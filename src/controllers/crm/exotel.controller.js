import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as exotelService from '../../services/crm/exotelService.js';
import logger from '../../config/logger.js';

/**
 * Get current account balance
 */
export const getBalance = catchAsync(async (req, res) => {
  const balance = await exotelService.getAccountBalance();
  
  logger.info(`Fetched Exotel account balance: ${balance.totalSpent} ${balance.currency}`);
  
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
  
  const usage = await exotelService.getUsageSummary(startDate, endDate);
  
  logger.info(`Fetched Exotel usage summary from ${startDate || 'beginning'} to ${endDate || 'now'}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    usage,
  });
});

/**
 * Get account information
 */
export const getAccountInfo = catchAsync(async (req, res) => {
  const accountInfo = await exotelService.getAccountInfo();
  
  logger.info(`Fetched Exotel account info: ${accountInfo.friendlyName || accountInfo.sid}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    account: accountInfo,
  });
});

/**
 * Get recent usage records
 */
export const getRecentUsage = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  
  const usage = await exotelService.getRecentUsage(limit);
  
  logger.info(`Fetched ${usage.length} recent Exotel usage records`);
  
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
  const countries = await exotelService.getAvailableCountries();
  
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
  
  const countryInfo = await exotelService.getCountryInfo(countryCode);
  
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
      error: 'Country code is required',
    });
  }
  
  if (!type || !['Landline', 'Mobile', 'TollFree'].includes(type)) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Type must be Landline, Mobile, or TollFree',
    });
  }
  
  // Extract filters from query parameters
  const filters = {
    IncomingSMS: req.query.IncomingSMS === 'true' ? true : req.query.IncomingSMS === 'false' ? false : undefined,
    InRegion: req.query.InRegion,
    Contains: req.query.Contains,
    PageSize: req.query.pageSize ? parseInt(req.query.pageSize, 10) : undefined,
    Page: req.query.page ? parseInt(req.query.page, 10) : undefined,
  };
  
  // Remove undefined values
  Object.keys(filters).forEach(key => {
    if (filters[key] === undefined) {
      delete filters[key];
    }
  });
  
  const results = await exotelService.searchAvailableNumbers(countryCode, type, filters);
  
  logger.info(`Searched for ${type} numbers in ${countryCode}: found ${results.availableNumbers.length} results`);
  
  res.status(httpStatus.OK).send({
    success: true,
    ...results,
  });
});

/**
 * Purchase a phone number
 */
export const purchasePhoneNumber = catchAsync(async (req, res) => {
  const { phoneNumber, VoiceUrl, SMSUrl, FriendlyName } = req.body;
  
  if (!phoneNumber) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Phone number is required',
    });
  }
  
  const options = {};
  if (VoiceUrl) options.VoiceUrl = VoiceUrl;
  if (SMSUrl) options.SMSUrl = SMSUrl;
  if (FriendlyName) options.FriendlyName = FriendlyName;
  
  const purchased = await exotelService.purchasePhoneNumber(phoneNumber, options);
  
  logger.info(`Purchased Exotel phone number: ${purchased.phoneNumber}`);
  
  res.status(httpStatus.CREATED).send({
    success: true,
    number: purchased,
    message: `Successfully purchased phone number ${purchased.phoneNumber}`,
  });
});

/**
 * Get list of owned phone numbers
 */
export const getOwnedNumbers = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const page = parseInt(req.query.page, 10) || 1;
  
  const result = await exotelService.getOwnedNumbers(limit, page);
  
  logger.info(`Fetched ${result.numbers.length} owned Exotel phone numbers (page ${page})`);
  
  res.status(httpStatus.OK).send({
    success: true,
    numbers: result.numbers,
    count: result.numbers.length,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  });
});

/**
 * Get specific number details
 */
export const getNumberDetails = catchAsync(async (req, res) => {
  const { sid } = req.params;
  
  const number = await exotelService.getNumberDetails(sid);
  
  logger.info(`Fetched Exotel number details: ${number.phoneNumber}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    number,
  });
});

/**
 * Update number configuration
 */
export const updateNumber = catchAsync(async (req, res) => {
  const { sid } = req.params;
  const { VoiceUrl, SMSUrl, FriendlyName } = req.body;
  
  const options = {};
  if (VoiceUrl !== undefined) options.VoiceUrl = VoiceUrl;
  if (SMSUrl !== undefined) options.SMSUrl = SMSUrl;
  if (FriendlyName !== undefined) options.FriendlyName = FriendlyName;
  
  const updated = await exotelService.updateNumber(sid, options);
  
  logger.info(`Updated Exotel number: ${updated.phoneNumber}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    number: updated,
    message: `Successfully updated phone number ${updated.phoneNumber}`,
  });
});

/**
 * Delete/Release a phone number
 */
export const deleteNumber = catchAsync(async (req, res) => {
  const { sid } = req.params;
  
  await exotelService.deleteNumber(sid);
  
  logger.info(`Deleted Exotel number with SID: ${sid}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Successfully deleted phone number',
  });
});

/**
 * Get number metadata (v1 API)
 */
export const getNumberMetadata = catchAsync(async (req, res) => {
  const { phoneNumber } = req.params;
  
  const metadata = await exotelService.getNumberMetadata(phoneNumber);
  
  logger.info(`Fetched Exotel number metadata: ${phoneNumber}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    metadata,
  });
});

/**
 * Get call details with filters
 */
export const getCalls = catchAsync(async (req, res) => {
  const filters = {
    Sid: req.query.Sid,
    DateCreated: req.query.DateCreated,
    To: req.query.To,
    From: req.query.From,
    Status: req.query.Status,
    Duration: req.query.Duration,
    Price: req.query.Price,
    Direction: req.query.Direction,
    PhoneNumber: req.query.PhoneNumber,
    PageSize: req.query.pageSize ? parseInt(req.query.pageSize, 10) : undefined,
    SortBy: req.query.sortBy,
    Before: req.query.before,
    After: req.query.after,
    details: req.query.details === 'true',
  };
  
  // Remove undefined values
  Object.keys(filters).forEach(key => {
    if (filters[key] === undefined) {
      delete filters[key];
    }
  });
  
  const result = await exotelService.getBulkCalls(filters);
  
  logger.info(`Fetched ${result.Calls.length} Exotel calls`);
  
  res.status(httpStatus.OK).send({
    success: true,
    calls: result.Calls,
    metadata: result.Metadata,
    count: result.Calls.length,
  });
});

/**
 * Get specific call details
 */
export const getCallDetails = catchAsync(async (req, res) => {
  const { callSid } = req.params;
  
  const call = await exotelService.getCallDetails(callSid);
  
  logger.info(`Fetched Exotel call details: ${callSid}`);
  
  res.status(httpStatus.OK).send({
    success: true,
    call,
  });
});

/**
 * Initiate a call (connect two numbers)
 */
export const connectCall = catchAsync(async (req, res) => {
  const { from, to, callerId, ...options } = req.body;
  
  if (!from || !to || !callerId) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'From, To, and CallerId are required',
    });
  }
  
  const call = await exotelService.connectCall(from, to, callerId, options);
  
  logger.info(`Initiated Exotel call from ${from} to ${to} using ${callerId}`);
  
  res.status(httpStatus.CREATED).send({
    success: true,
    call,
    message: 'Call initiated successfully',
  });
});
