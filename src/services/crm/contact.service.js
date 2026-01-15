import httpStatus from 'http-status';
import SavedContact from '../../models/crm/savedContact.model.js';
import ApiError from '../../utils/ApiError.js';

/**
 * Create a contact
 * @param {Object} contactBody
 * @returns {Promise<SavedContact>}
 */
export const createContact = async (contactBody) => {
  // Check if contact with same phone and userId already exists
  if (contactBody.phone && contactBody.userId) {
    const existingContact = await SavedContact.findOne({
      phone: contactBody.phone,
      userId: contactBody.userId,
    });
    if (existingContact) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Contact with this phone number already exists');
    }
  }

  return SavedContact.create(contactBody);
};

/**
 * Query for contacts
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
export const queryContacts = async (filter, options) => {
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

    const contacts = await SavedContact.paginate(filter, {
      ...paginateOptions,
      populate: 'providerId',
    });

    return contacts;
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
 * Get contact by id
 * @param {ObjectId} id
 * @returns {Promise<SavedContact>}
 */
export const getContactById = async (id) => {
  return SavedContact.findById(id).populate('providerId');
};

/**
 * Update contact by id
 * @param {ObjectId} contactId
 * @param {Object} updateBody
 * @returns {Promise<SavedContact>}
 */
export const updateContactById = async (contactId, updateBody) => {
  const contact = await getContactById(contactId);
  if (!contact) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found');
  }

  // Check for duplicate phone if phone is being updated
  if (updateBody.phone && updateBody.phone !== contact.phone) {
    const existingContact = await SavedContact.findOne({
      phone: updateBody.phone,
      userId: contact.userId || updateBody.userId,
      _id: { $ne: contactId },
    });
    if (existingContact) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Contact with this phone number already exists');
    }
  }

  Object.assign(contact, updateBody);
  await contact.save();
  return contact;
};

/**
 * Delete contact by id
 * @param {ObjectId} contactId
 * @returns {Promise<SavedContact>}
 */
export const deleteContactById = async (contactId) => {
  const contact = await getContactById(contactId);
  if (!contact) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found');
  }
  await contact.deleteOne();
  return contact;
};

/**
 * Get contact by phone number
 * @param {string} phone
 * @param {string} userId - Optional user ID
 * @returns {Promise<SavedContact>}
 */
export const getContactByPhone = async (phone, userId = null) => {
  const filter = { phone };
  if (userId) {
    filter.userId = userId;
  }
  return SavedContact.findOne(filter).populate('providerId');
};

/**
 * Increment call count and update lastCalledAt
 * @param {ObjectId} contactId
 * @returns {Promise<SavedContact>}
 */
export const incrementCallCount = async (contactId) => {
  const contact = await getContactById(contactId);
  if (!contact) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found');
  }
  contact.callCount = (contact.callCount || 0) + 1;
  contact.lastCalledAt = new Date();
  await contact.save();
  return contact;
};

/**
 * Toggle favorite status
 * @param {ObjectId} contactId
 * @returns {Promise<SavedContact>}
 */
export const toggleFavorite = async (contactId) => {
  const contact = await getContactById(contactId);
  if (!contact) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found');
  }
  contact.isFavorite = !contact.isFavorite;
  await contact.save();
  return contact;
};

/**
 * Create multiple contacts in bulk
 * @param {Array<Object>} contactsData - Array of contact objects
 * @param {string} userId - User ID for duplicate checking
 * @returns {Promise<Array<{success: boolean, contact?: SavedContact, error?: string}>>}
 */
export const createBulkContacts = async (contactsData, userId) => {
  const results = [];
  
  // Process contacts sequentially to handle duplicates properly
  for (const contactData of contactsData) {
    try {
      // Check for duplicate phone number
      if (contactData.phone && userId) {
        const existingContact = await SavedContact.findOne({
          phone: contactData.phone,
          userId: userId,
        });
        
        if (existingContact) {
          // Update existing contact instead of creating new one
          Object.assign(existingContact, contactData);
          await existingContact.save();
          results.push({ success: true, contact: existingContact, updated: true });
          continue;
        }
      }
      
      // Create new contact
      const contact = await createContact({ ...contactData, userId });
      results.push({ success: true, contact, updated: false });
    } catch (error) {
      results.push({
        success: false,
        error: error.message || 'Failed to create contact',
        name: contactData.name,
        phone: contactData.phone,
      });
    }
  }
  
  return results;
};
