import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import ApiError from '../../utils/ApiError.js';
import catchAsync from '../../utils/catchAsync.js';
import * as contactService from '../../services/crm/contact.service.js';

export const createContact = catchAsync(async (req, res) => {
  const contactBody = {
    ...req.body,
    userId: req.user?.id || req.body.userId,
  };
  const contact = await contactService.createContact(contactBody);
  res.status(httpStatus.CREATED).send(contact);
});

export const getContacts = catchAsync(async (req, res) => {
  const allowedFilterFields = [
    'serviceType', 'isFavorite', 'userId', 'tags'
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
  
  const result = await contactService.queryContacts(filter, options);
  res.send(result);
});

export const getContact = catchAsync(async (req, res) => {
  const contact = await contactService.getContactById(req.params.contactId);
  if (!contact) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Contact not found');
  }
  res.send(contact);
});

export const updateContact = catchAsync(async (req, res) => {
  const contact = await contactService.updateContactById(req.params.contactId, req.body);
  res.send(contact);
});

export const deleteContact = catchAsync(async (req, res) => {
  await contactService.deleteContactById(req.params.contactId);
  res.status(httpStatus.NO_CONTENT).send();
});

export const incrementCallCount = catchAsync(async (req, res) => {
  const contact = await contactService.incrementCallCount(req.params.contactId);
  res.send(contact);
});

export const toggleFavorite = catchAsync(async (req, res) => {
  const contact = await contactService.toggleFavorite(req.params.contactId);
  res.send(contact);
});

export const createBulkContacts = catchAsync(async (req, res) => {
  const { contacts } = req.body;
  const userId = req.user?.id || req.body.userId;
  const results = await contactService.createBulkContacts(contacts, userId);
  res.status(httpStatus.CREATED).send({ results });
});
