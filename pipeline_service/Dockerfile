FROM python:3.11-slim

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY app.py .

# Copy video processor from backend (shared code)
RUN mkdir -p /app/services
COPY ../backend/services/video_processor.py /app/services/

# Copy pipeline config
COPY ../pipeline/endpoint_config.json /app/

# Environment variables
ENV PORT=5002
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 5002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:5002/health', timeout=2)" || exit 1

# Run the service
CMD ["python", "app.py"]
