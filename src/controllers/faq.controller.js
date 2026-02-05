import httpStatus from 'http-status';
import { v4 as uuidv4 } from 'uuid';
import catchAsync from '../utils/catchAsync.js';
import faqService from '../services/faq.service.js';
import * as messengerSummaryService from '../services/messengerSummary.service.js';

const CHAT_SESSION_COOKIE = 'chat_session';
const CHAT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Train FAQ with embeddings
 * @route POST /v1/faq/train-faq
 * @param {Object} req.body - {question, answer} object
 * @returns {Object} 201 - Created FAQ vector
 */
const trainFaq = catchAsync(async (req, res) => {
  const { question, answer } = req.body;
  
  if (!question || !answer) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: 'error',
      message: 'Question and answer are required'
    });
  }
  
  const result = await faqService.trainFAQ({ question, answer });
  
  res.status(httpStatus.CREATED).json({
    status: 'success',
    message: result.message,
    data: result,
    action: result.action
  });
});

/**
 * Ask a question and get relevant answer.
 * Session and context window (conversation history) are managed in backend via cookie (chat_session).
 * @route POST /v1/faq/ask
 * @param {Object} req.body - { question: string } (context and conversationHistory are stored per session in backend)
 * @returns {Object} 200 - Relevant answer with metadata
 */
const askQuestion = catchAsync(async (req, res) => {
  const { question } = req.body;

  // Session: read from cookie (backend-managed); create and set cookie if missing
  let sessionId = req.cookies?.[CHAT_SESSION_COOKIE];
  if (!sessionId || typeof sessionId !== 'string') {
    sessionId = uuidv4();
    res.cookie(CHAT_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: CHAT_SESSION_MAX_AGE_MS,
      path: '/'
    });
  }

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: 'error',
      message: 'Question is required and must be a non-empty string'
    });
  }

  const trimmedQuestion = question.trim();

  // Context window in backend: append user message to session history, then pass stored history into askQuestion
  faqService.appendUserMessageToSession(sessionId, trimmedQuestion);
  const conversationHistory = faqService.getSessionConversationHistory(sessionId);

  const result = await faqService.askQuestion(trimmedQuestion, {
    sessionId,
    conversationHistory
  });

  // Persist assistant response to session conversation history (context window)
  faqService.persistSessionConversationFromResponse(sessionId, trimmedQuestion, result);

  const responseText = messengerSummaryService.getResponseText(result);

  res.status(httpStatus.OK).json({
    status: 'success',
    data: { ...result, responseText }
  });
});

/**
 * Ask and get text-only summary for messengers (Telegram, WhatsApp).
 * Same FAQ/ask flow as /v1/faq/ask; response is plain text, no HTML.
 * @route POST /v1/faq/ask-summary
 * @param {Object} req.body - {question: string}
 * @returns {Object} 200 - { status, summary: string }
 */
const askSummary = catchAsync(async (req, res) => {
  const { question } = req.body;

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: 'error',
      message: 'Question is required and must be a non-empty string',
    });
  }

  const { summary } = await messengerSummaryService.getSummary(question.trim());

  res.status(httpStatus.OK).json({
    status: 'success',
    summary,
  });
});

/**
 * Get all FAQ vectors with pagination
 * @route GET /v1/faq
 * @param {Object} req.query - Query parameters for pagination
 * @returns {Object} 200 - Paginated FAQ vectors
 */
const getFaqVectors = catchAsync(async (req, res) => {
  const filter = {};
  const options = {
    sortBy: req.query.sortBy || 'createdAt',
    limit: parseInt(req.query.limit) || 10,
    page: parseInt(req.query.page) || 1,
  };
  
  const result = await faqService.getFaqVectors(filter, options);
  
  res.status(httpStatus.OK).json({
    status: 'success',
    data: result.results,
    pagination: {
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      totalResults: result.totalResults,
    }
  });
});

/**
 * Delete FAQ vector by ID
 * @route DELETE /v1/faq/:faqId
 * @param {string} req.params.faqId - FAQ ID
 * @returns {Object} 200 - Deleted FAQ
 */
const deleteFaqVector = catchAsync(async (req, res) => {
  const { faqId } = req.params;
  
  const deletedFaq = await faqService.deleteFaqVector(faqId);
  
  res.status(httpStatus.OK).json({
    status: 'success',
    message: 'FAQ deleted successfully',
    data: deletedFaq
  });
});

/**
 * Clear all FAQ vectors
 * @route DELETE /v1/faq
 * @returns {Object} 200 - Deletion result
 */
const clearAllFaqs = catchAsync(async (req, res) => {
  const result = await faqService.clearAllFaqs();
  
  res.status(httpStatus.OK).json({
    status: 'success',
    message: 'All FAQs cleared successfully',
    data: result
  });
});

export default {
  trainFaq,
  askQuestion,
  askSummary,
  getFaqVectors,
  deleteFaqVector,
  clearAllFaqs,
};
