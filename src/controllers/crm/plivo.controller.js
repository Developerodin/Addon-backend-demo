import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as plivoService from '../../services/crm/plivoService.js';
import logger from '../../config/logger.js';

/**
 * Get current account balance
 */
export const getBalance = catchAsync(async (req, res) => {
  const balance = await plivoService.getAccountBalance();
  
  logger.info(`Fetched Plivo account balance: ${balance.balance} ${balance.currency}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    balance,
  });
});

/**
 * Get usage statistics
 */
export const getUsage = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  const usage = await plivoService.getUsageSummary(startDate, endDate);
  
  logger.info(`Fetched Plivo usage summary from ${startDate || 'beginning'} to ${endDate || 'now'}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    usage,
  });
});

/**
 * Get account information
 */
export const getAccountInfo = catchAsync(async (req, res) => {
  const accountInfo = await plivoService.getAccountInfo();
  
  logger.info(`Fetched Plivo account info: ${accountInfo.name || accountInfo.authId}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    account: accountInfo,
  });
});

/**
 * Update account details
 */
export const updateAccount = catchAsync(async (req, res) => {
  const {
    name,
    city,
    state,
    address,
    timezone,
  } = req.body;
  
  const updates = {
    name,
    city,
    state,
    address,
    timezone,
  };
  
  // Remove undefined values
  Object.keys(updates).forEach(key => {
    if (updates[key] === undefined) {
      delete updates[key];
    }
  });
  
  if (Object.keys(updates).length === 0) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'At least one update parameter is required (name, city, state, address, or timezone)',
    });
  }
  
  const result = await plivoService.updateAccount(updates);
  
  logger.info(`Updated Plivo account details`);
  
  res.status(httpStatus.ACCEPTED).send({
    success: true,
    ...result,
  });
});

/**
 * Get recent usage records
 */
export const getRecentUsage = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  
  const usage = await plivoService.getRecentUsage(limit);
  
  logger.info(`Fetched ${usage.length} recent Plivo usage records`);
  
  res.status(httpStatus.OK).send({
    success: true,
    usage,
    count: usage.length,
  });
});

/**
 * Get list of countries with available phone numbers
 */
export const getAvailableCountries = catchAsync(async (req, res) => {
  const countries = await plivoService.getAvailableCountries();
  
  logger.info(`Fetched ${countries.length} countries with available phone numbers`);
  
  res.status(httpStatus.OK).send({
    success: true,
    countries,
    count: countries.length,
  });
});

/**
 * Get country info and available number types
 */
export const getCountryInfo = catchAsync(async (req, res) => {
  const { countryCode } = req.params;
  
  const countryInfo = await plivoService.getCountryInfo(countryCode);
  
  logger.info(`Fetched country info for ${countryCode}: ${countryInfo.country}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    country: countryInfo,
  });
});

/**
 * Search for available phone numbers
 */
export const searchAvailableNumbers = catchAsync(async (req, res) => {
  const { countryCode, type } = req.query;
  
  if (!countryCode) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Country code (country_iso) is required',
    });
  }
  
  // Extract filters from query parameters according to Plivo API documentation
  const filters = {
    // Pattern matching
    pattern: req.query.pattern,
    contains: req.query.contains, // Legacy support
    
    // US/CA specific filters
    npanxx: req.query.npanxx ? parseInt(req.query.npanxx, 10) : undefined,
    localCallingArea: req.query.localCallingArea === 'true' ? true : req.query.localCallingArea === 'false' ? false : undefined,
    
    // Location filters
    region: req.query.region,
    inRegion: req.query.inRegion, // Legacy support
    city: req.query.city,
    inLocality: req.query.inLocality, // Legacy support
    lata: req.query.lata,
    inLata: req.query.inLata, // Legacy support
    rateCenter: req.query.rateCenter,
    inRateCenter: req.query.inRateCenter, // Legacy support
    
    // Service filters
    services: req.query.services, // voice,sms,mms format
    smsEnabled: req.query.smsEnabled === 'true' ? true : req.query.smsEnabled === 'false' ? false : undefined,
    mmsEnabled: req.query.mmsEnabled === 'true' ? true : req.query.mmsEnabled === 'false' ? false : undefined,
    voiceEnabled: req.query.voiceEnabled === 'true' ? true : req.query.voiceEnabled === 'false' ? false : undefined,
    
    // Compliance
    complianceRequirement: req.query.complianceRequirement,
    
    // Pagination
    limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
    pageSize: req.query.pageSize ? parseInt(req.query.pageSize, 10) : undefined,
    page: req.query.page ? parseInt(req.query.page, 10) : undefined,
  };
  
  // Remove undefined values
  Object.keys(filters).forEach(key => {
    if (filters[key] === undefined) {
      delete filters[key];
    }
  });
  
  const results = await plivoService.searchAvailableNumbers(countryCode, type, filters);
  
  logger.info(`Searched for ${type || 'numbers'} in ${countryCode}: found ${results.availableNumbers.length} results`);
  
  res.status(httpStatus.OK).send({
    success: true,
    ...results,
  });
});

/**
 * Purchase a phone number
 */
export const purchasePhoneNumber = catchAsync(async (req, res) => {
  const { phoneNumber, friendlyName, alias, appId, cnamLookup } = req.body;
  
  if (!phoneNumber) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Phone number is required',
    });
  }
  
  const options = {};
  
  // Support both friendlyName (legacy) and alias
  if (friendlyName || alias) {
    options.friendlyName = friendlyName;
    options.alias = alias || friendlyName;
  }
  
  if (appId) {
    options.appId = appId;
  }
  
  if (cnamLookup && ['enabled', 'disabled'].includes(cnamLookup)) {
    options.cnamLookup = cnamLookup;
  }
  
  const purchased = await plivoService.purchasePhoneNumber(phoneNumber, options);
  
  logger.info(`Purchased Plivo phone number: ${purchased.phoneNumber}`);
  
  res.status(httpStatus.CREATED).send({
    success: true,
    number: purchased,
    message: purchased.message || `Successfully purchased phone number ${purchased.phoneNumber}`,
  });
});

/**
 * Get list of owned phone numbers
 */
export const getOwnedNumbers = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  
  const numbers = await plivoService.getOwnedNumbers(limit);
  
  logger.info(`Fetched ${numbers.length} owned Plivo phone numbers`);
  
  res.status(httpStatus.OK).send({
    success: true,
    numbers,
    count: numbers.length,
  });
});

/**
 * Unrent/delete a phone number
 */
export const deletePhoneNumber = catchAsync(async (req, res) => {
  const { phoneNumber } = req.params;
  
  if (!phoneNumber) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Phone number is required',
    });
  }
  
  const result = await plivoService.deletePhoneNumber(phoneNumber);
  
  logger.info(`Unrented Plivo phone number: ${phoneNumber}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

/**
 * Get all live calls
 */
export const getLiveCalls = catchAsync(async (req, res) => {
  const filters = {
    call_direction: req.query.call_direction,
    number: req.query.number,
  };
  
  // Remove undefined values
  Object.keys(filters).forEach(key => {
    if (filters[key] === undefined) {
      delete filters[key];
    }
  });
  
  const result = await plivoService.getLiveCalls(filters);
  
  logger.info(`Fetched ${result.calls.length} live Plivo calls`);
  
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

/**
 * Get all queued calls
 */
export const getQueuedCalls = catchAsync(async (req, res) => {
  const result = await plivoService.getQueuedCalls();
  
  logger.info(`Fetched ${result.calls.length} queued Plivo calls`);
  
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

/**
 * Get details of a specific queued call
 */
export const getQueuedCallDetails = catchAsync(async (req, res) => {
  const { callUuid } = req.params;
  
  if (!callUuid) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Call UUID is required',
    });
  }
  
  const call = await plivoService.getQueuedCallDetails(callUuid);
  
  logger.info(`Fetched queued call details: ${callUuid}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    call,
  });
});

/**
 * Start recording a call
 */
export const startCallRecording = catchAsync(async (req, res) => {
  const { callUuid } = req.params;
  const {
    timeLimit,
    fileFormat,
    transcriptionType,
    transcriptionUrl,
    callbackUrl,
    callbackMethod,
    recordChannelType,
  } = req.body;
  
  if (!callUuid) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Call UUID is required',
    });
  }
  
  const options = {
    timeLimit,
    fileFormat,
    transcriptionType,
    transcriptionUrl,
    callbackUrl,
    callbackMethod,
    recordChannelType,
  };
  
  // Remove undefined values
  Object.keys(options).forEach(key => {
    if (options[key] === undefined) {
      delete options[key];
    }
  });
  
  const result = await plivoService.startCallRecording(callUuid, options);
  
  logger.info(`Started recording for call: ${callUuid}`);
  
  res.status(httpStatus.ACCEPTED).send({
    success: true,
    ...result,
  });
});

/**
 * Stop recording a call
 */
export const stopCallRecording = catchAsync(async (req, res) => {
  const { callUuid } = req.params;
  const { recordUrl } = req.body;
  
  if (!callUuid) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Call UUID is required',
    });
  }
  
  const result = await plivoService.stopCallRecording(callUuid, recordUrl);
  
  logger.info(`Stopped recording for call: ${callUuid}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

/**
 * Get details of a specific phone number
 */
export const getNumberDetails = catchAsync(async (req, res) => {
  const { phoneNumber } = req.params;
  
  if (!phoneNumber) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Phone number is required',
    });
  }
  
  const number = await plivoService.getNumberDetails(phoneNumber);
  
  logger.info(`Fetched Plivo number details: ${phoneNumber}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    number,
  });
});

/**
 * Update a phone number
 */
export const updateNumber = catchAsync(async (req, res) => {
  const { phoneNumber } = req.params;
  const {
    appId,
    alias,
    subaccount,
    cnamLookup,
    cnam,
    cnamCallbackUrl,
    cnamCallbackMethod,
  } = req.body;
  
  if (!phoneNumber) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Phone number is required',
    });
  }
  
  const updates = {
    appId,
    alias,
    subaccount,
    cnamLookup,
    cnam,
    cnamCallbackUrl,
    cnamCallbackMethod,
  };
  
  // Remove undefined values
  Object.keys(updates).forEach(key => {
    if (updates[key] === undefined) {
      delete updates[key];
    }
  });
  
  const result = await plivoService.updateNumber(phoneNumber, updates);
  
  logger.info(`Updated Plivo number: ${phoneNumber}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

/**
 * Add a phone number from your own carrier
 */
export const addNumberFromCarrier = catchAsync(async (req, res) => {
  const {
    numbers,
    carrier,
    region,
    numberType,
    appId,
    subaccount,
  } = req.body;
  
  if (!numbers) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Phone number(s) are required',
    });
  }
  
  if (!carrier) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Carrier ID is required',
    });
  }
  
  if (!region) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Region is required',
    });
  }
  
  const options = {
    numberType,
    appId,
    subaccount,
  };
  
  // Remove undefined values
  Object.keys(options).forEach(key => {
    if (options[key] === undefined) {
      delete options[key];
    }
  });
  
  const result = await plivoService.addNumberFromCarrier(numbers, carrier, region, options);
  
  logger.info(`Added number(s) from carrier: ${result.numbers}`);
  
  res.status(httpStatus.ACCEPTED).send({
    success: true,
    ...result,
  });
});
