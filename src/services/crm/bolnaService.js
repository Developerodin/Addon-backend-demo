import fetch from 'node-fetch';
import config from '../../config/config.js';
import ApiError from '../../utils/ApiError.js';
import httpStatus from 'http-status';
import logger from '../../config/logger.js';
import { normalizePhone, validatePhone } from '../../utils/phone.js';
import { validateLanguage } from '../../utils/validators.js';
import { getTemplateData } from '../../utils/callTemplates.js';

/**
 * Get agent ID based on user-selected language
 * @param {string} language - User-selected language ('en' or 'hi')
 * @returns {string} Agent ID for the selected language
 */
const getAgentId = (language) => {
  if (!language) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Language selection is required. User must choose 'en' or 'hi'.");
  }

  const normalizedLang = language.toLowerCase().trim();
  const languageMap = {
    'en': config.bolna.agentIdEnglish,
    'english': config.bolna.agentIdEnglish,
    'eng': config.bolna.agentIdEnglish,
    'hi': config.bolna.agentIdHindi,
    'hindi': config.bolna.agentIdHindi,
    'hin': config.bolna.agentIdHindi,
  };

  const agentId = languageMap[normalizedLang];
  if (!agentId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid language: '${language}'. Must be 'en' (English) or 'hi' (Hindi).`
    );
  }

  return agentId;
};

/**
 * Initiate a call directly via Bolna AI API
 * @param {Object} callData - Call data including phone, businessName, language, etc.
 * @returns {Promise<Object>} Call execution result
 */
export const initiateCall = async (callData) => {
  try {
    const apiKey = config.bolna?.apiKey;
    const apiBase = config.bolna?.apiBase || 'https://api.bolna.ai';

    if (!apiKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'BOLNA_API_KEY is not configured');
    }

    // Validate required fields (phone and language are required, service_type and location can be empty)
    if (!callData.phone) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Missing required field: phone');
    }

    if (!callData.language) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Missing required field: language');
    }

    // Validate language
    const language = callData.language?.toLowerCase() || 'en';
    if (!validateLanguage(language)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid language. Must be "en" (English) or "hi" (Hindi). Language selection is required.'
      );
    }

    // Normalize language code
    let normalizedLanguage = language;
    if (['english', 'eng'].includes(language)) {
      normalizedLanguage = 'en';
    } else if (['hindi', 'hin'].includes(language)) {
      normalizedLanguage = 'hi';
    }

    // Get provider name from request
    const providerName = callData.business_name || callData.businessName || callData.provider_name || 'Business';

    // Normalize phone number to E.164 format
    const phoneNumber = normalizePhone(callData.phone);
    if (!phoneNumber || !validatePhone(phoneNumber)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid phone number format');
    }

    // Get agent ID based on user's explicit language choice
    const agentId = getAgentId(normalizedLanguage);

    // Get template data for the service type
    const serviceType = callData.service_type || callData.serviceType || '';
    
    // Construct full location string from address components
    // Priority: full address > address + city > city + state > city > location field
    let location = '';
    const addressParts = [];
    
    if (callData.address) {
      addressParts.push(callData.address);
    }
    if (callData.city) {
      addressParts.push(callData.city);
    }
    if (callData.state) {
      addressParts.push(callData.state);
    }
    if (callData.country && callData.country !== 'India') {
      addressParts.push(callData.country);
    }
    
    if (addressParts.length > 0) {
      location = addressParts.join(', ');
    } else {
      // Fallback to location field or city
      location = callData.location || callData.city || '';
    }
    
    const templateData = getTemplateData(
      serviceType,
      providerName,
      location,
      normalizedLanguage
    );
    
    // Add full address details to template data for better context
    if (callData.address || callData.city || callData.state) {
      templateData.address = callData.address || '';
      templateData.city = callData.city || '';
      templateData.state = callData.state || '';
      templateData.country = callData.country || 'India';
      templateData.full_address = location; // Full formatted address
    }

    // Build payload (caller ID is optional and not required)
    const payload = {
      agent_id: agentId,
      recipient_phone_number: phoneNumber,
      user_data: templateData
    };

    // Only add caller ID if configured (optional)
    if (config.bolna?.callerId) {
      payload.from_phone_number = config.bolna.callerId;
    }

    logger.info(`Initiating call to ${phoneNumber} with language ${normalizedLanguage}, service_type=${serviceType}, location=${location}`);
    logger.info(`Payload: ${JSON.stringify({ ...payload, user_data: '...' }, null, 2)}`);

    // Make request to Bolna AI
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await fetch(`${apiBase}/call`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new ApiError(httpStatus.REQUEST_TIMEOUT, 'Request timeout: Bolna API did not respond within 30 seconds');
      }
      logger.error(`Fetch error: ${fetchError.message}`);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Network error: ${fetchError.message}`);
    }

    clearTimeout(timeoutId);

    // Get response text first to handle both JSON and text errors
    const responseText = await response.text();
    
    // Check for specific error messages in response
    if (!response.ok) {
      try {
        const errorData = JSON.parse(responseText);
        const errorMessage = errorData.message || errorData.error || errorData.detail || '';

        // Check for wallet balance issue
        if (errorMessage.toLowerCase().includes('wallet') || 
            errorMessage.toLowerCase().includes('balance') || 
            errorMessage.toLowerCase().includes('recharge')) {
          const errorMsg = `Wallet balance low: ${errorMessage}`;
          logger.error(errorMsg);
          throw new ApiError(httpStatus.BAD_REQUEST, errorMsg);
        }

        // Check for other common errors
        if (errorMessage) {
          logger.error(`Bolna API Error (${response.status}): ${errorMessage}`);
          throw new ApiError(response.status || httpStatus.BAD_REQUEST, `Bolna API Error: ${errorMessage}`);
        }
      } catch (parseError) {
        if (parseError instanceof ApiError) {
          throw parseError;
        }
        // If JSON parsing fails, use response text
        logger.error(`Bolna API error (${response.status}): ${responseText}`);
        throw new ApiError(response.status || httpStatus.INTERNAL_SERVER_ERROR, `Bolna API error: ${responseText || 'Unknown error'}`);
      }
    }

    // Parse response JSON
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      logger.error(`Failed to parse Bolna API response: ${responseText}`);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Invalid response from Bolna API: ${responseText}`);
    }
    
    // Bolna AI API returns "id" or "execution_id" or "executionId"
    const executionId = result.id || result.execution_id || result.executionId;
    if (!executionId) {
      logger.error(`No execution_id in Bolna response: ${JSON.stringify(result)}`);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'No execution_id returned from Bolna');
    }

    logger.info(`Call initiated successfully: execution_id=${executionId}, phone=${phoneNumber}, language=${normalizedLanguage}`);

    // Return result in standardized format
    return {
      success: true,
      call: {
        execution_id: executionId,
        external_call_id: executionId,
        agent_id: agentId,
        phone: phoneNumber,
        business_name: providerName,
        language: normalizedLanguage,
        status: 'initiated'
      },
      message: 'Call initiated successfully'
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    // Handle unexpected errors
    const errorMsg = error.message || 'Failed to initiate call';
    logger.error(`Unexpected error initiating call: ${errorMsg}`, error);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, errorMsg);
  }
};

/**
 * DEPRECATED: Get call status from Flask backend
 * This function is commented out as we no longer use Flask backend.
 * Call status is now retrieved directly from Bolna API via getExecutionDetails().
 * 
 * @param {string} executionId - Execution ID from Bolna AI
 * @returns {Promise<Object>} Call status
 */
/*
export const getCallStatus = async (executionId) => {
  try {
    const response = await fetch(`${FLASK_BACKEND_URL}/api/calls/${executionId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status || httpStatus.INTERNAL_SERVER_ERROR,
        errorData.error || 'Failed to get call status from Flask backend'
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Flask backend error: ${error.message}`);
  }
};
*/

/**
 * Get execution details directly from Bolna API
 * @param {string} executionId - Execution ID
 * @returns {Promise<Object>} Execution details
 */
export const getExecutionDetails = async (executionId) => {
  try {
    const apiKey = config.bolna?.apiKey;
    const apiBase = config.bolna?.apiBase || 'https://api.bolna.ai';

    if (!apiKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'BOLNA_API_KEY is not configured');
    }

    const response = await fetch(`${apiBase}/executions/${executionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status || httpStatus.INTERNAL_SERVER_ERROR,
        errorData.message || errorData.error || 'Failed to get execution details from Bolna API'
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get execution details: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Bolna API error: ${error.message}`);
  }
};

/**
 * Get all executions for an agent using the new v2 API with pagination
 * @param {string} agentId - Agent ID
 * @param {Object} options - Query options
 * @param {number} options.pageNumber - Page number (default: 1)
 * @param {number} options.pageSize - Page size, max 50 (default: 20)
 * @param {string} options.status - Filter by status
 * @param {string} options.callType - Filter by call type (inbound/outbound)
 * @param {string} options.from - Start date (ISO 8601)
 * @param {string} options.to - End date (ISO 8601)
 * @returns {Promise<Object>} Paginated executions list
 */
export const getAgentExecutionsV2 = async (agentId, options = {}) => {
  try {
    const apiKey = config.bolna?.apiKey;
    const apiBase = config.bolna?.apiBase || 'https://api.bolna.ai';

    if (!apiKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'BOLNA_API_KEY is not configured');
    }

    const {
      pageNumber = 1,
      pageSize = 20,
      status,
      callType,
      provider,
      answeredByVoiceMail,
      batchId,
      from,
      to,
    } = options;

    // Build query parameters
    const params = new URLSearchParams();
    params.append('page_number', String(pageNumber));
    params.append('page_size', String(Math.min(pageSize, 50))); // Max 50 per API
    
    if (status) params.append('status', status);
    if (callType) params.append('call_type', callType);
    if (provider) params.append('provider', provider);
    if (answeredByVoiceMail !== undefined) params.append('answered_by_voice_mail', String(answeredByVoiceMail));
    if (batchId) params.append('batch_id', batchId);
    if (from) params.append('from', from);
    if (to) params.append('to', to);

    const response = await fetch(`${apiBase}/v2/agent/${agentId}/executions?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status || httpStatus.INTERNAL_SERVER_ERROR,
        errorData.message || errorData.error || 'Failed to get agent executions from Bolna API'
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get agent executions: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Bolna API error: ${error.message}`);
  }
};

/**
 * Get agent details from Bolna API
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object>} Agent details
 */
export const getAgentDetails = async (agentId) => {
  try {
    const apiKey = config.bolna?.apiKey;
    const apiBase = config.bolna?.apiBase || 'https://api.bolna.ai';

    if (!apiKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'BOLNA_API_KEY is not configured');
    }

    const response = await fetch(`${apiBase}/v2/agent/${agentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status || httpStatus.INTERNAL_SERVER_ERROR,
        errorData.message || errorData.error || 'Failed to get agent details from Bolna API'
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get agent details: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Bolna API error: ${error.message}`);
  }
};

/**
 * Get agent executions from Bolna API
 * @param {string} agentId - Agent ID
 * @param {number} limit - Number of executions to retrieve
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Object>} Agent executions
 */
export const getAgentExecutions = async (agentId, limit = 100, offset = 0) => {
  try {
    const apiKey = config.bolna?.apiKey;
    const apiBase = config.bolna?.apiBase || 'https://api.bolna.ai';

    if (!apiKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'BOLNA_API_KEY is not configured');
    }

    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    const response = await fetch(`${apiBase}/v2/agent/${agentId}/executions?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status || httpStatus.INTERNAL_SERVER_ERROR,
        errorData.message || errorData.error || 'Failed to get agent executions from Bolna API'
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get agent executions: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Bolna API error: ${error.message}`);
  }
};

/**
 * Get batch executions from Bolna API
 * @param {string} batchId - Batch ID
 * @returns {Promise<Object>} Batch executions
 */
export const getBatchExecutions = async (batchId) => {
  try {
    const apiKey = config.bolna?.apiKey;
    const apiBase = config.bolna?.apiBase || 'https://api.bolna.ai';

    if (!apiKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'BOLNA_API_KEY is not configured');
    }

    const response = await fetch(`${apiBase}/batches/${batchId}/executions`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status || httpStatus.INTERNAL_SERVER_ERROR,
        errorData.message || errorData.error || 'Failed to get batch executions from Bolna API'
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get batch executions: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Bolna API error: ${error.message}`);
  }
};
