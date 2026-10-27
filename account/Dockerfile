# The account box: the Account service on its own volume (compose.yml at the repo root).
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 4820
