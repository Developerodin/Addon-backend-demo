import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import ApiError from '../../utils/ApiError.js';
import * as bolnaService from '../../services/crm/bolnaService.js';
import * as callService from '../../services/crm/call.service.js';
import * as webhookLogService from '../../services/crm/webhookLog.service.js';
import logger from '../../config/logger.js';

/**
 * Get execution details from Bolna API
 */
export const getExecutionDetails = catchAsync(async (req, res) => {
  const { executionId } = req.params;
  const { store } = req.query;

  const executionData = await bolnaService.getExecutionDetails(executionId);
  
  logger.info(`Fetched execution details for execution_id: ${executionId}`);

  // Optionally store in database if store parameter is true
  let stored = false;
  if (store === 'true') {
    try {
      // Check if webhook log already exists
      let existingLog = await webhookLogService.getWebhookLogByExecutionId(executionId);

      if (!existingLog) {
        // Try to find associated call
        const call = await callService.getCallByExecutionId(executionId);
        const callId = call?._id || null;
        const providerId = call?.providerId || null;

        // Create webhook log entry
        existingLog = await webhookLogService.createWebhookLog({
          executionId,
          payload: executionData,
          callId,
          providerId,
        });

        // Extract telephony data
        const telephonyData = executionData.telephony_data || {};
        
        // Extract recording URL
        const recordingUrl = telephonyData.recording_url || executionData.recording_url;
        
        // Extract conversation duration
        let conversationDuration = executionData.conversation_time || 
          executionData.duration || 
          telephonyData.duration;
        if (conversationDuration) {
          conversationDuration = parseInt(conversationDuration, 10);
        }
        
        // Extract total cost
        let totalCost = executionData.total_cost;
        if (totalCost) {
          totalCost = parseFloat(totalCost);
        }

        // Update with extracted fields
        const updateData = {
          status: executionData.status,
          transcript: executionData.transcript || executionData.transcription,
          extractedData: executionData.extracted_data,
          recordingUrl,
          telephonyData,
          conversationDuration,
          totalCost,
          processedAt: new Date(),
        };

        // Remove null/undefined values
        Object.keys(updateData).forEach(key => {
          if (updateData[key] === null || updateData[key] === undefined) {
            delete updateData[key];
          }
        });

        if (Object.keys(updateData).length > 0) {
          await webhookLogService.updateWebhookLogById(existingLog._id, updateData);
        }

        logger.info(`✅ Execution data stored: webhook_log_id=${existingLog._id}`);
        stored = true;
      }
    } catch (error) {
      logger.warn(`Failed to store execution data: ${error.message}`);
    }
  }

  res.status(httpStatus.OK).send({
    success: true,
    execution: executionData,
    stored,
  });
});

/**
 * Get agent details from Bolna API
 */
export const getAgentDetails = catchAsync(async (req, res) => {
  const { agentId } = req.params;

  const agentData = await bolnaService.getAgentDetails(agentId);
  
  logger.info(`Fetched agent details for agent_id: ${agentId}`);

  res.status(httpStatus.OK).send({
    success: true,
    agent: agentData,
  });
});

/**
 * Get agent executions from Bolna API
 */
export const getAgentExecutions = catchAsync(async (req, res) => {
  const { agentId } = req.params;
  const limit = parseInt(req.query.limit || '100', 10);
  const offset = parseInt(req.query.offset || '0', 10);

  const executions = await bolnaService.getAgentExecutions(agentId, limit, offset);
  
  logger.info(`Fetched executions for agent_id: ${agentId}`);

  res.status(httpStatus.OK).send({
    success: true,
    agent_id: agentId,
    executions: Array.isArray(executions) ? executions : executions.data || executions,
    limit,
    offset,
  });
});

/**
 * Sync all executions from Bolna API
 * Uses the new v2 agent executions API for better performance and pagination
 */
export const syncAllExecutions = catchAsync(async (req, res) => {
  const { 
    limit = 1000, 
    onlyMissing = true,
    agentId, // Optional: sync specific agent, otherwise syncs both
    status, // Optional: filter by status
    from, // Optional: start date (ISO 8601)
    to, // Optional: end date (ISO 8601)
  } = req.body;

  const config = await import('../../config/config.js');
  const agentIdEnglish = config.default.bolna?.agentIdEnglish;
  const agentIdHindi = config.default.bolna?.agentIdHindi;

  // Determine which agents to sync
  const agentsToSync = [];
  if (agentId) {
    agentsToSync.push(agentId);
  } else {
    if (agentIdEnglish) agentsToSync.push(agentIdEnglish);
    if (agentIdHindi) agentsToSync.push(agentIdHindi);
  }

  if (agentsToSync.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No agent IDs configured. Please set AGENT_ID_ENGLISH and/or AGENT_ID_HINDI in environment variables.');
  }

  let totalSynced = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  const errors = [];
  const executionMap = new Map(); // Map executionId -> execution data

  // Fetch executions from each agent using v2 API
  for (const agentIdToSync of agentsToSync) {
    logger.info(`🔄 Syncing executions for agent: ${agentIdToSync}`);
    
    let pageNumber = 1;
    const pageSize = 50; // Max allowed by API
    let hasMore = true;

    while (hasMore && totalSynced < limit) {
      try {
        const response = await bolnaService.getAgentExecutionsV2(agentIdToSync, {
          pageNumber,
          pageSize,
          status,
          from,
          to,
        });

        const executions = response.data || [];
        const total = response.total || 0;
        hasMore = response.has_more || false;

        logger.info(`📥 Fetched page ${pageNumber}: ${executions.length} executions (total: ${total})`);

        // Store executions in map (latest execution data wins)
        for (const execution of executions) {
          if (execution.id) {
            executionMap.set(execution.id, execution);
          }
        }

        totalSynced += executions.length;

        // Check if we've reached the limit
        if (totalSynced >= limit) {
          logger.info(`⏹️ Reached sync limit of ${limit}`);
          break;
        }

        // Move to next page
        if (hasMore) {
          pageNumber++;
        }
      } catch (error) {
        logger.error(`❌ Error fetching executions for agent ${agentIdToSync}, page ${pageNumber}: ${error.message}`);
        totalErrors++;
        errors.push(`Agent ${agentIdToSync}, page ${pageNumber}: ${error.message}`);
        hasMore = false; // Stop pagination on error
      }
    }
  }

  logger.info(`📊 Total executions fetched: ${executionMap.size}`);

  // Now update call records with fetched execution data
  let updatedCount = 0;
  let skippedCount = 0;

  // Get all calls with execution_ids
  const calls = await callService.queryCalls({}, { limit: 10000, page: 1 });

  for (const call of calls.results || []) {
    if (!call.executionId) {
      continue;
    }

    const executionData = executionMap.get(call.executionId);
    if (!executionData) {
      // Execution not found in fetched data (might be older than date range)
      continue;
    }

    // If onlyMissing is true, skip calls that already have complete data
    if (onlyMissing) {
      const hasCompleteData = call.transcription && call.recordingUrl && 
                              (call.status === 'completed' || call.status === 'failed' || call.status === 'no_answer' || call.status === 'busy');
      if (hasCompleteData) {
        skippedCount++;
        continue;
      }
    }

    try {

      // Extract data from Bolna response
      const telephonyData = executionData.telephony_data || {};
      const recordingUrl = telephonyData.recording_url || executionData.recording_url;
      const transcript = executionData.transcript || executionData.transcription;
      let status = executionData.status || call.status;
      
      // Normalize Bolna status format (hyphens) to our format (underscores)
      if (status) {
        status = String(status).toLowerCase().trim();
        const statusMap = {
          'no-answer': 'no_answer',
          'call-disconnected': 'failed',
          'in-progress': 'in_progress',
          'balance-low': 'failed',
        };
        status = statusMap[status] || status;
      }
      
      let conversationDuration = executionData.conversation_time || 
        executionData.duration || 
        telephonyData.duration;
      if (conversationDuration) {
        conversationDuration = parseInt(conversationDuration, 10);
      }

      let totalCost = executionData.total_cost;
      if (totalCost) {
        totalCost = parseFloat(totalCost);
      }

      // Prepare call update data
      const callUpdateData = {};
      if (status && status !== call.status) {
        callUpdateData.status = status.toLowerCase();
      }
      if (recordingUrl && recordingUrl !== call.recordingUrl) {
        callUpdateData.recordingUrl = recordingUrl;
      }
      if (transcript && transcript !== call.transcription) {
        callUpdateData.transcription = transcript;
      }
      if (conversationDuration && conversationDuration !== call.duration) {
        callUpdateData.duration = conversationDuration;
      }
      if (executionData.extracted_data) {
        callUpdateData.extractedData = executionData.extracted_data;
      }
      if (executionData.ai_analysis || executionData.aiAnalysis) {
        callUpdateData.aiAnalysis = executionData.ai_analysis || executionData.aiAnalysis;
      }
      if (executionData.error_message || executionData.errorMessage) {
        callUpdateData.errorMessage = executionData.error_message || executionData.errorMessage;
      }
      
      // Set completedAt if status indicates call ended
      const endedStatuses = ['completed', 'failed', 'no_answer', 'no-answer', 'busy', 'call-disconnected', 'canceled'];
      if (endedStatuses.includes(status?.toLowerCase()) && !call.completedAt) {
        callUpdateData.completedAt = executionData.updated_at ? 
          new Date(executionData.updated_at) : 
          (executionData.created_at ? new Date(executionData.created_at) : new Date());
      }
      
      if (executionData.agent_id || executionData.agentId) {
        callUpdateData.agentId = executionData.agent_id || executionData.agentId;
      }

      // Update call record if there's data to update
      if (Object.keys(callUpdateData).length > 0) {
        await callService.updateCallByExecutionId(call.executionId, callUpdateData);
        updatedCount++;
        totalUpdated++;
        logger.info(`✅ Updated call record: executionId=${call.executionId}, status=${status}, hasRecording=${!!recordingUrl}, hasTranscript=${!!transcript}`);
      }

      // Check if webhook log already exists
      const existingLog = await webhookLogService.getWebhookLogByExecutionId(call.executionId);
      
      // Create or update webhook log
      if (existingLog) {
        const logUpdateData = {
          status: status || existingLog.status,
          transcript: transcript || existingLog.transcript,
          extractedData: executionData.extracted_data || existingLog.extractedData,
          recordingUrl: recordingUrl || existingLog.recordingUrl,
          telephonyData: telephonyData || existingLog.telephonyData,
          conversationDuration: conversationDuration || existingLog.conversationDuration,
          totalCost: totalCost || existingLog.totalCost,
          processedAt: new Date(),
          payload: executionData, // Update payload with latest data
        };

        // Remove null/undefined values
        Object.keys(logUpdateData).forEach(key => {
          if (logUpdateData[key] === null || logUpdateData[key] === undefined) {
            delete logUpdateData[key];
          }
        });

        await webhookLogService.updateWebhookLogById(existingLog._id, logUpdateData);
      } else {
        const newLog = await webhookLogService.createWebhookLog({
          executionId: call.executionId,
          payload: executionData,
          callId: call._id,
          providerId: call.providerId,
        });

        const logUpdateData = {
          status: status,
          transcript: transcript,
          extractedData: executionData.extracted_data,
          recordingUrl: recordingUrl,
          telephonyData: telephonyData,
          conversationDuration: conversationDuration,
          totalCost: totalCost,
          processedAt: new Date(),
        };

        // Remove null/undefined values
        Object.keys(logUpdateData).forEach(key => {
          if (logUpdateData[key] === null || logUpdateData[key] === undefined) {
            delete logUpdateData[key];
          }
        });

        if (Object.keys(logUpdateData).length > 0) {
          await webhookLogService.updateWebhookLogById(newLog._id, logUpdateData);
        }
      }

      logger.info(`✅ Synced execution_id: ${call.executionId}`);
    } catch (error) {
      totalErrors++;
      const errorMsg = `Failed to sync ${call.executionId}: ${error.message}`;
      errors.push(errorMsg);
      logger.warn(errorMsg);
    }
  }

  res.status(httpStatus.OK).send({
    success: true,
    synced: totalSynced,
    updated: totalUpdated,
    skipped: skippedCount,
    errors: totalErrors,
    error_details: errors.slice(0, 10), // Limit error details
    agents_synced: agentsToSync.length,
    message: `Synced ${totalSynced} executions from ${agentsToSync.length} agent(s), updated ${totalUpdated} call records, skipped ${skippedCount} already complete`,
  });
});

/**
 * Health check endpoint
 */
export const healthCheck = catchAsync(async (req, res) => {
  res.status(httpStatus.OK).send({
    success: true,
    status: 'healthy',
    database: 'connected',
  });
});

/**
 * Get batch executions from Bolna API
 */
export const getBatchExecutions = catchAsync(async (req, res) => {
  const { batchId } = req.params;
  const { store } = req.query;

  const batchExecutions = await bolnaService.getBatchExecutions(batchId);
  
  logger.info(`Fetched batch executions for batch_id: ${batchId}`);

  let storedCount = 0;

  // Optionally store in database if store parameter is true
  if (store === 'true' && Array.isArray(batchExecutions)) {
    try {
      for (const execution of batchExecutions) {
        const executionId = execution.id || execution.execution_id;
        if (!executionId) {
          continue;
        }

        // Check if already stored
        const existingLog = await webhookLogService.getWebhookLogByExecutionId(executionId);
        if (existingLog) {
          continue;
        }

        // Try to find associated call
        const call = await callService.getCallByExecutionId(executionId);
        const callId = call?._id || null;
        const providerId = call?.providerId || null;

        // Create webhook log entry
        const webhookLog = await webhookLogService.createWebhookLog({
          executionId,
          payload: execution,
          callId,
          providerId,
        });

        // Update with extracted fields
        const telephonyData = execution.telephony_data || {};
        const updateData = {
          status: execution.status,
          transcript: execution.transcript,
          extractedData: execution.extracted_data,
          recordingUrl: telephonyData.recording_url,
          telephonyData,
          conversationDuration: execution.conversation_time,
          totalCost: execution.total_cost,
          processedAt: new Date(),
        };

        // Remove null/undefined values
        Object.keys(updateData).forEach(key => {
          if (updateData[key] === null || updateData[key] === undefined) {
            delete updateData[key];
          }
        });

        if (Object.keys(updateData).length > 0) {
          await webhookLogService.updateWebhookLogById(webhookLog._id, updateData);
        }

        storedCount++;
      }

      logger.info(`✅ Stored ${storedCount} batch executions in database`);
    } catch (error) {
      logger.warn(`Failed to store batch executions: ${error.message}`);
    }
  }

  if (Array.isArray(batchExecutions)) {
    res.status(httpStatus.OK).send({
      success: true,
      batch_id: batchId,
      executions: batchExecutions,
      count: batchExecutions.length,
      stored: store === 'true' ? storedCount : undefined,
    });
  } else {
    res.status(httpStatus.OK).send({
      success: true,
      batch_id: batchId,
      data: batchExecutions,
      stored: store === 'true' ? storedCount : undefined,
    });
  }
});
