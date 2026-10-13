# Optional always-on service; NOT a Next.js web deployment or Vercel cron.
# Pin the reviewed node image digest before live employer deployment.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts/worker.ts ./scripts/worker.ts
USER node
STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "scripts/worker.ts"]
