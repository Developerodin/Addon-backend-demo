# Telegram bot – why it’s not responding & how to fix

The agent/chatbot works on the website because the frontend calls your backend directly. Telegram doesn’t: **Telegram’s servers** must be able to **POST updates to your backend**. If any of the steps below are wrong, the bot will not reply.

---

## 1. Environment variables (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | **Yes** | From [@BotFather](https://t.me/BotFather): create a bot, then use the token (e.g. `123456:ABC-DEF...`). If this is missing, the webhook handler returns 200 and does nothing (no reply). |
| `API_URL` | **Yes** (for webhook) | **Public** URL of your backend, no trailing slash (e.g. `https://api.yourdomain.com` or `https://abc123.ngrok.io`). Telegram will POST to `{API_URL}/v1/chatbot/telegram/webhook`. |
| `OPENAI_API_KEY` | Yes (for FAQ/agent) | Already used by website chatbot; same key is used for Telegram replies. |
| `MONGODB_URL` | Yes | Same as rest of app; FAQ/agent may use DB. |

If `TELEGRAM_BOT_TOKEN` is not set, the server logs:  
`TELEGRAM_BOT_TOKEN not set; telegram webhook ignored`  
and still returns HTTP 200 (so Telegram won’t retry).

---

## 2. Backend must be reachable from the internet

- Telegram sends webhook requests **from their servers** to your **public** URL.
- **localhost is not enough.** Telegram cannot reach `http://localhost:3000`.
- Use one of:
  - Deployed backend (e.g. `https://api.yourdomain.com`) and set `API_URL` to that.
  - **ngrok**: run `ngrok http 3000`, then set `API_URL=https://xxxx.ngrok-free.app` (or your ngrok URL). Restart backend after changing `.env`.

---

## 3. Register the webhook with Telegram (one-time)

After `TELEGRAM_BOT_TOKEN` and `API_URL` are set and the backend is running at that URL:

- **Option A – use `API_URL` from .env**  
  Open in browser (or curl):  
  `GET https://your-public-backend-url/v1/chatbot/telegram/set-webhook`  
  You should get JSON: `{ "success": true, "message": "Telegram webhook set", "webhookUrl": "..." }`.

- **Option B – override URL**  
  `GET https://your-public-backend-url/v1/chatbot/telegram/set-webhook?url=https://your-public-backend-url`  
  (Use the same public URL you set in `API_URL`.)

If `TELEGRAM_BOT_TOKEN` is wrong or missing, you’ll get `503` and a message like “TELEGRAM_BOT_TOKEN is not configured”.  
If `API_URL` (or `?url=`) is missing, you’ll get `400` and “Missing API_URL...”.

Until this step is done, Telegram does **not** send updates to your server, so the bot will never reply.

---

## 4. Flow summary

1. User sends a message in Telegram.
2. Telegram sends a **POST** to `{API_URL}/v1/chatbot/telegram/webhook` with a JSON body (the “Update”).
3. Your backend:
   - Reads `update.message.text` (or `update.edited_message.text`),
   - Calls `messengerSummaryService.getSummary(text, { sessionId: 'telegram_<chatId>' })`,
   - Which uses the same FAQ/agent flow as the website (`faqService.askQuestion`),
   - Then sends the reply with `bot.sendMessage(chatId, summary)`.

If the bot still doesn’t respond, the failure is in one of: env, reachability, webhook registration, or an error inside `getSummary`/`askQuestion` (see below).

---

## 5. Troubleshooting

| Symptom | What to check |
|--------|----------------|
| Bot never replies | 1) `TELEGRAM_BOT_TOKEN` in .env and backend restarted.<br>2) `API_URL` is the **public** URL (no localhost).<br>3) Called `/v1/chatbot/telegram/set-webhook` once and got `success: true`. |
| “Sorry, something went wrong: …” in Telegram | Backend threw inside `getSummary` (e.g. OpenAI, DB, or agent code). Check backend logs for the exact error (search for “Telegram webhook chatbot error”). |
| 403/404 from Telegram | Wrong or old webhook URL; call set-webhook again with correct `API_URL`. |
| Bot replies on website but not in Telegram | Confirms the issue is Telegram-specific: env (token, API_URL), reachability, or webhook not set. |

---

## 6. Quick checklist

- [ ] `.env` has `TELEGRAM_BOT_TOKEN` (from BotFather).
- [ ] `.env` has `API_URL` = public backend URL (no trailing slash), e.g. `https://your-backend.com` or ngrok URL.
- [ ] Backend is running and reachable at that URL (e.g. `curl https://your-api-url/`).
- [ ] You have called `GET .../v1/chatbot/telegram/set-webhook` (and optionally `?url=...`) and got `success: true`.
- [ ] If using ngrok, URL is the current ngrok URL (it changes on free restarts).
- [ ] Backend logs: no “TELEGRAM_BOT_TOKEN not set” and no “Telegram webhook chatbot error” when you send a message in Telegram.

After fixing the above, send a message to the bot again; it should reply using the same agent logic as the website.
