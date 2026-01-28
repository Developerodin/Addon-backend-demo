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
    // Priority: from_phone_number/fromPhoneNumber from request > configured CALLER_ID
    const callerIdToUse = callData.from_phone_number || callData.fromPhoneNumber || config.bolna?.callerId;
    
    if (callerIdToUse) {
      const normalizedCallerId = normalizePhone(callerIdToUse);
      if (normalizedCallerId && validatePhone(normalizedCallerId)) {
        // Check if agent is configured to use Plivo (REQUIRED for custom caller IDs)
        // Note: If you've configured Plivo in the dashboard, this check may fail due to API limitations
        // The call will still proceed with from_phone_number if the number is valid
        try {
          const plivoConfig = await checkAgentPlivoConfig(agentId);
          if (!plivoConfig.isPlivoConfigured) {
            logger.warn(`⚠️  Agent ${agentId} shows as not configured with Plivo via API check.`);
            logger.warn(`Current: input_provider=${plivoConfig.inputProvider}, output_provider=${plivoConfig.outputProvider}`);
            logger.warn(`If you've configured Plivo in the Bolna dashboard, this is likely an API limitation.`);
            logger.warn(`Proceeding with caller ID - if calls fail, verify Plivo is set in dashboard.`);
            // Don't throw error - allow call to proceed if Plivo is configured in dashboard
          } else {
            logger.info(`✅ Agent ${agentId} is configured to use Plivo (input: ${plivoConfig.inputProvider}, output: ${plivoConfig.outputProvider})`);
          }
        } catch (configError) {
          // If check fails, don't block the call - user may have configured Plivo in dashboard
          logger.warn(`Could not verify agent Plivo configuration: ${configError.message}. Proceeding with caller ID.`);
          logger.warn(`If you've set Plivo in the Bolna dashboard, the call should work.`);
        }

        // Validate that the caller ID is registered in Bolna account and is a Plivo number
        try {
          const validation = await validateCallerId(normalizedCallerId);
          if (validation.valid) {
            if (!validation.isPlivo) {
              logger.warn(`Caller ID ${normalizedCallerId} is registered but may not be a Plivo number. Custom caller ID may not work.`);
            }
            payload.from_phone_number = normalizedCallerId;
            logger.info(`Using caller ID: ${normalizedCallerId}${validation.isPlivo ? ' (Plivo)' : ''}`);
            if (validation.warning) {
              logger.warn(validation.warning);
            }
          } else {
            logger.error(`Caller ID validation failed: ${validation.error}`);
            if (validation.availableTwilioNumbers && validation.availableTwilioNumbers.length > 0) {
              logger.error(`Available Twilio phone numbers in your account: ${validation.availableTwilioNumbers.join(', ')}`);
            } else if (validation.availableNumbers && validation.availableNumbers.length > 0) {
              logger.error(`Available phone numbers in your account: ${validation.availableNumbers.join(', ')}`);
            }
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Invalid caller ID: ${validation.error}. ${validation.availablePlivoNumbers ? `Available Plivo numbers: ${validation.availablePlivoNumbers.join(', ')}` : validation.availableNumbers ? `Available numbers: ${validation.availableNumbers.join(', ')}` : 'Please check your Bolna account for registered Plivo phone numbers.'}`
            );
          }
        } catch (validationError) {
          // If validation fails due to API error, log warning but allow call to proceed
          if (validationError instanceof ApiError && validationError.statusCode === httpStatus.BAD_REQUEST) {
            throw validationError; // Re-throw validation errors
          }
          logger.warn(`Could not validate caller ID with Bolna API: ${validationError.message}. Proceeding with caller ID anyway.`);
          payload.from_phone_number = normalizedCallerId;
        }
      } else {
        logger.warn(`Invalid caller ID format: ${config.bolna.callerId}. Expected E.164 format (e.g., +91XXXXXXXXXX). Call will proceed without caller ID.`);
      }
    }

    logger.info(`Initiating call to ${phoneNumber} with language ${normalizedLanguage}, service_type=${serviceType}, location=${location}`);
    if (payload.from_phone_number) {
      logger.info(`Caller ID configured: ${payload.from_phone_number}`);
    } else {
      logger.info('No caller ID configured - using default Bolna number');
    }
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

        // Check for Plivo unverified number error (trial account limitation)
        if (errorMessage.includes('unverified') || 
            errorMessage.includes('21219') ||
            errorMessage.includes('Trial accounts may only make calls to verified numbers')) {
          const errorMsg = `Plivo Account Limitation: ${errorMessage}. Please verify the recipient number in Plivo console or upgrade your Plivo account.`;
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
 * Update agent configuration to set Plivo as input and output provider
 * This is required for using custom caller IDs (from_phone_number)
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object>} Updated agent details
 */
export const updateAgentToUsePlivo = async (agentId) => {
  try {
    const apiKey = config.bolna?.apiKey;
    const apiBase = config.bolna?.apiBase || 'https://api.bolna.ai';

    if (!apiKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'BOLNA_API_KEY is not configured');
    }

    // First, get current agent details to preserve other settings
    const currentAgent = await getAgentDetails(agentId);

    // Prepare tools_config with Plivo as input and output provider
    // Preserve existing tools_config structure if it exists
    const toolsConfig = currentAgent.tools_config || {};
    
    const updatedToolsConfig = {
      ...toolsConfig,
      input: {
        ...(toolsConfig.input || {}),
        format: toolsConfig.input?.format || 'wav',
        provider: 'plivo',
      },
      output: {
        ...(toolsConfig.output || {}),
        format: toolsConfig.output?.format || 'wav',
        provider: 'plivo',
      },
    };

    // Log current agent structure for debugging
    logger.info(`Current agent tools_config: ${JSON.stringify(toolsConfig)}`);
    
    // Prepare update payload - send only tools_config (Bolna API may require minimal payload)
    // Some APIs require only the fields being updated
    const updatePayload = {
      tools_config: updatedToolsConfig,
    };

    // Log what we're sending
    logger.info(`Updating agent ${agentId} with payload: ${JSON.stringify(updatePayload, null, 2)}`);
    logger.info(`Current agent has tools_config: ${!!currentAgent.tools_config}`);

    const response = await fetch(`${apiBase}/v2/agent/${agentId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
      timeout: 30000,
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch (e) {
        errorData = { raw: responseText };
      }
      const errorMessage = errorData.message || errorData.error || errorData.detail || 'Failed to update agent configuration';
      logger.error(`❌ Failed to update agent ${agentId} (Status ${response.status}): ${errorMessage}`);
      logger.error(`Full error response: ${responseText}`);
      
      // If minimal payload failed, try with full agent object
      if (response.status === 400 || response.status === 422) {
        logger.info(`Attempting alternative: sending full agent object...`);
        const fullPayload = {
          ...currentAgent,
          tools_config: updatedToolsConfig,
        };
        delete fullPayload.id;
        delete fullPayload.created_at;
        delete fullPayload.updated_at;
        delete fullPayload.humanized_created_at;
        delete fullPayload.humanized_updated_at;
        
        const retryResponse = await fetch(`${apiBase}/v2/agent/${agentId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fullPayload),
          timeout: 30000,
        });
        
        const retryText = await retryResponse.text();
        if (!retryResponse.ok) {
          logger.error(`❌ Retry with full payload also failed: ${retryText}`);
          throw new ApiError(
            retryResponse.status || httpStatus.INTERNAL_SERVER_ERROR,
            `Failed to update agent: ${errorMessage}. Retry also failed.`
          );
        }
        const updatedAgent = JSON.parse(retryText);
        logger.info(`✅ Updated agent ${agentId} using full payload approach`);
        return updatedAgent;
      }
      
      throw new ApiError(
        response.status || httpStatus.INTERNAL_SERVER_ERROR,
        `Failed to update agent: ${errorMessage}. Status: ${response.status}`
      );
    }

    let updatedAgent;
    try {
      updatedAgent = JSON.parse(responseText);
    } catch (e) {
      logger.error(`Failed to parse response: ${responseText}`);
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Invalid response from Bolna API');
    }
    
    // Verify the update was actually applied
    logger.info(`Update API returned success. Verifying configuration...`);
    logger.info(`Update response: ${JSON.stringify(updatedAgent.tools_config || 'no tools_config in response', null, 2)}`);
    
    try {
      // Wait a moment for the update to propagate
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const verifyConfig = await checkAgentPlivoConfig(agentId);
      if (!verifyConfig.isPlivoConfigured) {
        logger.error(`❌ CRITICAL: Update API returned success, but agent ${agentId} is still NOT configured with Plivo!`);
        logger.error(`Update response tools_config: ${JSON.stringify(updatedAgent.tools_config || 'missing')}`);
        logger.error(`Verified config: input=${verifyConfig.inputProvider}, output=${verifyConfig.outputProvider}`);
        logger.error(`Full agent response: ${JSON.stringify(Object.keys(updatedAgent))}`);
        
        // Check if tools_config exists in response but with different structure
        if (updatedAgent.tools_config) {
          logger.error(`Response tools_config structure: ${JSON.stringify(updatedAgent.tools_config, null, 2)}`);
        }
        
        logger.error(`⚠️  The Bolna API may not support updating tools_config via PATCH endpoint.`);
        logger.error(`⚠️  You may need to update the agent manually in the Bolna dashboard at https://platform.bolna.ai`);
        logger.error(`⚠️  Or recreate the agent with tools_config set to plivo from the start.`);
      } else {
        logger.info(`✅ Verified: Agent ${agentId} is now configured with Plivo`);
      }
    } catch (verifyError) {
      logger.warn(`Could not verify update: ${verifyError.message}`);
    }
    
    logger.info(`✅ Updated agent ${agentId} to use Plivo as input and output provider`);
    return updatedAgent;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to update agent to use Plivo: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Bolna API error: ${error.message}`);
  }
};

/**
 * Check if agent is configured to use Plivo
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object>} Configuration check result
 */
export const checkAgentPlivoConfig = async (agentId) => {
  try {
    const agentDetails = await getAgentDetails(agentId);
    
    // Check tools_config structure (new format)
    const toolsConfig = agentDetails.tools_config || {};
    const inputProvider = toolsConfig.input?.provider;
    const outputProvider = toolsConfig.output?.provider;
    
    // Fallback to old format if tools_config doesn't exist
    const fallbackInputProvider = agentDetails.input_provider || agentDetails.inputProvider;
    const fallbackOutputProvider = agentDetails.output_provider || agentDetails.outputProvider;
    
    const finalInputProvider = inputProvider || fallbackInputProvider;
    const finalOutputProvider = outputProvider || fallbackOutputProvider;

    const isPlivoConfigured = 
      (finalInputProvider === 'plivo' || finalInputProvider === 'Plivo') &&
      (finalOutputProvider === 'plivo' || finalOutputProvider === 'Plivo');

    return {
      agentId,
      isPlivoConfigured,
      inputProvider: finalInputProvider || 'not set',
      outputProvider: finalOutputProvider || 'not set',
      toolsConfig: toolsConfig.input || toolsConfig.output ? {
        input: toolsConfig.input,
        output: toolsConfig.output,
      } : null,
      message: isPlivoConfigured 
        ? 'Agent is configured to use Plivo'
        : 'Agent is NOT configured to use Plivo. Please update agent configuration.',
    };
  } catch (error) {
    logger.error(`Failed to check agent Twilio configuration: ${error.message}`);
    throw error;
  }
};

/**
 * Get all phone numbers associated with your Bolna account
 * @returns {Promise<Array>} List of phone numbers
 */
export const getPhoneNumbers = async () => {
  try {
    const apiKey = config.bolna?.apiKey;
    const apiBase = config.bolna?.apiBase || 'https://api.bolna.ai';

    if (!apiKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'BOLNA_API_KEY is not configured');
    }

    const response = await fetch(`${apiBase}/phone-numbers/all`, {
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
        errorData.message || errorData.error || 'Failed to get phone numbers from Bolna API'
      );
    }

    const result = await response.json();
    return Array.isArray(result) ? result : [];
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get phone numbers: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Bolna API error: ${error.message}`);
  }
};

/**
 * Validate if a phone number is available in your Bolna account and is a Plivo number
 * @param {string} phoneNumber - Phone number to validate (E.164 format)
 * @returns {Promise<Object>} Validation result with phone number details if found
 */
export const validateCallerId = async (phoneNumber) => {
  try {
    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone || !validatePhone(normalizedPhone)) {
      return {
        valid: false,
        error: 'Invalid phone number format. Expected E.164 format (e.g., +91XXXXXXXXXX)'
      };
    }

    const phoneNumbers = await getPhoneNumbers();
    const matchingNumber = phoneNumbers.find(
      (pn) => normalizePhone(pn.phone_number) === normalizedPhone
    );

    if (!matchingNumber) {
      return {
        valid: false,
        error: `Phone number ${normalizedPhone} is not registered in your Bolna account. Please use one of your registered numbers.`,
        availableNumbers: phoneNumbers.map((pn) => pn.phone_number)
      };
    }

    // Check if the phone number is from Plivo provider
    const telephonyProvider = matchingNumber.telephony_provider || matchingNumber.telephonyProvider;
    const isPlivo = telephonyProvider && telephonyProvider.toLowerCase() === 'plivo';

    if (!isPlivo) {
      return {
        valid: false,
        error: `Phone number ${normalizedPhone} is registered but is not a Plivo number (provider: ${telephonyProvider || 'unknown'}). For custom caller IDs, you must use a Plivo number.`,
        phoneNumber: matchingNumber,
        availablePlivoNumbers: phoneNumbers
          .filter((pn) => (pn.telephony_provider || pn.telephonyProvider || '').toLowerCase() === 'plivo')
          .map((pn) => pn.phone_number)
      };
    }

    return {
      valid: true,
      phoneNumber: matchingNumber,
      isPlivo: true,
      message: `Phone number ${normalizedPhone} is a registered Plivo number in your Bolna account`
    };
  } catch (error) {
    logger.error(`Failed to validate caller ID: ${error.message}`);
    // If we can't fetch phone numbers, still allow the call but log a warning
    return {
      valid: true,
      warning: `Could not verify caller ID with Bolna API: ${error.message}. Proceeding with caller ID.`
    };
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
