# CloudFlow 部署镜像：直接运行 dist/ 编译产物（不含源码）
#   构建：docker build -t hansyou/cloudflow-dist:latest .
#   运行：docker compose up -d（见 docker-compose.yml）
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# node:22-slim 的 CA 根证书包在官方镜像构建时被 apt auto-remove 清掉了（/etc/ssl/certs 为空）。
# workerd 的 TLS 校验走系统证书库（Node 用内置证书库，所以 node 自测正常但 Worker 全挂）——
# 必须装回 ca-certificates，否则任何 HTTPS 都报
# 「TLS peer's certificate is not trusted; self signed certificate in certificate chain」
# apt 先换中科大源（保持 http：此刻还没有 CA 证书，https 源无法校验），再装证书
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --omit=dev --no-audit --no-fund --timeout=120000 \
    && npm cache clean --force

COPY dist/ ./dist/
COPY docker/ ./docker/

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "docker/launch.mjs"]
