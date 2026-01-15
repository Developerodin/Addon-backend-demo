#!/bin/bash

# Script to start AddOn Backend and ngrok on AWS EC2
# This script uses PM2 to keep both services running forever

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AddOn Backend & ngrok Startup Script${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}PM2 is not installed. Installing PM2...${NC}"
    npm install -g pm2
fi

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}ngrok is not installed.${NC}"
    echo -e "${YELLOW}Please install ngrok:${NC}"
    echo "  curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null"
    echo "  echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' | sudo tee /etc/apt/sources.list.d/ngrok.list"
    echo "  sudo apt update && sudo apt install ngrok"
    echo ""
    echo "Or download from: https://ngrok.com/download"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Warning: .env file not found${NC}"
    echo "Please create a .env file with required environment variables"
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Get backend port from environment or use default
BACKEND_PORT=${PORT:-3003}
NGROK_DOMAIN=${NGROK_DOMAIN:-""}

echo -e "${GREEN}Configuration:${NC}"
echo "  Backend Port: $BACKEND_PORT"
if [ -n "$NGROK_DOMAIN" ]; then
    echo "  ngrok Domain: $NGROK_DOMAIN"
    NGROK_ARGS="http $BACKEND_PORT --domain=$NGROK_DOMAIN --log=stdout"
else
    echo "  ngrok Domain: Dynamic (will be assigned)"
    NGROK_ARGS="http $BACKEND_PORT --log=stdout"
fi

# Update ecosystem.config.json with correct port and domain
if [ -n "$NGROK_DOMAIN" ]; then
    # Update ngrok args in ecosystem config (if using custom domain)
    sed -i "s|\"args\": \".*\"|\"args\": \"http $BACKEND_PORT --domain=$NGROK_DOMAIN --log=stdout\"|g" ecosystem.config.json 2>/dev/null || true
else
    sed -i "s|\"args\": \".*\"|\"args\": \"http $BACKEND_PORT --log=stdout\"|g" ecosystem.config.json 2>/dev/null || true
fi

# Stop existing PM2 processes
echo -e "${YELLOW}Stopping existing PM2 processes...${NC}"
pm2 stop ecosystem.config.json 2>/dev/null || true
pm2 delete ecosystem.config.json 2>/dev/null || true

# Start backend with PM2
echo -e "${GREEN}Starting AddOn Backend...${NC}"
pm2 start ecosystem.config.json --only addon-backend

# Wait a bit for backend to start
sleep 3

# Check if backend is running
if pm2 list | grep -q "addon-backend.*online"; then
    echo -e "${GREEN}✓ Backend started successfully${NC}"
else
    echo -e "${RED}✗ Backend failed to start${NC}"
    pm2 logs addon-backend --lines 20
    exit 1
fi

# Start ngrok with PM2
echo -e "${GREEN}Starting ngrok tunnel...${NC}"

# Set ngrok authtoken if provided
if [ -n "$NGROK_AUTHTOKEN" ]; then
    ngrok config add-authtoken "$NGROK_AUTHTOKEN" 2>/dev/null || true
fi

# Start ngrok via PM2
pm2 start ecosystem.config.json --only ngrok-tunnel

# Wait a bit for ngrok to start
sleep 5

# Check if ngrok is running
if pm2 list | grep -q "ngrok-tunnel.*online"; then
    echo -e "${GREEN}✓ ngrok started successfully${NC}"
else
    echo -e "${YELLOW}⚠ ngrok may have issues. Check logs: pm2 logs ngrok-tunnel${NC}"
fi

# Save PM2 process list
pm2 save

# Setup PM2 startup script
echo -e "${GREEN}Setting up PM2 startup script...${NC}"
pm2 startup systemd -u $USER --hp $HOME | grep -v "PM2" | bash || true

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Services Status:${NC}"
echo -e "${GREEN}========================================${NC}"
pm2 list

echo ""
echo -e "${GREEN}Useful Commands:${NC}"
echo "  View logs:        pm2 logs"
echo "  View backend:     pm2 logs addon-backend"
echo "  View ngrok:       pm2 logs ngrok-tunnel"
echo "  Restart all:      pm2 restart ecosystem.config.json"
echo "  Stop all:         pm2 stop ecosystem.config.json"
echo "  Monitor:          pm2 monit"
echo ""
echo -e "${GREEN}To get ngrok URL:${NC}"
echo "  curl http://localhost:4040/api/tunnels | jq"
echo "  Or visit: http://localhost:4040"
echo ""
echo -e "${GREEN}Services are now running!${NC}"
