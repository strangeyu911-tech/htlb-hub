/**
 * 本地自检：把 worker 当普通模块 import 进来，起一个临时端口，用真实 HTTP 请求验一遍。
 * 单进程、用完即 close + exit —— 不留任何后台服务或孤儿子进程。
 * 用法: node htlb-hub/selftest.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './deploy/worker.js';

// ⚠️ 期望的项目数一律从数据文件读，别写死 —— 上游 衍生项目.md 加一项就假失败一次
const DIR = path.dirname(fileURLToPath(import.meta.url));
const N = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'projects.json'), 'utf8')).projects.length;

// 假的 KV + 回灌密钥：让 ingest 这条链路能在本地被真正跑通
const KVSTORE = new Map();
const ENV = {
  HTLB_KV: {
    async get(k, type) {
      const v = KVSTORE.get(k);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) {
      KVSTORE.set(k, v);
    },
  },
  INGEST_SECRET: 'selftest-secret-0123456789abcdef',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || '127.0.0.1'));
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const rq = new Request(url.toString(), {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const rs = await worker.fetch(rq, ENV, { waitUntil() {} });
    res.statusCode = rs.status;
    rs.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await rs.arrayBuffer()));
  } catch (e) {
    res.statusCode = 500;
    res.end('selftest-server-error: ' + e.message);
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port;
console.log('临时服务器 ' + base + '\n');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log('  ✅ ' + name + (extra ? '  ' + extra : ''));
  } else {
    fail++;
    console.log('  ❌ ' + name + (extra ? '  ' + extra : ''));
  }
};

// 1) 首页
{
  const r = await fetch(base + '/');
  const t = await r.text();
  check('GET / → 200', r.status === 200, 'status=' + r.status);
  check('首页含标题', /高性价比人生指南/.test(t));
  check(`首页含 ${N} 个项目卡片`, (t.match(/<article class="card"/g) || []).length === N, '实际 ' + (t.match(/<article class="card"/g) || []).length);
  check('首页无占位符残留', !/undefined|NaN|\[object Object\]/.test(t));
}

// 2) 动态 badge
{
  const r = await fetch(base + '/badge/howtolivebetter-net.svg');
  const t = await r.text();
  check('GET /badge/howtolivebetter-net.svg → 200', r.status === 200, 'status=' + r.status);
  check('内容类型是 SVG', /svg/.test(r.headers.get('content-type') || ''), r.headers.get('content-type'));
  check('是合法 SVG', t.startsWith('<svg') && t.includes('</svg>'));
  check('带长缓存头', /max-age=\d+/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
  console.log('     内容: ' + t.replace(/<[^>]+>/g, '|').replace(/\|+/g, ' ').trim().slice(0, 90));
}
{
  const r = await fetch(base + '/badge/llzx373-betterlifeapp.svg');
  const t = await r.text();
  check('落后项目的 badge 显示「落后」', /落后/.test(t));
}
{
  const r = await fetch(base + '/badge/not-a-real-project.svg');
  check('未知 slug → 404', r.status === 404, 'status=' + r.status);
}
{
  const r = await fetch(base + '/badge/');
  const t = await r.text();
  check(`GET /badge/ → 200 且有 ${N} 个 img`, r.status === 200 && (t.match(/<img /g) || []).length === N);
}

// 3) API
{
  const r = await fetch(base + '/api/status.json');
  const j = await r.json();
  check('GET /api/status.json → 200', r.status === 200);
  check('CORS 头存在', r.headers.get('access-control-allow-origin') === '*');
  check(`projects 数 = ${N}`, j.projects.length === N, '实际 ' + j.projects.length);
  check('含 upstream.entries', Number.isFinite(j.upstream.entries), 'entries=' + j.upstream.entries);
  check('实时取值标记', j.upstream.entriesLive === true || j.upstream.entriesLive === false, 'entriesLive=' + j.upstream.entriesLive);
  const lag = j.projects.filter((p) => p.status === 'lag').length;
  const sync = j.projects.filter((p) => p.status === 'sync').length;
  const unk = j.projects.filter((p) => p.status === 'unknown').length;
  console.log('     上游 ' + j.upstream.entries + ' 条（实时=' + j.upstream.entriesLive + '）｜追平 ' + sync + ' / 落后 ' + lag + ' / 未标注 ' + unk);
  console.log('     badge 字段样例: ' + j.projects[0].badge);
}
{
  const r = await fetch(base + '/health');
  const j = await r.json();
  check('GET /health → ok', r.status === 200 && j.ok === true, JSON.stringify(j));
}

// 4) 其他
{
  const r = await fetch(base + '/nope');
  check('未知路径 → 404', r.status === 404, 'status=' + r.status);
}
{
  const r = await fetch(base + '/', { method: 'POST' });
  check('POST / → 405', r.status === 405, 'status=' + r.status);
}

// 5) 回灌端点（GitHub Actions 每天走的就是这条）
{
  const r = await fetch(base + '/api/ingest');
  const j = await r.json();
  check('GET /api/ingest → 200', r.status === 200, 'status=' + r.status);
  check('初始 KV 为空', j.hasKVData === false, 'hasKVData=' + j.hasKVData);
}
{
  const r = await fetch(base + '/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projects: [{ slug: 'x' }] }),
  });
  check('POST /api/ingest 不带 secret → 401', r.status === 401, 'status=' + r.status);
}
{
  const r = await fetch(base + '/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-secret': 'wrong-secret-0123456789' },
    body: JSON.stringify({ projects: [{ slug: 'x' }] }),
  });
  check('POST /api/ingest 错误 secret → 401', r.status === 401, 'status=' + r.status);
}
{
  const payload = JSON.parse(fs.readFileSync(new URL('./data/projects.json', import.meta.url), 'utf8'));
  const r = await fetch(base + '/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-secret': ENV.INGEST_SECRET },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  check('POST /api/ingest 正确 secret → 200', r.status === 200 && j.ok === true, JSON.stringify(j).slice(0, 140));
}
{
  const r = await fetch(base + '/api/status.json');
  const j = await r.json();
  check('回灌后数据源切到 kv', j.dataSource === 'kv', 'dataSource=' + j.dataSource);
  check(`回灌后仍 ${N} 个项目`, j.projects.length === N, '实际 ' + j.projects.length);
  check('回灌带上 lastCrawlAt', !!j.lastCrawlAt, 'lastCrawlAt=' + j.lastCrawlAt);
  const rt = j.projects.filter((p) => p.status === 'runtime').length;
  check('运行时项目被单独归类', rt >= 1, 'runtime=' + rt);
  const fx = j.projects.filter((p) => p.status === 'fixed').length;
  check('固定快照项目被单独归类（不被算作落后）', fx >= 1, 'fixed=' + fx);
  check('未知 slug 不会出现在 /api/status.json 里', j.projects.every((p) => p.slug && p.name));
}
{
  // 徽章文案：固定快照 / 运行时 / 未标注 三种都必须与「落后」区分开
  const r1 = await fetch(base + '/badge/robineo2045-comics.svg');
  const t1 = await r1.text();
  check('固定快照 badge 文案', /固定快照/.test(t1), t1.replace(/<[^>]+>/g, '|').replace(/\|+/g, ' ').trim().slice(0, 60));
  const r2 = await fetch(base + '/badge/mittsommer-daily-life-tip.svg');
  const t2 = await r2.text();
  check('运行时 badge 文案', /运行时跟随上游/.test(t2), t2.replace(/<[^>]+>/g, '|').replace(/\|+/g, ' ').trim().slice(0, 60));
}

await new Promise((r) => server.close(r));
console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail === 0 ? 0 : 1);
