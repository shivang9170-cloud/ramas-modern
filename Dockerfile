# Ramas ERP — the whole project in ONE container:
#   SQL Server 2022 (Linux, Express edition by default) + the Node.js API, which also serves the built React app.
# Build and start with docker-compose.yml (settings in .env — see docker/.env.example and docs/DOCKER.md):
#   docker compose up -d --build

# ---- 1. React app → client/dist (the client imports ../shared, so it is copied next to it)
FROM node:24-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared/ /app/shared/
COPY client/ ./
RUN npm run build

# ---- 2. API packages, production only. msnodesqlv8 (optional) is the Windows ODBC driver: left out — the container uses tedious.
FROM node:24-bookworm-slim AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund

# ---- 3. runtime: Microsoft's SQL Server image + the Node.js binary
FROM mcr.microsoft.com/mssql/server:2022-latest
USER root
COPY --from=server /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=server /app/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY server/scripts server/scripts
COPY server/db server/db
COPY shared shared
COPY --from=client /app/client/dist client/dist
COPY docker/entrypoint.sh /usr/local/bin/ramas-entrypoint
# CRLF → LF in case Git checked the script out with Windows line endings; POD uploads written by the mssql user
RUN sed -i 's/\r$//' /usr/local/bin/ramas-entrypoint \
 && chmod 755 /usr/local/bin/ramas-entrypoint \
 && mkdir -p /app/server/uploads/PODImage \
 && chown -R mssql /app/server/uploads

ENV ACCEPT_EULA=Y \
    MSSQL_PID=Express \
    NODE_ENV=production \
    PORT=4000 \
    CLIENT_DIST=/app/client/dist \
    DB_DRIVER=tedious \
    DB_SERVER=127.0.0.1 \
    DB_PORT=1433 \
    DB_ENCRYPT=false \
    DB_TRUST_SERVER_CERT=true

USER mssql
EXPOSE 4000 1433
VOLUME ["/var/opt/mssql", "/app/server/uploads"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/ramas-entrypoint"]
