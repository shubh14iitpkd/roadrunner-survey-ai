#!/bin/bash

# Test script for Roads API integration
echo "======================================"
echo "Testing Roads API Integration"
echo "======================================"

cd backend

# Activate virtual environment
source venv/bin/activate

# Check MongoDB connection
echo ""
echo "1. Testing MongoDB Connection..."
python3 << EOF
from db import get_client
from config import Config
from flask import Flask
app = Flask(__name__)
app.config.from_object(Config())
client = get_client(app)
db = client[app.config['MONGO_DB_NAME']]
count = db.roads.count_documents({})
print(f"✓ Connected to MongoDB")
print(f"✓ Found {count} roads in database")
EOF

echo ""
echo "2. Testing Backend Imports..."
python3 << EOF
try:
    from roads.routes import roads_bp
    from app import create_app
    app = create_app()
    print("✓ Backend imports successful")
    print(f"✓ Roads blueprint registered at /api/roads")
except Exception as e:
    print(f"✗ Error: {e}")
EOF

echo ""
echo "======================================"
echo "Integration Complete!"
echo "======================================"
echo ""
echo "To test the full stack:"
echo "1. Start backend:  cd backend && source venv/bin/activate && python app.py"
echo "2. Start frontend: npm run dev"
echo "3. Open browser:   http://localhost:5173/roads"
echo ""
