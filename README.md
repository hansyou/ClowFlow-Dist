# CloudFlow（部署仓库）

CloudFlow 是一个**自部署的媒体库刮削中心**：接入网盘（115 网盘 / WebDAV 等）扫描视频文件，
自动匹配 TMDB 元数据、海报与剧集信息，并以 **Jellyfin 兼容接口**对接常见第三方播放器。

- 运行在 **Cloudflare Workers 免费套餐**即可（D1 / R2 / KV / 定时任务都用免费额度）
- **不提供视频播放、不做转码**，视频流量不经过 Cloudflare，只做元数据刮削
- 本仓库只包含**编译产物**（不含源码），使用限制见 [LICENSE](./LICENSE)

版本：v0.5.0

## 一、部署（GitHub Actions，推荐）

1. **Fork** 本仓库到你自己的 GitHub 账户。
2. 在 Cloudflare 控制台**手动创建两个资源**（名字随意，记下 id）：
   - **D1 数据库**：Workers & Pages → **D1** → **Create**，命名建议 `cloudflow-d1`；
   - **KV 命名空间**：Workers & Pages → **KV** → **Create**，命名建议 `cloudflow-kv`。

   > R2 存储桶**无需手动创建**，部署时会自动创建。
3. 在 fork 后的仓库里把 **`wrangler.toml.default` 复制为 `wrangler.toml`**（已有就直接改），
   填入上一步的两个 id 并提交到 master / main：
   - `[[d1_databases]]` 的 `database_id` = D1 的 **UUID**；
   - `[[kv_namespaces]]` 的 `id` = KV 的 **id**。
4. 在 Cloudflare 创建 API Token：
   - 头像 → **My Profile** → **API Tokens** → **Create Token** → 使用模板 **Edit Cloudflare Workers**；
   - 再手动追加权限：**Account → D1: Edit**、**Account → Workers KV Storage: Edit**、
     **Account → R2 Storage: Edit**（Region 选 All）；
   - 记下生成的 **Token**；Account ID 在 Workers & Pages 首页右侧可见。
5. 在 fork 后的仓库里配置 Secrets：
   **Settings → Secrets and variables → Actions → New repository secret**：
   | Name | 值 |
   |------|----|
   | `CLOUDFLARE_API_TOKEN` | 上一步的 API Token |
   | `CLOUDFLARE_ACCOUNT_ID` | 你的 Account ID |
6. 打开 **Actions** 页 → **Deploy to Cloudflare** → **Run workflow**。
   会先校验 wrangler.toml 里的资源 id → 部署 → 生成并注入 JWT 密钥，约 1 分钟。
7. 完成后在 Cloudflare 的 **Workers & Pages** 里打开 `*.workers.dev` 地址即可使用。
   （想绑自定义域名：Workers & Pages → 你的 Worker → Settings → Domains & Routes。）

> 以后本仓库更新时，在你的 fork 点 **Sync fork**（或拉取后 push 到 master）即会自动重新部署。
> 资源 id 填好后无需再动；换 Cloudflare 账号或重新建库时记得同步更新 `wrangler.toml`。

## 二、部署后必做的两件事

1. **设置管理员密码**：首次打开页面会要求设置密码。
2. **设置页补全配置**：
   - **TMDB API Key**（https://www.themoviedb.org/settings/api 申请）；
   - **115 网盘令牌**：在 https://api.oplist.org/ 完成「115 网盘 · 验证登录」并勾选
     「使用 OpenList 提供的参数」，把访问/刷新令牌粘贴到 CloudFlow 设置页；
   - **WebDAV 网盘**（可选）：按设置页指引添加。
   - 其余（刮削语言、定时扫描计划等）默认即可。

之后在网盘页浏览目录 → 添加到媒体库 → 扫描入库 → 刮削，即可在任意 Jellyfin 兼容客户端
（如网易爆米花、VidHub 等）里填 `http://你的域名/jellyfin` 使用。

## 三、本地/命令行部署（可选）

```bash
corepack enable            # Node ≥ 20 自带 pnpm
pnpm install               # 安装 wrangler（devDependencies，不影响 Docker 镜像）

pnpm exec wrangler login   # 或 export CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID

# 1) 手动创建资源（Cloudflare 控制台或 CLI 二选一，R2 无需创建）
pnpm d1:create
pnpm kv:create
#    把输出的 database_id / KV id 填入 wrangler.toml（从 wrangler.toml.default 复制起步）

# 2) 部署
pnpm provision:check       # 确认 wrangler.toml 里的资源 id 已填
pnpm deploy
pnpm provision:jwt         # 注入 JWT 密钥（可选）
```

## 四、Docker 部署（可选）

镜像内是与 Cloudflare 版**完全相同的编译产物**，运行在本地 workerd 上，行为一致
（含每 5 分钟一次的调度心跳；是否真正扫描由设置页 cron 表达式决定）。

```bash
docker compose up -d        # 拉取镜像并启动（首次）
# 打开 http://[ip]:8787
docker compose logs -f      # 查看日志
docker compose down         # 停止（数据保留在 ./data）
```

- **镜像**：Docker Hub `hansyou/cloudflow-dist:latest`，`docker-compose.yml` 直接引用它。
- **数据**：D1 / R2 / KV 全部持久化在宿主机 `./data`（容器内 `/data`），备份该目录即备份全部数据。
- **端口**：默认 `8787`，改 `docker-compose.yml` 的 `ports` 即可。
- **更新**：`docker compose pull && docker compose up -d`，数据不受影响。
- **本地构建自己的镜像**（可选）：在仓库根目录

  ```bash
  docker build -t cloudflow-dist:latest .
  # 把 docker-compose.yml 的 image 换成 cloudflow-dist:latest 后
  docker compose up -d
  ```

## 五、费用

全部使用 Cloudflare 免费额度即可（100 部电影 + 2000 集量级实测占用 < 10%）。
CloudFlow 本身不产生视频流量：不提供播放、不转码、不下载视频文件。

## 六、常见问题

- **Actions 部署失败，提示 wrangler.toml 资源 id 未就绪**：D1 / KV 还没创建或 id 没填 ——
  按「一、部署」第 2–3 步在 Cloudflare 控制台手动创建资源，把 id 填进 `wrangler.toml` 后重新运行。
- **部署时报 403 / 权限不足**：检查 API Token 是否包含 D1 / KV / R2 的 Edit 权限。
- **页面打不开 / 一直转圈**：看 Actions 日志是否有 `wrangler deploy` 失败；再到
  Workers & Pages → 你的 Worker → Logs 查看实时日志。
- **无法播放**：CloudFlow 只负责刮削与元数据，播放走网盘直链，由第三方播放器完成；
  请确认网盘令牌有效、播放器已正确填写 `/jellyfin` 地址。
