# ==============================================================================
# Multi-Stage Production Dockerfile for API_Hashira
# ==============================================================================

# STAGE 1: Build & Compile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for layer caching
COPY package*.json ./
RUN npm ci

# Copy full application source
COPY . .

# Build client SPA and compile server.ts via esbuild bundle
RUN npm run build

# STAGE 2: Lightweight Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled assets from builder
COPY --from=builder /app/dist ./dist

# Create non-privileged user for container security
USER node

EXPOSE 3000

# Start compiled server
CMD ["node", "dist/server.cjs"]
