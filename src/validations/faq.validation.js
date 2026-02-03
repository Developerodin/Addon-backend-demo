import Joi from 'joi';
import { objectId } from './custom.validation.js';

const trainFaq = {
  body: Joi.object().keys({
    question: Joi.string().required().min(1).max(1000).trim(),
    answer: Joi.string().required().min(1).max(5000).trim(),
  }),
};

const askQuestion = {
  body: Joi.object().keys({
    question: Joi.string().required().min(1).max(1000).trim(),
    sessionId: Joi.string().optional().max(128).trim(),
    context: Joi.object().keys({ lastOrderWizardPrompt: Joi.string().optional() }).optional(),
    conversationHistory: Joi.array()
      .items(Joi.object().keys({
        role: Joi.string().valid('user', 'assistant').required(),
        content: Joi.string().max(3000).allow('')
      }))
      .max(50)
      .optional()
  }),
};

const getFaqVectors = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().valid('createdAt', 'updatedAt', 'question').default('createdAt'),
  }),
};

const deleteFaqVector = {
  params: Joi.object().keys({
    faqId: Joi.string().custom(objectId).required(),
  }),
};

export default {
  trainFaq,
  askQuestion,
  getFaqVectors,
  deleteFaqVector,
};
