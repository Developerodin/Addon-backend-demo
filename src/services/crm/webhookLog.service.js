import httpStatus from 'http-status';
import WebhookLog from '../../models/crm/webhookLog.model.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Get webhook log by execution ID
 * @param {string} executionId
 * @returns {Promise<WebhookLog>}
 */
export const getWebhookLogByExecutionId = async (executionId) => {
  return WebhookLog.findOne({ executionId })
    .sort({ receivedAt: -1 })
    .populate('callId')
    .populate('providerId');
};

/**
 * Get webhook logs by call ID
 * @param {ObjectId} callId
 * @param {Object} options - Query options
 * @returns {Promise<WebhookLog[]>}
 */
export const getWebhookLogsByCallId = async (callId, options = {}) => {
  const limit = options.limit || 100;
  return WebhookLog.find({ callId })
    .sort({ receivedAt: -1 })
    .limit(limit)
    .populate('callId')
    .populate('providerId');
};

/**
 * Query for webhook logs
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const queryWebhookLogs = async (filter, options) => {
  try {
    if (!filter || typeof filter !== 'object') {
      filter = {};
    }

    // Combine sortBy and sortOrder
    const paginateOptions = { ...options };
    if (options.sortBy && options.sortOrder) {
      paginateOptions.sortBy = `${options.sortBy}:${options.sortOrder}`;
    } else if (options.sortBy) {
      paginateOptions.sortBy = `${options.sortBy}:desc`;
    } else {
      paginateOptions.sortBy = 'receivedAt:desc';
    }

    const webhookLogs = await WebhookLog.paginate(filter, {
      ...paginateOptions,
      populate: ['callId', 'providerId'],
    });

    return webhookLogs;
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Invalid ID format: ${error.value}`
      );
    }
    throw error;
  }
};

/**
 * Create a webhook log
 * @param {Object} webhookLogBody
 * @returns {Promise<WebhookLog>}
 */
export const createWebhookLog = async (webhookLogBody) => {
  return WebhookLog.create({
    ...webhookLogBody,
    receivedAt: webhookLogBody.receivedAt || new Date(),
  });
};

/**
 * Get webhook log by id
 * @param {ObjectId} id
 * @returns {Promise<WebhookLog>}
 */
export const getWebhookLogById = async (id) => {
  return WebhookLog.findById(id).populate('callId').populate('providerId');
};

/**
 * Update webhook log by id
 * @param {ObjectId} webhookLogId
 * @param {Object} updateBody
 * @returns {Promise<WebhookLog>}
 */
export const updateWebhookLogById = async (webhookLogId, updateBody) => {
  const webhookLog = await getWebhookLogById(webhookLogId);
  if (!webhookLog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Webhook log not found');
  }

  Object.assign(webhookLog, updateBody);
  await webhookLog.save();
  return webhookLog;
};

/**
 * Delete webhook log by id
 * @param {ObjectId} webhookLogId
 * @returns {Promise<WebhookLog>}
 */
export const deleteWebhookLogById = async (webhookLogId) => {
  const webhookLog = await getWebhookLogById(webhookLogId);
  if (!webhookLog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Webhook log not found');
  }
  await webhookLog.deleteOne();
  return webhookLog;
};
