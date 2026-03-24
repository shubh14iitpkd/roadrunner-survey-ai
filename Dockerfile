# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Declare build args
ARG VITE_GEMINI_API_KEY
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_API_URL

# Make them available to Vite during build
ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ── Stage 2: Serve ───────────────────────────────────────────
FROM node:20-alpine

RUN npm install -g serve
COPY --from=builder /app/dist /app/dist

EXPOSE 8080
CMD ["serve", "-s", "/app/dist", "-l", "8080"]
