#!/bin/bash

# Script to stop AddOn Backend and ngrok services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Stopping AddOn Backend and ngrok services...${NC}"

# Stop PM2 processes
pm2 stop ecosystem.config.json 2>/dev/null || echo -e "${YELLOW}No PM2 processes found${NC}"

echo -e "${GREEN}Services stopped${NC}"
pm2 list
