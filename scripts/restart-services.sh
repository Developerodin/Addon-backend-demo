#!/bin/bash

# Script to restart AddOn Backend and ngrok services

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Restarting AddOn Backend and ngrok services...${NC}"

# Restart PM2 processes
pm2 restart ecosystem.config.json

echo -e "${GREEN}Services restarted${NC}"
pm2 list
