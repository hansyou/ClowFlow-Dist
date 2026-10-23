#!/usr/bin/env node
/**
 * 部署辅助（GitHub Actions / 本地通用）—— 只做校验与密钥注入，**不代建资源**：
 *   --check       校验 wrangler.toml 里 D1 / KV 的 id 已填成真实值（不是占位符）。
 *                 D1 数据库 / KV 命名空间需在 Cloudflare 控制台手动创建，id 填进 wrangler.toml；
 *   --jwt-secret  首次部署后生成并注入 JWT_SECRET（已存在则不覆盖，避免使已登录会话失效）。
 *
 * 两个动作可同时传（先 --check、后 --jwt-secret）。失败策略不同：
 *   --check       未就绪则退出码 1（拦住部署）；
 *   --jwt-secret  一律容忍失败：查不到 secret 列表 / 注入失败都只是跳过并打日志，
 *                 退出码 0，不影响部署（JWT 会退回由管理员密码派生，仍可正常登录）。
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

/** wrangler 的 JSON 输出在不同子命令下可能是裸数组，也可能包一层 { result/... }，统一解开 */
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

/**
 * 跑 wrangler 并拿 stdout；失败只返回 null（不 exit），由调用方按「查不到就跳过」保守处理。
 * Windows 下 `wrangler` 只有 .cmd 包装，spawnSync 直接找 `wrangler` 会 ENOENT，须经 shell 拉起。
 */
const wranglerTry = (argv) => {
  const r = spawnSync('wrangler', argv, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.error) {
    log(`wrangler 无法执行：${r.error.message}`);
    return null;
  }
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').trim() || `exit=${r.status}`;
    log(`wrangler ${argv.join(' ')} 失败：${detail}`);
    return null;
  }
  return r.stdout ?? '';
};

/**
 * 取 wrangler 的 JSON 输出并解开包裹。
 * JSON flag 在 wrangler 各版本 / 子命令间有漂移（4.151 起 `secret list` 只认 `--format json`，
 * 其余子命令仍是 `--json`），故按 flagSets 顺序逐套尝试；**全部失败返回 null、不做任何猜测**
 * ——宁可跳过注入，也绝不把「查不到」当成「不存在」去覆盖已有的 JWT_SECRET。
 */
const wranglerJson = (argv, flagSets) => {
  for (const flags of flagSets) {
    const args = [...argv, ...flags];
    const out = wranglerTry(args);
    if (out === null) continue;
    try {
      return unwrap(JSON.parse(out));
    } catch {
      log(`wrangler ${args.join(' ')} 输出不是 JSON，换下一组参数重试`);
    }
  }
  return null;
};

const runCheck = process.argv.includes('--check');
const runJwt = process.argv.includes('--jwt-secret');
if (!runCheck && !runJwt) {
  log('没有指定动作：--check 校验资源 id / --jwt-secret 注入 JWT 密钥（可同时传）');
  process.exit(1);
}

// ---------------- --check：wrangler.toml 资源 id 预检 ----------------
// 资源（D1 / KV）由用户在 Cloudflare 控制台手动创建后把 id 填进 wrangler.toml；
// 部署前先确认不是占位符，否则 wrangler deploy 会以一个「找不到资源」的报错收场，很难排查。
if (runCheck) {
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
  // 不在这里 exit：--jwt-secret 与 --check 可同一次执行
}

// ---------------- --jwt-secret：JWT_SECRET 注入（容忍失败，不影响部署） ----------------
if (runJwt) {
  // wrangler 4.151 起 `secret list` 只认 `--format json`（默认即 json）；旧版只认 `--json`
  const list = wranglerJson(['secret', 'list'], [['--format', 'json'], ['--json']]);
  if (list === null) {
    // 查不到 / 解析失败一律保守跳过：宁可不注入，也绝不覆盖已存在的 JWT_SECRET（会使已登录会话失效）
    log('无法查询 secret 列表，跳过 JWT_SECRET 注入（不影响使用，可在 Cloudflare 控制台手动添加）');
    process.exit(0);
  }
  const exists = Array.isArray(list)
    ? list.some((s) => s && s.name === 'JWT_SECRET')
    : String(list).includes('JWT_SECRET');
  if (exists) {
    log('JWT_SECRET 已存在，跳过');
    process.exit(0);
  }
  const value = crypto.randomBytes(32).toString('hex');
  // secret put 非交互态走 readFromStdin() + trim 尾部空白：这里直接写值即可，不必补换行
  const r = spawnSync('wrangler', ['secret', 'put', 'JWT_SECRET'], {
    cwd: ROOT,
    input: value,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    log(`JWT_SECRET 注入失败（不影响使用，稍后可在 Cloudflare 控制台手动添加）：\n${r.stderr || r.stdout || ''}`);
    process.exit(0);
  }
  log('JWT_SECRET 已生成并注入');
  process.exit(0);
}

process.exit(0);
