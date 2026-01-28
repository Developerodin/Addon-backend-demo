# Agent Prompt Setup Guide

## How It Works

The system prompts are configured in the **Bolna Dashboard** (not sent per call). When you initiate a call:

1. **Language Selection** → Determines which **Agent ID** to use
   - English (`en`) → Uses English Agent ID → Uses **Amritanshu** prompt
   - Hindi (`hi`) → Uses Hindi Agent ID → Uses **Alok** prompt

2. **user_data** → Fills template variables in the system prompt
   - Variables like `{provider_name}`, `{service_type}`, `{location}`, `{key_points}` are filled from `user_data`

## Setup Steps

### Step 1: Copy Prompts to Bolna Dashboard

1. **English Agent (Amritanshu)**
   - Go to https://platform.bolna.ai/
   - Navigate to **Agents** → Select your English Agent
   - Copy content from `AddOn_backend/docs/english-agent-prompt.txt`
   - Paste into **System Prompt** field
   - Save

2. **Hindi Agent (Alok)**
   - Go to https://platform.bolna.ai/
   - Navigate to **Agents** → Select your Hindi Agent
   - Copy content from `AddOn_backend/docs/hindi-agent-prompt.txt`
   - Paste into **System Prompt** field
   - Save

### Step 2: Verify Connection

The code automatically:
- ✅ Selects correct agent ID based on language
- ✅ Sends `user_data` with all required variables
- ✅ Includes correct agent name (Amritanshu/Alok) in `user_data`

## How It's Connected

### Call Flow:
```
User selects language (en/hi)
    ↓
getAgentId(language) → Returns English or Hindi Agent ID
    ↓
getTemplateData(...) → Creates user_data with:
    - ai_agent_name: "Amritanshu" (if English) or "Alok" (if Hindi)
    - provider_name, service_type, location, key_points, etc.
    ↓
Bolna API Call → Uses selected agent's system prompt + user_data variables
```

### Code Location:
- **Agent Selection**: `AddOn_backend/src/services/crm/bolnaService.js` → `getAgentId()`
- **Template Data**: `AddOn_backend/src/utils/callTemplates.js` → `getTemplateData()`
- **Call Initiation**: `AddOn_backend/src/services/crm/bolnaService.js` → `initiateCall()`

## Variables in user_data

The following variables are sent in `user_data` and can be used in prompts:

- `ai_agent_name` - "Amritanshu" (English) or "Alok" (Hindi)
- `provider_name` - Business name
- `service_type` - Service type (e.g., "plumber", "electrician")
- `location` - City/location
- `language` - "en" or "hi"
- `introduction` - Pre-formatted introduction
- `business_verification` - Business verification question
- `location_confirmation` - Location confirmation question
- `purpose` - Purpose of call
- `key_points` - Array of key points
- `closing` - Pre-formatted closing message
- `template_name` - Template identifier

## Testing

After setting up prompts in Bolna dashboard:

1. Make a test call with English selected → Should use Amritanshu prompt
2. Make a test call with Hindi selected → Should use Alok prompt
3. Check call transcripts to verify agent names and prompt behavior
