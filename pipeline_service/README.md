# ML Pipeline Service

Separate microservice for AI video processing to avoid blocking the main backend.

## Why Separate?

- **Performance**: ML processing is CPU/GPU intensive and can slow down API responses
- **Scalability**: Can be scaled independently from the main backend
- **Isolation**: Failures in ML processing don't affect the main API
- **Resource Management**: Can be deployed on machines optimized for ML workloads

## Architecture

```
Main Backend (Port 5001)
    ↓ Creates Job
MongoDB (Processing Jobs Queue)
    ↓ Worker Polls
ML Pipeline Service (Port 5002)
    ↓ Processes Video
    ↓ Updates MongoDB
Main Backend ← Reads Results
```

## Setup

1. **Install dependencies**:
   ```bash
   cd pipeline_service
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Run the service**:
   ```bash
   python app.py
   ```

The service will:
- Start on port 5002 (configurable via `PORT` env var)
- Automatically start the background worker
- Poll MongoDB for processing jobs every 5 seconds

## API Endpoints

### Health Check
```
GET /health
```

### Create Processing Job
```
POST /jobs
Body: { "video_id": "..." }
```

### Get Job Status
```
GET /jobs/<job_id>
```

### List Jobs
```
GET /jobs?status=pending
```

### Worker Control
```
POST /worker/start
POST /worker/stop
```

## Database Collections

### `processing_jobs`
- `video_id`: ObjectId - Reference to video
- `status`: String - pending, claimed, processing, completed, failed
- `progress`: Number - 0-100
- `created_at`, `updated_at`: ISO timestamps
- `result`: Object - Processing results (annotated_video_url, stats)
- `error`: String - Error message if failed

## Deployment

### Docker (Recommended)

```bash
docker build -t ml-pipeline-service .
docker run -p 5002:5002 \
  -e MONGO_URI=mongodb://host.docker.internal:27017/ \
  -e UPLOAD_DIR=/app/uploads \
  -v /path/to/uploads:/app/uploads \
  ml-pipeline-service
```

### Production Considerations

1. **Use Gunicorn** for production:
   ```bash
   gunicorn -w 1 -b 0.0.0.0:5002 app:app
   ```
   Note: Use only 1 worker to avoid duplicate processing

2. **Configure AWS credentials** for SageMaker:
   ```bash
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_DEFAULT_REGION=ap-south-1
   ```

3. **Monitor**: Check `/health` endpoint regularly

4. **Scale**: Run multiple instances if needed, jobs are claimed atomically
