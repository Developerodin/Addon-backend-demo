import httpStatus from 'http-status';
import SearchProvider from '../../models/crm/searchProvider.model.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a search provider record
 * @param {Object} searchProviderBody
 * @returns {Promise<SearchProvider>}
 */
export const createSearchProvider = async (searchProviderBody) => {
  return SearchProvider.create(searchProviderBody);
};

/**
 * Create multiple search provider records
 * @param {Array} searchProviderBodies
 * @returns {Promise<Array<SearchProvider>>}
 */
export const createBulkSearchProviders = async (searchProviderBodies) => {
  return SearchProvider.insertMany(searchProviderBodies);
};

/**
 * Query for search providers
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const querySearchProviders = async (filter, options) => {
  try {
    if (!filter || typeof filter !== 'object') {
      filter = {};
    }

    const paginateOptions = { ...options };
    if (options.sortBy && options.sortOrder) {
      paginateOptions.sortBy = `${options.sortBy}:${options.sortOrder}`;
    } else if (options.sortBy) {
      paginateOptions.sortBy = `${options.sortBy}:desc`;
    } else {
      paginateOptions.sortBy = 'rank:asc';
    }

    const searchProviders = await SearchProvider.paginate(filter, {
      ...paginateOptions,
      populate: ['searchId', 'providerId'],
    });
    return searchProviders;
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
 * Get search providers by search ID
 * @param {ObjectId} searchId
 * @returns {Promise<Array<SearchProvider>>}
 */
export const getSearchProvidersBySearchId = async (searchId) => {
  return SearchProvider.find({ searchId })
    .populate('providerId')
    .sort({ rank: 1 })
    .lean();
};

/**
 * Get search providers by provider ID
 * @param {ObjectId} providerId
 * @returns {Promise<Array<SearchProvider>>}
 */
export const getSearchProvidersByProviderId = async (providerId) => {
  return SearchProvider.find({ providerId })
    .populate('searchId')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get search provider by id
 * @param {ObjectId} id
 * @returns {Promise<SearchProvider>}
 */
export const getSearchProviderById = async (id) => {
  return SearchProvider.findById(id).populate(['searchId', 'providerId']);
};

/**
 * Update search provider by id
 * @param {ObjectId} searchProviderId
 * @param {Object} updateBody
 * @returns {Promise<SearchProvider>}
 */
export const updateSearchProviderById = async (searchProviderId, updateBody) => {
  const searchProvider = await getSearchProviderById(searchProviderId);
  if (!searchProvider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Search provider not found');
  }

  Object.assign(searchProvider, updateBody);
  await searchProvider.save();
  return searchProvider;
};

/**
 * Delete search provider by id
 * @param {ObjectId} searchProviderId
 * @returns {Promise<SearchProvider>}
 */
export const deleteSearchProviderById = async (searchProviderId) => {
  const searchProvider = await getSearchProviderById(searchProviderId);
  if (!searchProvider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Search provider not found');
  }
  await searchProvider.deleteOne();
  return searchProvider;
};

/**
 * Delete search providers by search ID
 * @param {ObjectId} searchId
 * @returns {Promise<Object>}
 */
export const deleteSearchProvidersBySearchId = async (searchId) => {
  const result = await SearchProvider.deleteMany({ searchId });
  return result;
};
