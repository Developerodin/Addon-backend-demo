/**
 * Phone number normalization and validation utilities
 */

/**
 * Normalize phone number to E.164 format
 * @param {string} phone - Phone number to normalize
 * @returns {string|null} Normalized phone number or null if invalid
 */
export const normalizePhone = (phone) => {
  if (!phone) {
    return null;
  }

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // If starts with country code, ensure + prefix
  if (digits.startsWith('91')) {
    // India country code
    return `+${digits}`;
  } else if (digits.startsWith('1') && digits.length === 11) {
    // US/Canada
    return `+${digits}`;
  } else if (digits.length === 10) {
    // Assume India if 10 digits
    return `+91${digits}`;
  } else if (phone.startsWith('+')) {
    return phone; // Already formatted
  } else {
    return `+${digits}`;
  }
};

/**
 * Validate phone number format (E.164)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid
 */
export const validatePhone = (phone) => {
  if (!phone) {
    return false;
  }

  // E.164 format: +[country code][number] (max 15 digits)
  const pattern = /^\+[1-9]\d{1,14}$/;
  return pattern.test(phone);
};
