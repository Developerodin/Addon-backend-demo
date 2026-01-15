#!/bin/bash

# Script to check status of AddOn Backend and ngrok services

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Service Status${NC}"
echo -e "${GREEN}========================================${NC}"
pm2 list

echo ""
echo -e "${GREEN}Backend Status:${NC}"
if pm2 list | grep -q "addon-backend.*online"; then
    echo -e "${GREEN}✓ Backend is running${NC}"
    BACKEND_PORT=${PORT:-3003}
    if curl -s http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend is responding on port $BACKEND_PORT${NC}"
    else
        echo -e "${YELLOW}⚠ Backend may not be responding${NC}"
    fi
else
    echo -e "${YELLOW}✗ Backend is not running${NC}"
fi

echo ""
echo -e "${GREEN}ngrok Status:${NC}"
if pm2 list | grep -q "ngrok-tunnel.*online"; then
    echo -e "${GREEN}✓ ngrok is running${NC}"
    # Try to get ngrok URL
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"[^"]*' | head -1 | cut -d'"' -f4 || echo "")
    if [ -n "$NGROK_URL" ]; then
        echo -e "${GREEN}✓ ngrok URL: $NGROK_URL${NC}"
        echo -e "${GREEN}  Webhook URL: ${NGROK_URL}/v1/crm/webhook${NC}"
    else
        echo -e "${YELLOW}⚠ Could not retrieve ngrok URL${NC}"
        echo "  Check: curl http://localhost:4040/api/tunnels"
    fi
else
    echo -e "${YELLOW}✗ ngrok is not running${NC}"
fi

echo ""
echo -e "${GREEN}Recent Logs (last 10 lines):${NC}"
pm2 logs --lines 10 --nostream
