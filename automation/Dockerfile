# Automation service + devnet scripts. Build from the repo root:
#   docker build -f automation/Dockerfile -t meridian-automation .
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY sdk/package.json sdk/
COPY automation/package.json automation/
COPY app/package.json app/
RUN npm ci --omit=dev --no-audit --no-fund
COPY sdk sdk
COPY automation automation
COPY scripts scripts
ENV NODE_ENV=production
CMD ["npx", "tsx", "automation/src/index.ts", "run"]
