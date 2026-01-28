import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as providerService from '../../services/crm/provider.service.js';
import config from '../../config/config.js';

export const createProvider = catchAsync(async (req, res) => {
  const provider = await providerService.createProvider(req.body);
  res.status(httpStatus.CREATED).send(provider);
});

export const getProviders = catchAsync(async (req, res) => {
  const allowedFilterFields = [
    'serviceType', 'status', 'city', 'state', 'country', 'businessStatus'
  ];
  const filter = pick(req.query, allowedFilterFields);
  
  const allowedOptions = ['sortBy', 'sortOrder', 'limit', 'page', 'populate'];
  const options = pick(req.query, allowedOptions);
  
  if (options.limit) {
    options.limit = parseInt(options.limit, 10);
  }
  if (options.page) {
    options.page = parseInt(options.page, 10);
  }
  
  const result = await providerService.queryProviders(filter, options);
  res.send(result);
});

export const getProvider = catchAsync(async (req, res) => {
  const provider = await providerService.getProviderById(req.params.providerId);
  if (!provider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  }
  res.send(provider);
});

export const updateProvider = catchAsync(async (req, res) => {
  const provider = await providerService.updateProviderById(req.params.providerId, req.body);
  res.send(provider);
});

export const deleteProvider = catchAsync(async (req, res) => {
  await providerService.deleteProviderById(req.params.providerId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const searchProviders = catchAsync(async (req, res) => {
  const { query, location, serviceType, limit = 20 } = req.query;
  
  if (!query || !query.trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Search query is required');
  }
  
  try {
    const providers = await providerService.searchProviders({
      query: query.trim(),
      location,
      serviceType,
      limit: parseInt(limit, 10),
    });
    
    // Return array directly as frontend expects Provider[]
    res.send(providers);
  } catch (error) {
    // Log the full error for debugging
    console.error('Provider search error:', error);
    throw error; // Re-throw to let error middleware handle it
  }
});

/**
 * Check provider search configuration (for debugging)
 */
export const checkProviderConfig = catchAsync(async (req, res) => {
  const hasApiKey = !!(config.googlePlaces?.apiKey || process.env.GOOGLE_PLACES_API_KEY);
  
  res.status(httpStatus.OK).send({
    success: true,
    googlePlacesConfigured: hasApiKey,
    apiKeyPresent: hasApiKey,
    apiKeyLength: hasApiKey ? (config.googlePlaces?.apiKey || process.env.GOOGLE_PLACES_API_KEY || '').length : 0,
    message: hasApiKey 
      ? 'Google Places API key is configured' 
      : 'Google Places API key is NOT configured. Please set GOOGLE_PLACES_API_KEY in .env file',
  });
});
