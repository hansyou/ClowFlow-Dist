# CloudFlow（部署仓库）

CloudFlow 是一个**自部署的媒体库刮削中心**：接入网盘（115 网盘 / WebDAV 等）扫描视频文件，
自动匹配 TMDB 元数据、海报与剧集信息，并以 **Jellyfin 兼容接口**对接常见第三方播放器
（网易爆米花 / VidHub / Infuse 等）—— 播放时由 CloudFlow 把请求重定向到**网盘直链**，
视频流量**不经过服务端**。

- 后端运行在 **workerd**（与 Cloudflare Workers 同一运行时），支持 **Cloudflare Workers** 与 **Docker** 两种部署，同一份编译产物；Cloudflare 部署用免费套餐即可（D1 / R2 / KV / 定时任务都用免费额度）
- **不提供视频播放、不做转码**，视频流量**不经过服务端**，只做元数据刮削
- 本仓库只包含**编译产物**（不含源码），使用限制见 [LICENSE](./LICENSE)

版本：v0.7.0

## 核心特性

- **媒体库**：电影 / 电视剧 / 混合内容 三种类型，可自由创建多个（默认「电影」「电视剧」），首页按媒体库展示
- **多账号管理**：支持**多网盘账号**管理，各账号的目录可添加到同一个媒体库，增量扫描
- **115 网盘**：由于 115 网盘暂停了开发者账户申请，暂时借用 OpenList 令牌登录，无需申请开发者应用
- **光鸭云盘**（开发中）
- **WebDAV 网盘**：一个 WebDAV 地址 = 一个「账号」（可加多个），用户名/密码认证；
  浏览 → 加库 → 扫描入库与 115 一致，STRM 直链直接指向文件；可配**自定义直链源**
  （内网地址替换出链），公网部署也能内网直连播放，管理内网媒体库
- **TMDB 刮削**：自动识别（中英文命名）+ **一键自动匹配（自动跑到底：多路并行、失败自动重试、列表实时刷新，刷新页面也能接管续刮，识别不了的留手动）** + **清除未识别列表**（确认后一键清空待办，网盘文件不动，重新扫描可恢复） + 手动匹配 + **按文件夹批量指定** + **手动重新匹配（刮错可纠正，电影/剧集可跨界改绑）**/重置，媒体库还能**一键刮削全部目录**，页头**「刷新全部」**按库顺序刷完所有媒体库（**刷完一个库等 5 秒再刷下一个**，防风控）；**限流模式开关**（Cloudflare 安全档防风控 / 自部署全速档；TMDB 请求两种模式下都全局限速 30 次/秒，避免触发官方限流），
  元数据、海报、**演员头像**本地化存储
- **海报墙**：深色液态玻璃界面，海报墙 / 详情页 / 元数据编辑 / 刮削工作台，**滑到底自动加载下一页**（也保留「加载更多」按钮手动兜底）；媒体库有**合成封面**（3 部剧海报拼一张，无封面时扫描后自动生成）
- **数据维护**：每日自动清理垃圾数据（**孤儿图片**（改绑/删条目残留的海报等）/ 超期刮削留痕 / 孤儿观看记录 / 超期软删文件行），设置页可开关、调保留天数、一键「立即清理」并查看清理报告；删除条目自动连图片与记录一起收尾
- **蓝光原盘**：扫描到含 `BDMV` 子文件夹的目录时，整个文件夹**当成一个文件**入库（不再扫出一堆 m2ts），刮削与播放和普通视频完全一致，直链指向 **BDMV/STREAM 下体积最大的 m2ts**（即正片），播放器直接播正片；原盘合集（多张子盘）一盘一条目，子盘名无意义时按「合集名 + 序号」识别，留手动匹配防刮错
- **进度管理**：导航「媒体库 ▾ → 进度管理」，对播放进度 / 观看记录**增删查改**：搜索筛选、
  进度编辑（播放位置 / 已看完 / 播放次数 / 最后播放时间），新增走**「作品 → 季/集」两级选择**
  （剧集按集记进度，选集时显示已有进度），可清理条目已删的失效记录
- **失效条目清理**：网盘里删掉文件后，条目会变成只剩海报的空壳；「媒体库管理」页的**「失效条目」**面板列出它们，可单删或**一键清理**（连海报 / 剧照图片一起删）
- **Jellyfin 兼容**：第三方播放器登录浏览、**302 直链播放**（视频流量不经服务端）
- **115 官方目录树更新（防风控）**：115 库更新走官方「导出目录树」任务（服务端生成目录树文本，官方功能零风控），程序解析文本入库 —— 每次更新仅约十几次网盘请求，不再逐目录遍历；新文件首次播放时按路径解析文件标识并缓存
- **定时扫描**：cron 表达式（默认每天 7–23 点每 4 小时）

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

## 二、本地/命令行部署（可选）

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

## 三、Docker 部署（可选）

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
- **接口地址变量**：115 / TMDB / OpenList 接口地址已内置默认值（与 Cloudflare 版一致），无需配置；如需自定义，在 `docker-compose.yml` 加同名环境变量覆盖（`OPEN115_API_BASE` / `OPEN115_PASSPORT_BASE` / `OPEN115_QRCODE_BASE` / `OPLIST_API_BASE` / `TMDB_API_BASE` / `TMDB_IMAGE_BASE`）。
- **更新**：`docker compose pull && docker compose up -d`，数据不受影响。
- **本地构建自己的镜像**（可选）：在仓库根目录

  ```bash
  docker build -t cloudflow-dist:latest .
  # 把 docker-compose.yml 的 image 换成 cloudflow-dist:latest 后
  docker compose up -d
  ```

## 四、使用方法

### 环境要求

| 项目         | 说明                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| TMDB API Key | https://www.themoviedb.org/settings/api 申请                                                                                        |
| 115 访问令牌 | 打开 https://api.oplist.org/ →「115 网盘 · 验证登录」→ 勾选「使用 OpenList 提供的参数」→ 获取 Token，复制**访问令牌**与**刷新令牌** |

### 首次上手

打开 CloudFlow 页面（`*.workers.dev` 地址、自定义域名或 `http://[ip]:8787`）：

1. **首次登录**：输入任意密码即设为管理员密码（忘记密码见下）
2. **设置页**：填写 TMDB API Key；按需调整定时扫描 cron
3. **115 网盘页**：粘贴访问令牌 / 刷新令牌 → 连接
   > 令牌失效（自动续期失败、或手动断开连接）后，在 115 网盘页点**「更换令牌」**（已断开状态显示**「重新连接」**）
   > 粘贴新的访问令牌 / 刷新令牌即可原地恢复，扫描目录与媒体库数据全部保留
4. **媒体库页**：确认/新建媒体库（电影 / 电视剧 / 混合内容）
5. **网盘页**：浏览目录，选择目标媒体库 →「添加当前目录到媒体库」→ 立即更新（115 = 官方目录树导入，网盘根可能生成一个目录树 txt，属正常）
6. **WebDAV 网盘页（可选）**：添加 WebDAV 地址，浏览目录 →「添加当前目录到媒体库」→ 立即扫描；可配置「自定义直链源」
7. **刮削工作台**：自动或手动匹配未识别的文件（待处理列表最多显示 2000 条，超出按路径顺序截断，处理完刷新会出现更多）；不想处理的文件可点「清除未识别列表」一键清空（网盘文件不动，重新扫描可恢复）

### 连接 Jellyfin 客户端（网易爆米花 / VidHub / Infuse 等）

添加 **Jellyfin** 类型服务器，地址填：

```
http://<主机>:8787/jellyfin     # 或 https://<你的域名>/jellyfin
```

> 注意要带 `/jellyfin` 后缀 —— 接口统一挂在这个前缀下，`/` 始终是管理网页。
> 这是 Jellyfin 官方支持的子路径部署方式（`BaseUrl`）

账号 `admin` + 管理员密码。支持浏览海报墙、季/集导航、观看进度同步；
播放时自动跳转网盘直链（需要播放器支持 302 跟随）。

> 按 Jellyfin 官方规范，**海报/剧照和视频流是匿名接口**（播放器的图片加载器带不了令牌），
> 元数据接口仍要求登录。

### 忘记管理员密码

```
npx wrangler d1 execute cloudflow-d1 --local --command "DELETE FROM settings WHERE key='admin_password'"
```

线上部署加 `--remote`（需 Cloudflare 凭据），下次登录会重新设置。

## 五、费用

Cloudflare 部署全部使用免费额度即可（100 部电影 + 2000 集量级实测占用 < 10%）；Docker 自部署跑在自己的机器上，无云服务费用。
CloudFlow 本身不产生视频流量：不提供播放、不转码、不下载视频文件。

## 六、常见问题

| 问题                     | 处理                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 海报墙没有内容           | 先在「网盘」连接网盘、把目录添加到媒体库并扫描；未识别的文件到「刮削」页匹配                                                                     |
| 115 令牌失效 / 连不上    | access_token 偶发失效**会自动强刷令牌重试**（浏览/扫描/播放都自愈），无需手动处理；只有 refresh_token 也失效（续期报错）才需要点「更换令牌」（已断开状态显示「重新连接」），到 api.oplist.org 重新获取令牌粘贴恢复 |
| 添加 115 报「令牌无效或已过期：Cannot read properties of undefined (reading 'replace')」 | 令牌没问题，是旧版 Docker 镜像缺接口地址变量 —— `docker compose pull && docker compose up -d` 更新到最新镜像即可 |
| 添加 115 报「internal error; reference = …」（日志伴 `TLS peer's certificate is not trusted`） | 令牌没问题，是旧版 Docker 镜像缺 CA 根证书（workerd 的 TLS 校验走系统证书库）—— `docker compose pull && docker compose up -d` 更新到最新镜像；如仍出现再查服务器 DNS / 网络 |
| 刮削结果不对（绑错条目） | 详情页点「手动刮削」，搜索正确的电影 / 剧集重新匹配（已锁定字段不覆盖，文件绑定不变）；**类型刮错（剧集刮成电影）也能改**：弹窗里把「匹配为」切到剧集即可跨界改绑（自动重建季集并对齐集号）；**同一库里绑重的条目**（两件是同一部）选中已有条目时可一键「并入」——文件搬进已有条目、删除当前条目 |
| 想在多个媒体库放同一部片   | 支持：每个媒体库是独立条目（同一媒体库内才不允许重复绑定同一 TMDB）                                                                              |
| 刮削速度慢               | 设置页「刮削 → 限流模式」：部署在 Cloudflare 建议保持开启（防风控/操作预算打爆）；**Docker 自部署可关闭**，解除分片限流并多路并行，速度可提升数倍      |
| 播放器连不上服务器       | 地址要带 `/jellyfin` 后缀；再看部署平台日志里的 `[jellyfin]` 请求记录（Cloudflare Workers Logs / `docker compose logs`，未实现接口会有告警）      |
| 播放器报「无法播放」     | 看日志是否有 `[jellyfin] GET /Videos/.../stream`，应返回 302 并带 `Location: https://115-...`；网盘令牌失效也会导致换链失败                      |
| 磁盘占用                 | 图片约 200 MB / 万集（存 R2，不占服务器磁盘）                                                                                                   |
| 云端删了文件，海报墙上还残留 | 更新媒体库后会标记文件丢失；到「媒体库管理」页的**「失效条目」**一键清理（连海报 / 剧照图片一起删）                                               |
| 更新提示「未找到目录树输出文件」 | 115 导出任务生成可能有延迟，稍后重试；仍失败可在 115 客户端对目标文件夹手动「生成文件目录树」（输出 txt 落在网盘根）后再更新 |
| 更新时报「自动导出不可用 / 请重新登录」 | 115 的目录树自动导出接口不接受令牌鉴权（浏览/播放不受影响）—— 在 115 客户端对目标文件夹**手动「生成文件目录树」**（输出 txt 落在网盘根）后再点「立即更新」，程序自动导入 |
| Actions 部署失败，提示 wrangler.toml 资源 id 未就绪 | D1 / KV 还没创建或 id 没填 —— 按「一、部署」第 2–3 步在 Cloudflare 控制台手动创建资源，把 id 填进 `wrangler.toml` 后重新运行    |
| 部署时报 403 / 权限不足  | 检查 API Token 是否包含 D1 / KV / R2 的 Edit 权限                                                                                               |
| 页面打不开 / 一直转圈    | 看 Actions 日志是否有 `wrangler deploy` 失败；再到 Workers & Pages → 你的 Worker → Logs 查看实时日志                                            |
