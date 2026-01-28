import httpStatus from 'http-status';
import Call from '../../models/crm/call.model.js';
import ApiError from '../../utils/ApiError.js';
import * as bolnaService from './bolnaService.js';
import * as contactService from './contact.service.js';
import { normalizePhone } from '../../utils/phone.js';
import logger from '../../config/logger.js';

/**
 * Create a call record and initiate call via Bolna AI API
 * @param {Object} callBody
 * @returns {Promise<Call>}
 */
export const createCall = async (callBody) => {
  // Create call record in MongoDB
  const call = await Call.create({
    ...callBody,
    status: 'initiated',
    startedAt: new Date(),
  });

  // Update contact's call count if contact exists
  // Try multiple phone number formats to find the contact
  try {
    const phoneVariations = [
      callBody.phone, // Original format
      normalizePhone(callBody.phone), // Normalized E.164 format
      callBody.phone.replace(/\D/g, ''), // Digits only
      callBody.phone.replace(/^\+91/, ''), // Without +91 prefix
      callBody.phone.replace(/^91/, ''), // Without 91 prefix
    ].filter(Boolean); // Remove null/undefined values
    
    // Remove duplicates
    const uniquePhones = [...new Set(phoneVariations)];
    
    let contactFound = false;
    for (const phoneToTry of uniquePhones) {
      try {
        const contact = await contactService.getContactByPhone(phoneToTry);
        if (contact && contact._id) {
          await contactService.incrementCallCount(contact._id);
          logger.info(`✅ Updated call count for contact ${contact._id} (matched phone: ${phoneToTry}, original: ${callBody.phone})`);
          contactFound = true;
          break; // Found contact, no need to try other variations
        }
      } catch (err) {
        // Continue to next variation
        continue;
      }
    }
    
    if (!contactFound) {
      logger.debug(`ℹ️ No contact found for phone ${callBody.phone} (tried variations: ${uniquePhones.join(', ')})`);
    }
  } catch (contactError) {
    // Don't fail call creation if contact update fails
    logger.warn(`⚠️ Failed to update contact call count for phone ${callBody.phone}: ${contactError.message}`);
  }

  try {
    // Construct full location string from address components
    // Priority: full address > address + city > city + state > city > location field
    let location = '';
    const addressParts = [];
    
    if (callBody.address) {
      addressParts.push(callBody.address);
    }
    if (callBody.city) {
      addressParts.push(callBody.city);
    }
    if (callBody.state) {
      addressParts.push(callBody.state);
    }
    if (callBody.country && callBody.country !== 'India') {
      addressParts.push(callBody.country);
    }
    
    if (addressParts.length > 0) {
      location = addressParts.join(', ');
    } else {
      // Fallback to location field or city
      location = callBody.location || callBody.city || '';
    }
    
    // Initiate call directly via Bolna AI API
    const bolnaResponse = await bolnaService.initiateCall({
      phone: callBody.phone,
      business_name: callBody.businessName,
      businessName: callBody.businessName,
      service_type: callBody.serviceType || '',
      serviceType: callBody.serviceType || '',
      location: location,
      address: callBody.address,
      city: callBody.city,
      state: callBody.state,
      country: callBody.country,
      language: callBody.language || 'en',
      provider_id: callBody.providerId,
      from_phone_number: callBody.fromPhoneNumber,
      fromPhoneNumber: callBody.fromPhoneNumber,
    });

    // Update call record with Bolna response
    if (bolnaResponse.success) {
      if (bolnaResponse.call) {
        call.externalCallId = bolnaResponse.call.execution_id || bolnaResponse.call.external_call_id;
        call.executionId = bolnaResponse.call.execution_id || bolnaResponse.call.external_call_id;
        call.agentId = bolnaResponse.call.agent_id;
        call.language = bolnaResponse.call.language || callBody.language || 'en';
      } else if (bolnaResponse.execution_id) {
        // Handle direct execution_id in response
        call.externalCallId = bolnaResponse.execution_id;
        call.executionId = bolnaResponse.execution_id;
      }
      call.status = 'in_progress';
      await call.save();
    }
  } catch (error) {
    // Update call status to failed if Bolna call fails
    call.status = 'failed';
    call.errorMessage = error.message;
    await call.save();
    throw error;
  }

  return call;
};

/**
 * Query for calls
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const queryCalls = async (filter, options) => {
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
      paginateOptions.sortBy = 'startedAt:desc';
    }

    const calls = await Call.paginate(filter, {
      ...paginateOptions,
      populate: 'providerId',
    });

    return calls;
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
 * Get call by id
 * @param {ObjectId} id
 * @returns {Promise<Call>}
 */
export const getCallById = async (id) => {
  return Call.findById(id).populate('providerId');
};

/**
 * Get call by execution ID
 * @param {string} executionId
 * @returns {Promise<Call>}
 */
export const getCallByExecutionId = async (executionId) => {
  return Call.findOne({
    $or: [
      { executionId: executionId },
      { externalCallId: executionId }
    ]
  }).populate('providerId');
};

/**
 * Update call by execution ID
 * @param {string} executionId
 * @param {Object} updateBody
 * @returns {Promise<Call>}
 */
export const updateCallByExecutionId = async (executionId, updateBody) => {
  const call = await getCallByExecutionId(executionId);
  if (!call) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Call not found for the given execution ID');
  }

  // Only update fields that are provided and not null/undefined
  Object.keys(updateBody).forEach(key => {
    if (updateBody[key] !== undefined && updateBody[key] !== null) {
      call[key] = updateBody[key];
    }
  });
  
  await call.save();
  return call;
};

/**
 * Update call by id
 * @param {ObjectId} callId
 * @param {Object} updateBody
 * @returns {Promise<Call>}
 */
export const updateCallById = async (callId, updateBody) => {
  const call = await getCallById(callId);
  if (!call) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
  }

  Object.assign(call, updateBody);
  await call.save();
  return call;
};

/**
 * Delete call by id
 * @param {ObjectId} callId
 * @returns {Promise<Call>}
 */
export const deleteCallById = async (callId) => {
  const call = await getCallById(callId);
  if (!call) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
  }
  await call.deleteOne();
  return call;
};

/**
 * Get call by request ID
 * @param {string} requestId
 * @returns {Promise<Call>}
 */
export const getCallByRequestId = async (requestId) => {
  return Call.findOne({ requestId }).populate('providerId');
};

/**
 * Get calls by provider ID
 * @param {ObjectId} providerId
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const getCallsByProviderId = async (providerId, options = {}) => {
  const filter = { providerId };
  return queryCalls(filter, options);
};

/**
 * Get calls by status
 * @param {string} status
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const getCallsByStatus = async (status, options = {}) => {
  const filter = { status };
  return queryCalls(filter, options);
};

/**
 * Update call status only
 * @param {ObjectId} callId
 * @param {string} status
 * @returns {Promise<Call>}
 */
export const updateCallStatus = async (callId, status) => {
  const call = await getCallById(callId);
  if (!call) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
  }
  call.status = status;
  await call.save();
  return call;
};

/**
 * Update call completion data
 * @param {ObjectId} callId
 * @param {Object} completionData - { duration, transcription, extractedData, recordingUrl, etc. }
 * @returns {Promise<Call>}
 */
export const updateCallCompletion = async (callId, completionData) => {
  const call = await getCallById(callId);
  if (!call) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
  }

  if (completionData.duration !== undefined) {
    call.duration = completionData.duration;
  }
  if (completionData.transcription !== undefined) {
    call.transcription = completionData.transcription;
  }
  if (completionData.extractedData !== undefined) {
    call.extractedData = completionData.extractedData;
  }
  if (completionData.recordingUrl !== undefined) {
    call.recordingUrl = completionData.recordingUrl;
  }
  if (completionData.completedAt !== undefined) {
    call.completedAt = completionData.completedAt;
  }
  if (completionData.status !== undefined) {
    call.status = completionData.status;
  }

  await call.save();
  return call;
};

/**
 * Create multiple calls in bulk
 * @param {Array<Object>} callsData - Array of call objects
 * @returns {Promise<Array<{success: boolean, call?: Call, error?: string}>>}
 */
export const createBulkCalls = async (callsData) => {
  const results = [];
  
  // Process calls in parallel with error handling
  const promises = callsData.map(async (callData) => {
    try {
      const call = await createCall(callData);
      return { success: true, call };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to create call',
        phone: callData.phone,
        businessName: callData.businessName,
      };
    }
  });
  
  const settledResults = await Promise.allSettled(promises);
  
  settledResults.forEach((result) => {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      results.push({
        success: false,
        error: result.reason?.message || 'Unknown error',
      });
    }
  });
  
  return results;
};
