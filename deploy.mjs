/**
 * 部署 htlb-hub 到 Cloudflare Workers + 绑定自定义域名
 * 用法: CLOUDFLARE_API_TOKEN=xxx node htlb-hub/deploy.mjs [--domain htlb.strangeyu.xyz]
 *
 * 步骤：
 *   1) PUT /accounts/{a}/workers/scripts/htlb-hub         上传 worker.js（multipart）
 *   2) POST .../scripts/htlb-hub/subdomain                开 workers.dev 子域（备用入口）
 *   3) PUT  /accounts/{a}/workers/domains                 绑定自定义域名（自动建 DNS + 证书）
 *   4) 真机 HTTP 验证
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_ID = '320630a19eed9c18dc9371dd71d6f288';
const ZONE_ID = '6cf5d7c942a6cf684d044e369fc6718f';
const SCRIPT = 'htlb-hub';
/** KV namespace: htlb-hub-data（2026-10-13 建，账号原本 0 个 KV） */
const KV_NAMESPACE_ID = '0591ded627a44e60bb4abe91256c867a';
/** 凭据查找顺序：环境变量 → 仓库内隐藏文件 → 本机历史位置 */
const pick = (envName, localName, fallback) => {
  if (process.env[envName]) return process.env[envName].trim();
  const files = [path.join(DIR, localName), fallback].filter(Boolean);
  for (const f of files) if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  return '';
};
const DOMAIN = (() => {
  const i = process.argv.indexOf('--domain');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'htlb.strangeyu.xyz';
})();

const TOKEN = pick('CLOUDFLARE_API_TOKEN', '.cf-token', 'D:/全局项目库/.workbuddy/tmp/cf-token.txt');
if (!TOKEN) throw new Error('缺少 Cloudflare token（环境变量 CLOUDFLARE_API_TOKEN，或仓库内 .cf-token 文件）');

// ⚠️ PUT script 是**全量替换**：bindings 必须每次都带全，否则已有的 KV/secret 会被抹掉
const INGEST_SECRET = pick('HTLB_INGEST_SECRET', '.ingest-secret', 'D:/全局项目库/.workbuddy/tmp/htlb-ingest-secret.txt');
if (INGEST_SECRET.length < 16) {
  throw new Error('缺少回灌密钥（≥16 字符）：设 HTLB_INGEST_SECRET，或放仓库内 .ingest-secret 文件');
}

const code = fs.readFileSync(path.join(DIR, 'deploy', 'worker.js'), 'utf8');
const H = { Authorization: 'Bearer ' + TOKEN };

async function api(method, p, body, json = true) {
  const r = await fetch(API + p, {
    method,
    headers: json ? Object.assign({ 'content-type': 'application/json' }, H) : H,
    body: json && body ? JSON.stringify(body) : body,
  });
  const text = await r.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* 非 JSON（如 worker 上传返回的是纯脚本信息） */
  }
  return { status: r.status, ok: r.ok, json: j, text };
}

function show(label, r) {
  const ok = r.ok && (!r.json || r.json.success !== false);
  console.log((ok ? '  ✅ ' : '  ❌ ') + label + '  [' + r.status + ']');
  if (!ok) console.log('     ' + r.text.slice(0, 400).replace(/\s+/g, ' '));
  else if (r.json && r.json.result && typeof r.json.result === 'object' && !Array.isArray(r.json.result)) {
    const s = JSON.stringify(r.json.result);
    if (s.length < 260) console.log('     ' + s);
  }
  return ok;
}

console.log('部署目标：' + DOMAIN + '   worker=' + SCRIPT + '   代码 ' + Buffer.byteLength(code) + ' B\n');
console.log('1) 上传 worker 脚本');

const metadata = {
  main_module: 'worker.js',
  compatibility_date: '2026-10-01',
  compatibility_flags: [],
  bindings: [
    { type: 'kv_namespace', name: 'HTLB_KV', namespace_id: KV_NAMESPACE_ID },
    { type: 'secret_text', name: 'INGEST_SECRET', text: INGEST_SECRET },
  ],
  observability: { enabled: true },
};
const fd = new FormData();
fd.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata');
fd.set('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');

const up = await api('PUT', '/accounts/' + ACCOUNT_ID + '/workers/scripts/' + SCRIPT, fd, false);
if (!show('上传 ' + SCRIPT + '.js', up)) process.exit(1);

console.log('\n2) 开启 workers.dev 备用入口');
const sub = await api('POST', '/accounts/' + ACCOUNT_ID + '/workers/scripts/' + SCRIPT + '/subdomain', {
  enabled: true,
  previews_enabled: true,
});
show('workers.dev 子域', sub);

console.log('\n3) 绑定自定义域名 ' + DOMAIN);
const dom = await api('PUT', '/accounts/' + ACCOUNT_ID + '/workers/domains', {
  zone_id: ZONE_ID,
  hostname: DOMAIN,
  service: SCRIPT,
  environment: 'production',
});
const domOk = show('自定义域名', dom);
if (!domOk) {
  console.log('  ↳ 自定义域名失败，回退到「DNS 记录 + Worker Route」方案');
  const dns = await api('POST', '/zones/' + ZONE_ID + '/dns_records', {
    type: 'AAAA',
    name: DOMAIN,
    content: '100::',
    proxied: true,
    ttl: 1,
    comment: 'htlb-hub worker route',
  });
  show('DNS 记录', dns);
  const route = await api('POST', '/zones/' + ZONE_ID + '/workers/routes', {
    pattern: DOMAIN + '/*',
    script: SCRIPT,
  });
  show('Worker Route', route);
}

console.log('\n4) 列出现有绑定');
const list = await api('GET', '/accounts/' + ACCOUNT_ID + '/workers/domains');
if (list.json && list.json.success) {
  for (const d of list.json.result) console.log('     ' + d.hostname + '  →  ' + d.service);
}

console.log('\n5) 真机验证（等 8 秒让证书签发）');
await new Promise((r) => setTimeout(r, 8000));
const targets = ['/', '/badge/howtolivebetter-net.svg', '/badge/llzx373-betterlifeapp.svg', '/api/status.json', '/api/ingest', '/health'];
for (const t of targets) {
  try {
    const r = await fetch('https://' + DOMAIN + t, { redirect: 'follow' });
    const b = await r.text();
    console.log('  ' + (r.ok ? '✅' : '❌') + ' https://' + DOMAIN + t + '  [' + r.status + ', ' + r.headers.get('content-type') + ', ' + b.length + ' B]');
    if (t === '/api/status.json' && r.ok) {
      const j = JSON.parse(b);
      console.log('     上游 ' + j.upstream.entries + ' 条（实时=' + j.upstream.entriesLive + '）｜数据源=' + j.dataSource +
        '｜追平 ' + j.stats.synced + ' / 落后 ' + j.stats.lagging + ' / 运行时 ' + j.stats.runtime + ' / 未标注 ' + j.stats.unknown +
        '（实测 ' + j.stats.measured + ' 项）');
    }
    if (t === '/api/ingest' && r.ok) {
      const j = JSON.parse(b);
      console.log('     KV 已回灌=' + j.hasKVData + '  时间=' + (j.pushedAt || '（还没被 GitHub Actions 写过）') + '  项目数=' + j.projects);
    }
    if (t.endsWith('.svg') && r.ok) console.log('     ' + b.replace(/<[^>]+>/g, '|').replace(/\|+/g, ' ').trim().slice(0, 80));
  } catch (e) {
    console.log('  ❌ https://' + DOMAIN + t + '  ' + e.message);
  }
}
