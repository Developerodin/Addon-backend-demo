import httpStatus from 'http-status';
import SearchHistory from '../../models/crm/searchHistory.model.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a search history record
 * @param {Object} searchHistoryBody
 * @returns {Promise<SearchHistory>}
 */
export const createSearchHistory = async (searchHistoryBody) => {
  return SearchHistory.create(searchHistoryBody);
};

/**
 * Query for search history records
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const querySearchHistory = async (filter, options) => {
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
      paginateOptions.sortBy = 'createdAt:desc';
    }

    const searchHistory = await SearchHistory.paginate(filter, paginateOptions);
    return searchHistory;
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
 * Get search history by id
 * @param {ObjectId} id
 * @returns {Promise<SearchHistory>}
 */
export const getSearchHistoryById = async (id) => {
  return SearchHistory.findById(id);
};

/**
 * Get search history by request ID
 * @param {string} requestId
 * @returns {Promise<SearchHistory>}
 */
export const getSearchHistoryByRequestId = async (requestId) => {
  return SearchHistory.findOne({ requestId });
};

/**
 * Update search history by id
 * @param {ObjectId} searchHistoryId
 * @param {Object} updateBody
 * @returns {Promise<SearchHistory>}
 */
export const updateSearchHistoryById = async (searchHistoryId, updateBody) => {
  const searchHistory = await getSearchHistoryById(searchHistoryId);
  if (!searchHistory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Search history not found');
  }

  Object.assign(searchHistory, updateBody);
  await searchHistory.save();
  return searchHistory;
};

/**
 * Delete search history by id
 * @param {ObjectId} searchHistoryId
 * @returns {Promise<SearchHistory>}
 */
export const deleteSearchHistoryById = async (searchHistoryId) => {
  const searchHistory = await getSearchHistoryById(searchHistoryId);
  if (!searchHistory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Search history not found');
  }
  await searchHistory.deleteOne();
  return searchHistory;
};
