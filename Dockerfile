FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci

COPY tsconfig.json ./
COPY server ./server
COPY public ./public

RUN npm run build \
    && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="TeamSpeak Web" \
      org.opencontainers.image.description="Browser-based TeamSpeak client and lightweight UDP gateway" \
      org.opencontainers.image.source="https://github.com/Lightalso/TeamSpeakWeb" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TSWEB_LOCK_SERVER=false \
    TSWEB_TEAMSPEAK_ADDRESS=127.0.0.1:9987

WORKDIR /app

COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node LICENSE ./LICENSE

USER node

EXPOSE 3000/tcp

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const scheme = process.env.SSL_CERT && process.env.SSL_KEY ? 'https' : 'http'; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; fetch(scheme + '://127.0.0.1:' + process.env.PORT + '/').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/src/index.js"]
