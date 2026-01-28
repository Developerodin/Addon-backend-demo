import fetch from 'node-fetch';
import config from '../../config/config.js';
import ApiError from '../../utils/ApiError.js';
import httpStatus from 'http-status';
import logger from '../../config/logger.js';

/**
 * Get base URL for Exotel API (without credentials)
 * @returns {string} Base URL without credentials
 */
const getBaseUrl = () => {
  const subdomain = config.exotel?.subdomain || 'api.in.exotel.com';
  const accountSid = config.exotel?.accountSid;

  if (!accountSid) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Exotel Account SID not configured. Please set EXOTEL_ACCOUNT_SID in .env file.'
    );
  }

  return `https://${subdomain}/v1/Accounts/${accountSid}`;
};

/**
 * Get Basic Auth header for Exotel API
 * @returns {string} Base64 encoded credentials
 */
const getAuthHeader = () => {
  const apiKey = config.exotel?.apiKey;
  const apiToken = config.exotel?.apiToken;

  if (!apiKey || !apiToken) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Exotel credentials not configured. Please set EXOTEL_API_KEY and EXOTEL_API_TOKEN in .env file.'
    );
  }

  const credentials = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
  return `Basic ${credentials}`;
};

/**
 * Make a request to Exotel API
 * @param {string} endpoint - API endpoint (relative to base URL)
 * @param {Object} options - Request options
 * @param {boolean} useJson - Whether to append .json for JSON response (default: true)
 * @returns {Promise<Object>} Response data
 */
const exotelRequest = async (endpoint, options = {}, useJson = true) => {
  try {
    const baseUrl = getBaseUrl();
    const jsonSuffix = useJson ? '.json' : '';
    const url = `${baseUrl}${endpoint}${jsonSuffix}`;
    const authHeader = getAuthHeader();

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const responseText = await response.text();
    let data;

    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      logger.error(`Failed to parse Exotel API response: ${responseText}`);
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Exotel API returned invalid JSON: ${responseText.substring(0, 200)}`
      );
    }

    if (!response.ok) {
      const errorMessage = data.message || data.error || responseText || 'Unknown error';
      const errorCode = data.code || response.status;
      
      logger.error(`Exotel API Error (${errorCode}): ${errorMessage}`);
      
      // Handle specific error codes
      if (errorCode === 401 || errorMessage.includes('authenticate') || errorMessage.includes('Unauthorized')) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Exotel credentials. Please check your API Key, API Token, and Account SID.');
      }
      
      if (errorCode === 429 || errorMessage.includes('rate limit')) {
        throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Exotel API rate limit exceeded. Please try again later.');
      }

      throw new ApiError(
        response.status || httpStatus.BAD_REQUEST,
        `Exotel API Error: ${errorMessage}`
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Exotel API request failed: ${error.message}`);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to communicate with Exotel API: ${error.message}`
    );
  }
};

/**
 * Get account balance (calculated from call history)
 * @returns {Promise<Object>} Account balance information
 */
export const getAccountBalance = async () => {
  try {
    // Get recent calls to calculate balance
    // Note: Exotel doesn't have a direct balance endpoint, so we calculate from call history
    const calls = await getBulkCalls({ pageSize: 1000 });
    
    let totalSpent = 0;
    if (calls.Calls && Array.isArray(calls.Calls)) {
      calls.Calls.forEach(call => {
        if (call.Price) {
          totalSpent += parseFloat(call.Price) || 0;
        }
      });
    }

    // Note: This is an approximation. For accurate balance, you'd need to track all calls
    return {
      balance: 0, // Exotel doesn't provide direct balance, would need account-level tracking
      totalSpent,
      currency: 'INR', // Default currency for Exotel
      accountSid: config.exotel?.accountSid,
    };
  } catch (error) {
    logger.error(`Failed to calculate Exotel balance: ${error.message}`);
    // Return default values if calculation fails
    return {
      balance: 0,
      totalSpent: 0,
      currency: 'INR',
      accountSid: config.exotel?.accountSid,
    };
  }
};

/**
 * Get account information
 * @returns {Promise<Object>} Account information
 */
export const getAccountInfo = async () => {
  const accountSid = config.exotel?.accountSid;
  if (!accountSid) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Exotel Account SID not configured');
  }

  // Exotel doesn't have a direct account info endpoint, so we return what we can from config
  return {
    sid: accountSid,
    friendlyName: 'Exotel Account',
    status: 'active',
    type: 'exotel',
    subdomain: config.exotel?.subdomain || 'api.in.exotel.com',
  };
};

/**
 * Get usage summary (aggregated from call history)
 * @param {string} startDate - Start date (YYYY-MM-DD HH:mm:ss)
 * @param {string} endDate - End date (YYYY-MM-DD HH:mm:ss)
 * @returns {Promise<Object>} Usage summary
 */
export const getUsageSummary = async (startDate, endDate) => {
  const filters = {};
  
  if (startDate || endDate) {
    let dateFilter = '';
    if (startDate) dateFilter += `gte:${startDate}`;
    if (startDate && endDate) dateFilter += ';';
    if (endDate) dateFilter += `lte:${endDate}`;
    filters.DateCreated = dateFilter;
  }

  const calls = await getBulkCalls({ ...filters, pageSize: 1000 });
  
  let totalCost = 0;
  let totalCalls = 0;
  let completedCalls = 0;
  let failedCalls = 0;

  if (calls.Calls && Array.isArray(calls.Calls)) {
    totalCalls = calls.Calls.length;
    calls.Calls.forEach(call => {
      if (call.Price) {
        totalCost += parseFloat(call.Price) || 0;
      }
      if (call.Status === 'completed') {
        completedCalls++;
      } else if (call.Status === 'failed' || call.Status === 'busy' || call.Status === 'no-answer') {
        failedCalls++;
      }
    });
  }

  return {
    startDate,
    endDate,
    totalCost,
    totalCalls,
    completedCalls,
    failedCalls,
    records: calls.Calls ? calls.Calls.slice(0, 100) : [],
  };
};

/**
 * Get recent usage records
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<Array>} Recent usage records
 */
export const getRecentUsage = async (limit = 50) => {
  const calls = await getBulkCalls({ pageSize: Math.min(limit, 100) });
  
  const records = calls.Calls && Array.isArray(calls.Calls) ? calls.Calls : [];
  
  return records.slice(0, limit).map(call => ({
    callSid: call.Sid,
    status: call.Status,
    direction: call.Direction,
    from: call.From,
    to: call.To,
    phoneNumber: call.PhoneNumberSid,
    duration: call.Duration ? parseInt(call.Duration) : 0,
    price: call.Price ? parseFloat(call.Price) : 0,
    startTime: call.StartTime,
    endTime: call.EndTime,
    dateCreated: call.DateCreated,
    dateUpdated: call.DateUpdated,
  }));
};

/**
 * Get list of countries with available phone numbers
 * @returns {Promise<Array>} List of countries
 */
export const getAvailableCountries = async () => {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl.replace('/v1/Accounts/', '/v2_beta/Accounts/')}/AvailablePhoneNumbers`;
  const authHeader = getAuthHeader();
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': authHeader,
      },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(response.status, data.message || 'Failed to fetch available countries');
    }

    const countries = Array.isArray(data.countries) ? data.countries : [];
    
    return countries.map(country => ({
      countryCode: country.country_code,
      country: country.country,
      subresourceUris: country.subresource_uris || {},
    }));
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to fetch Exotel available countries: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to fetch available countries: ${error.message}`);
  }
};

/**
 * Get country info and available number types
 * @param {string} countryCode - ISO country code (e.g., 'IN')
 * @returns {Promise<Object>} Country information
 */
export const getCountryInfo = async (countryCode) => {
  if (!countryCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Country code is required');
  }

  const countries = await getAvailableCountries();
  const country = countries.find(c => c.countryCode === countryCode);

  if (!country) {
    throw new ApiError(httpStatus.NOT_FOUND, `Country ${countryCode} not found`);
  }

  // Extract available types from subresource URIs
  const availableTypes = Object.keys(country.subresourceUris || {}).map(key => {
    // Convert URI keys to type names (e.g., 'Landline' -> 'Landline', 'Mobile' -> 'Mobile')
    return key.split('/').pop() || key;
  });

  return {
    countryCode: country.countryCode,
    country: country.country,
    subresourceUris: country.subresourceUris,
    availableTypes: availableTypes.length > 0 ? availableTypes : ['Landline', 'Mobile', 'TollFree'], // Default types
  };
};

/**
 * Search for available phone numbers
 * @param {string} countryCode - ISO country code
 * @param {string} type - Number type: 'Landline', 'Mobile', or 'TollFree'
 * @param {Object} filters - Search filters
 * @returns {Promise<Object>} Search results
 */
export const searchAvailableNumbers = async (countryCode, type, filters = {}) => {
  if (!countryCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Country code is required');
  }

  if (!type || !['Landline', 'Mobile', 'TollFree'].includes(type)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Type must be Landline, Mobile, or TollFree');
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl.replace('/v1/Accounts/', '/v2_beta/Accounts/')}/AvailablePhoneNumbers/${countryCode}/${type}`;

  // Build query parameters
  const params = new URLSearchParams();
  
  if (filters.IncomingSMS !== undefined) params.append('IncomingSMS', filters.IncomingSMS);
  if (filters.InRegion) params.append('InRegion', filters.InRegion);
  if (filters.Contains) params.append('Contains', filters.Contains);
  if (filters.PageSize) params.append('PageSize', Math.min(filters.PageSize, 1000));
  if (filters.Page !== undefined) params.append('Page', filters.Page);

  const queryString = params.toString();
  const fullUrl = queryString ? `${url}?${queryString}` : url;
  const authHeader = getAuthHeader();

  try {
    logger.info(`Searching Exotel numbers: ${fullUrl}`);
    const response = await fetch(fullUrl, {
      headers: {
        'Authorization': authHeader,
      },
    });
    
    const responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      logger.error(`Failed to parse Exotel search response: ${responseText}`);
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Exotel API returned invalid JSON: ${responseText.substring(0, 200)}`
      );
    }

    if (!response.ok) {
      logger.error(`Exotel search API error (${response.status}): ${JSON.stringify(data)}`);
      logger.error(`Request URL: ${fullUrl}`);
      
      // Handle 404 - might mean no numbers available for this combination
      if (response.status === 404) {
        // Return empty results instead of error for 404
        logger.warn(`No numbers found for ${countryCode}/${type} - returning empty results`);
        return {
          availableNumbers: [],
          page: 0,
          pageSize: 0,
          total: 0,
        };
      }
      
      const errorMessage = data.message || data.error || responseText || 'Failed to search available numbers';
      throw new ApiError(response.status, errorMessage);
    }

    // API returns an array directly, not an object
    const availableNumbers = Array.isArray(data) ? data : [];

    return {
      availableNumbers: availableNumbers.map(num => {
        // Ensure capabilities object exists and has proper structure
        const capabilities = num.capabilities || {};
        return {
          phoneNumber: num.phone_number,
          friendlyName: num.friendly_name || num.phone_number,
          type: num.number_type || type,
          region: num.region,
          circle: num.region, // For India, region is the circle
          operator: num.operator, // May not be present
          capabilities: {
            voice: capabilities.voice === true,
            sms: capabilities.sms === true,
          },
          pricing: {
            oneTimePrice: num.one_time_price ? parseFloat(num.one_time_price) : null,
            rentalPrice: num.rental_price ? parseFloat(num.rental_price) : null,
            incomingRate: num.incoming_rate ? parseFloat(num.incoming_rate) : null,
            currency: num.currency || 'INR',
          },
        };
      }),
      page: 0,
      pageSize: availableNumbers.length,
      total: availableNumbers.length,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to search Exotel available numbers: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to search available numbers: ${error.message}`);
  }
};

/**
 * Purchase a phone number
 * @param {string} phoneNumber - Phone number in E.164 format
 * @param {Object} options - Purchase options (VoiceUrl, SMSUrl, FriendlyName)
 * @returns {Promise<Object>} Purchased number information
 */
export const purchasePhoneNumber = async (phoneNumber, options = {}) => {
  if (!phoneNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number is required');
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl.replace('/v1/Accounts/', '/v2_beta/Accounts/')}/IncomingPhoneNumbers`;
  const authHeader = getAuthHeader();

  // Build request body
  const body = new URLSearchParams();
  body.append('PhoneNumber', phoneNumber);
  if (options.VoiceUrl) body.append('VoiceUrl', options.VoiceUrl);
  if (options.SMSUrl) body.append('SMSUrl', options.SMSUrl);
  if (options.FriendlyName) body.append('FriendlyName', options.FriendlyName);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(response.status, data.message || 'Failed to purchase phone number');
    }

    return {
      sid: data.sid,
      phoneNumber: data.phone_number,
      friendlyName: data.friendly_name,
      capabilities: {
        voice: data.capabilities?.voice || false,
        sms: data.capabilities?.sms || false,
      },
      status: 'active',
      dateCreated: data.date_created,
      dateUpdated: data.date_updated,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to purchase Exotel phone number: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to purchase phone number: ${error.message}`);
  }
};

/**
 * Get list of owned phone numbers
 * @param {number} limit - Maximum number of numbers to return
 * @param {number} page - Page number (1-based)
 * @returns {Promise<Object>} List of owned phone numbers with pagination
 */
export const getOwnedNumbers = async (limit = 50, page = 1) => {
  const baseUrl = getBaseUrl();
  const params = new URLSearchParams();
  params.append('PageSize', Math.min(limit, 1000));
  // Exotel uses 0-based pagination, convert from 1-based
  params.append('Page', (page - 1).toString());

  const url = `${baseUrl.replace('/v1/Accounts/', '/v2_beta/Accounts/')}/IncomingPhoneNumbers?${params.toString()}`;
  const authHeader = getAuthHeader();

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': authHeader,
      },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(response.status, data.message || 'Failed to fetch owned numbers');
    }

    const numbers = Array.isArray(data.incoming_phone_numbers) ? data.incoming_phone_numbers : [];

    return {
      numbers: numbers.map(num => ({
        sid: num.sid,
        phoneNumber: num.phone_number,
        friendlyName: num.friendly_name,
        capabilities: {
          voice: num.capabilities?.voice || false,
          sms: num.capabilities?.sms || false,
        },
        status: 'active', // Exotel doesn't provide status field
        dateCreated: num.date_created,
        dateUpdated: num.date_updated,
        voiceUrl: num.voice_url,
        smsUrl: num.sms_url,
        pricing: {
          oneTimePrice: num.one_time_price ? parseFloat(num.one_time_price) : null,
          rentalPrice: num.rental_price ? parseFloat(num.rental_price) : null,
          incomingRate: num.incoming_rate ? parseFloat(num.incoming_rate) : null,
          currency: num.currency || 'INR',
        },
        region: num.region,
        circle: num.region, // For India, region is the circle
      })),
      page: (data.page !== undefined ? data.page + 1 : page), // Convert back to 1-based for frontend
      pageSize: data.page_size || limit,
      total: numbers.length, // Exotel doesn't provide total in response
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to fetch Exotel owned numbers: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to fetch owned numbers: ${error.message}`);
  }
};

/**
 * Get specific number details
 * @param {string} sid - Phone number SID
 * @returns {Promise<Object>} Number details
 */
export const getNumberDetails = async (sid) => {
  if (!sid) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Number SID is required');
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl.replace('/v1/Accounts/', '/v2_beta/Accounts/')}/IncomingPhoneNumbers/${sid}`;
  const authHeader = getAuthHeader();

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': authHeader,
      },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(response.status, data.message || 'Failed to fetch number details');
    }

    return {
      sid: data.sid,
      phoneNumber: data.phone_number,
      friendlyName: data.friendly_name,
      capabilities: {
        voice: data.capabilities?.voice || false,
        sms: data.capabilities?.sms || false,
      },
      status: 'active',
      dateCreated: data.date_created,
      dateUpdated: data.date_updated,
      voiceUrl: data.voice_url,
      smsUrl: data.sms_url,
      pricing: {
        oneTimePrice: data.one_time_price ? parseFloat(data.one_time_price) : null,
        rentalPrice: data.rental_price ? parseFloat(data.rental_price) : null,
        incomingRate: data.incoming_rate ? parseFloat(data.incoming_rate) : null,
        currency: data.currency || 'INR',
      },
      region: data.region,
      circle: data.region, // For India, region is the circle
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to fetch Exotel number details: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to fetch number details: ${error.message}`);
  }
};

/**
 * Update number configuration
 * @param {string} sid - Phone number SID
 * @param {Object} options - Update options (VoiceUrl, SMSUrl, FriendlyName)
 * @returns {Promise<Object>} Updated number information
 */
export const updateNumber = async (sid, options = {}) => {
  if (!sid) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Number SID is required');
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl.replace('/v1/Accounts/', '/v2_beta/Accounts/')}/IncomingPhoneNumbers/${sid}`;
  const authHeader = getAuthHeader();

  // Build request body
  const body = new URLSearchParams();
  if (options.VoiceUrl !== undefined) body.append('VoiceUrl', options.VoiceUrl);
  if (options.SMSUrl !== undefined) body.append('SMSUrl', options.SMSUrl);
  if (options.FriendlyName !== undefined) body.append('FriendlyName', options.FriendlyName);

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(response.status, data.message || 'Failed to update number');
    }

    return {
      sid: data.sid,
      phoneNumber: data.phone_number,
      friendlyName: data.friendly_name,
      capabilities: {
        voice: data.capabilities?.voice || false,
        sms: data.capabilities?.sms || false,
      },
      status: 'active',
      dateUpdated: data.date_updated,
      voiceUrl: data.voice_url,
      smsUrl: data.sms_url,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to update Exotel number: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to update number: ${error.message}`);
  }
};

/**
 * Delete/Release a phone number
 * @param {string} sid - Phone number SID
 * @returns {Promise<void>}
 */
export const deleteNumber = async (sid) => {
  if (!sid) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Number SID is required');
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl.replace('/v1/Accounts/', '/v2_beta/Accounts/')}/IncomingPhoneNumbers/${sid}`;
  const authHeader = getAuthHeader();

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': authHeader,
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(response.status, data.message || 'Failed to delete number');
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to delete Exotel number: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to delete number: ${error.message}`);
  }
};

/**
 * Get number metadata (v1 API)
 * @param {string} phoneNumber - Phone number
 * @returns {Promise<Object>} Number metadata
 */
export const getNumberMetadata = async (phoneNumber) => {
  if (!phoneNumber) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number is required');
  }

  // Remove + and special characters for the API
  const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
  
  const data = await exotelRequest(`/Numbers/~${cleanNumber}`, {}, true);

  // Handle both possible response formats
  return {
    phoneNumber: data.PhoneNumber || data.phone_number || phoneNumber,
    circle: data.Circle || data.circle,
    type: data.Type || data.type,
    operator: data.Operator || data.operator,
    dnd: data.DND || data.dnd || false,
    region: data.Region || data.region,
  };
};

/**
 * Get call details
 * @param {string} callSid - Call SID
 * @returns {Promise<Object>} Call details
 */
export const getCallDetails = async (callSid) => {
  if (!callSid) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Call SID is required');
  }

  const data = await exotelRequest(`/Calls/${callSid}`, {}, true);

  // Handle both possible response formats (Call object or direct fields)
  const call = data.Call || data.call || data;

  return {
    sid: call.Sid || call.sid,
    status: call.Status || call.status,
    direction: call.Direction || call.direction,
    from: call.From || call.from,
    to: call.To || call.to,
    phoneNumberSid: call.PhoneNumberSid || call.phone_number_sid || call.PhoneNumberSid,
    duration: call.Duration ? parseInt(call.Duration) : (call.duration ? parseInt(call.duration) : null),
    price: call.Price ? parseFloat(call.Price) : (call.price ? parseFloat(call.price) : null),
    startTime: call.StartTime || call.start_time,
    endTime: call.EndTime || call.end_time,
    dateCreated: call.DateCreated || call.date_created,
    dateUpdated: call.DateUpdated || call.date_updated,
    recordingUrl: call.RecordingUrl || call.recording_url,
    answeredBy: call.AnsweredBy || call.answered_by,
  };
};

/**
 * Get bulk call details with filters
 * @param {Object} filters - Filter parameters
 * @returns {Promise<Object>} Call details with metadata
 */
export const getBulkCalls = async (filters = {}) => {
  const params = new URLSearchParams();
  
  if (filters.Sid) params.append('Sid', filters.Sid);
  if (filters.DateCreated) params.append('DateCreated', filters.DateCreated);
  if (filters.To) params.append('To', filters.To);
  if (filters.From) params.append('From', filters.From);
  if (filters.Status) params.append('Status', filters.Status);
  if (filters.Duration) params.append('Duration', filters.Duration);
  if (filters.Price) params.append('Price', filters.Price);
  if (filters.Direction) params.append('Direction', filters.Direction);
  if (filters.PhoneNumber) params.append('PhoneNumber', filters.PhoneNumber);
  if (filters.PageSize) params.append('PageSize', Math.min(filters.PageSize, 100));
  if (filters.SortBy) params.append('SortBy', filters.SortBy);
  if (filters.Before) params.append('Before', filters.Before);
  if (filters.After) params.append('After', filters.After);
  if (filters.details === true) params.append('details', 'true');

  const queryString = params.toString();
  const endpoint = queryString ? `/Calls?${queryString}` : '/Calls';

  const data = await exotelRequest(endpoint, {}, true);

  // Handle both possible response formats
  const calls = Array.isArray(data.Calls) ? data.Calls : (Array.isArray(data.calls) ? data.calls : []);
  const metadata = data.Metadata || data.metadata || {};

  // Transform call objects to consistent format
  const transformedCalls = calls.map(call => ({
    sid: call.Sid || call.sid,
    status: call.Status || call.status,
    direction: call.Direction || call.direction,
    from: call.From || call.from,
    to: call.To || call.to,
    phoneNumberSid: call.PhoneNumberSid || call.phone_number_sid,
    duration: call.Duration ? parseInt(call.Duration) : (call.duration ? parseInt(call.duration) : null),
    price: call.Price ? parseFloat(call.Price) : (call.price ? parseFloat(call.price) : null),
    startTime: call.StartTime || call.start_time,
    endTime: call.EndTime || call.end_time,
    dateCreated: call.DateCreated || call.date_created,
    dateUpdated: call.DateUpdated || call.date_updated,
    recordingUrl: call.RecordingUrl || call.recording_url,
    answeredBy: call.AnsweredBy || call.answered_by,
  }));

  return {
    Calls: transformedCalls,
    Metadata: metadata,
  };
};

/**
 * Connect two numbers (initiate a call)
 * @param {string} from - Phone number to call first
 * @param {string} to - Phone number to connect to
 * @param {string} callerId - Exotel virtual number (CallerId)
 * @param {Object} options - Additional call options
 * @returns {Promise<Object>} Call information
 */
export const connectCall = async (from, to, callerId, options = {}) => {
  if (!from || !to || !callerId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'From, To, and CallerId are required');
  }

  const baseUrl = getBaseUrl();
  // Remove .json suffix as per API docs - endpoint is /Calls/connect
  const url = `${baseUrl}/Calls/connect`;
  const authHeader = getAuthHeader();

  // Build form data
  const body = new URLSearchParams();
  body.append('From', from);
  body.append('To', to);
  body.append('CallerId', callerId);
  
  if (options.CallType) body.append('CallType', options.CallType);
  if (options.TimeLimit) body.append('TimeLimit', options.TimeLimit);
  if (options.TimeOut) body.append('TimeOut', options.TimeOut);
  if (options.WaitUrl) body.append('WaitUrl', options.WaitUrl);
  if (options.Record !== undefined) body.append('Record', options.Record);
  if (options.RecordingChannels) body.append('RecordingChannels', options.RecordingChannels);
  if (options.RecordingFormat) body.append('RecordingFormat', options.RecordingFormat);
  if (options.StatusCallback) body.append('StatusCallback', options.StatusCallback);
  if (options.StatusCallbackEvents) {
    if (Array.isArray(options.StatusCallbackEvents)) {
      options.StatusCallbackEvents.forEach((event, index) => {
        body.append(`StatusCallbackEvents[${index}]`, event);
      });
    }
  }
  if (options.StatusCallbackContentType) body.append('StatusCallbackContentType', options.StatusCallbackContentType);
  if (options.CustomField) body.append('CustomField', options.CustomField);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(response.status, data.message || 'Failed to initiate call');
    }

    // Handle both possible response formats
    const call = data.Call || data.call || data;

    return {
      sid: call.Sid || call.sid,
      status: call.Status || call.status,
      direction: call.Direction || call.direction,
      from: call.From || call.from,
      to: call.To || call.to,
      phoneNumberSid: call.PhoneNumberSid || call.phone_number_sid,
      dateCreated: call.DateCreated || call.date_created,
      dateUpdated: call.DateUpdated || call.date_updated,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to initiate Exotel call: ${error.message}`);
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Failed to initiate call: ${error.message}`);
  }
};
