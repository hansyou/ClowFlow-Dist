#!/usr/bin/env node
/**
 * CloudFlow Docker 运行器（纯运行胶水，无业务逻辑）。
 *
 * 用 miniflare(workerd) 直接加载 dist/worker.js —— 与 Cloudflare 线上完全同一份产物：
 *   - D1 / R2 / KV 持久化到 /data（容器卷），重启不丢数据；
 *   - 每 5 分钟向 Miniflare 保留路由发一次调度心跳，触发产物自带的 scheduled 入口，
 *     与 Cloudflare Cron Triggers 的每 5 分钟心跳行为一致；
 *     （对应 wrangler.toml 的 crons：斜杠 5 星号，即每 5 分钟）
 *     是否真正执行扫描仍由设置页的 cron 表达式决定。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, CorePaths } from 'miniflare';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const PERSIST = process.env.PERSIST_DIR || '/data';
const CRON_MS = Math.max(60_000, Number(process.env.CRON_INTERVAL_MS || 5 * 60 * 1000));

// 运行期变量：与 wrangler.toml [vars] 一一对应。
// Cloudflare 部署由 wrangler 注入，这里必须显式传给 Miniflare，
// 否则 Worker 读到 undefined 会在拼接口 URL 时崩（如 115 令牌校验报
// 「Cannot read properties of undefined (reading 'replace')」）。
// 同名环境变量可覆盖，便于自定义接口源。
const VARS = {
  TMDB_API_BASE: process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3',
  TMDB_IMAGE_BASE: process.env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p',
  OPEN115_API_BASE: process.env.OPEN115_API_BASE || 'https://proapi.115.com',
  OPEN115_PASSPORT_BASE: process.env.OPEN115_PASSPORT_BASE || 'https://passportapi.115.com',
  OPEN115_QRCODE_BASE: process.env.OPEN115_QRCODE_BASE || 'https://qrcodeapi.115.com',
  OPLIST_API_BASE: process.env.OPLIST_API_BASE || 'https://api.oplist.org',
};

const mf = new Miniflare({
  scriptPath: path.join(APP, 'dist', 'worker.js'),
  modules: true,
  // 日期须 ≤ 所固定 miniflare 内置 workerd 支持的最新日期（miniflare 4.20260730.0 → 2026-08-06），
  // 全仓统一同一天（云端支持旧日期永久有效）；升级 miniflare 后可整体上调
  compatibilityDate: '2026-08-06',
  compatibilityFlags: ['nodejs_compat'],
  // 与 wrangler.toml [vars] 对应的接口地址变量（缺了会让 115 / TMDB 调用崩掉）；
  // wrangler 叫 [vars]，Miniflare 里以普通 bindings 传入
  bindings: VARS,
  // 绑定与 wrangler.toml 一一对应（DB / IMAGES / CACHE），持久化统一放 PERSIST
  d1Databases: { DB: 'cloudflow-d1' },
  d1Persist: PERSIST,
  r2Buckets: ['IMAGES'],
  r2Persist: PERSIST,
  kvNamespaces: ['CACHE'],
  kvPersist: PERSIST,
  cachePersist: PERSIST,
  durableObjectsPersist: PERSIST,
  assets: {
    directory: path.join(APP, 'dist', 'web'),
    binding: 'ASSETS',
    assetConfig: {
      not_found_handling: 'single-page-application',
      compatibility_date: '2026-08-06',
      compatibility_flags: ['nodejs_compat'],
    },
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true, // run_worker_first = true
    },
  },
  host: '0.0.0.0',
  port: PORT,
});

await mf.ready;
console.log(`[cloudflow] 已启动：http://0.0.0.0:${PORT}（数据目录 ${PERSIST}）`);

// ---- 调度心跳：打 Miniflare 保留路由，触发 Worker 的 scheduled 入口 ----
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${CorePaths.SCHEDULED}`);
    if (!res.ok) console.error(`[cloudflow] 调度心跳返回 ${res.status}`);
  } catch (e) {
    console.error('[cloudflow] 调度心跳失败：', e?.message ?? e);
  } finally {
    ticking = false;
  }
}
const timer = setInterval(tick, CRON_MS);
setTimeout(tick, 5_000); // 启动 5 秒后先补一次心跳

// ---- 优雅退出 ----
async function shutdown(signal) {
  console.log(`[cloudflow] 收到 ${signal}，正在退出 …`);
  clearInterval(timer);
  try {
    await mf.dispose();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
