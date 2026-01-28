import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import logger from '../../config/logger.js';
import * as callService from '../../services/crm/call.service.js';
import * as webhookLogService from '../../services/crm/webhookLog.service.js';

export const createCall = catchAsync(async (req, res) => {
  const call = await callService.createCall(req.body);
  res.status(httpStatus.CREATED).send(call);
});

export const getCalls = catchAsync(async (req, res) => {
  const allowedFilterFields = [
    'providerId', 'phone', 'status', 'language', 'startedAt', 'completedAt'
  ];
  const filter = pick(req.query, allowedFilterFields);
  
  // Handle date range filtering
  if (req.query.dateFrom || req.query.dateTo) {
    filter.startedAt = {};
    if (req.query.dateFrom) {
      filter.startedAt.$gte = new Date(req.query.dateFrom);
    }
    if (req.query.dateTo) {
      const endDate = new Date(req.query.dateTo);
      endDate.setHours(23, 59, 59, 999);
      filter.startedAt.$lte = endDate;
    }
  }
  
  const allowedOptions = ['sortBy', 'sortOrder', 'limit', 'page', 'populate'];
  const options = pick(req.query, allowedOptions);
  
  if (options.limit) {
    options.limit = parseInt(options.limit, 10);
  }
  if (options.page) {
    options.page = parseInt(options.page, 10);
  }
  
  // Default sort by startedAt descending
  if (!options.sortBy) {
    options.sortBy = 'startedAt:desc';
  }
  
  const result = await callService.queryCalls(filter, options);
  res.send(result);
});

export const getCall = catchAsync(async (req, res) => {
  const call = await callService.getCallById(req.params.callId);
  if (!call) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
  }
  res.send(call);
});

export const updateCall = catchAsync(async (req, res) => {
  const call = await callService.updateCallById(req.params.callId, req.body);
  res.send(call);
});

export const deleteCall = catchAsync(async (req, res) => {
  await callService.deleteCallById(req.params.callId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const createBulkCalls = catchAsync(async (req, res) => {
  const { calls } = req.body;
  const results = await callService.createBulkCalls(calls);
  res.status(httpStatus.CREATED).send({ results });
});

export const updateCallStatus = catchAsync(async (req, res) => {
  // Webhook endpoint for Bolna AI to update call status directly
  // Supports both direct Bolna webhooks and Flask-forwarded webhooks
  
  const payload = req.body;
  
  // Log incoming webhook for debugging
  logger.info('📥 Webhook received:', JSON.stringify(payload, null, 2));
  
  // Extract execution_id from various possible locations in Bolna payload
  const executionId = payload.id || 
                      payload.execution_id || 
                      payload.executionId ||
                      payload.data?.id ||
                      payload.data?.execution_id ||
                      payload.callId; // Fallback for Flask-forwarded
  
  logger.info(`🔍 Extracted executionId: ${executionId}`);
  
  // Extract status - check multiple possible locations and formats
  // Bolna sends both 'status' and 'smart_status' fields
  let status = payload.status || 
               payload.smart_status || // Bolna's smart_status field
               payload.data?.status ||
               payload.data?.smart_status ||
               payload.call?.status ||
               payload.state; // Some webhook formats use 'state'
  
  // Normalize status values - map Bolna statuses to our internal format
  if (status) {
    status = String(status).toLowerCase().trim();
    // Map common variations and Bolna-specific statuses
    // Based on Bolna API v2 documentation: queued, ringing, initiate, in-progress, 
    // call-disconnected, completed, balance-low, busy, no-answer, canceled, failed, stopped, error
    const statusMap = {
      'done': 'completed',
      'finished': 'completed',
      'ended': 'completed',
      'success': 'completed',
      'error': 'failed',
      'errored': 'failed',
      'cancelled': 'failed',
      'canceled': 'failed',
      'stopped': 'failed', // Stopped calls are treated as failed
      'initiate': 'initiated', // Initial call state
      'initiated': 'initiated',
      // Map Bolna statuses (with hyphens) to our format (with underscores)
      'no-answer': 'no_answer',
      'call-disconnected': 'call_disconnected', // Keep as separate status
      'in-progress': 'in_progress',
      'balance-low': 'failed',
      'queued': 'initiated', // Queued calls are in initial state
      'ringing': 'in_progress', // Ringing means call is in progress
    };
    status = statusMap[status] || status;
  }
  
  logger.info(`📊 Extracted status: ${status}`);
  
  // Extract agent_id
  const agentId = payload.agent_id || 
                  payload.agentId ||
                  payload.data?.agent_id ||
                  payload.data?.agentId ||
                  payload.call?.agent_id;
  
  // Extract other fields from Bolna payload format
  const duration = payload.duration || 
                   payload.conversation_time ||
                   payload.conversation_duration ||
                   payload.data?.duration ||
                   payload.telephony_data?.duration ||
                   payload.telephony_data?.conversation_duration;
  
  const recordingUrl = payload.recording_url || 
                      payload.recordingUrl ||
                      payload.data?.recording_url ||
                      payload.telephony_data?.recording_url;
  
  const transcription = payload.transcript || 
                       payload.transcription ||
                       payload.data?.transcript ||
                       payload.data?.transcription ||
                       payload.conversation?.transcript ||
                       payload.conversation?.transcription;
  
  const extractedData = payload.extracted_data || 
                       payload.extractedData ||
                       payload.data?.extracted_data;
  
  const aiAnalysis = payload.ai_analysis || 
                    payload.aiAnalysis ||
                    payload.data?.ai_analysis;
  
  const errorMessage = payload.error_message || 
                      payload.errorMessage ||
                      payload.data?.error_message;
  
  const completedAt = payload.completed_at || 
                      payload.completedAt ||
                      payload.data?.completed_at ||
                      payload.ended_at ||
                      payload.endedAt ||
                      payload.finished_at ||
                      payload.finishedAt;
  
  // Prefer executionId for webhook updates
  if (!executionId && !payload.callId) {
    logger.error('❌ Webhook received without executionId or callId:', JSON.stringify(payload, null, 2));
    throw new ApiError(httpStatus.BAD_REQUEST, 'Either executionId or callId is required');
  }
  
  // Try to find the call first to get callId for webhook log
  let call = null;
  if (executionId) {
    call = await callService.getCallByExecutionId(executionId);
    logger.info(`🔍 Call lookup by executionId ${executionId}: ${call ? 'Found' : 'Not found'}`);
  } else if (payload.callId) {
    call = await callService.getCallById(payload.callId);
    logger.info(`🔍 Call lookup by callId ${payload.callId}: ${call ? 'Found' : 'Not found'}`);
  }
  
  if (!call) {
    logger.warn(`⚠️ Call not found for executionId: ${executionId || payload.callId}`);
    // Still create webhook log for debugging
    try {
      await webhookLogService.createWebhookLog({
        executionId: executionId || payload.callId,
        payload: payload,
        status: status,
        transcript: transcription,
        recordingUrl: recordingUrl,
      });
    } catch (err) {
      logger.error('Failed to create webhook log:', err);
    }
    return res.status(httpStatus.NOT_FOUND).send({ 
      success: false, 
      error: 'Call not found',
      executionId: executionId || payload.callId 
    });
  }
  
  // Build update object with all webhook fields (only include non-null/undefined values)
  const updateData = {};
  if (status !== undefined && status !== null && status !== '') {
    updateData.status = String(status).toLowerCase();
  }
  if (duration !== undefined && duration !== null && duration !== '') {
    const parsedDuration = parseInt(duration, 10);
    if (!isNaN(parsedDuration)) {
      updateData.duration = parsedDuration;
    }
  }
  if (recordingUrl !== undefined && recordingUrl !== null && recordingUrl !== '') {
    updateData.recordingUrl = String(recordingUrl);
  }
  if (transcription !== undefined && transcription !== null && transcription !== '') {
    updateData.transcription = String(transcription);
  }
  if (extractedData !== undefined && extractedData !== null) {
    updateData.extractedData = extractedData;
  }
  if (aiAnalysis !== undefined && aiAnalysis !== null) {
    updateData.aiAnalysis = aiAnalysis;
  }
  if (errorMessage !== undefined && errorMessage !== null && errorMessage !== '') {
    updateData.errorMessage = String(errorMessage);
  }
  if (completedAt !== undefined && completedAt !== null && completedAt !== '') {
    updateData.completedAt = completedAt instanceof Date ? completedAt : new Date(completedAt);
  } else if (status && (status === 'completed' || status === 'failed' || status === 'no_answer' || status === 'no-answer' || status === 'busy' || status === 'stopped' || status === 'error' || status === 'call_disconnected' || status === 'call-disconnected' || status === 'balance-low')) {
    // Auto-set completedAt if status indicates call ended but no timestamp provided
    updateData.completedAt = new Date();
  }
  if (agentId !== undefined && agentId !== null && agentId !== '') {
    updateData.agentId = String(agentId);
  }
  
  logger.info(`📝 Update data (${Object.keys(updateData).length} fields):`, JSON.stringify(updateData, null, 2));
  
  if (Object.keys(updateData).length === 0) {
    logger.warn('⚠️ No valid fields to update in webhook payload');
    return res.send({ success: true, message: 'Webhook received but no fields to update', call });
  }
  
  // Update the call
  const updatedCall = await callService.updateCallByExecutionId(executionId || call.executionId, updateData);
  
  if (!updatedCall) {
    logger.error(`❌ Failed to update call with executionId: ${executionId || call.executionId}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to update call');
  }
  
  // Create webhook log entry
  try {
    await webhookLogService.createWebhookLog({
      executionId: executionId || call.executionId,
      callId: call._id,
      providerId: call.providerId,
      payload: payload,
      status: status,
      transcript: transcription,
      recordingUrl: recordingUrl,
      extractedData: extractedData,
      telephonyData: payload.telephony_data,
      conversationDuration: duration,
      processedAt: new Date(),
    });
  } catch (err) {
    logger.error('Failed to create webhook log:', err);
    // Don't fail the request if webhook log creation fails
  }
  
  logger.info(`✅ Webhook processed successfully: executionId=${executionId}, status=${status}, agentId=${agentId}, duration=${duration}, hasRecording=${!!recordingUrl}, hasTranscript=${!!transcription}`);
  logger.info(`📋 Updated call status: ${updatedCall.status}, completedAt: ${updatedCall.completedAt}`);
  
  res.send({ success: true, call: updatedCall });
});

/**
 * Get webhook configuration info for debugging
 */
export const getWebhookInfo = catchAsync(async (req, res) => {
  const ngrokService = await import('../../services/crm/ngrokService.js');
  const webhookUrl = await ngrokService.default.getWebhookUrl();
  
  res.send({
    webhookUrl: webhookUrl || 'Not configured',
    endpoint: '/v1/crm/webhook',
    note: 'Configure this URL in Bolna AI dashboard for both English and Hindi agents',
    authorizedIPs: [
      '13.200.45.61',
      '65.2.44.157',
      '34.194.233.253',
      '13.204.98.4',
      '43.205.31.43',
      '107.20.118.52'
    ],
    localhostAllowed: true,
    ngrokAllowed: true,
  });
});
