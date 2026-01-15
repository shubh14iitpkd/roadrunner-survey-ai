#!/bin/bash

echo "🚀 Starting deployment..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Load environment variables if .env exists
if [ -f .env ]; then
    echo -e "${YELLOW}Loading environment variables...${NC}"
    export $(cat .env | grep -v '^#' | xargs)
fi

########################################
# FRONTEND
########################################
echo -e "${YELLOW}Installing and building frontend...${NC}"

if [ -f "package.json" ]; then
    npm install
    npm run build
    echo -e "${GREEN}✅ Frontend built successfully${NC}"
else
    echo -e "${RED}No package.json found — skipping frontend build${NC}"
fi

########################################
# BACKEND
########################################
echo -e "${YELLOW}Setting up backend...${NC}"

cd backend || exit 1

# Setup Python venv
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}✅ Virtual environment created${NC}"
fi

source venv/bin/activate

# Install dependencies
if [ -f "requirements.txt" ]; then
    pip install --upgrade pip
    pip install -r requirements.txt
    echo -e "${GREEN}✅ Backend dependencies installed${NC}"
fi

# Ensure uploads directories exist with all subdirectories
mkdir -p uploads/gpx uploads/frames uploads/original_videos uploads/annotated_videos uploads/metadata
echo -e "${GREEN}✅ Upload directories created${NC}"

########################################
# START/RESTART BACKEND (PM2)
########################################
echo -e "${YELLOW}Restarting backend with PM2 (port 5000)...${NC}"

# Check if backend already exists in PM2
if pm2 describe backend > /dev/null 2>&1; then
    pm2 restart backend
    echo -e "${GREEN}✅ Backend restarted successfully${NC}"
else
    # Use gunicorn for production (matching Dockerfile)
    pm2 start "gunicorn -w 4 -b 0.0.0.0:5000 --timeout 900 --graceful-timeout 120 --keep-alive 5 app:app" --name backend --interpreter bash
    echo -e "${GREEN}✅ Backend started successfully on port 5000${NC}"
fi

deactivate
cd ..

########################################
# START/RESTART FRONTEND (PM2)
########################################
echo -e "${YELLOW}Starting frontend on port 8080 with PM2...${NC}"

if pm2 describe frontend > /dev/null 2>&1; then
    pm2 restart frontend
    echo -e "${GREEN}✅ Frontend restarted successfully${NC}"
else
    pm2 serve dist 8080 --spa --name frontend
    echo -e "${GREEN}✅ Frontend started successfully on port 8081${NC}"
fi

########################################
# SAVE PM2 PROCESS LIST
########################################
pm2 save

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
