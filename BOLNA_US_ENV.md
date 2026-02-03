# Bolna US Account – Environment Variables

Add these to your `.env` for the **US Bolna account** (used when calling with US Plivo numbers).

## Required for US number calling

```env
# --- Bolna US Account (for US Plivo numbers) ---
BOLNA_US_API_KEY=your_us_bolna_api_key_here
BOLNA_US_API_BASE=https://api.bolna.ai
AGENT_ID_US_ENGLISH=your_us_english_agent_id_here
AGENT_ID_US_HINDI=your_us_hindi_agent_id_here
```

## Summary

| Variable | Description |
|----------|-------------|
| `BOLNA_US_API_KEY` | API key from your **US Bolna account** (same format as `BOLNA_API_KEY`) |
| `BOLNA_US_API_BASE` | Bolna API base URL (default: `https://api.bolna.ai`) |
| `AGENT_ID_US_ENGLISH` | English agent ID in your US Bolna account |
| `AGENT_ID_US_HINDI` | Hindi agent ID in your US Bolna account |

## Existing India account (unchanged)

```env
# --- Bolna India Account (default, for India Plivo numbers) ---
BOLNA_API_KEY=your_india_bolna_api_key
BOLNA_API_BASE=https://api.bolna.ai
AGENT_ID_ENGLISH=your_india_english_agent_id
AGENT_ID_HINDI=your_india_hindi_agent_id
CALLER_ID=optional_default_caller_id
```

## Behaviour

- **India calls** (recipient +91 or caller ID +91): uses India Bolna account (`BOLNA_API_KEY`, `AGENT_ID_ENGLISH`, `AGENT_ID_HINDI`).
- **US calls** (recipient +1 or caller ID +1): uses US Bolna account (`BOLNA_US_API_KEY`, `AGENT_ID_US_ENGLISH`, `AGENT_ID_US_HINDI`).
- Country is chosen from the **caller ID** (from phone number) if present, otherwise from the **recipient** phone number.

After adding the variables, restart the backend.
