FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force \
  && rm -rf \
    /opt/yarn-v* \
    /usr/local/lib/node_modules/corepack \
    /usr/local/lib/node_modules/npm \
    /usr/local/bin/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg
COPY --chown=node:node server.js ./
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node public/ ./public/
RUN mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 3000
USER node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
