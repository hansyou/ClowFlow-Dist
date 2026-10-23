#!/usr/bin/env node
/**
 * 部署辅助（GitHub Actions / 本地通用）—— 只做校验与密钥注入，**不代建资源**：
 *   --check       校验 wrangler.toml 里 D1 / KV 的 id 已填成真实值（不是占位符）。
 *                 D1 数据库 / KV 命名空间需在 Cloudflare 控制台手动创建，id 填进 wrangler.toml；
 *   --jwt-secret  首次部署后生成并注入 JWT_SECRET（已存在则不覆盖，避免使已登录会话失效）。
 *
 * 只用 wrangler CLI + Node 内置模块，无第三方依赖。
 * 用法：node scripts/provision.mjs [--check] [--jwt-secret]
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOML = path.join(ROOT, 'wrangler.toml');

const PLACEHOLDER_D1 = '00000000-0000-0000-0000-000000000000';
const PLACEHOLDER_KV = '00000000000000000000000000000000';

const log = (msg) => console.log(`[provision] ${msg}`);
const fail = (msg) => {
  console.error(`[provision] ${msg}`);
  process.exit(1);
};

const wrangler = (argv, opts = {}) => {
  const r = spawnSync('wrangler', argv, { cwd: ROOT, encoding: 'utf8', ...opts });
  if (r.status !== 0) fail(`wrangler ${argv.join(' ')} 失败：\n${r.stderr || r.stdout || ''}`);
  return r.stdout ?? '';
};

/** wrangler --json 输出在不同子命令下可能是裸数组，也可能包一层 { result/... }，统一解开 */
const unwrap = (v) => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    for (const k of ['result', 'buckets', 'namespaces', 'databases']) {
      if (Array.isArray(v[k])) return v[k];
    }
    return v.result ?? v;
  }
  return v;
};
const wranglerJson = (argv) => {
  const out = wrangler([...argv, '--json']);
  try {
    return unwrap(JSON.parse(out));
  } catch {
    return null;
  }
};

// ---------------- --check：wrangler.toml 资源 id 预检 ----------------
// 资源（D1 / KV）由用户在 Cloudflare 控制台手动创建后把 id 填进 wrangler.toml；
// 部署前先确认不是占位符，否则 wrangler deploy 会以一个「找不到资源」的报错收场，很难排查。
if (process.argv.includes('--check')) {
  const toml = fs.existsSync(TOML) ? fs.readFileSync(TOML, 'utf8') : '';
  const missing = [];
  if (!toml) missing.push('wrangler.toml 不存在（可从 wrangler.toml.default 复制一份）');
  else {
    if (toml.includes(PLACEHOLDER_D1)) missing.push('D1 database_id 还是占位符');
    if (toml.includes(PLACEHOLDER_KV)) missing.push('KV id 还是占位符');
  }
  if (missing.length) {
    fail(
      'wrangler.toml 资源 id 未就绪：' +
        missing.join('；') +
        '\n请在 Cloudflare 控制台（Workers & Pages → D1 / KV）手动创建资源，' +
        '把 id 填入 wrangler.toml 后再部署（格式参考 wrangler.toml.default）。',
    );
  }
  log('wrangler.toml 资源 id 已就绪');
  process.exit(0);
}

// ---------------- --jwt-secret：JWT_SECRET 注入（容忍失败，不影响部署） ----------------
if (process.argv.includes('--jwt-secret')) {
  let exists = false;
  try {
    const list = wranglerJson(['secret', 'list']) ?? [];
    exists = Array.isArray(list) && list.some((s) => s && s.name === 'JWT_SECRET');
    if (!exists && !Array.isArray(list)) exists = String(list).includes('JWT_SECRET');
  } catch {
    // secret list 不可用时保守跳过（JWT 会退回由管理员密码派生，仍可正常登录）
    log('无法查询 secret 列表，跳过 JWT_SECRET 注入（不影响使用）');
    process.exit(0);
  }
  if (exists) {
    log('JWT_SECRET 已存在，跳过');
    process.exit(0);
  }
  const value = crypto.randomBytes(32).toString('hex');
  const r = spawnSync('wrangler', ['secret', 'put', 'JWT_SECRET'], {
    cwd: ROOT,
    input: value,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    log(`JWT_SECRET 注入失败（不影响使用，稍后可在 Cloudflare 控制台手动添加）：\n${r.stderr || r.stdout || ''}`);
    process.exit(0);
  }
  log('JWT_SECRET 已生成并注入');
  process.exit(0);
}

log('没有指定动作：--check 校验资源 id / --jwt-secret 注入 JWT 密钥');
process.exit(1);
