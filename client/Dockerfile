# Multi-stage Dockerfile for React Client
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root manifests
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/solver-ts/package*.json ./packages/solver-ts/
COPY client/package*.json ./client/

# Install dependencies
RUN npm ci

# Copy sources
COPY packages/ ./packages/
COPY client/ ./client/

# Build client
RUN npm run build:packages
RUN npm run build:client

# Production Nginx Stage
FROM nginx:alpine AS runner

COPY --from=builder /app/client/dist /usr/share/nginx/html

# Custom nginx config for SPA routing and proxy
COPY <<EOF /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name localhost;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://server:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

