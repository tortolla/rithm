FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/apps/api/src/db/migrations ./apps/api/src/db/migrations
EXPOSE 3000
CMD ["sh", "-c", "node dist/api/db/migrate.js && node dist/api/db/seed.js && node dist/api/server.js"]
