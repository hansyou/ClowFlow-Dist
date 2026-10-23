# CloudFlow 部署镜像：直接运行 dist/ 编译产物（不含源码）
#   构建：docker build -t hansyou/cloudflow-dist:latest .
#   运行：docker compose up -d（见 docker-compose.yml）
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --omit=dev --no-audit --no-fund --timeout=120000 \
    && npm cache clean --force

COPY dist/ ./dist/
COPY docker/ ./docker/

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "docker/launch.mjs"]
