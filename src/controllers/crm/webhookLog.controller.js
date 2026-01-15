import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as webhookLogService from '../../services/crm/webhookLog.service.js';

export const getWebhookLogs = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['executionId', 'callId', 'providerId', 'status']);
  const options = pick(req.query, ['sortBy', 'sortOrder', 'limit', 'page', 'populate']);
  
  if (options.limit) {
    options.limit = parseInt(options.limit, 10);
  }
  if (options.page) {
    options.page = parseInt(options.page, 10);
  }
  
  const result = await webhookLogService.queryWebhookLogs(filter, options);
  res.send(result);
});

export const getWebhookLog = catchAsync(async (req, res) => {
  const webhookLog = await webhookLogService.getWebhookLogById(req.params.webhookLogId);
  if (!webhookLog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Webhook log not found');
  }
  res.send(webhookLog);
});

export const getWebhookLogByExecutionId = catchAsync(async (req, res) => {
  const webhookLog = await webhookLogService.getWebhookLogByExecutionId(req.params.executionId);
  if (!webhookLog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Webhook log not found');
  }
  res.send(webhookLog);
});

export const getWebhookLogsByCallId = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit']);
  if (options.limit) {
    options.limit = parseInt(options.limit, 10);
  }
  const webhookLogs = await webhookLogService.getWebhookLogsByCallId(req.params.callId, options);
  res.send(webhookLogs);
});

export const createWebhookLog = catchAsync(async (req, res) => {
  const webhookLog = await webhookLogService.createWebhookLog(req.body);
  res.status(httpStatus.CREATED).send(webhookLog);
});

export const updateWebhookLog = catchAsync(async (req, res) => {
  const webhookLog = await webhookLogService.updateWebhookLogById(req.params.webhookLogId, req.body);
  res.send(webhookLog);
});

export const deleteWebhookLog = catchAsync(async (req, res) => {
  await webhookLogService.deleteWebhookLogById(req.params.webhookLogId);
  res.status(httpStatus.NO_CONTENT).send();
});
