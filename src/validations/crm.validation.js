import Joi from 'joi';
import { objectId } from './custom.validation.js';

// Call validations
const createCall = {
  body: Joi.object().keys({
    providerId: Joi.string().custom(objectId).optional(),
    phone: Joi.string().required(),
    businessName: Joi.string().required(),
    serviceType: Joi.string().optional(),
    location: Joi.string().optional(),
    address: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    country: Joi.string().optional(),
    language: Joi.string().valid('en', 'hi').default('en'),
    fromPhoneNumber: Joi.string().optional(),
  }),
};

const getCalls = {
  query: Joi.object().keys({
    providerId: Joi.string().custom(objectId).optional(),
    phone: Joi.string().optional(),
    status: Joi.string().valid('initiated', 'in_progress', 'completed', 'failed', 'no_answer', 'no-answer', 'busy', 'call_disconnected').optional(),
    language: Joi.string().valid('en', 'hi').optional(),
    dateFrom: Joi.date().optional(),
    dateTo: Joi.date().optional(),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer().optional(),
    page: Joi.number().integer().optional(),
  }),
};

const getCall = {
  params: Joi.object().keys({
    callId: Joi.string().custom(objectId).required(),
  }),
};

const updateCall = {
  params: Joi.object().keys({
    callId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      status: Joi.string().valid('initiated', 'in_progress', 'completed', 'failed', 'no_answer', 'no-answer', 'busy', 'call_disconnected').optional(),
      duration: Joi.number().min(0).optional(),
      recordingUrl: Joi.string().optional(),
      transcription: Joi.string().optional(),
      extractedData: Joi.object().optional(),
      aiAnalysis: Joi.object().optional(),
      errorMessage: Joi.string().optional(),
      completedAt: Joi.date().optional(),
    })
    .min(1),
};

const deleteCall = {
  params: Joi.object().keys({
    callId: Joi.string().custom(objectId).required(),
  }),
};

// Provider validations
const createProvider = {
  body: Joi.object().keys({
    placeId: Joi.string().optional(),
    name: Joi.string().required(),
    phone: Joi.string().optional(),
    email: Joi.string().email().optional(),
    address: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    country: Joi.string().default('India'),
    latitude: Joi.number().optional(),
    longitude: Joi.number().optional(),
    rating: Joi.number().min(0).max(5).optional(),
    reviewCount: Joi.number().min(0).optional(),
    businessStatus: Joi.string().valid('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY').optional(),
    priceLevel: Joi.number().min(1).max(4).optional(),
    serviceType: Joi.string().optional(),
    distanceKm: Joi.number().optional(),
    score: Joi.number().optional(),
    status: Joi.string().valid('pending', 'calling', 'available', 'unavailable', 'no_answer', 'failed').optional(),
    notes: Joi.string().optional(),
    metadata: Joi.object().optional(),
    expiresAt: Joi.date().optional(),
  }),
};

const getProviders = {
  query: Joi.object().keys({
    serviceType: Joi.string().optional(),
    status: Joi.string().valid('pending', 'calling', 'available', 'unavailable', 'no_answer', 'failed').optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    country: Joi.string().optional(),
    businessStatus: Joi.string().valid('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY').optional(),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer().optional(),
    page: Joi.number().integer().optional(),
  }),
};

const getProvider = {
  params: Joi.object().keys({
    providerId: Joi.string().custom(objectId).required(),
  }),
};

const updateProvider = {
  params: Joi.object().keys({
    providerId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().min(1),
};

const deleteProvider = {
  params: Joi.object().keys({
    providerId: Joi.string().custom(objectId).required(),
  }),
};

const searchProviders = {
  query: Joi.object().keys({
    query: Joi.string().optional(),
    location: Joi.string().optional(),
    serviceType: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

// Contact validations
const createContact = {
  body: Joi.object().keys({
    providerId: Joi.string().custom(objectId).allow('').optional(),
    name: Joi.string().required(),
    phone: Joi.string().required(),
    email: Joi.string().email().allow('').optional(),
    address: Joi.string().allow('').optional(),
    city: Joi.string().allow('').optional(),
    state: Joi.string().allow('').optional(),
    country: Joi.string().default('India'),
    serviceType: Joi.string().allow('').optional(),
    notes: Joi.string().allow('').optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    isFavorite: Joi.boolean().optional(),
    userId: Joi.string().optional(),
  }),
};

const getContacts = {
  query: Joi.object().keys({
    serviceType: Joi.string().optional(),
    isFavorite: Joi.boolean().optional(),
    userId: Joi.string().optional(),
    tags: Joi.string().optional(),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer().optional(),
    page: Joi.number().integer().optional(),
  }),
};

const getContact = {
  params: Joi.object().keys({
    contactId: Joi.string().custom(objectId).required(),
  }),
};

const updateContact = {
  params: Joi.object().keys({
    contactId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().min(1),
};

const deleteContact = {
  params: Joi.object().keys({
    contactId: Joi.string().custom(objectId).required(),
  }),
};

// Bulk call validation
const createBulkCalls = {
  body: Joi.object().keys({
    calls: Joi.array()
      .items(
        Joi.object().keys({
          providerId: Joi.string().custom(objectId).optional(),
          phone: Joi.string().required(),
          businessName: Joi.string().required(),
          serviceType: Joi.string().optional(),
          location: Joi.string().optional(),
          address: Joi.string().optional(),
          city: Joi.string().optional(),
          state: Joi.string().optional(),
          country: Joi.string().optional(),
          language: Joi.string().valid('en', 'hi').default('en'),
          fromPhoneNumber: Joi.string().optional(),
        })
      )
      .min(1)
      .max(100)
      .required(),
  }),
};

// Bulk contact validation
const createBulkContacts = {
  body: Joi.object().keys({
    contacts: Joi.array()
      .items(
        Joi.object().keys({
          providerId: Joi.string().custom(objectId).allow('').optional(),
          name: Joi.string().required(),
          phone: Joi.string().required(),
          email: Joi.string().email().allow('').optional(),
          address: Joi.string().allow('').optional(),
          city: Joi.string().allow('').optional(),
          state: Joi.string().allow('').optional(),
          country: Joi.string().default('India'),
          serviceType: Joi.string().allow('').optional(),
          notes: Joi.string().allow('').optional(),
          tags: Joi.array().items(Joi.string()).optional(),
          isFavorite: Joi.boolean().optional(),
        })
      )
      .min(1)
      .max(100)
      .required(),
  }),
};

// Webhook validation
const updateCallStatus = {
  body: Joi.object().keys({
    // Direct fields (from Flask-forwarded webhooks)
    callId: Joi.string().custom(objectId).optional(),
    executionId: Joi.string().optional(),
    execution_id: Joi.string().optional(),
    id: Joi.string().optional(), // Bolna sends 'id' as execution_id
    status: Joi.string().valid('initiated', 'in_progress', 'completed', 'failed', 'no_answer', 'no-answer', 'busy', 'call_disconnected').optional(),
    duration: Joi.number().min(0).optional(),
    conversation_time: Joi.number().min(0).optional(), // Bolna field
    recordingUrl: Joi.string().optional(),
    recording_url: Joi.string().optional(), // Bolna field
    transcription: Joi.string().optional(),
    transcript: Joi.string().optional(), // Bolna field
    extractedData: Joi.object().optional(),
    extracted_data: Joi.object().optional(), // Bolna field
    aiAnalysis: Joi.object().optional(),
    ai_analysis: Joi.object().optional(), // Bolna field
    errorMessage: Joi.string().optional(),
    error_message: Joi.string().optional(), // Bolna field
    completedAt: Joi.date().optional(),
    completed_at: Joi.date().optional(), // Bolna field
    agentId: Joi.string().optional(),
    agent_id: Joi.string().optional(), // Bolna field
    // Nested data object (Bolna format)
    data: Joi.object().optional(),
    telephony_data: Joi.object().optional(), // Bolna field
    // Raw payload for debugging
    rawPayload: Joi.object().optional(),
  }).or('callId', 'executionId', 'execution_id', 'id'), // At least one identifier must be provided
};

// Webhook log validations
const createWebhookLog = {
  body: Joi.object().keys({
    executionId: Joi.string().required(),
    callId: Joi.string().custom(objectId).optional(),
    providerId: Joi.string().custom(objectId).optional(),
    payload: Joi.object().required(),
    status: Joi.string().optional(),
    transcript: Joi.string().optional(),
    extractedData: Joi.object().optional(),
    recordingUrl: Joi.string().optional(),
    telephonyData: Joi.object().optional(),
    conversationDuration: Joi.number().min(0).optional(),
    totalCost: Joi.number().min(0).optional(),
    receivedAt: Joi.date().optional(),
    processedAt: Joi.date().optional(),
  }),
};

const getWebhookLogs = {
  query: Joi.object().keys({
    executionId: Joi.string().optional(),
    callId: Joi.string().custom(objectId).optional(),
    providerId: Joi.string().custom(objectId).optional(),
    status: Joi.string().optional(),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    limit: Joi.number().integer().min(1).max(100).default(20),
    page: Joi.number().integer().min(1).default(1),
  }),
};

const getWebhookLog = {
  params: Joi.object().keys({
    webhookLogId: Joi.string().custom(objectId).required(),
  }),
};

const updateWebhookLog = {
  params: Joi.object().keys({
    webhookLogId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.string().optional(),
    transcript: Joi.string().optional(),
    extractedData: Joi.object().optional(),
    recordingUrl: Joi.string().optional(),
    telephonyData: Joi.object().optional(),
    conversationDuration: Joi.number().min(0).optional(),
    totalCost: Joi.number().min(0).optional(),
    processedAt: Joi.date().optional(),
  }).min(1),
};

const deleteWebhookLog = {
  params: Joi.object().keys({
    webhookLogId: Joi.string().custom(objectId).required(),
  }),
};

// Bolna API validations
const getExecutionDetails = {
  params: Joi.object().keys({
    executionId: Joi.string().required(),
  }),
  query: Joi.object().keys({
    store: Joi.string().valid('true', 'false').optional(),
  }),
};

const getAgentDetails = {
  params: Joi.object().keys({
    agentId: Joi.string().required(),
  }),
};

const getAgentExecutions = {
  params: Joi.object().keys({
    agentId: Joi.string().required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().integer().min(1).max(1000).optional(),
    offset: Joi.number().integer().min(0).optional(),
  }),
};

const syncAllExecutions = {
  body: Joi.object().keys({
    limit: Joi.number().integer().min(1).max(10000).optional().default(1000),
    onlyMissing: Joi.boolean().optional().default(true), // Only sync calls missing data
    agentId: Joi.string().optional().description('Optional: Sync specific agent ID, otherwise syncs all configured agents'),
    status: Joi.string().valid('queued', 'ringing', 'initiate', 'in-progress', 'call-disconnected', 'completed', 'balance-low', 'busy', 'no-answer', 'canceled', 'failed', 'stopped', 'error').optional(),
    from: Joi.string().isoDate().optional().description('Start date in ISO 8601 format (e.g., 2025-05-07T00:00:00.000Z)'),
    to: Joi.string().isoDate().optional().description('End date in ISO 8601 format (e.g., 2025-05-14T00:00:00.000Z)'),
  }),
};

const getBatchExecutions = {
  params: Joi.object().keys({
    batchId: Joi.string().required(),
  }),
  query: Joi.object().keys({
    store: Joi.string().valid('true', 'false').optional(),
  }),
};

export default {
  // Call
  createCall,
  getCalls,
  getCall,
  updateCall,
  deleteCall,
  updateCallStatus,
  createBulkCalls,
  // Provider
  createProvider,
  getProviders,
  getProvider,
  updateProvider,
  deleteProvider,
  searchProviders,
  // Contact
  createContact,
  getContacts,
  getContact,
  updateContact,
  deleteContact,
  createBulkContacts,
  // Webhook Log
  createWebhookLog,
  getWebhookLogs,
  getWebhookLog,
  updateWebhookLog,
  deleteWebhookLog,
  // Bolna API
  getExecutionDetails,
  getAgentDetails,
  getAgentExecutions,
  syncAllExecutions,
  getBatchExecutions,
};
