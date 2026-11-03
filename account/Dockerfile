# The account box: the Account service on its own volume (compose.yml at the repo root). It runs
# no data sidecar and holds no iFinD token: both are the market box's (market/Dockerfile).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 4820
