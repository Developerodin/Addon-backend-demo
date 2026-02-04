import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import AgentJob from '../../models/agent/agentJob.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UI_FLOWS_DIR = path.join(__dirname, '../../agent/ui-flows');

/**
 * Map flowKey to JSON filename (e.g. "purchase.po.create.ui" -> "purchase.po.create.json")
 * @param {string} flowKey
 * @returns {string} filename
 */
function flowKeyToFilename(flowKey) {
  const base = flowKey.replace(/\.ui$/, '');
  return `${base}.json`;
}

/**
 * Get value from object by dot path (e.g. "order.items" -> context.order.items)
 * @param {Object} obj
 * @param {string} dotPath
 * @returns {*}
 */
function getByPath(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Load flow definition from agent/ui-flows by flowKey
 * @param {string} flowKey
 * @returns {Promise<Object>} { flowKey, description, version, steps }
 */
async function loadFlow(flowKey) {
  const filename = flowKeyToFilename(flowKey);
  const filePath = path.join(UI_FLOWS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new ApiError(httpStatus.NOT_FOUND, `Flow not found: ${flowKey}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Resolve a step using context: replace "from" with actual data
 * @param {Object} step - raw step from flow JSON
 * @param {Object} context - job context (e.g. { order: { purchaseDate, supplierName, items, notes } })
 * @returns {Object} resolved step for frontend
 */
function resolveStep(step, context) {
  const resolved = { ...step };

  if (resolved.from !== undefined) {
    const value = getByPath(context, resolved.from);
    resolved.value = value;
    delete resolved.from;
  }

  return resolved;
}

/**
 * Get job by jobId
 * @param {string} jobId
 * @returns {Promise<AgentJob|null>}
 */
async function getJobByJobId(jobId) {
  return AgentJob.findOne({ jobId });
}

/**
 * Start a UI flow: load job, load flow, mark job running. Caller then streams steps.
 * @param {string} jobId
 * @returns {Promise<{ job: AgentJob, flow: Object }>}
 */
async function startUiFlow(jobId) {
  const job = await AgentJob.findOne({ jobId });
  if (!job) {
    throw new ApiError(httpStatus.NOT_FOUND, `Job not found: ${jobId}`);
  }
  if (job.status !== 'pending') {
    throw new ApiError(httpStatus.BAD_REQUEST, `Job ${jobId} is not pending (status: ${job.status})`);
  }

  const flow = await loadFlow(job.flowKey);
  job.status = 'running';
  await job.save();

  return { job, flow };
}

/**
 * Mark job completed or failed. Idempotent: if already completed, returns job without error.
 * @param {string} jobId
 * @param {'completed'|'failed'} status
 * @returns {Promise<AgentJob>}
 */
async function completeUiFlow(jobId, status = 'completed') {
  const job = await AgentJob.findOne({ jobId });
  if (!job) {
    throw new ApiError(httpStatus.NOT_FOUND, `Job not found: ${jobId}`);
  }
  if (job.status === 'completed') {
    return job;
  }
  job.status = status;
  job.completedAt = new Date();
  await job.save();
  return job;
}

/**
 * Create a new agent job (for creating a job before starting the flow)
 * @param {Object} params - { jobId, flowKey, refType?, refId?, context? }
 * @returns {Promise<AgentJob>}
 */
async function createJob(params) {
  const { jobId, flowKey, refType, refId, context } = params;
  const existing = await AgentJob.findOne({ jobId });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Job already exists: ${jobId}`);
  }
  const job = await AgentJob.create({
    jobId,
    flowKey,
    refType: refType || null,
    refId: refId || null,
    context: context || {},
    status: 'pending',
  });
  return job;
}

export {
  loadFlow,
  resolveStep,
  getJobByJobId,
  startUiFlow,
  completeUiFlow,
  createJob,
};
