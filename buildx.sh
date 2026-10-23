#!/usr/bin/env bash
set -euo pipefail

# ========== 配置区 ==========
IMAGE_NAME="hansyou/cloudflow-dist"
TAG="latest"
PLATFORMS="linux/amd64,linux/arm64"
BUILDX_BUILDER_NAME="multi-builder"
# 代理地址：buildkitd（拉取/推送镜像）与 buildx CLI（获取 Docker Hub token）都走它
PROXY_URL="http://10.0.0.1:7890"
NO_PROXY_LIST="localhost,127.0.0.1"
# ============================

echo "=== 开始构建多架构镜像 ${IMAGE_NAME}:${TAG} ==="

# buildx 客户端侧（Docker Hub token 握手等）也走代理
export HTTP_PROXY="${PROXY_URL}"
export HTTPS_PROXY="${PROXY_URL}"
export NO_PROXY="${NO_PROXY_LIST}"

# 1. 创建带代理 env 的 buildx builder（buildkitd 进程需要代理才能访问 Docker Hub）
if ! docker buildx inspect "${BUILDX_BUILDER_NAME}" >/dev/null 2>&1; then
    echo "创建 buildx builder: ${BUILDX_BUILDER_NAME}（代理 ${PROXY_URL}）"
    # 注意：--driver-opt 按逗号拆分值，no_proxy 含逗号无法传入，此处无需它
    docker buildx create --name "${BUILDX_BUILDER_NAME}" --driver docker-container \
        --driver-opt "env.http_proxy=${PROXY_URL}" \
        --driver-opt "env.https_proxy=${PROXY_URL}"
fi

docker buildx use "${BUILDX_BUILDER_NAME}"
docker buildx inspect --bootstrap >/dev/null

# 2. 注册多架构用户态模拟（binfmt）
#    注意：binfmt 条目保存在 binfmt_misc 挂载中——重启后宿主机通常没有挂载它，
#    此时注册会随 tonistiigi 容器退出而失效。所以先挂载 binfmt_misc 再注册。
if [ ! -e /proc/sys/fs/binfmt_misc/register ]; then
    echo "挂载 binfmt_misc（重启后条目会丢失，脚本每次运行会自动重新挂载/注册）"
    mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
fi

# 用官方 tonistiigi/binfmt 镜像注册，自动处理魔数/掩码/标志位，不手写注册串
# （首次运行需拉取该镜像，由 docker daemon 侧自行走代理或直连）
echo "注册 binfmt 模拟器（tonistiigi/binfmt）"
docker run --privileged --rm tonistiigi/binfmt --install all

# 校验 arm64 模拟已注册（条目名为 qemu-aarch64）
if [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    echo "❌ arm64 binfmt 注册失败，请检查 /proc/sys/fs/binfmt_misc" >&2
    exit 1
fi

# 3. 构建并推送（npm 安装走 npmmirror 直连，无需代理 build-arg）
docker buildx build \
    --platform "${PLATFORMS}" \
    -t "${IMAGE_NAME}:${TAG}" \
    --push \
    .

echo "✅ 构建推送完成: ${IMAGE_NAME}:${TAG}"
