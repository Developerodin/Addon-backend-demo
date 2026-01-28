import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import { validateBolnaWebhook } from '../../middlewares/validateBolnaWebhook.js';
import crmValidation from '../../validations/crm.validation.js';
import * as callController from '../../controllers/crm/call.controller.js';
import * as providerController from '../../controllers/crm/provider.controller.js';
import * as contactController from '../../controllers/crm/contact.controller.js';
import * as webhookLogController from '../../controllers/crm/webhookLog.controller.js';
import * as ngrokController from '../../controllers/crm/ngrok.controller.js';
import * as bolnaController from '../../controllers/crm/bolna.controller.js';
import * as plivoController from '../../controllers/crm/plivo.controller.js';
import * as exotelController from '../../controllers/crm/exotel.controller.js';

const router = express.Router();

// Call routes
router
  .route('/calls')
  .post(
    auth(),
    validate(crmValidation.createCall),
    callController.createCall
  )
  .get(
    auth(),
    validate(crmValidation.getCalls),
    callController.getCalls
  );

router
  .route('/calls/bulk')
  .post(
    auth(),
    validate(crmValidation.createBulkCalls),
    callController.createBulkCalls
  );

router
  .route('/calls/:callId')
  .get(
    auth(),
    validate(crmValidation.getCall),
    callController.getCall
  )
  .patch(
    auth(),
    validate(crmValidation.updateCall),
    callController.updateCall
  )
  .delete(
    auth(),
    validate(crmValidation.deleteCall),
    callController.deleteCall
  );

// Provider routes
router
  .route('/providers')
  .post(
    auth(),
    validate(crmValidation.createProvider),
    providerController.createProvider
  )
  .get(
    auth(),
    validate(crmValidation.getProviders),
    providerController.getProviders
  );

router
  .route('/providers/:providerId')
  .get(
    auth(),
    validate(crmValidation.getProvider),
    providerController.getProvider
  )
  .patch(
    auth(),
    validate(crmValidation.updateProvider),
    providerController.updateProvider
  )
  .delete(
    auth(),
    validate(crmValidation.deleteProvider),
    providerController.deleteProvider
  );

router
  .route('/search')
  .get(
    auth(),
    validate(crmValidation.searchProviders),
    providerController.searchProviders
  );

// Contact routes
router
  .route('/contacts')
  .post(
    auth(),
    validate(crmValidation.createContact),
    contactController.createContact
  )
  .get(
    auth(),
    validate(crmValidation.getContacts),
    contactController.getContacts
  );

router
  .route('/contacts/bulk')
  .post(
    auth(),
    validate(crmValidation.createBulkContacts),
    contactController.createBulkContacts
  );

router
  .route('/contacts/:contactId')
  .get(
    auth(),
    validate(crmValidation.getContact),
    contactController.getContact
  )
  .patch(
    auth(),
    validate(crmValidation.updateContact),
    contactController.updateContact
  )
  .delete(
    auth(),
    validate(crmValidation.deleteContact),
    contactController.deleteContact
  );

router
  .route('/contacts/:contactId/increment-call-count')
  .post(
    auth(),
    validate(crmValidation.getContact),
    contactController.incrementCallCount
  );

router
  .route('/contacts/:contactId/toggle-favorite')
  .post(
    auth(),
    validate(crmValidation.getContact),
    contactController.toggleFavorite
  );

// Webhook route (no auth required - receives webhooks directly from Bolna AI)
router
  .route('/webhook')
  .post(
    validateBolnaWebhook, // Validate IP from Bolna AI or ngrok
    validate(crmValidation.updateCallStatus),
    callController.updateCallStatus
  )
  .get(
    callController.getWebhookInfo // Get webhook URL info for configuration
  );

// Webhook log routes (optional, for debugging/admin)
router
  .route('/webhook-logs')
  .get(
    auth(),
    validate(crmValidation.getWebhookLogs),
    webhookLogController.getWebhookLogs
  )
  .post(
    auth(),
    validate(crmValidation.createWebhookLog),
    webhookLogController.createWebhookLog
  );

router
  .route('/webhook-logs/execution/:executionId')
  .get(
    auth(),
    webhookLogController.getWebhookLogByExecutionId
  );

router
  .route('/webhook-logs/call/:callId')
  .get(
    auth(),
    webhookLogController.getWebhookLogsByCallId
  );

router
  .route('/webhook-logs/:webhookLogId')
  .get(
    auth(),
    validate(crmValidation.getWebhookLog),
    webhookLogController.getWebhookLog
  )
  .patch(
    auth(),
    validate(crmValidation.updateWebhookLog),
    webhookLogController.updateWebhookLog
  )
  .delete(
    auth(),
    validate(crmValidation.deleteWebhookLog),
    webhookLogController.deleteWebhookLog
  );

// ngrok routes
router
  .route('/ngrok/url')
  .get(
    auth(),
    ngrokController.getNgrokUrl
  );

router
  .route('/ngrok/webhook-url')
  .get(
    auth(),
    ngrokController.getWebhookUrl
  );

router
  .route('/ngrok/status')
  .get(
    auth(),
    ngrokController.getNgrokStatus
  );

router
  .route('/ngrok/test')
  .post(
    auth(),
    ngrokController.testWebhook
  );

// Bolna API routes
router
  .route('/bolna/execution/:executionId')
  .get(
    auth(),
    validate(crmValidation.getExecutionDetails),
    bolnaController.getExecutionDetails
  );

router
  .route('/bolna/execution/:executionId/diagnostics')
  .get(
    auth(),
    bolnaController.getExecutionDiagnostics
  );

router
  .route('/bolna/agent/:agentId')
  .get(
    auth(),
    validate(crmValidation.getAgentDetails),
    bolnaController.getAgentDetails
  );

router
  .route('/bolna/agent/:agentId/executions')
  .get(
    auth(),
    validate(crmValidation.getAgentExecutions),
    bolnaController.getAgentExecutions
  );

router
  .route('/bolna/sync-all')
  .post(
    auth(),
    validate(crmValidation.syncAllExecutions),
    bolnaController.syncAllExecutions
  );

router
  .route('/bolna/batches/:batchId/executions')
  .get(
    auth(),
    validate(crmValidation.getBatchExecutions),
    bolnaController.getBatchExecutions
  );

router
  .route('/bolna/phone-numbers')
  .get(
    auth(),
    bolnaController.getPhoneNumbers
  );

router
  .route('/bolna/validate-caller-id')
  .post(
    auth(),
    bolnaController.validateCallerId
  );

router
  .route('/bolna/agent/:agentId/update-plivo')
  .patch(
    auth(),
    bolnaController.updateAgentToUsePlivo
  );

router
  .route('/bolna/agent/:agentId/check-plivo')
  .get(
    auth(),
    bolnaController.checkAgentPlivoConfig
  );

router
  .route('/bolna/agents/update-all-plivo')
  .post(
    auth(),
    bolnaController.updateAllAgentsToUsePlivo
  );

// Setup endpoint (no auth required, uses secret key from .env)
router
  .route('/bolna/agents/update-all-plivo-setup')
  .post(
    bolnaController.updateAllAgentsToUsePlivoNoAuth
  );

router
  .route('/bolna/agents/check-all-plivo')
  .get(
    auth(),
    bolnaController.checkAllAgentsPlivoConfig
  );

// Setup endpoint for checking (no auth required, uses secret key from .env)
router
  .route('/bolna/agents/check-all-plivo-setup')
  .get(
    bolnaController.checkAllAgentsPlivoConfigNoAuth
  );

// Health check route
router
  .route('/health')
  .get(
    bolnaController.healthCheck
  );

// Provider search diagnostic route (for debugging)
router
  .route('/providers/check-config')
  .get(
    auth(),
    providerController.checkProviderConfig
  );

// Plivo routes
router
  .route('/plivo/balance')
  .get(
    auth(),
    plivoController.getBalance
  );

router
  .route('/plivo/usage')
  .get(
    auth(),
    plivoController.getUsage
  );

router
  .route('/plivo/account-info')
  .get(
    auth(),
    plivoController.getAccountInfo
  )
  .patch(
    auth(),
    plivoController.updateAccount
  );

router
  .route('/plivo/recent-usage')
  .get(
    auth(),
    plivoController.getRecentUsage
  );

router
  .route('/plivo/numbers/countries')
  .get(
    auth(),
    plivoController.getAvailableCountries
  );

router
  .route('/plivo/numbers/country/:countryCode')
  .get(
    auth(),
    plivoController.getCountryInfo
  );

router
  .route('/plivo/numbers/search')
  .get(
    auth(),
    plivoController.searchAvailableNumbers
  );

router
  .route('/plivo/numbers/purchase')
  .post(
    auth(),
    plivoController.purchasePhoneNumber
  );

router
  .route('/plivo/numbers/add-from-carrier')
  .post(
    auth(),
    plivoController.addNumberFromCarrier
  );

router
  .route('/plivo/numbers/owned')
  .get(
    auth(),
    plivoController.getOwnedNumbers
  );

router
  .route('/plivo/numbers/:phoneNumber')
  .get(
    auth(),
    plivoController.getNumberDetails
  )
  .patch(
    auth(),
    plivoController.updateNumber
  )
  .delete(
    auth(),
    plivoController.deletePhoneNumber
  );

router
  .route('/plivo/calls/live')
  .get(
    auth(),
    plivoController.getLiveCalls
  );

router
  .route('/plivo/calls/queued')
  .get(
    auth(),
    plivoController.getQueuedCalls
  );

router
  .route('/plivo/calls/queued/:callUuid')
  .get(
    auth(),
    plivoController.getQueuedCallDetails
  );

router
  .route('/plivo/calls/:callUuid/record')
  .post(
    auth(),
    plivoController.startCallRecording
  )
  .delete(
    auth(),
    plivoController.stopCallRecording
  );

// Exotel routes
router
  .route('/exotel/balance')
  .get(
    auth(),
    exotelController.getBalance
  );

router
  .route('/exotel/usage')
  .get(
    auth(),
    exotelController.getUsage
  );

router
  .route('/exotel/account-info')
  .get(
    auth(),
    exotelController.getAccountInfo
  );

router
  .route('/exotel/recent-usage')
  .get(
    auth(),
    exotelController.getRecentUsage
  );

router
  .route('/exotel/numbers/countries')
  .get(
    auth(),
    exotelController.getAvailableCountries
  );

router
  .route('/exotel/numbers/country/:countryCode')
  .get(
    auth(),
    exotelController.getCountryInfo
  );

router
  .route('/exotel/numbers/search')
  .get(
    auth(),
    exotelController.searchAvailableNumbers
  );

router
  .route('/exotel/numbers/purchase')
  .post(
    auth(),
    exotelController.purchasePhoneNumber
  );

router
  .route('/exotel/numbers/owned')
  .get(
    auth(),
    exotelController.getOwnedNumbers
  );

router
  .route('/exotel/numbers/:sid')
  .get(
    auth(),
    exotelController.getNumberDetails
  )
  .put(
    auth(),
    exotelController.updateNumber
  )
  .delete(
    auth(),
    exotelController.deleteNumber
  );

router
  .route('/exotel/numbers/:phoneNumber/metadata')
  .get(
    auth(),
    exotelController.getNumberMetadata
  );

router
  .route('/exotel/calls')
  .get(
    auth(),
    exotelController.getCalls
  );

router
  .route('/exotel/calls/:callSid')
  .get(
    auth(),
    exotelController.getCallDetails
  );

router
  .route('/exotel/calls/connect')
  .post(
    auth(),
    exotelController.connectCall
  );

export default router;
