# Webhook Troubleshooting Guide

## Problem: Calls Not Updating Automatically

If calls are stuck in "in_progress" status and not updating automatically, follow these steps:

### Step 1: Check if Webhooks Are Being Received

1. **Check Backend Logs**
   ```bash
   # Look for webhook logs in your backend console
   # You should see: "📥 Webhook received:" when a webhook arrives
   ```

2. **Check Webhook Logs in Database**
   - Navigate to `/v1/crm/webhook-logs` endpoint (requires auth)
   - Or check MongoDB collection `webhooklogs`
   - Look for recent entries with your `executionId`

3. **Test Webhook Endpoint**
   ```bash
   # Get webhook URL info
   GET http://localhost:3000/v1/crm/webhook
   
   # Or check ngrok webhook URL
   GET http://localhost:3000/v1/crm/ngrok/webhook-url
   ```

### Step 2: Verify ngrok Configuration

1. **Check if ngrok is Running**
   ```bash
   # Check if ngrok tunnel is active
   curl http://localhost:4040/api/tunnels
   ```

2. **Verify ngrok Tunnel**
   - ngrok should be tunneling to `http://localhost:3000` (or your backend port)
   - The tunnel should be HTTPS (required for webhooks)

3. **Get ngrok Webhook URL**
   ```bash
   GET http://localhost:3000/v1/crm/ngrok/webhook-url
   ```
   Copy the `webhook_url` from the response

### Step 3: Configure Webhook in Bolna Dashboard

1. **Go to Bolna Dashboard**
   - Navigate to https://platform.bolna.ai/
   - Go to **Agents** → Select your agent (English or Hindi)

2. **Set Webhook URL**
   - Find **Webhook URL** or **Callback URL** field
   - Paste the URL from Step 2: `https://your-ngrok-domain.ngrok.io/v1/crm/webhook`
   - **Important**: Use the SAME URL for both English and Hindi agents

3. **Save Configuration**
   - Click **Save** or **Update**
   - Verify the webhook URL is saved

### Step 4: Test Webhook Manually

1. **Make a Test Call**
   - Initiate a call from the frontend
   - Wait for the call to complete

2. **Check Logs**
   ```bash
   # Look for these log messages:
   # 📥 Webhook received: {...}
   # 🔍 Extracted executionId: exec_xxx
   # 📊 Extracted status: completed
   # ✅ Webhook processed successfully
   ```

3. **Check Call Status**
   - Refresh the call history page
   - The call status should update to "completed" or "failed"
   - Transcript and recording should appear if available

### Step 5: Common Issues and Solutions

#### Issue 1: Webhooks Not Received

**Symptoms:**
- No webhook logs in backend
- Calls stuck in "in_progress"

**Solutions:**
- ✅ Verify ngrok is running: `ngrok http 3000`
- ✅ Check webhook URL in Bolna dashboard matches ngrok URL
- ✅ Ensure webhook URL ends with `/v1/crm/webhook`
- ✅ Check firewall/network settings
- ✅ Verify ngrok tunnel is HTTPS (not HTTP)

#### Issue 2: Webhooks Received But Status Not Updated

**Symptoms:**
- Webhook logs exist but call status unchanged
- Logs show "⚠️ No valid fields to update"

**Solutions:**
- ✅ Check webhook payload format in logs
- ✅ Verify `executionId` matches call record
- ✅ Check if status field exists in payload
- ✅ Use "Sync Missing Data" button to manually sync

#### Issue 3: Status Extraction Failed

**Symptoms:**
- Webhook received but status is null/undefined
- Logs show "📊 Extracted status: undefined"

**Solutions:**
- ✅ Check webhook payload structure
- ✅ Verify Bolna is sending status field
- ✅ Check if status is in nested `data` object
- ✅ Review webhook logs to see actual payload format

### Step 6: Manual Sync (Fallback)

If automatic webhooks aren't working:

1. **Use Sync Button**
   - Go to Call History page
   - Click "Sync Missing Data" button
   - This fetches latest data from Bolna API

2. **API Endpoint**
   ```bash
   POST http://localhost:3000/v1/crm/bolna/sync-all
   Body: { "limit": 100, "onlyMissing": true }
   ```

### Step 7: Verify Webhook Processing

Check these logs in order:

1. **Webhook Received**
   ```
   📥 Webhook received: {...}
   ```

2. **Execution ID Extracted**
   ```
   🔍 Extracted executionId: exec_xxx
   ```

3. **Status Extracted**
   ```
   📊 Extracted status: completed
   ```

4. **Call Found**
   ```
   🔍 Call lookup by executionId exec_xxx: Found
   ```

5. **Update Data Prepared**
   ```
   📝 Update data (X fields): {...}
   ```

6. **Call Updated**
   ```
   ✅ Webhook processed successfully
   📋 Updated call status: completed, completedAt: ...
   ```

### Debugging Commands

```bash
# Check recent webhook logs
GET /v1/crm/webhook-logs?limit=10&sortBy=receivedAt:desc

# Check specific execution
GET /v1/crm/webhook-logs/execution/{executionId}

# Get webhook URL
GET /v1/crm/webhook

# Test webhook endpoint (should return webhook info)
GET /v1/crm/webhook

# Manual sync
POST /v1/crm/bolna/sync-all
Body: { "limit": 100, "onlyMissing": true }
```

### Expected Webhook Payload Format

Bolna AI typically sends webhooks in this format:

```json
{
  "id": "exec_123456",
  "status": "completed",
  "agent_id": "agent-uuid",
  "transcript": "Conversation transcript...",
  "telephony_data": {
    "recording_url": "https://...",
    "duration": 120
  },
  "conversation_time": 120,
  "completed_at": "2025-01-14T10:32:00Z"
}
```

The webhook handler supports multiple formats and will extract data from various locations in the payload.

### Still Not Working?

1. **Check Backend Logs** - Look for errors or warnings
2. **Check Webhook Logs** - Review actual payloads received
3. **Test with Manual Sync** - Use sync button to verify API connection
4. **Verify ngrok Tunnel** - Ensure tunnel is active and HTTPS
5. **Check Bolna Dashboard** - Verify webhook URL is configured correctly
