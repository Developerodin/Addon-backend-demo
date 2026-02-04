import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import * as agentUiFlowService from '../services/agent/agentUiFlow.service.js';

/**
 * POST /v1/agent/ui-flow/start
 * Body: { jobId }
 * Loads flow by job's flowKey, marks job running, returns job + flow so frontend can open stream.
 */
const startUiFlow = catchAsync(async (req, res) => {
  const { jobId } = req.body;
  const { job, flow } = await agentUiFlowService.startUiFlow(jobId);
  res.status(httpStatus.OK).json({
    success: true,
    data: { job, flow },
  });
});

const STEP_DELAY_MS = 1000;

/**
 * GET /v1/agent/ui-flow/stream?jobId=xxx
 * SSE: streams resolved steps one-by-one with delay so UI can react. Resumable: if job already completed, sends no steps.
 */
const streamUiFlow = catchAsync(async (req, res) => {
  const { jobId } = req.query;
  const job = await agentUiFlowService.getJobByJobId(jobId);
  if (!job) {
    return res.status(httpStatus.NOT_FOUND).json({ success: false, message: `Job not found: ${jobId}` });
  }
  if (job.status === 'completed') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ jobId, step: { type: 'DONE' }, alreadyCompleted: true })}\n\n`);
    return res.end();
  }
  if (job.status !== 'running') {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: `Job ${jobId} is not running (status: ${job.status})`,
    });
  }

  const flow = await agentUiFlowService.loadFlow(job.flowKey);
  const context = job.context || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const step of flow.steps) {
    const resolved = agentUiFlowService.resolveStep(step, context);
    res.write(`data: ${JSON.stringify({ jobId, step: resolved })}\n\n`);
    if (typeof res.flush === 'function') res.flush();
    await delay(STEP_DELAY_MS);
  }

  res.end();
});

/**
 * POST /v1/agent/ui-flow/complete
 * Body: { jobId }
 * Marks job completed (call after frontend receives DONE step). Idempotent: returns 200 if already completed.
 */
const completeUiFlow = catchAsync(async (req, res) => {
  const { jobId } = req.body;
  await agentUiFlowService.completeUiFlow(jobId, 'completed');
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Job completed',
  });
});

/**
 * POST /v1/agent/ui-flow/job
 * Body: { jobId, flowKey, refType?, refId?, context? }
 * Create a new agent job (pending). Then frontend can call start with this jobId.
 */
const createJob = catchAsync(async (req, res) => {
  const job = await agentUiFlowService.createJob(req.body);
  res.status(httpStatus.CREATED).json({
    success: true,
    data: job,
  });
});

export { startUiFlow, streamUiFlow, completeUiFlow, createJob };
