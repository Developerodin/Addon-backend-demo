import plivo from 'plivo';
import fetch from 'node-fetch';
import config from '../../config/config.js';
import ApiError from '../../utils/ApiError.js';
import httpStatus from 'http-status';
import logger from '../../config/logger.js';

/**
 * Get Plivo client instance
 * @returns {plivo.Client} Plivo client
 */
const getPlivoClient = () => {
  const authId = config.plivo?.authId;
  const authToken = config.plivo?.authToken;

  if (!authId || !authToken) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Plivo credentials not configured. Please set PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN in .env file.'
    );
  }

  // Plivo SDK uses Client constructor with authId and authToken
  return new plivo.Client(authId, authToken);
};

/**
 * Get account balance
 * Uses account details to get cash credits
 * @returns {Promise<Object>} Account balance information
 */
export const getAccountBalance = async () => {
  try {
    const client = getPlivoClient();
    
    // Get account details which includes cash_credits
    // Plivo SDK: client.account.get() (singular, not accounts)
    let account;
    try {
      account = await client.account.get();
    } catch (sdkError) {
      // Fallback: try plural form if singular doesn't work
      logger.warn(`client.account.get() failed, trying client.accounts.get(): ${sdkError.message}`);
      account = await client.accounts.get();
    }
    
    // Log full account response to debug
    logger.info(`Full account response from Plivo: ${JSON.stringify(account, null, 2)}`);
    logger.info(`Account balance response keys: ${Object.keys(account || {}).join(', ')}`);
    logger.info(`cash_credits value: ${account.cash_credits}, type: ${typeof account.cash_credits}`);
    
    // Try multiple possible field names for cash credits
    const cashCredits = account.cash_credits || account.cashCredits || account.balance || account.credits || 0;
    const balance = cashCredits ? parseFloat(cashCredits) : 0;
    
    logger.info(`Parsed balance: ${balance}`);
    
    return {
      balance: balance,
      currency: 'USD',
      accountId: account.auth_id || config.plivo?.authId || '',
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get Plivo account balance: ${error.message}`);
    
    const errorMessage = error.message || 'Unknown error';
    if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Plivo credentials. Please check your Auth ID and Auth Token.');
    }
    
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get account balance: ${errorMessage}`
    );
  }
};

/**
 * Get account information
 * @returns {Promise<Object>} Account information
 */
export const getAccountInfo = async () => {
  try {
    const client = getPlivoClient();
    
    // Get account details from Plivo API
    // Plivo SDK: client.account.get() (singular, not accounts)
    let account;
    try {
      account = await client.account.get();
    } catch (sdkError) {
      // Fallback: try plural form if singular doesn't work
      logger.warn(`client.account.get() failed, trying client.accounts.get(): ${sdkError.message}`);
      account = await client.accounts.get();
    }
    
    // Log full account response to debug
    logger.info(`Full account info response from Plivo: ${JSON.stringify(account, null, 2)}`);
    logger.info(`Account info response keys: ${Object.keys(account || {}).join(', ')}`);
    
    // Try multiple possible field names for cash credits
    const cashCredits = account.cash_credits || account.cashCredits || account.balance || account.credits || 0;
    const parsedCashCredits = cashCredits ? parseFloat(cashCredits) : 0;
    
    logger.info(`cash_credits value: ${account.cash_credits}, parsed: ${parsedCashCredits}`);
    
    return {
      accountType: account.account_type || account.accountType || null,
      address: account.address || null,
      authId: account.auth_id || account.authId || null,
      autoRecharge: account.auto_recharge === true || account.autoRecharge === true,
      billingMode: account.billing_mode || account.billingMode || null,
      cashCredits: parsedCashCredits,
      city: account.city || null,
      name: account.name || null,
      resourceUri: account.resource_uri || null,
      state: account.state || null,
      timezone: account.timezone || null,
      apiId: account.api_id || null,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get Plivo account info: ${error.message}`);
    
    const errorMessage = error.message || 'Unknown error';
    if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Plivo credentials. Please check your Auth ID and Auth Token.');
    }
    
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get account info: ${errorMessage}`
    );
  }
};

/**
 * Update account details
 * @param {Object} updates - Account update parameters (name, city, state, address, timezone)
 * @returns {Promise<Object>} Update result
 */
export const updateAccount = async (updates = {}) => {
  try {
    const client = getPlivoClient();
    
    const params = {};
    
    if (updates.name !== undefined) {
      params.name = updates.name;
    }
    
    if (updates.city !== undefined) {
      params.city = updates.city;
    }
    
    if (updates.state !== undefined) {
      params.state = updates.state;
    }
    
    if (updates.address !== undefined) {
      params.address = updates.address;
    }
    
    if (updates.timezone !== undefined) {
      params.timezone = updates.timezone;
    }
    
    // At least one parameter is required
    if (Object.keys(params).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'At least one update parameter is required');
    }
    
    // Plivo SDK: client.account.update() (singular, not accounts)
    let response;
    try {
      response = await client.account.update(params);
    } catch (sdkError) {
      // Fallback: try plural form if singular doesn't work
      logger.warn(`client.account.update() failed, trying client.accounts.update(): ${sdkError.message}`);
      response = await client.accounts.update(params);
    }
    
    logger.info(`Updated Plivo account details`);
    
    return {
      success: true,
      message: response.message || 'Account updated successfully',
      apiId: response.api_id,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Failed to update Plivo account: ${errorMessage}`);
    
    if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Plivo credentials. Please check your Auth ID and Auth Token.');
    }
    
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Failed to update account: ${errorMessage}`
    );
  }
};

/**
 * Get usage summary
 * Note: Plivo doesn't have usage records API like Twilio
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Usage summary
 */
export const getUsageSummary = async (startDate, endDate) => {
  // Plivo doesn't expose usage records via API
  // Return empty structure
  return {
    startDate,
    endDate,
    totalCost: 0,
    totalCalls: 0,
    totalSms: 0,
    records: [],
  };
};

/**
 * Get recent usage records
 * Uses Plivo Calls API to get recent call records as usage data
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<Array>} Recent usage records
 */
export const getRecentUsage = async (limit = 50) => {
  try {
    const client = getPlivoClient();
    
    // Get recent calls from Plivo API
    // Filter for completed calls only to get billing data
    const params = {
      limit: Math.min(limit, 20), // Plivo limit is 20 per page
      offset: 0,
      call_direction: 'both', // Get both inbound and outbound
    };
    
    const response = await client.calls.list(params);
    
    logger.info(`Plivo calls.list response structure: ${JSON.stringify({
      isArray: Array.isArray(response),
      hasObjects: !!response?.objects,
      responseKeys: response ? Object.keys(response) : [],
      objectsLength: response?.objects?.length || 0
    })}`);
    
    // Handle different response structures from Plivo SDK
    let calls = [];
    if (Array.isArray(response)) {
      calls = Array.from(response);
    } else if (response && Array.isArray(response.objects)) {
      calls = Array.from(response.objects);
    } else if (response && typeof response === 'object') {
      // Handle array-like objects (objects with numeric keys)
      const keys = Object.keys(response).filter(k => k !== 'meta' && /^\d+$/.test(k));
      if (keys.length > 0) {
        calls = keys
          .map(k => parseInt(k, 10))
          .sort((a, b) => a - b)
          .map(index => response[index])
          .filter(item => item !== undefined && item !== null);
      }
    }
    
    logger.info(`Fetched ${calls.length} calls for usage records`);
    if (calls.length > 0) {
      logger.info(`First call example (all fields): ${JSON.stringify(calls[0], null, 2)}`);
      logger.info(`First call key fields: ${JSON.stringify({
        call_uuid: calls[0].call_uuid,
        call_status: calls[0].call_status,
        call_state: calls[0].call_state,
        direction: calls[0].direction,
        call_direction: calls[0].call_direction,
        call_duration: calls[0].call_duration,
        bill_duration: calls[0].bill_duration,
        billed_duration: calls[0].billed_duration,
        duration: calls[0].duration,
        total_amount: calls[0].total_amount,
        total_cost: calls[0].total_cost,
        bill_amount: calls[0].bill_amount,
        initiation_time: calls[0].initiation_time,
        answer_time: calls[0].answer_time,
        start_time: calls[0].start_time,
        end_time: calls[0].end_time,
        from: calls[0].from,
        from_number: calls[0].from_number,
        to: calls[0].to,
        to_number: calls[0].to_number
      })}`);
    }
    
    // Map Plivo call records to usage record format
    // Always try to get individual call details for accurate billing info
    // Limit to avoid too many API calls
    const callsToProcess = calls.slice(0, Math.min(limit, 10)); // Process max 10 calls with detail API calls
    
    logger.info(`Processing ${callsToProcess.length} calls for usage records`);
    
    const usageRecords = await Promise.all(
      callsToProcess.map(async (call) => {
        const callUuid = call.call_uuid || call.uuid || call.callUuid;
        
        // Get duration in seconds (Plivo uses call_duration or bill_duration)
        // Try multiple field name variations
        let duration = call.call_duration || call.bill_duration || call.billed_duration || call.duration || 0;
        let price = call.total_amount || call.total_cost || call.bill_amount || 0;
        
        // Convert string numbers to numbers
        if (typeof duration === 'string') {
          duration = parseFloat(duration) || 0;
        }
        if (typeof price === 'string') {
          price = parseFloat(price) || 0;
        }
        
        // Always try to get call details for accurate billing info
        if (callUuid) {
          try {
            logger.info(`Fetching details for call ${callUuid} to get billing info`);
            const callDetails = await client.calls.get(callUuid);
            
            // Log full call details structure
            logger.info(`Call details for ${callUuid} (full): ${JSON.stringify(callDetails, null, 2)}`);
            
            // Use detailed call info (prefer detail API over list API)
            if (callDetails.call_duration || callDetails.bill_duration || callDetails.billed_duration) {
              duration = callDetails.call_duration || callDetails.bill_duration || callDetails.billed_duration || duration;
            }
            if (callDetails.total_amount || callDetails.total_cost || callDetails.bill_amount) {
              price = callDetails.total_amount || callDetails.total_cost || callDetails.bill_amount || price;
            }
            
            // Convert to numbers if strings
            if (typeof duration === 'string') {
              duration = parseFloat(duration) || 0;
            }
            if (typeof price === 'string') {
              price = parseFloat(price) || 0;
            }
            
            logger.info(`After fetching details - duration: ${duration}, price: ${price}`);
          } catch (detailError) {
            logger.warn(`Failed to get details for call ${callUuid}: ${detailError.message}`);
            // Continue with original call data
          }
        }
        
        const durationSeconds = duration ? parseInt(duration, 10) : 0;
        const priceValue = price ? parseFloat(price) : 0;
        
        // Determine category based on call type
        let category = 'Voice';
        if (call.resource_type === 'message' || call.message_uuid) {
          category = 'SMS';
        } else if (call.resource_type === 'mms') {
          category = 'MMS';
        }
        
        // Get timestamps - Plivo uses initiation_time and answer_time
        const startTime = call.initiation_time || call.start_time || call.created || call.session_start || null;
        const endTime = call.answer_time || call.end_time || call.hangup_time || null;
        
        // If endTime is missing but we have startTime and duration, calculate it
        let finalEndTime = endTime;
        if (!finalEndTime && startTime && durationSeconds > 0) {
          try {
            const startDate = new Date(startTime);
            finalEndTime = new Date(startDate.getTime() + durationSeconds * 1000).toISOString();
          } catch (e) {
            logger.warn(`Failed to calculate endTime: ${e.message}`);
          }
        }
        
        // Format description
        const from = call.from_number || call.from || 'Unknown';
        const to = call.to_number || call.to || 'Unknown';
        const direction = call.direction || call.call_direction || 'outbound';
        const description = `${direction === 'inbound' ? 'Incoming' : 'Outgoing'} call from ${from} to ${to}`;
        
        return {
          category: category,
          usage: durationSeconds, // Number in seconds
          usageUnit: 'seconds',
          price: priceValue,
          priceUnit: 'USD',
          count: 1,
          countUnit: 'call',
          description: description,
          startDate: startTime || new Date().toISOString(), // ISO string format
          endDate: finalEndTime || new Date().toISOString(), // ISO string format
        };
      })
    );
    
    // Return all records (even if billing data is 0, as it might still be processing)
    logger.info(`Returning ${usageRecords.length} usage records`);
    
    return usageRecords;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get recent Plivo usage: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    // Return empty array on error instead of throwing
    return [];
  }
};

/**
 * Get list of countries with available phone numbers
 * Hardcoded to return only US and India
 * @returns {Promise<Array>} List of countries
 */
export const getAvailableCountries = async () => {
  try {
    // Hardcoded list: US and India only
    const supportedCountries = [
      { code: 'US', name: 'United States' },
      { code: 'IN', name: 'India' },
    ];
    
    const countries = supportedCountries.map(({ code, name }) => ({
      countryCode: code,
      country: name,
      beta: false,
      subresourceUris: {},
    }));
    
    logger.info(`Returning ${countries.length} supported countries for Plivo: US and India`);
    
    return countries;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get Plivo available countries: ${error.message}`);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get available countries: ${error.message}`
    );
  }
};

/**
 * Helper function to get country name from code
 */
const getCountryName = (code) => {
  const countryMap = {
    'US': 'United States',
    'GB': 'United Kingdom',
    'CA': 'Canada',
    'AU': 'Australia',
    'IN': 'India',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'PL': 'Poland',
    'PT': 'Portugal',
    'IE': 'Ireland',
  };
  return countryMap[code] || code;
};

/**
 * Get country info and available number types
 * @param {string} countryCode - ISO country code (e.g., 'US', 'GB')
 * @returns {Promise<Object>} Country information
 */
export const getCountryInfo = async (countryCode) => {
  try {
    const client = getPlivoClient();
    
    if (!countryCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Country code is required');
    }

    // Search for each number type to determine availability
    const availableTypes = [];
    const typeMap = {
      'fixed': 'Local',
      'tollfree': 'TollFree',
      'mobile': 'Mobile',
    };

    for (const [plivoType, ourType] of Object.entries(typeMap)) {
      try {
        const response = await client.numbers.search(countryCode, { 
          type: plivoType,
          limit: 1 
        });
        
        // Handle different response structures from Plivo SDK
        let hasNumbers = false;
        
        if (Array.isArray(response)) {
          // Response is directly an array
          hasNumbers = response.length > 0;
        } else if (response && Array.isArray(response.objects)) {
          // Standard Plivo SDK response structure
          hasNumbers = response.objects.length > 0;
        } else if (response && typeof response === 'object') {
          // Handle array-like objects (objects with numeric keys)
          const keys = Object.keys(response).filter(k => k !== 'meta' && /^\d+$/.test(k));
          hasNumbers = keys.length > 0;
        }
        
        // Also check meta.totalCount as fallback
        if (!hasNumbers && response?.meta?.totalCount > 0) {
          hasNumbers = true;
        }
        
        if (hasNumbers) {
          availableTypes.push(ourType);
        }
      } catch (e) {
        // Type not available for this country
        logger.debug(`Type ${plivoType} not available for ${countryCode}: ${e.message}`);
        continue;
      }
    }

    return {
      countryCode,
      country: getCountryName(countryCode),
      beta: false,
      subresourceUris: {},
      availableTypes,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get Plivo country info for ${countryCode}: ${error.message}`);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get country info: ${error.message}`
    );
  }
};

// Simple in-memory cache for pricing data (key: countryCode, value: pricing object)
// Cache expires after 1 hour (3600000 ms)
const pricingCache = new Map();

/**
 * Get pricing information for a country using Plivo Pricing API
 * @param {string} countryCode - ISO country code (e.g., 'US', 'IN')
 * @returns {Promise<Object>} Pricing information with currency and rates
 */
const getCountryPricing = async (countryCode) => {
  try {
    // Check cache first
    const cacheKey = countryCode.toUpperCase();
    const cached = pricingCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hour cache
      logger.debug(`Using cached pricing for ${countryCode}`);
      return cached.data;
    }

    const authId = config.plivo?.authId;
    const authToken = config.plivo?.authToken;
    
    if (!authId || !authToken) {
      throw new Error('Plivo credentials not configured');
    }

    // Make direct HTTP request to Plivo Pricing API
    // Endpoint: GET https://api.plivo.com/v1/Account/{auth_id}/Pricing/?country_iso={countryCode}
    const url = `https://api.plivo.com/v1/Account/${authId}/Pricing/?country_iso=${countryCode}`;
    
    // Create Basic Auth header
    const authHeader = Buffer.from(`${authId}:${authToken}`).toString('base64');
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Plivo Pricing API error: ${response.status} - ${errorText}`);
    }

    const pricing = await response.json();
    
    logger.info(`Pricing API full response for ${countryCode}: ${JSON.stringify(pricing, null, 2)}`);
    
    // Plivo pricing API returns rates in USD only
    // Always use USD for pricing
    const currency = 'USD';
    
    // Cache the result
    const pricingData = { ...pricing, currency };
    pricingCache.set(cacheKey, {
      data: pricingData,
      timestamp: Date.now()
    });
    
    logger.info(`Fetched pricing for ${countryCode}: currency=${currency}`);
    return pricingData;
  } catch (error) {
    logger.warn(`Failed to fetch pricing for ${countryCode}: ${error.message}. Using default USD.`);
    // Return USD pricing if API call fails (Plivo always returns USD)
    return { currency: 'USD', phone_numbers: {} };
  }
};

/**
 * Search for available phone numbers
 * @param {string} countryCode - ISO country code (country_iso)
 * @param {string} type - Number type: 'Local', 'TollFree', 'Mobile', 'National', or 'Fixed'
 * @param {Object} filters - Search filters
 * @returns {Promise<Object>} Search results with pagination
 */
export const searchAvailableNumbers = async (countryCode, type, filters = {}) => {
  try {
    const client = getPlivoClient();
    
    if (!countryCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Country code (country_iso) is required');
    }

    // Map our type format to Plivo type format
    const typeMap = {
      'Local': 'local',
      'TollFree': 'tollfree',
      'Mobile': 'mobile',
      'National': 'national',
      'Fixed': 'fixed',
    };
    // Handle undefined/null/empty type - don't filter by type (search all types)
    const plivoType = type ? (typeMap[type] || type?.toLowerCase()) : null;

    // Build search parameters according to Plivo API documentation
    // Note: countryCode is passed as first parameter to search(), not in searchParams
    const searchParams = {
      limit: Math.min(filters.pageSize || filters.limit || 20, 20), // Plivo limit is 20
      offset: filters.offset !== undefined ? filters.offset : (filters.page ? (filters.page - 1) * (filters.pageSize || 20) : 0),
    };

    // Add type if provided and not empty/null
    // If type is not provided or is 'any', don't add type filter (search all types)
    if (plivoType && plivoType !== 'any' && ['tollfree', 'local', 'mobile', 'national', 'fixed'].includes(plivoType)) {
      searchParams.type = plivoType;
    }

    // Add pattern search if provided
    // Plivo API uses 'pattern' parameter, but we accept 'contains' for legacy compatibility
    if (filters.pattern) {
      searchParams.pattern = filters.pattern;
    } else if (filters.contains) {
      searchParams.pattern = filters.contains;
    }

    // Add npanxx (six-digit integer) for US/CA local numbers
    if (filters.npanxx) {
      searchParams.npanxx = parseInt(filters.npanxx, 10);
    }

    // Add local_calling_area boolean
    if (filters.localCallingArea !== undefined) {
      searchParams.local_calling_area = filters.localCallingArea === true || filters.localCallingArea === 'true';
    }

    // Add region filter
    if (filters.inRegion || filters.region) {
      searchParams.region = filters.inRegion || filters.region;
    }

    // Add services filter (voice, sms, mms)
    // Only add services filter if explicitly requested
    // If no capabilities are selected, don't filter by services (return all)
    if (filters.services) {
      searchParams.services = filters.services;
    } else {
      // Build services filter from capability filters
      // Only add services if they are explicitly set to true
      const services = [];
      if (filters.voiceEnabled === true) services.push('voice');
      if (filters.smsEnabled === true) services.push('sms');
      if (filters.mmsEnabled === true) services.push('mms');
      // Only add services filter if at least one capability is explicitly requested
      if (services.length > 0) {
        searchParams.services = services.join(',');
      }
      // If no capabilities are selected (all undefined), don't add services filter
      // This allows the API to return all numbers regardless of capabilities
    }

    // Add city filter (applicable only for local type)
    if (filters.inLocality || filters.city) {
      searchParams.city = filters.inLocality || filters.city;
    }

    // Add LATA filter (US/CA only)
    if (filters.inLata || filters.lata) {
      searchParams.lata = filters.inLata || filters.lata;
    }

    // Add rate_center filter (US/CA only)
    if (filters.inRateCenter || filters.rateCenter) {
      searchParams.rate_center = filters.inRateCenter || filters.rateCenter;
    }

    // Add compliance_requirement filter
    if (filters.complianceRequirement) {
      searchParams.compliance_requirement = filters.complianceRequirement;
    }

    logger.info(`Searching Plivo numbers: country=${countryCode}, type=${plivoType || 'any'}, params=${JSON.stringify(searchParams)}`);
    
    // Fetch pricing information (rates are always in USD)
    let countryPricing;
    try {
      countryPricing = await getCountryPricing(countryCode);
    } catch (pricingError) {
      logger.warn(`Could not fetch pricing for ${countryCode}, using defaults: ${pricingError.message}`);
      countryPricing = { currency: 'USD', phone_numbers: {} };
    }
    
    // Declare variables outside try block so they're accessible in return statement
    let response;
    let availableNumbers = [];
    let responseMeta = {};
    
    try {
      response = await client.numbers.search(countryCode, searchParams);
      
      // Log response structure for debugging
      const responseKeys = response ? Object.keys(response) : [];
      logger.info(`Plivo search response structure: ${JSON.stringify({
        hasObjects: !!response.objects,
        hasArray: Array.isArray(response),
        responseKeys: responseKeys,
        responseType: typeof response,
        objectsType: response?.objects ? (Array.isArray(response.objects) ? 'array' : typeof response.objects) : 'undefined',
        objectsLength: response?.objects?.length || 0,
        meta: response?.meta,
        // Try to find array-like properties
        hasData: !!response?.data,
        dataLength: response?.data?.length || 0,
        hasResults: !!response?.results,
        resultsLength: response?.results?.length || 0,
      })}`);
      
      // Handle different response structures from Plivo SDK
      // The SDK might return { objects: [...], meta: {...} } or other structures
      // Note: Plivo SDK can return an array-like object with numeric indices AND a meta property
      // Initialize arrays (already declared above)
      availableNumbers = [];
      responseMeta = {};
      
      // First, extract meta if it exists (before processing the array)
      if (response && response.meta) {
        responseMeta = response.meta;
      }
      
      // Check if response is an array or array-like object
      if (Array.isArray(response)) {
        // Response is directly an array - create a proper copy
        // Use Array.from to ensure we get a true array, not array-like object
        availableNumbers = Array.from(response);
        logger.info(`Response is directly an array with ${availableNumbers.length} items`);
      } else if (response && Array.isArray(response.objects)) {
        // Standard Plivo SDK response structure
        availableNumbers = Array.from(response.objects);
        logger.info(`Response has objects property with ${availableNumbers.length} items`);
      } else if (response && response.data && Array.isArray(response.data)) {
        // Alternative structure with data property
        availableNumbers = Array.from(response.data);
        logger.info(`Response has data property with ${availableNumbers.length} items`);
      } else if (response && response.results && Array.isArray(response.results)) {
        // Alternative structure with results property
        availableNumbers = Array.from(response.results);
        logger.info(`Response has results property with ${availableNumbers.length} items`);
      } else if (response && typeof response === 'object') {
        // Handle array-like objects (objects with numeric keys)
        // Check if it has numeric keys (0, 1, 2, etc.) which indicates array-like structure
        const keys = Object.keys(response).filter(k => k !== 'meta' && /^\d+$/.test(k));
        if (keys.length > 0) {
          // It's an array-like object - convert to array
          availableNumbers = keys
            .map(k => parseInt(k, 10))
            .sort((a, b) => a - b)
            .map(index => response[index])
            .filter(item => item !== undefined && item !== null);
          logger.info(`Converted array-like object to array with ${availableNumbers.length} items`);
        } else if (response.objects) {
          // Try to convert to array if it's not already
          try {
            availableNumbers = Array.from(response.objects);
            logger.info(`Converted response.objects to array with ${availableNumbers.length} items`);
          } catch (e) {
            logger.warn(`Failed to convert response.objects to array: ${e.message}`);
          }
        }
      }
      
      // If still no numbers but meta shows totalCount > 0, there might be a structure issue
      if (availableNumbers.length === 0 && responseMeta?.total_count > 0) {
        logger.error(`CRITICAL: Meta shows ${responseMeta.total_count} numbers available but objects array is empty!`);
        logger.error(`Full response keys: ${Object.keys(response || {}).join(', ')}`);
        logger.error(`Response type: ${typeof response}, IsArray: ${Array.isArray(response)}`);
        // Try to find numbers in any array-like property
        for (const key of Object.keys(response || {})) {
          // Skip 'meta' property
          if (key === 'meta') continue;
          if (Array.isArray(response[key]) && response[key].length > 0) {
            logger.error(`Found array in property '${key}' with ${response[key].length} items!`);
            availableNumbers = Array.from(response[key]);
            responseMeta = response.meta || {};
            break;
          }
        }
      }
      
      // Ensure availableNumbers is always an array
      if (!Array.isArray(availableNumbers)) {
        logger.warn(`availableNumbers is not an array, converting...`);
        availableNumbers = [];
      }
      
      // Final check - if still no numbers, log full response (truncated)
      if (availableNumbers.length === 0 && response) {
        const responseStr = JSON.stringify(response);
        logger.warn(`No numbers extracted. Response preview (first 500 chars): ${responseStr.substring(0, 500)}`);
      }
      
      if (availableNumbers.length > 0) {
        logger.info(`Found ${availableNumbers.length} numbers for country ${countryCode}, type ${plivoType || 'any'}`);
        logger.info(`First number example: ${JSON.stringify(availableNumbers[0])}`);
      } else {
        logger.warn(`No numbers found for country ${countryCode}, type ${plivoType || 'any'}. Response structure: ${JSON.stringify({
          type: typeof response,
          isArray: Array.isArray(response),
          keys: response ? Object.keys(response) : 'null',
          hasObjects: !!response?.objects,
          objectsType: response?.objects ? typeof response.objects : 'undefined'
        })}`);
      }
    } catch (plivoError) {
      logger.error(`Plivo API error during search: ${plivoError.message}`, {
        error: plivoError.message,
        stack: plivoError.stack,
        countryCode,
        searchParams
      });
      throw new ApiError(
        httpStatus.BAD_GATEWAY,
        `Plivo API error: ${plivoError.message || 'Failed to search numbers'}`
      );
    }

    // Map Plivo PhoneNumber object to our format
    return {
      availableNumbers: availableNumbers.map(num => {
        // Plivo API returns camelCase fields, handle both camelCase and snake_case for compatibility
        const voiceEnabled = num.voiceEnabled !== undefined ? num.voiceEnabled : num.voice_enabled;
        const smsEnabled = num.smsEnabled !== undefined ? num.smsEnabled : num.sms_enabled;
        const mmsEnabled = num.mmsEnabled !== undefined ? num.mmsEnabled : num.mms_enabled;
        const monthlyRentalRate = num.monthlyRentalRate !== undefined ? num.monthlyRentalRate : num.monthly_rental_rate;
        const setupRate = num.setupRate !== undefined ? num.setupRate : num.setup_rate;
        const smsRate = num.smsRate !== undefined ? num.smsRate : num.sms_rate;
        const mmsRate = num.mmsRate !== undefined ? num.mmsRate : num.mms_rate;
        const voiceRate = num.voiceRate !== undefined ? num.voiceRate : num.voice_rate;
        const rateCenter = num.rateCenter !== undefined ? num.rateCenter : num.rate_center;
        const subType = num.subType !== undefined ? num.subType : num.sub_type;
        const restrictionText = num.restrictionText !== undefined ? num.restrictionText : num.restriction_text;
        const resourceUri = num.resourceUri !== undefined ? num.resourceUri : num.resource_uri;
        
        return {
          friendlyName: num.number || '',
          phoneNumber: num.number || '',
          prefix: num.prefix || null,
          city: num.city || null,
          country: num.country || null,
          region: num.region || null,
          rateCenter: rateCenter || null,
          lata: num.lata || null,
          type: num.type || null,
          subType: subType || null,
          locality: num.city || num.locality || null,
          postalCode: num.postal_code || null,
          isoCountry: num.country_iso || countryCode,
          addressRequirements: num.restriction ? 
            (num.restriction === 'city-address' ? 'local' : 
             num.restriction === 'country-address' ? 'foreign' : 'any') : 'none',
          restriction: num.restriction || null,
          restrictionText: restrictionText || null,
          beta: false,
          capabilities: {
            voice: voiceEnabled === true,
            sms: smsEnabled === true,
            mms: mmsEnabled === true,
            fax: false, // Plivo doesn't support fax
          },
          pricing: (() => {
            // Plivo pricing API always returns rates in USD
            const currency = 'USD';
            
            // Map search API type to Pricing API type
            // Search API: "fixed" with subType "local" -> Pricing API: "local"
            // Search API: "tollfree" -> Pricing API: "tollfree"
            // Search API: "mobile" -> Pricing API: "mobile"
            let pricingApiType = null;
            if (num.subType === 'local' || (num.type === 'fixed' && num.subType === 'local')) {
              pricingApiType = 'local';
            } else if (num.type === 'tollfree') {
              pricingApiType = 'tollfree';
            } else if (num.type === 'mobile') {
              pricingApiType = 'mobile';
            } else if (num.type === 'national') {
              pricingApiType = 'national';
            } else {
              // Fallback: use plivoType or default to 'local'
              pricingApiType = plivoType || 'local';
            }
            
            const pricingForType = countryPricing?.phone_numbers?.[pricingApiType];
            
            // Log pricing API data for debugging
            if (pricingForType) {
              logger.debug(`Pricing API data for ${pricingApiType}: ${JSON.stringify({
                hasRate: !!pricingForType.rate,
                rate: pricingForType.rate,
                hasRatesArray: Array.isArray(pricingForType.rates),
                ratesArrayLength: pricingForType.rates?.length || 0,
                ratesArray: pricingForType.rates ? pricingForType.rates.map(r => ({
                  capabilities: r.capabilities,
                  rental_rate: r.rental_rate,
                  setup_rate: r.setup_rate
                })) : null
              })}`);
            } else {
              logger.debug(`No pricing data found for type ${pricingApiType} in country ${countryCode}`);
            }
            
            // Determine capabilities for matching pricing rates
            const hasVoice = voiceEnabled === true;
            const hasSms = smsEnabled === true;
            const hasMms = mmsEnabled === true;
            
            // Try to find matching rate from pricing API based on capabilities
            let pricingRate = null;
            let pricingSetupRate = null;
            
            // First, try to find capability-specific rate from rates array
            if (pricingForType?.rates && Array.isArray(pricingForType.rates)) {
              // Find rate that matches capabilities
              const matchingRate = pricingForType.rates.find(rate => {
                const rateCaps = rate.capabilities || [];
                // Match if all required capabilities are present in the rate
                if (hasVoice && !rateCaps.includes('voice')) return false;
                if (hasSms && !rateCaps.includes('sms')) return false;
                if (hasMms && !rateCaps.includes('mms')) return false;
                return true;
              });
              
              if (matchingRate) {
                pricingRate = matchingRate.rental_rate ? parseFloat(matchingRate.rental_rate) : null;
                pricingSetupRate = matchingRate.setup_rate ? parseFloat(matchingRate.setup_rate) : null;
              }
            }
            
            // Fallback to general rate if no matching capability-specific rate found
            if (!pricingRate && pricingForType?.rate) {
              pricingRate = parseFloat(pricingForType.rate);
            }
            
            // Use Pricing API rates directly (Plivo should return rates in local currency)
            // If Pricing API doesn't have rates, use search response rates
            let finalMonthlyRate = pricingRate;
            let finalSetupRate = pricingSetupRate;
            
            // If pricing API doesn't have rates, use search response rates as fallback
            if (!finalMonthlyRate && monthlyRentalRate) {
              finalMonthlyRate = parseFloat(monthlyRentalRate);
            }
            
            if (!finalSetupRate && setupRate) {
              finalSetupRate = parseFloat(setupRate);
            }
            
            return {
              basePrice: null,
              currentPrice: finalMonthlyRate || null,
              baseSetupPrice: finalSetupRate || null,
              baseRecurringPrice: finalMonthlyRate || null,
              currency: currency,
              smsRate: smsRate ? parseFloat(smsRate) : null,
              mmsRate: mmsRate ? parseFloat(mmsRate) : null,
              voiceRate: voiceRate ? parseFloat(voiceRate) : null,
            };
          })(),
          resourceUri: resourceUri || null,
        };
      }),
      page: filters.page || 1,
      pageSize: searchParams.limit,
      uri: null,
      nextPageUri: responseMeta?.next ? `offset=${responseMeta.next}` : null,
      previousPageUri: responseMeta?.previous ? `offset=${responseMeta.previous}` : null,
      meta: {
        limit: responseMeta?.limit || searchParams.limit,
        offset: responseMeta?.offset || searchParams.offset,
        totalCount: responseMeta?.total_count || responseMeta?.totalCount || availableNumbers.length,
        next: responseMeta?.next || null,
        previous: responseMeta?.previous || null,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    // Handle Plivo-specific errors
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Plivo API Error: ${errorMessage}`);
    
    if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Plivo credentials. Please check your Auth ID and Auth Token.');
    }
    
    if (errorMessage.includes('rate limit')) {
      throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Plivo API rate limit exceeded. Please try again later.');
    }

    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Plivo API Error: ${errorMessage}`
    );
  }
};

/**
 * Purchase a phone number
 * @param {string} phoneNumber - Phone number in E.164 format
 * @param {Object} options - Purchase options (friendlyName/alias, appId, cnamLookup)
 * @returns {Promise<Object>} Purchased number information
 */
export const purchasePhoneNumber = async (phoneNumber, options = {}) => {
  try {
    const client = getPlivoClient();
    
    if (!phoneNumber) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number is required');
    }

    // Build buy parameters according to Plivo API
    // Only include parameters that have values
    const buyParams = {};
    
    // Support both friendlyName (legacy) and alias
    if (options.friendlyName || options.alias) {
      const aliasValue = options.friendlyName || options.alias;
      if (aliasValue && typeof aliasValue === 'string' && aliasValue.trim()) {
        buyParams.alias = aliasValue.trim();
      }
    }
    
    // Add app_id if provided
    if (options.appId && typeof options.appId === 'string' && options.appId.trim()) {
      buyParams.app_id = options.appId.trim();
    }
    
    // Add cnam_lookup if provided (for US local and toll-free numbers)
    if (options.cnamLookup && ['enabled', 'disabled'].includes(options.cnamLookup)) {
      buyParams.cnam_lookup = options.cnamLookup;
    }

    // Log the buy parameters for debugging
    logger.info(`Purchasing phone number ${phoneNumber}`);
    logger.info(`Options received: ${JSON.stringify(options)}`);
    
    // Build clean params object with only defined, non-empty values
    const cleanParams = {};
    if (buyParams.alias && String(buyParams.alias).trim()) {
      cleanParams.alias = String(buyParams.alias).trim();
    }
    if (buyParams.app_id && String(buyParams.app_id).trim()) {
      cleanParams.app_id = String(buyParams.app_id).trim();
    }
    if (buyParams.cnam_lookup) {
      cleanParams.cnam_lookup = String(buyParams.cnam_lookup);
    }

    const hasParams = Object.keys(cleanParams).length > 0;
    logger.info(`Clean params to send: ${JSON.stringify(cleanParams)}`);
    logger.info(`Has params: ${hasParams}`);

    // Call Plivo SDK buy method
    // According to Plivo docs, second parameter is optional
    // Only pass params object if it has values to avoid JSON formatting issues
    let response;
    if (hasParams) {
      response = await client.numbers.buy(phoneNumber, cleanParams);
    } else {
      // Call without second parameter if no options provided
      response = await client.numbers.buy(phoneNumber);
    }

    // Log the response structure for debugging
    logger.info(`Plivo buy response: ${JSON.stringify({
      message: response.message,
      status: response.status,
      numbers: response.numbers,
      apiId: response.api_id
    })}`);

    // Handle response according to Plivo API documentation
    // Response can have status "fulfilled" (immediate) or "pending" (verification required)
    const purchaseStatus = response.status || 'fulfilled';
    const numbersArray = response.numbers || [];
    const numberStatus = numbersArray.length > 0 ? numbersArray[0].status : 'Success';

    // If status is "pending", the number requires verification
    if (purchaseStatus === 'pending' || numberStatus === 'pending') {
      logger.warn(`Phone number ${phoneNumber} purchase is pending verification`);
      return {
        sid: phoneNumber,
        phoneNumber: phoneNumber,
        friendlyName: options.friendlyName || options.alias || phoneNumber,
        capabilities: {
          voice: false,
          sms: false,
          mms: false,
          fax: false,
        },
        status: 'pending',
        dateCreated: new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
        message: response.message || 'created',
        numbers: response.numbers || [{ number: phoneNumber, status: 'pending' }],
        apiId: response.api_id,
        requiresVerification: true,
      };
    }

    // If status is "fulfilled" and number status is "Success", get the number details
    let numberDetails;
    try {
      numberDetails = await client.numbers.get(phoneNumber);
    } catch (getError) {
      // If we can't get details immediately, return what we have from the buy response
      logger.warn(`Could not fetch number details immediately after purchase: ${getError.message}`);
      return {
        sid: phoneNumber,
        phoneNumber: phoneNumber,
        friendlyName: options.friendlyName || options.alias || phoneNumber,
        capabilities: {
          voice: true, // Assume voice is enabled for purchased numbers
          sms: false,
          mms: false,
          fax: false,
        },
        status: 'active',
        dateCreated: new Date().toISOString(),
        dateUpdated: new Date().toISOString(),
        message: response.message || 'created',
        numbers: response.numbers || [{ number: phoneNumber, status: 'Success' }],
        apiId: response.api_id,
      };
    }

    return {
      sid: numberDetails.number || phoneNumber,
      phoneNumber: numberDetails.number || phoneNumber,
      friendlyName: numberDetails.alias || options.friendlyName || options.alias || phoneNumber,
      capabilities: {
        voice: numberDetails.voice_enabled !== false,
        sms: numberDetails.sms_enabled === true,
        mms: numberDetails.mms_enabled === true,
        fax: false,
      },
      status: numberDetails.active !== false ? 'active' : 'inactive',
      dateCreated: numberDetails.added_on || new Date().toISOString(),
      dateUpdated: numberDetails.modified_on || new Date().toISOString(),
      message: response.message || 'created',
      numbers: response.numbers || [{ number: phoneNumber, status: 'Success' }],
      apiId: response.api_id,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    // Handle error message - could be string, object, or undefined
    let errorMessage = 'Unknown error';
    if (typeof error.message === 'string') {
      errorMessage = error.message;
    } else if (error.message) {
      // If error.message is an object, stringify it
      errorMessage = JSON.stringify(error.message);
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error.toString === 'function') {
      errorMessage = error.toString();
    }
    
    logger.error(`Failed to purchase Plivo phone number:`, error);
    logger.error(`Error message: ${errorMessage}`);
    
    const errorMessageLower = errorMessage.toLowerCase();
    
    if (errorMessageLower.includes('authentication') || errorMessageLower.includes('unauthorized')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Plivo credentials. Please check your Auth ID and Auth Token.');
    }
    
    if (errorMessageLower.includes('already') || errorMessageLower.includes('owned')) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This phone number is already owned or not available for purchase.');
    }

    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Failed to purchase phone number: ${errorMessage}`
    );
  }
};

/**
 * Get list of owned phone numbers
 * @param {number} limit - Maximum number of numbers to return
 * @returns {Promise<Array>} List of owned phone numbers
 */
export const getOwnedNumbers = async (limit = 50) => {
  try {
    const client = getPlivoClient();
    
    const numbers = [];
    let offset = 0;
    const pageLimit = Math.min(limit, 20); // Plivo limit is 20 per page
    
    // Fetch numbers in pages
    while (numbers.length < limit) {
      const response = await client.numbers.list({
        limit: Math.min(pageLimit, limit - numbers.length),
        offset,
      });
      
      // Log response structure for debugging
      logger.info(`Plivo list numbers response: ${JSON.stringify({
        hasObjects: !!response.objects,
        isArray: Array.isArray(response),
        responseKeys: response ? Object.keys(response) : [],
        objectsLength: response?.objects?.length || 0,
        meta: response?.meta
      })}`);
      
      // Handle different response structures
      let responseObjects = [];
      if (Array.isArray(response)) {
        responseObjects = response;
        logger.info(`Response is directly an array with ${responseObjects.length} items`);
      } else if (response && Array.isArray(response.objects)) {
        responseObjects = response.objects;
        logger.info(`Response has objects property with ${responseObjects.length} items`);
      } else if (response && response.data && Array.isArray(response.data)) {
        responseObjects = response.data;
        logger.info(`Response has data property with ${responseObjects.length} items`);
      } else {
        logger.warn(`Unexpected response structure for list numbers: ${JSON.stringify({
          type: typeof response,
          isArray: Array.isArray(response),
          keys: response ? Object.keys(response) : []
        })}`);
      }
      
      if (!responseObjects || responseObjects.length === 0) {
        logger.info(`No more numbers to fetch. Total fetched: ${numbers.length}`);
        break;
      }
      
      const mappedNumbers = responseObjects.map(num => ({
        sid: num.number || num.phone_number || '',
        phoneNumber: num.number || num.phone_number || '',
        friendlyName: num.alias || num.number || '',
        alias: num.alias || null,
        capabilities: {
          voice: num.voice_enabled !== false,
          sms: num.sms_enabled === true,
          mms: num.mms_enabled === true || num.sms_enabled === true,
          fax: false,
        },
        status: num.active !== false ? 'active' : 'inactive',
        dateCreated: num.added_on || null,
        dateUpdated: num.modified_on || null,
        uri: num.resource_uri || null,
        // Additional fields for display
        city: num.city || null,
        region: num.region || null,
        country: num.country || null,
        type: num.type || num.sub_type || 'local',
        appId: num.app_id || null,
        appName: num.application?.name || null,
        voiceUrl: num.voice_url || null,
        smsUrl: num.sms_url || null,
      }));
      
      numbers.push(...mappedNumbers);
      
      logger.info(`Fetched ${mappedNumbers.length} numbers (total: ${numbers.length}/${limit})`);
      
      // Check if there are more pages
      const responseMeta = response.meta || {};
      if (!responseMeta.next || numbers.length >= limit) {
        logger.info(`Reached end of pagination or limit. Total numbers: ${numbers.length}`);
        break;
      }
      
      offset += pageLimit;
    }
    
    logger.info(`Returning ${numbers.length} owned numbers`);
    return numbers.slice(0, limit);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get Plivo owned numbers: ${error.message}`);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get owned numbers: ${error.message}`
    );
  }
};

/**
 * Unrent/delete a phone number from your account
 * This operation cannot be undone
 * @param {string} phoneNumber - Phone number in E.164 format
 * @returns {Promise<Object>} Deletion result
 */
export const deletePhoneNumber = async (phoneNumber) => {
  try {
    const client = getPlivoClient();
    
    if (!phoneNumber) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number is required');
    }

    // Delete/unrent the number
    await client.numbers.delete(phoneNumber);

    logger.info(`Successfully unrented Plivo phone number: ${phoneNumber}`);

    return {
      success: true,
      phoneNumber,
      message: `Successfully unrented phone number ${phoneNumber}`,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Failed to unrent Plivo phone number: ${errorMessage}`);
    
    if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Plivo credentials. Please check your Auth ID and Auth Token.');
    }
    
    if (errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
      throw new ApiError(httpStatus.NOT_FOUND, 'This phone number is not found in your account or has already been unrented.');
    }

    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Failed to unrent phone number: ${errorMessage}`
    );
  }
};

/**
 * Get all live calls
 * @param {Object} filters - Optional filters (call_direction, number)
 * @returns {Promise<Object>} List of live calls
 */
export const getLiveCalls = async (filters = {}) => {
  try {
    const client = getPlivoClient();
    
    const params = {
      status: 'live',
    };
    
    if (filters.call_direction) {
      params.call_direction = filters.call_direction;
    }
    
    if (filters.number) {
      params.number = filters.number;
    }
    
    const response = await client.calls.list(params);
    
    const calls = (response.objects || []).map(call => ({
      callUuid: call.call_uuid,
      callStatus: call.call_status,
      callerName: call.caller_name,
      direction: call.direction,
      from: call.from,
      to: call.to,
      requestUuid: call.request_uuid,
      sessionStart: call.session_start,
      stirAttestation: call.stir_attestation,
      stirVerification: call.stir_verification,
    }));
    
    return {
      calls,
      meta: {
        count: response.meta?.count || calls.length,
        limit: response.meta?.limit || 20,
        next: response.meta?.next || null,
        offset: response.meta?.offset || 0,
        previous: response.meta?.previous || null,
      },
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get Plivo live calls: ${error.message}`);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get live calls: ${error.message}`
    );
  }
};

/**
 * Get all queued calls
 * @returns {Promise<Object>} List of queued call UUIDs
 */
export const getQueuedCalls = async () => {
  try {
    const client = getPlivoClient();
    
    const response = await client.calls.listQueuedCalls();
    
    return {
      calls: response.calls || [],
      apiId: response.api_id,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to get Plivo queued calls: ${error.message}`);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get queued calls: ${error.message}`
    );
  }
};

/**
 * Get details of a specific queued call
 * @param {string} callUuid - Call UUID
 * @returns {Promise<Object>} Queued call details
 */
export const getQueuedCallDetails = async (callUuid) => {
  try {
    const client = getPlivoClient();
    
    if (!callUuid) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Call UUID is required');
    }
    
    const call = await client.calls.getQueuedCall(callUuid);
    
    return {
      callUuid: call.call_uuid,
      callStatus: call.call_status,
      callerName: call.caller_name,
      direction: call.direction,
      from: call.from,
      to: call.to,
      requestUuid: call.request_uuid,
      apiId: call.api_id,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Failed to get queued call details: ${errorMessage}`);
    
    if (errorMessage.includes('not found')) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Queued call not found');
    }
    
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get queued call details: ${errorMessage}`
    );
  }
};

/**
 * Start recording a call
 * @param {string} callUuid - Call UUID
 * @param {Object} options - Recording options
 * @returns {Promise<Object>} Recording details
 */
export const startCallRecording = async (callUuid, options = {}) => {
  try {
    const client = getPlivoClient();
    
    if (!callUuid) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Call UUID is required');
    }
    
    const params = {};
    
    if (options.timeLimit) {
      params.time_limit = options.timeLimit;
    }
    
    if (options.fileFormat) {
      params.file_format = options.fileFormat;
    }
    
    if (options.transcriptionType) {
      params.transcription_type = options.transcriptionType;
    }
    
    if (options.transcriptionUrl) {
      params.transcription_url = options.transcriptionUrl;
    }
    
    if (options.callbackUrl) {
      params.callback_url = options.callbackUrl;
    }
    
    if (options.callbackMethod) {
      params.callback_method = options.callbackMethod;
    }
    
    if (options.recordChannelType) {
      params.record_channel_type = options.recordChannelType;
    }
    
    const response = await client.calls.record(callUuid, params);
    
    return {
      url: response.url,
      message: response.message,
      recordingId: response.recording_id,
      apiId: response.api_id,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Failed to start call recording: ${errorMessage}`);
    
    if (errorMessage.includes('not found')) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Call not found');
    }
    
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to start call recording: ${errorMessage}`
    );
  }
};

/**
 * Stop recording a call
 * @param {string} callUuid - Call UUID
 * @param {string} recordUrl - Optional record URL to stop specific recording
 * @returns {Promise<Object>} Stop recording result
 */
export const stopCallRecording = async (callUuid, recordUrl = null) => {
  try {
    const client = getPlivoClient();
    
    if (!callUuid) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Call UUID is required');
    }
    
    const params = {};
    if (recordUrl) {
      params.url = recordUrl;
    }
    
    await client.calls.stopRecording(callUuid, params);
    
    return {
      success: true,
      message: recordUrl ? 'Recording stopped successfully' : 'All recordings stopped successfully',
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Failed to stop call recording: ${errorMessage}`);
    
    if (errorMessage.includes('not found')) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Call or recording not found');
    }
    
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to stop call recording: ${errorMessage}`
    );
  }
};

/**
 * Get details of a specific phone number
 * @param {string} phoneNumber - Phone number
 * @returns {Promise<Object>} Number details
 */
export const getNumberDetails = async (phoneNumber) => {
  try {
    const client = getPlivoClient();
    
    if (!phoneNumber) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number is required');
    }
    
    const number = await client.numbers.get(phoneNumber);
    
    return {
      number: number.number,
      alias: number.alias,
      subaccount: number.sub_account,
      addedOn: number.added_on,
      application: number.application,
      carrier: number.carrier,
      region: number.region,
      numberType: number.number_type,
      monthlyRentalRate: number.monthly_rental_rate,
      renewalDate: number.renewal_date,
      smsEnabled: number.sms_enabled,
      smsRate: number.sms_rate,
      mmsEnabled: number.mms_enabled,
      mmsRate: number.mms_rate,
      voiceEnabled: number.voice_enabled,
      voiceRate: number.voice_rate,
      cnamLookup: number.cnam_lookup,
      cnam: number.cnam,
      cnamRegistrationStatus: number.cnam_registration_status,
      resourceUri: number.resource_uri,
      tendlcRegistrationStatus: number.tendlc_registration_status,
      tendlcCampaignId: number.tendlc_campaign_id,
      tollFreeSmsVerification: number.toll_free_sms_verification,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Failed to get Plivo number details: ${errorMessage}`);
    
    if (errorMessage.includes('not found')) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Phone number not found');
    }
    
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to get number details: ${errorMessage}`
    );
  }
};

/**
 * Update a phone number
 * @param {string} phoneNumber - Phone number
 * @param {Object} updates - Update parameters (app_id, alias, subaccount, cnam_lookup, cnam, etc.)
 * @returns {Promise<Object>} Update result
 */
export const updateNumber = async (phoneNumber, updates = {}) => {
  try {
    const client = getPlivoClient();
    
    if (!phoneNumber) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number is required');
    }
    
    const params = {};
    
    if (updates.appId) {
      params.app_id = updates.appId;
    }
    
    if (updates.alias !== undefined) {
      params.alias = updates.alias;
    }
    
    if (updates.subaccount) {
      params.subaccount = updates.subaccount;
    }
    
    if (updates.cnamLookup) {
      params.cnam_lookup = updates.cnamLookup;
    }
    
    if (updates.cnam) {
      params.cnam = updates.cnam;
    }
    
    if (updates.cnamCallbackUrl) {
      params.cnam_callback_url = updates.cnamCallbackUrl;
    }
    
    if (updates.cnamCallbackMethod) {
      params.cnam_callback_method = updates.cnamCallbackMethod;
    }
    
    const response = await client.numbers.update(phoneNumber, params);
    
    return {
      success: true,
      message: response.message || 'Number updated successfully',
      apiId: response.api_id,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Failed to update Plivo number: ${errorMessage}`);
    
    if (errorMessage.includes('not found')) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Phone number not found');
    }
    
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to update number: ${errorMessage}`
    );
  }
};

/**
 * Add a phone number from your own carrier
 * @param {string|Array<string>} numbers - Phone number(s) to add (comma-separated string or array)
 * @param {string} carrier - The ID of the IncomingCarrier
 * @param {string} region - Free-text description of the region
 * @param {Object} options - Optional parameters (number_type, app_id, subaccount)
 * @returns {Promise<Object>} Add number result
 */
export const addNumberFromCarrier = async (numbers, carrier, region, options = {}) => {
  try {
    const client = getPlivoClient();
    
    if (!numbers || (Array.isArray(numbers) && numbers.length === 0)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'At least one phone number is required');
    }
    
    if (!carrier) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Carrier ID is required');
    }
    
    if (!region) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Region is required');
    }
    
    // Convert array to comma-separated string if needed
    const numbersString = Array.isArray(numbers) ? numbers.join(',') : numbers;
    
    const params = {
      numbers: numbersString,
      carrier,
      region,
    };
    
    if (options.numberType) {
      params.number_type = options.numberType;
    }
    
    if (options.appId) {
      params.app_id = options.appId;
    }
    
    if (options.subaccount) {
      params.subaccount = options.subaccount;
    }
    
    // Use the create method to add numbers from own carrier
    // This is different from buy() which purchases from Plivo
    const response = await client.numbers.create(params);
    
    logger.info(`Successfully added ${numbersString} from carrier ${carrier}`);
    
    return {
      success: true,
      message: response.message || 'Number(s) added successfully',
      apiId: response.api_id,
      numbers: numbersString,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error.message || 'Unknown error';
    logger.error(`Failed to add number from carrier: ${errorMessage}`);
    
    if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Plivo credentials. Please check your Auth ID and Auth Token.');
    }
    
    if (errorMessage.includes('carrier') && errorMessage.includes('not found')) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Incoming carrier not found. Please create an incoming carrier first.');
    }
    
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Failed to add number from carrier: ${errorMessage}`
    );
  }
};
