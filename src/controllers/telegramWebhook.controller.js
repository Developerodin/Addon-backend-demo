import TelegramBot from 'node-telegram-bot-api';
import catchAsync from '../utils/catchAsync.js';
import * as messengerSummaryService from '../services/messengerSummary.service.js';
import logger from '../config/logger.js';

/**
 * Handle incoming Telegram webhook (POST from Telegram servers)
 * Receives Update, runs chatbot, sends reply via Bot API
 */
export const handleTelegramWebhook = catchAsync(async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set; telegram webhook ignored. Set in .env and restart. See TELEGRAM_SETUP.md');
    return res.sendStatus(200);
  }

  const update = req.body;
  if (!update) {
    logger.debug('Telegram webhook: empty body');
    return res.sendStatus(200);
  }

  const message = update.message || update.edited_message;
  const chatId = message?.chat?.id;
  const text = (message?.text || '').trim();

  if (!chatId) {
    logger.debug('Telegram webhook: no chatId (e.g. channel post)');
    return res.sendStatus(200);
  }

  const bot = new TelegramBot(token, { polling: false });

  if (!text) {
    await bot.sendMessage(
      chatId,
      'Send me a message (e.g. "Show me brand performance data" or "help") and I\'ll reply with a text summary.'
    );
    return res.sendStatus(200);
  }

  try {
    const sessionId = `telegram_${chatId}`;
    const { summary } = await messengerSummaryService.getSummary(text, { sessionId });
    const reply = summary || 'No response.';
    await bot.sendMessage(chatId, reply, { parse_mode: undefined });
    logger.info(`Telegram reply sent to chat ${chatId} (${reply.length} chars)`);
  } catch (err) {
    logger.error('Telegram webhook chatbot error:', err);
    await bot.sendMessage(chatId, `Sorry, something went wrong: ${err.message}`).catch(() => {});
  }

  res.sendStatus(200);
});

/**
 * Set Telegram webhook URL using API_URL from .env (live backend URL).
 * Optional override: ?url=... or body.url
 */
export const setTelegramWebhook = catchAsync(async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(503).json({
      success: false,
      message: 'TELEGRAM_BOT_TOKEN is not configured',
    });
  }

  const baseUrl = (req.query.url || req.body?.url || process.env.API_URL || '')
    .toString()
    .replace(/\/+$/, '');
  if (!baseUrl) {
    return res.status(400).json({
      success: false,
      message: 'Missing API_URL in .env or provide ?url=https://your-public-domain.com',
    });
  }

  const webhookUrl = `${baseUrl}/v1/chatbot/telegram/webhook`;
  const bot = new TelegramBot(token, { polling: false });
  await bot.setWebHook(webhookUrl);

  return res.status(200).json({
    success: true,
    message: 'Telegram webhook set',
    webhookUrl,
  });
});
