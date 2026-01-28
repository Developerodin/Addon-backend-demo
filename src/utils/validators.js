/**
 * Validation utilities for CRM operations
 */

/**
 * Validate language code
 * @param {string} language - Language code to validate
 * @returns {boolean} True if valid
 */
export const validateLanguage = (language) => {
  const validLanguages = ['en', 'hi', 'english', 'hindi', 'eng', 'hin'];
  return validLanguages.includes(language?.toLowerCase());
};

/**
 * Validate provider status
 * @param {string} status - Status to validate
 * @returns {boolean} True if valid
 */
export const validateProviderStatus = (status) => {
  const validStatuses = ['pending', 'calling', 'available', 'unavailable', 'no_answer', 'failed'];
  return validStatuses.includes(status);
};

/**
 * Validate call status
 * @param {string} status - Status to validate
 * @returns {boolean} True if valid
 */
export const validateCallStatus = (status) => {
  const validStatuses = ['initiated', 'in_progress', 'completed', 'failed', 'no_answer', 'busy', 'call_disconnected'];
  return validStatuses.includes(status);
};

/**
 * Validate that all required fields are present
 * @param {Object} data - Data object to validate
 * @param {string[]} requiredFields - Array of required field names
 * @returns {{isValid: boolean, errorMsg: string|null}} Validation result
 */
export const validateRequiredFields = (data, requiredFields) => {
  const missing = requiredFields.filter(field => !data || data[field] === undefined || data[field] === null);
  if (missing.length > 0) {
    return {
      isValid: false,
      errorMsg: `Missing required fields: ${missing.join(', ')}`
    };
  }
  return { isValid: true, errorMsg: null };
};
