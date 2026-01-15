# AWS EC2 Deployment Guide

This guide explains how to deploy AddOn Backend and ngrok on AWS EC2 and keep them running forever.

## Prerequisites

- AWS EC2 instance (Ubuntu recommended)
- SSH access to the instance
- Domain name (optional, for custom ngrok domain)

## Quick Start

### 1. Install Dependencies

```bash
cd AddOn_backend
./scripts/install-dependencies.sh
```

This will install:
- Node.js
- PM2 (process manager)
- ngrok
- Project dependencies

### 2. Configure Environment

Create a `.env` file in the project root:

```bash
# Backend Configuration
NODE_ENV=production
PORT=3003
MONGODB_URL=your_mongodb_url
JWT_SECRET=your_jwt_secret

# ngrok Configuration
NGROK_AUTHTOKEN=your_ngrok_authtoken
NGROK_DOMAIN=addon.ngrok.app  # Optional: for custom domain

# Bolna AI Configuration
BOLNA_API_KEY=your_bolna_api_key
AGENT_ID_ENGLISH=your_english_agent_id
AGENT_ID_HINDI=your_hindi_agent_id

# Other required variables...
```

### 3. Configure ngrok

```bash
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

### 4. Start Services

```bash
./scripts/start-services.sh
```

This will:
- Start the Express backend on port 3003
- Start ngrok tunnel pointing to port 3003
- Configure PM2 to auto-restart on failure
- Set up PM2 to start on system boot

## Management Commands

### Check Status
```bash
./scripts/status.sh
```

### Restart Services
```bash
./scripts/restart-services.sh
```

### Stop Services
```bash
./scripts/stop-services.sh
```

### View Logs
```bash
# All logs
pm2 logs

# Backend only
pm2 logs addon-backend

# ngrok only
pm2 logs ngrok-tunnel

# Last 50 lines
pm2 logs --lines 50
```

### Monitor Services
```bash
pm2 monit
```

## PM2 Commands

### Manual PM2 Operations

```bash
# List all processes
pm2 list

# Restart specific service
pm2 restart addon-backend
pm2 restart ngrok-tunnel

# Stop specific service
pm2 stop addon-backend
pm2 stop ngrok-tunnel

# Delete process
pm2 delete addon-backend

# Save current process list
pm2 save

# View process info
pm2 info addon-backend
```

## Getting ngrok URL

### Method 1: Via ngrok API
```bash
curl http://localhost:4040/api/tunnels | jq
```

### Method 2: Via Backend API
```bash
curl http://localhost:3003/v1/crm/ngrok/webhook-url
```

### Method 3: Via ngrok Web Interface
Visit: `http://localhost:4040` (only accessible from EC2 instance)

## Auto-Start on Boot

PM2 will automatically start services on system boot after running `start-services.sh`.

To verify:
```bash
pm2 startup
```

To disable:
```bash
pm2 unstartup
```

## Troubleshooting

### Backend Not Starting

1. Check logs:
   ```bash
   pm2 logs addon-backend --lines 50
   ```

2. Verify environment variables:
   ```bash
   pm2 env addon-backend
   ```

3. Check MongoDB connection:
   ```bash
   # Test MongoDB connection
   node -e "require('mongoose').connect('YOUR_MONGODB_URL').then(() => console.log('Connected')).catch(e => console.error(e))"
   ```

### ngrok Not Starting

1. Check logs:
   ```bash
   pm2 logs ngrok-tunnel --lines 50
   ```

2. Verify authtoken:
   ```bash
   ngrok config check
   ```

3. Test ngrok manually:
   ```bash
   ngrok http 3003
   ```

### Port Already in Use

If port 3003 is already in use:

1. Find the process:
   ```bash
   sudo lsof -i :3003
   ```

2. Kill the process:
   ```bash
   sudo kill -9 <PID>
   ```

3. Or change PORT in `.env` file

### PM2 Process Not Found

If PM2 processes are not found after reboot:

1. Restore saved processes:
   ```bash
   pm2 resurrect
   ```

2. Or restart manually:
   ```bash
   ./scripts/start-services.sh
   ```

## Security Considerations

1. **Firewall**: Configure AWS Security Group to allow:
   - Port 3003 (backend)
   - Port 4040 (ngrok web interface - optional, can be restricted to localhost)

2. **Environment Variables**: Never commit `.env` file to git

3. **ngrok Domain**: Use custom domain for production to avoid URL changes

4. **HTTPS**: ngrok provides HTTPS automatically, but ensure backend validates webhook IPs

## Monitoring

### Health Check Endpoint

The backend should have a health check endpoint:
```bash
curl http://localhost:3003/health
```

### Set up CloudWatch (Optional)

You can configure PM2 to send logs to CloudWatch:
```bash
pm2 install pm2-cloudwatch
pm2 set pm2-cloudwatch:accessKeyId YOUR_ACCESS_KEY
pm2 set pm2-cloudwatch:secretAccessKey YOUR_SECRET_KEY
pm2 set pm2-cloudwatch:region us-east-1
```

## Updating Services

### Update Backend Code

```bash
# Pull latest code
git pull

# Install new dependencies (if any)
npm install

# Restart services
./scripts/restart-services.sh
```

### Update ngrok

```bash
sudo apt update && sudo apt upgrade ngrok
pm2 restart ngrok-tunnel
```

## Backup

### Backup PM2 Configuration

```bash
pm2 save
# This saves to ~/.pm2/dump.pm2
```

### Backup Environment Variables

```bash
cp .env .env.backup
```

## Additional Resources

- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [ngrok Documentation](https://ngrok.com/docs)
- [AWS EC2 Documentation](https://docs.aws.amazon.com/ec2/)
