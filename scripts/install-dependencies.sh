#!/bin/bash

# Script to install all dependencies for AWS EC2 deployment

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Installing Dependencies${NC}"
echo -e "${GREEN}========================================${NC}"

# Update package list
echo -e "${YELLOW}Updating package list...${NC}"
sudo apt-get update

# Install Node.js (if not installed)
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Installing Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo -e "${GREEN}Node.js is already installed: $(node --version)${NC}"
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}Installing PM2...${NC}"
    sudo npm install -g pm2
else
    echo -e "${GREEN}PM2 is already installed: $(pm2 --version)${NC}"
fi

# Install ngrok
if ! command -v ngrok &> /dev/null; then
    echo -e "${YELLOW}Installing ngrok...${NC}"
    curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
    echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
    sudo apt update && sudo apt install ngrok
else
    echo -e "${GREEN}ngrok is already installed${NC}"
fi

# Install project dependencies
echo -e "${YELLOW}Installing project dependencies...${NC}"
npm install

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Create .env file with required environment variables"
echo "2. Set NGROK_AUTHTOKEN: ngrok config add-authtoken YOUR_TOKEN"
echo "3. Run: ./scripts/start-services.sh"
