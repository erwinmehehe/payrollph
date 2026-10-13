# External watchdog MUST run on a separate failure domain from the worker.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY scripts/lib/scheduler-watchdog.mjs ./scripts/lib/scheduler-watchdog.mjs
COPY scripts/scheduler-watchdog.mjs ./scripts/scheduler-watchdog.mjs
USER node
STOPSIGNAL SIGTERM
CMD ["node", "scripts/scheduler-watchdog.mjs"]
