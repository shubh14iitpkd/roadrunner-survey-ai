# RoadRunner AI Chatbot Module

## Overview
The AI module provides an intelligent chatbot that can query the RoadRunner database using natural language. It uses Google's Gemini AI to convert user questions into MongoDB queries, execute them, and return natural language answers.

## Files
- **`chatbot_ai.py`**: Core chatbot logic with MongoDB integration and Gemini AI
- **`routes.py`**: Flask REST API endpoints for chat management

## API Endpoints

### 1. Create Chat
```http
POST /api/ai/chats
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "title": "New Chat"
}
```

### 2. List Chats
```http
GET /api/ai/chats
Authorization: Bearer <jwt_token>
```

### 3. Get Messages
```http
GET /api/ai/chats/{chat_id}/messages
Authorization: Bearer <jwt_token>
```

### 4. Send Message
```http
POST /api/ai/chats/{chat_id}/messages
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "content": "How many street lights are on route 105?"
}
```

**Response:**
```json
{
  "user_message": {
    "_id": "...",
    "chat_id": "...",
    "role": "user",
    "content": "How many street lights are on route 105?",
    "created_at": "..."
  },
  "assistant_message": {
    "_id": "...",
    "chat_id": "...",
    "role": "assistant",
    "content": "Route 105 has 45 street lights detected across 1,234 frames...",
    "created_at": "..."
  }
}
```

### 5. Delete Chat
```http
DELETE /api/ai/chats/{chat_id}
Authorization: Bearer <jwt_token>
```

## Setup Instructions

### 1. Install Dependencies
```bash
cd backend
pip install google-generativeai
```

### 2. Configure Environment Variables
Create `backend/.env` (or update existing):
```env
GEMINI_API_KEY=your_gemini_api_key_here
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=roadrunner
```

### 3. Get Gemini API Key
1. Go to https://makersuite.google.com/app/apikey
2. Create a new API key
3. Add it to your `.env` file

### 4. Database Collections
The chatbot uses these MongoDB collections:
- **`ai_chats`**: Chat sessions
- **`ai_messages`**: Chat messages
- **`frames`**: Video frames with detections
- **`videos`**: Video metadata

## How It Works

1. **User sends a message** → Frontend calls `/api/ai/chats/{id}/messages`
2. **Backend saves user message** → Stored in MongoDB
3. **Gemini converts to MongoDB query** → Natural language → MongoDB query
4. **Query executed** → Results fetched from database
5. **Gemini generates answer** → Results → Natural language response
6. **Backend saves AI response** → Stored in MongoDB
7. **Both messages returned** → Frontend displays conversation

## Example Queries

- "How many street lights are on route 105?"
- "Show me videos from route 258"
- "What detections are available in the database?"
- "List all road markings detected"
- "Count frames with information boards on route 215"

## Database Schema

### Frames Collection
```javascript
{
  video_id: ObjectId,
  route_id: Number,          // e.g., 105, 258, 215
  frame_number: Number,
  timestamp: Number,         // seconds
  detections: [
    {
      class_name: String,    // "Street lights", "Road markings", etc.
      confidence: Number     // 0-1
    }
  ],
  location: {                // GeoJSON
    type: "Point",
    coordinates: [lng, lat]
  }
}
```

### Videos Collection
```javascript
{
  route_id: Number,
  title: String,
  duration_seconds: Number,
  status: String,           // "uploaded", "completed"
  category_videos: Object
}
```

## Troubleshooting

### "Cannot connect to MongoDB"
- Ensure MongoDB is running: `mongod`
- Check MONGO_URI in `.env`

### "GEMINI_API_KEY not set"
- Add GEMINI_API_KEY to `backend/.env`
- Verify the key is valid

### "No data found"
- Verify collections have data: `mongosh roadrunner`
- Check collection names match schema

## Frontend Integration

The frontend (AskAI.tsx) automatically:
- Creates chat sessions
- Sends user messages
- Displays AI responses
- Handles errors gracefully

No additional frontend configuration needed!
