# Multi-stage Dockerfile for Node.js Express Server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/solver-ts/package*.json ./packages/solver-ts/
COPY server/package*.json ./server/

# Install dependencies
RUN npm ci

# Copy sources
COPY packages/ ./packages/
COPY server/ ./server/

# Build packages and server
RUN npm run build:packages
WORKDIR /app/server
RUN npx prisma generate
RUN npm run build

# Runtime Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000

# Copy root package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/solver-ts/package*.json ./packages/solver-ts/
COPY server/package*.json ./server/

# Install production dependencies
RUN npm ci --omit=dev

# Copy compiled artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/solver-ts/dist ./packages/solver-ts/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

WORKDIR /app/server

EXPOSE 5000

CMD ["node", "dist/server.js"]

