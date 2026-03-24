FROM python:3.12.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ARG FRAME_INTERVAL
ARG CONFIDENCE_THRESHOLD

ARG ENABLE_SWAGGER
ARG GEMINI_API_KEY
ARG GOOGLE_API_KEY
ARG MONGO_URI
ARG MONGO_DB_NAME
ARG SECRET_KEY
ARG JWT_SECRET_KEY

ENV FRAME_INTERVAL=$FRAME_INTERVAL
ENV CONFIDENCE_THRESHOLD=$CONFIDENCE_THRESHOLD
ENV AUTO_PROCESS_ON_UPLOAD=false

ENV CORS_ORIGINS=*
ENV ENABLE_SWAGGER=$ENABLE_SWAGGER  
ENV GEMINI_API_KEY=$GEMINI_API_KEY
ENV GOOGLE_API_KEY=$GOOGLE_API_KEY
ENV MONGO_URI=$MONGO_URI
ENV MONGO_DB_NAME=$MONGO_DB_NAME
ENV SECRET_KEY=$SECRET_KEY
ENV JWT_SECRET_KEY=$JWT_SECRET_KEY

# This is set it via docker-compose
RUN mkdir -p /app/uploads

EXPOSE 5001

CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:5001", \
     "--timeout", "900", "--graceful-timeout", "120", \
     "--keep-alive", "5", "--access-logfile", "-", \
     "--error-logfile", "-", "app:app"]
