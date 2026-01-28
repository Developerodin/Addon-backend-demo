import httpStatus from 'http-status';
import Provider from '../../models/crm/provider.model.js';
import ApiError from '../../utils/ApiError.js';
import GooglePlacesService from './googlePlacesService.js';

/**
 * Create a provider
 * @param {Object} providerBody
 * @returns {Promise<Provider>}
 */
export const createProvider = async (providerBody) => {
  return Provider.create(providerBody);
};

/**
 * Query for providers
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const queryProviders = async (filter, options) => {
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
      paginateOptions.sortBy = 'createdAt:desc';
    }

    const providers = await Provider.paginate(filter, paginateOptions);
    return providers;
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
 * Get provider by id
 * @param {ObjectId} id
 * @returns {Promise<Provider>}
 */
export const getProviderById = async (id) => {
  return Provider.findById(id);
};

/**
 * Update provider by id
 * @param {ObjectId} providerId
 * @param {Object} updateBody
 * @returns {Promise<Provider>}
 */
export const updateProviderById = async (providerId, updateBody) => {
  const provider = await getProviderById(providerId);
  if (!provider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  }

  Object.assign(provider, updateBody);
  await provider.save();
  return provider;
};

/**
 * Delete provider by id
 * @param {ObjectId} providerId
 * @returns {Promise<Provider>}
 */
export const deleteProviderById = async (providerId) => {
  const provider = await getProviderById(providerId);
  if (!provider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  }
  await provider.deleteOne();
  return provider;
};

/**
 * Search providers by query, location, service type
 * Uses Google Places API - copied from Calling AGENT's working implementation
 * @param {Object} searchParams
 * @returns {Promise<Array>}
 */
export const searchProviders = async ({ query, location, serviceType, limit = 20 }) => {
  if (!query || !query.trim()) {
    // If no query, just search MongoDB
    return await searchMongoDB({ query, location, serviceType, limit });
  }

  const googlePlacesService = new GooglePlacesService();
  
  // Check if API key is configured
  if (!googlePlacesService.apiKey) {
    console.error('Google Places API key is not configured. Please set GOOGLE_PLACES_API_KEY in .env');
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Google Places API key is not configured. Please set GOOGLE_PLACES_API_KEY in .env file.'
    );
  }

  try {
    // Build search query - include location in query string if provided (same as Flask)
    let searchQuery = query.trim();
    if (location) {
      // Include location in query string for better results
      searchQuery = `${query} in ${location}`;
    }
    if (serviceType) {
      searchQuery = `${serviceType} ${searchQuery}`;
    }

    // Search Google Places (location parameter expects lat,lng, so we include it in query instead)
    const places = await googlePlacesService.textSearch(
      searchQuery,
      null, // Don't use location parameter with text search - include in query instead
      3000
    );

    if (!places || places.length === 0) {
      return [];
    }

    // Fetch phone numbers using Place Details API for each result
    // Filter: Only include places with phone numbers (required for calling)
    const providers = [];

    for (const place of places) {
      const placeId = place.place_id;
      if (!placeId) {
        continue;
      }

      // Fetch place details to get phone number
      const placeDetails = await googlePlacesService.getPlaceDetails(placeId);
      if (placeDetails && placeDetails.phone) {
        place.phone = placeDetails.phone;
        // Update other fields from details if available
        if (placeDetails.email) {
          place.email = placeDetails.email;
        }
        // Merge city, state, country from place details if not already present
        if (placeDetails.city && !place.city) {
          place.city = placeDetails.city;
        }
        if (placeDetails.state && !place.state) {
          place.state = placeDetails.state;
        }
        if (placeDetails.country && !place.country) {
          place.country = placeDetails.country;
        }
        // Update service type from details if not present
        if (placeDetails.service_type && !place.service_type) {
          place.service_type = placeDetails.service_type;
        }
        // Use search query's serviceType as final fallback
        if (!place.service_type && serviceType) {
          place.service_type = serviceType;
        }
      } else {
        // Skip places without phone numbers (this is a calling agent)
        console.log(`Skipping place ${place.name} - no phone number`);
        continue;
      }

      // Check if provider already exists by place_id
      let existingProvider = null;
      if (place.place_id) {
        existingProvider = await Provider.findOne({ placeId: place.place_id });
      }

      if (existingProvider) {
        // Update existing provider
        const providerData = {
          name: place.name,
          address: place.address,
          city: place.city,
          state: place.state,
          country: place.country || 'India',
          latitude: place.latitude,
          longitude: place.longitude,
          rating: place.rating,
          reviewCount: place.review_count || 0,
          businessStatus: place.business_status || 'OPERATIONAL',
          priceLevel: place.price_level,
          phone: place.phone,
        };
        if (place.service_type) {
          providerData.serviceType = place.service_type;
        }

        Object.assign(existingProvider, providerData);
        await existingProvider.save();
        providers.push(existingProvider.toObject());
      } else {
        // Create new provider object (don't save to DB automatically - return it for frontend)
        const providerData = {
          placeId: place.place_id,
          name: place.name,
          address: place.address,
          city: place.city,
          state: place.state,
          country: place.country || 'India',
          latitude: place.latitude,
          longitude: place.longitude,
          rating: place.rating,
          reviewCount: place.review_count || 0,
          businessStatus: place.business_status || 'OPERATIONAL',
          priceLevel: place.price_level,
          serviceType: place.service_type || serviceType,
          phone: place.phone,
          status: 'pending',
          metadata: {
            source: 'google_places',
            types: place.types || [],
            website: place.website,
          },
        };

        providers.push(providerData);
      }
    }

    return providers;
  } catch (error) {
    console.error(`Error searching providers: ${error.message}`, error);
    
    // If it's an ApiError, re-throw it
    if (error instanceof ApiError) {
      throw error;
    }
    
    // For other errors, throw with more context
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to search providers: ${error.message || 'Unknown error'}`
    );
  }
};

/**
 * Search providers in MongoDB database
 * @param {Object} searchParams
 * @returns {Promise<Array>}
 */
const searchMongoDB = async ({ query, location, serviceType, limit = 20 }) => {
  const filter = {};

  if (serviceType) {
    filter.serviceType = serviceType;
  }

  if (query) {
    filter.$or = [
      { name: { $regex: query, $options: 'i' } },
      { address: { $regex: query, $options: 'i' } },
      { city: { $regex: query, $options: 'i' } },
    ];
  }

  if (location) {
    filter.$or = filter.$or || [];
    filter.$or.push(
      { city: { $regex: location, $options: 'i' } },
      { address: { $regex: location, $options: 'i' } }
    );
  }

  const providers = await Provider.find(filter)
    .limit(parseInt(limit, 10))
    .sort({ createdAt: -1 })
    .lean();

  return providers;
};
