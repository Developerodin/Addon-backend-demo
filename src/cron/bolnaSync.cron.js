import { CronJob } from 'cron';
import logger from '../config/logger.js';
import * as callService from '../services/crm/call.service.js';
import * as bolnaService from '../services/crm/bolnaService.js';

/**
 * Schedule Bolna call status synchronization job
 * Automatically syncs call statuses from Bolna API to keep CRM dashboard updated
 * Runs every 1 minute by default
 * @param {string} schedule - Cron schedule pattern (default: every 1 minute)
 */
export const startBolnaSyncJob = (schedule = '* * * * *') => {
  const job = new CronJob(
    schedule,
    async () => {
      try {
        logger.info('🔄 Starting scheduled Bolna call status sync...');
        
        // Get all calls that need syncing:
        // 1. Active calls (in_progress, initiated) to update their status
        // 2. Failed/error calls to get error details, transcripts, recordings that might have arrived later
        // 3. Completed calls without duration to get duration, transcripts, recordings (especially for Hindi calls)
        // 4. Recently completed calls (last 2 hours) to get any late-arriving data
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const inProgressCalls = await callService.queryCalls(
          { 
            $or: [
              // Active or failed calls
              { status: { $in: ['in_progress', 'initiated', 'failed', 'error'] } },
              // Completed calls without duration (to fetch duration that might have arrived later)
              { status: 'completed', duration: { $exists: false } },
              { status: 'completed', duration: null },
              // Recently completed calls (might have late-arriving duration/transcripts)
              { status: 'completed', completedAt: { $gte: twoHoursAgo } },
            ],
            // Only sync calls from the last 24 hours to avoid syncing very old calls
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          },
          { limit: 1000, page: 1 }
        );

        const callsToSync = inProgressCalls.results || [];
        
        if (callsToSync.length === 0) {
          logger.info('✅ No in-progress calls to sync');
          return;
        }

        logger.info(`📞 Found ${callsToSync.length} in-progress calls to sync`);

        // Group calls by executionId and get unique execution IDs
        const executionIds = [...new Set(callsToSync.map(call => call.executionId).filter(Boolean))];
        
        if (executionIds.length === 0) {
          logger.info('⚠️ No execution IDs found in calls');
          return;
        }

        logger.info(`🔄 Syncing ${executionIds.length} unique executions...`);
        
        let syncedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;

        // Sync each execution (batch process to avoid overwhelming the API)
        for (const executionId of executionIds.slice(0, 50)) { // Limit to 50 per run
          try {
            const executionData = await bolnaService.getExecutionDetails(executionId);
            
            // Find the call(s) with this executionId
            const calls = callsToSync.filter(call => call.executionId === executionId);
            
            for (const call of calls) {
              // Extract status (check both status and smart_status)
              let status = executionData.status || executionData.smart_status;
              
              // Normalize status
              if (status) {
                status = String(status).toLowerCase().trim();
                const statusMap = {
                  'done': 'completed',
                  'finished': 'completed',
                  'ended': 'completed',
                  'success': 'completed',
                  'error': 'failed',
                  'errored': 'failed',
                  'cancelled': 'failed',
                  'canceled': 'failed',
                  'stopped': 'failed',
                  'initiate': 'initiated',
                  'initiated': 'initiated',
                  'no-answer': 'no_answer',
                  // 'call-disconnected' means call connected but then disconnected - keep as separate status
                  'call-disconnected': 'call_disconnected',
                  'in-progress': 'in_progress',
                  'balance-low': 'failed',
                  'queued': 'initiated',
                  'ringing': 'in_progress',
                };
                status = statusMap[status] || status;
              }

              // Extract duration from multiple possible locations (important for Hindi calls)
              const telephonyData = executionData.telephony_data || {};
              let conversationDuration = executionData.conversation_time || 
                executionData.duration || 
                telephonyData.duration ||
                telephonyData.conversation_duration;
              // Parse duration (0 is a valid duration, so check for null/undefined)
              if (conversationDuration !== null && conversationDuration !== undefined) {
                conversationDuration = parseInt(conversationDuration, 10);
                // If parsing fails, set to null
                if (isNaN(conversationDuration)) {
                  conversationDuration = null;
                }
              } else {
                conversationDuration = null;
              }
              
              // Extract recording URL and transcript
              const recordingUrl = telephonyData.recording_url || executionData.recording_url;
              const transcript = executionData.transcript || executionData.transcription;
              
              // Always update status if it's different from Bolna, regardless of other data
              // This ensures status stays in sync with Bolna dashboard
              const statusChanged = status && status !== call.status;
              const isTerminalCall = (call.status === 'failed' || call.status === 'error' || call.status === 'completed');
              const hasNewData = (executionData.error_message && executionData.error_message !== call.errorMessage) ||
                                 (recordingUrl && recordingUrl !== call.recordingUrl) ||
                                 (transcript && transcript !== call.transcription) ||
                                 (conversationDuration !== null && conversationDuration !== call.duration);
              
              // Always update if status changed (even if call already has complete data)
              // OR if terminal call has new data
              if (statusChanged || (isTerminalCall && hasNewData)) {
                const updateData = {};
                
                // Always update status if it changed - this ensures sync with Bolna dashboard
                // Even if call already has complete data, status should match Bolna
                if (statusChanged) {
                  updateData.status = status;
                  logger.info(`🔄 Status change detected: ${call.status} → ${status} for call ${call._id}`);
                }

                // Always update duration if available (especially important for Hindi calls)
                // Update even if call.duration is null/undefined/0
                if (conversationDuration !== null && conversationDuration !== call.duration) {
                  updateData.duration = conversationDuration;
                }

                // Always update recording/transcript if available (especially for failed/completed calls)
                if (recordingUrl && recordingUrl !== call.recordingUrl) {
                  updateData.recordingUrl = recordingUrl;
                }
                if (transcript && transcript !== call.transcription) {
                  updateData.transcription = transcript;
                }
                
                // Extract error message if status is error/failed (always update for failed calls)
                if ((status === 'failed' || status === 'error' || call.status === 'failed' || call.status === 'error') && executionData.error_message) {
                  let errorMessage = executionData.error_message;
                  if (typeof errorMessage === 'string') {
                    try {
                      const parsed = JSON.parse(errorMessage);
                      if (parsed.message) {
                        errorMessage = parsed.message;
                      }
                    } catch (e) {
                      // Not JSON, use as-is
                    }
                  }
                  // Update error message if it's different or missing
                  if (String(errorMessage) !== call.errorMessage) {
                    updateData.errorMessage = String(errorMessage);
                  }
                }

                // Set completedAt for terminal statuses
                const finalStatus = status || call.status;
                const endedStatuses = ['completed', 'failed', 'no_answer', 'busy', 'stopped', 'error', 'call_disconnected', 'balance-low'];
                if (endedStatuses.includes(finalStatus) && !call.completedAt) {
                  updateData.completedAt = executionData.updated_at ? 
                    new Date(executionData.updated_at) : 
                    (executionData.initiated_at ? new Date(executionData.initiated_at) : new Date());
                }

                // Only update if there's actual data to update
                if (Object.keys(updateData).length > 0) {
                  await callService.updateCallByExecutionId(executionId, updateData);
                  updatedCount++;
                  const statusUpdate = statusChanged ? `${call.status} → ${status}` : call.status;
                  logger.info(`✅ Updated call ${call._id}: ${statusUpdate}${hasNewData ? ' (with new data)' : ''}`);
                }
              }
            }
            
            syncedCount++;
          } catch (error) {
            errorCount++;
            logger.error(`❌ Failed to sync execution ${executionId}: ${error.message}`);
          }
        }

        logger.info(`✅ Scheduled Bolna sync completed: ${syncedCount} executions synced, ${updatedCount} calls updated, ${errorCount} errors`);
      } catch (error) {
        logger.error('❌ Error in scheduled Bolna call sync:', error);
      }
    },
    null, // onComplete callback
    true, // start immediately
    'UTC' // timezone
  );

  logger.info(`🔄 Bolna call sync cron job started with schedule: ${schedule}`);
  return job;
};

/**
 * Stop a Bolna sync cron job
 * @param {CronJob} job - Cron job instance
 */
export const stopBolnaSyncJob = (job) => {
  if (job) {
    job.stop();
    logger.info('Bolna sync cron job stopped');
  }
};

export default {
  startBolnaSyncJob,
  stopBolnaSyncJob,
};
