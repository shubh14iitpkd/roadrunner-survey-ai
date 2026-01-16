#!/bin/bash

# ML Pipeline Service Startup Script

echo "Starting ML Pipeline Service..."

# Load environment variables if .env exists
if [ -f .env ]; then
    echo "Loading environment from .env file..."
    export $(cat .env | xargs)
fi

# Default values
export PORT=${PORT:-5002}
export MONGO_URI=${MONGO_URI:-mongodb://localhost:27017/}
export MONGO_DB_NAME=${MONGO_DB_NAME:-roadrunner_survey}

# Get upload directory from main backend
if [ -z "$UPLOAD_DIR" ]; then
    UPLOAD_DIR="$(cd "$(dirname "$0")/../backend/uploads" && pwd)"
    export UPLOAD_DIR
fi

echo "Configuration:"
echo "  Port: $PORT"
echo "  MongoDB: $MONGO_URI"
echo "  Database: $MONGO_DB_NAME"
echo "  Uploads: $UPLOAD_DIR"
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Creating..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Start the service
echo "Starting ML Pipeline Service on port $PORT..."
python app.py
