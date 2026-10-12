/**
 * GitHub 墙内稳定性实测 —— 验证「唯一的聚合点是 GitHub，而 GitHub 不稳」这个立项前提
 * 用法: node htlb-hub/probe-github.mjs
 * 输出: htlb-hub/data/github-probe.json
 */
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'data', 'github-probe.json');
const SAMPLES = 5;

function req(url, { timeout = 15000, method = 'GET' } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false;
    const finish = (o) => {
      if (!done) {
        done = true;
        resolve({ ...o, ms: Date.now() - t0 });
      }
    };
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return finish({ ok: false, err: 'bad-url' });
    }
    const mod = parsed.protocol === 'http:' ? http : https;
    const r = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
          accept: '*/*',
          'accept-language': 'zh-CN,zh;q=0.9',
        },
        timeout,
      },
      (res) => {
        const ip = res.socket?.remoteAddress || '';
        let n = 0;
        res.on('data', (c) => {
          n += c.length;
          if (n > 200 * 1024) res.destroy();
        });
        res.on('close', () => finish({ ok: true, status: res.statusCode, ip, bytes: n }));
      }
    );
    r.on('timeout', () => {
      r.destroy();
      finish({ ok: false, err: 'timeout' });
    });
    r.on('error', (e) => finish({ ok: false, err: e.code || e.message }));
    r.end();
  });
}

const TARGETS = [
  { id: 'gh-html', label: 'GitHub 仓库页（HTML）', url: 'https://github.com/eternity4719/HowToLiveBetter', kind: 'github' },
  { id: 'gh-html-sub', label: 'GitHub 子目录页', url: 'https://github.com/eternity4719/HowToLiveBetter/tree/main/book', kind: 'github' },
  { id: 'gh-raw', label: 'raw.githubusercontent 单文件', url: 'https://raw.githubusercontent.com/eternity4719/HowToLiveBetter/main/README.md', kind: 'github' },
  { id: 'gh-api', label: 'api.github.com', url: 'https://api.github.com/repos/eternity4719/HowToLiveBetter', kind: 'github' },
  { id: 'gh-codeload', label: 'codeload 源码包', url: 'https://codeload.github.com/eternity4719/HowToLiveBetter/tar.gz/refs/heads/main', kind: 'github' },
  { id: 'gh-pages', label: 'GitHub Pages（上游在线检索页）', url: 'https://eternity4719.github.io/HowToLiveBetter/', kind: 'github' },
  { id: 'baseline-cf', label: '【对照】Cloudflare 站 life.xfun.fun', url: 'https://life.xfun.fun/', kind: 'baseline' },
  { id: 'baseline-cn', label: '【对照】国内 CDN 站 better.aigcwei.cn', url: 'https://better.aigcwei.cn/', kind: 'baseline' },
];

const out = { generatedAt: new Date().toISOString(), samples: SAMPLES, results: [] };

for (const t of TARGETS) {
  const runs = [];
  for (let i = 0; i < SAMPLES; i++) {
    const r = await req(t.url, { method: t.id === 'gh-codeload' ? 'GET' : 'GET' });
    runs.push({ ok: r.ok, status: r.status ?? null, ms: r.ms, ip: r.ip || '', err: r.err || null, bytes: r.bytes || 0 });
  }
  const okRuns = runs.filter((r) => r.ok && r.status < 400);
  const ms = okRuns.map((r) => r.ms).sort((a, b) => a - b);
  const med = ms.length ? ms[Math.floor(ms.length / 2)] : null;
  const p90 = ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.9))] : null;
  const rec = {
    ...t,
    runs,
    success: okRuns.length,
    total: runs.length,
    median: med,
    p90,
    min: ms[0] ?? null,
    max: ms[ms.length - 1] ?? null,
    spread: ms.length > 1 ? ms[ms.length - 1] - ms[0] : 0,
    ips: [...new Set(runs.map((r) => r.ip).filter(Boolean))],
    bytes: okRuns[0]?.bytes ?? 0,
  };
  out.results.push(rec);
  console.log(
    `${String(rec.success)}/${rec.total}  ${String(rec.median ?? '-').padStart(6)}ms(中位)  p90=${String(rec.p90 ?? '-').padStart(6)}ms  波动=${String(rec.spread).padStart(6)}ms  ${t.label}`
  );
}

// 汇总判定
const gh = out.results.filter((r) => r.kind === 'github');
const base = out.results.filter((r) => r.kind === 'baseline');
out.verdict = {
  githubSuccessRate: gh.reduce((a, r) => a + r.success, 0) / gh.reduce((a, r) => a + r.total, 0),
  githubMedianAvg: Math.round(gh.reduce((a, r) => a + (r.median || 0), 0) / gh.length),
  githubWorst: gh.reduce((a, b) => ((b.median || 0) > (a.median || 0) ? b : a)),
  githubMaxSpread: Math.max(...gh.map((r) => r.spread)),
  baselineMedianAvg: Math.round(base.reduce((a, r) => a + (r.median || 0), 0) / base.length),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('');
console.log(`GitHub 组成功率 ${(out.verdict.githubSuccessRate * 100).toFixed(1)}% ｜ 中位延迟均值 ${out.verdict.githubMedianAvg}ms`);
console.log(`对照站 中位延迟均值 ${out.verdict.baselineMedianAvg}ms ｜ 最不稳 ${out.verdict.githubWorst.label}（波动 ${out.verdict.githubMaxSpread}ms）`);
console.log('已写出: ' + OUT);
