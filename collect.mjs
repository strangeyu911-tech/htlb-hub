/**
 * HowToLiveBetter 生态采集器
 * 用法: node .workbuddy/tmp/htlb-collect.mjs
 * 输出: htlb-hub/data/audit.json
 *
 * 用 node:https 直连（不走 HTTP_PROXY 环境变量），与 curl --noproxy '*' 的口径一致。
 */
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'data', 'audit.json');
const UPSTREAM = 'eternity4719/HowToLiveBetter';

function req(url, { timeout = 9000, maxRedirect = 4, method = 'GET' } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false;
    const finish = (o) => {
      if (done) return;
      done = true;
      resolve({ ...o, ms: Date.now() - t0 });
    };
    const go = (u, left) => {
      let parsed;
      try {
        parsed = new URL(u);
      } catch (e) {
        return finish({ ok: false, err: 'bad-url' });
      }
      const mod = parsed.protocol === 'http:' ? http : https;
      const r = mod.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
          path: parsed.pathname + parsed.search,
          method,
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
            accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'zh-CN,zh;q=0.9',
          },
          timeout,
        },
        (res) => {
          const ip = res.socket?.remoteAddress || '';
          const cdn = res.headers['cf-ray'] ? 'Cloudflare' : res.headers['x-vercel-id'] ? 'Vercel' : res.headers['server'] || '';
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
            res.resume();
            return go(new URL(res.headers.location, u).toString(), left - 1);
          }
          const chunks = [];
          let total = 0;
          const CAP = 400 * 1024;
          res.on('data', (c) => {
            if (total < CAP) {
              chunks.push(c);
              total += c.length;
            }
          });
          res.on('end', () =>
            finish({
              ok: true,
              status: res.statusCode,
              ip,
              cdn,
              server: res.headers['server'] || '',
              len: res.headers['content-length'] || '',
              body: Buffer.concat(chunks).toString('utf8'),
              truncated: total >= CAP,
            })
          );
        }
      );
      r.on('timeout', () => {
        r.destroy();
        finish({ ok: false, err: 'timeout' });
      });
      r.on('error', (e) => finish({ ok: false, err: e.code || e.message }));
      r.end();
    };
    go(url, maxRedirect);
  });
}

async function ghApi(p) {
  const r = await req('https://api.github.com' + p, { timeout: 12000 });
  if (!r.ok || r.status !== 200) return null;
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

function pick(body, res) {
  const sig = [];
  if (!body) return sig;
  const n = body.match(/(\d{3,4})\s*条/g);
  if (n) sig.push('条目数出现: ' + [...new Set(n)].slice(0, 6).join(' / '));
  const dates = body.match(/20\d{2}-[01]\d-[0-3]\d/g);
  if (dates) {
    const uniq = [...new Set(dates)].sort();
    sig.push('页面日期: ' + uniq.slice(0, 3).join(' / ') + (uniq.length > 3 ? ` …共${uniq.length}个，最新 ${uniq[uniq.length - 1]}` : ''));
  }
  const m = body.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i);
  if (m) sig.push('title: ' + m[1].replace(/\s+/g, ' ').trim());
  if (/evidence|证据/.test(body)) sig.push('含「证据」字段');
  if (/\bA\s*450|\bB\s*190|\bC\s*47/.test(body)) sig.push('★ 含上游证据分级计数 A450/B190/C47');
  return sig;
}

const DERIVED = [
  { id: 'howtolivebetter.net', name: '打勾清单', author: 'littleben', kind: '网站', gh: 'littleben', url: 'https://howtolivebetter.net/', note: '加待办、标记做到没有、收藏' },
  { id: 'life.warpnav.com', name: 'WarpNav 人生手册', author: 'SatoMini', kind: '网站', url: 'https://life.warpnav.com/', note: '按生活场景进入、搜索筛选、收藏导入导出、接着上次读；不用注册；页面有广告' },
  { id: 'life.xfun.fun', name: '手绘地图版', author: 'sagiriiiiii', kind: '网站', url: 'https://life.xfun.fun/', note: '各节画成可拖动地图，每条是可翻面卡片，支持拼音搜索和生成分享海报' },
  { id: 'how2livebetter.net', name: '人生阶段指南', author: 'marsbuildlog', kind: '网站', url: 'https://how2livebetter.net/', note: '按五个阶段重排；处境自测、行动清单、每日打卡；阅读免费，打卡/复查提醒以后收费' },
  { id: 'better.aigcwei.cn', name: 'better.aigcwei.cn + MCP', author: 'Helioswei', kind: '网站+MCP', url: 'https://better.aigcwei.cn/', ghRepo: 'Helioswei/HowToLiveBetter-Kit', note: '按节/按场景读、检索全部条目；MCP 装进 Cursor/Claude Code 后助手回答前先查本书并注明第几节第几条，可按性价比/成本/证据等级/收益筛选；不用注册、没有广告' },
  { id: 'qingdan.lazyso.com', name: '懒人性价性清单', author: 'lazyvip', kind: '网站', url: 'https://qingdan.lazyso.com/', note: '按「0元、不费毅力、收益大、证据A」组合筛选；打勾记进度、每日一条；不用注册、无广告' },
  { id: 'livebetter101.com', name: 'LiveBetter 101', author: 'PlatoTheOne', kind: '网站', url: 'https://livebetter101.com/', note: '闯关游戏：建议改编成生活场景选择题，分急救/钱包/时间/关系/安全几块练；不用注册、无广告' },
  { id: 'HuiTurn/HowToLiveBetter', name: '微信小程序版', author: 'HuiTurn', kind: '小程序', ghRepo: 'HuiTurn/HowToLiveBetter', note: '分类、收藏、每日一读、全文搜索，离线可用' },
  { id: 'apps.apple.com/id6818596108', name: '行动版 iOS App', author: 'GUGU VITALITY LIMITED', kind: 'iOS App', url: 'https://apps.apple.com/cn/app/id6818596108', note: '左右滑卡片决定做不做，做一次的进清单，要重复的设打卡，离线可用；免费版清单/打卡有数量限制' },
  { id: 'llzx373/BetterLifeApp', name: 'BetterLifeApp', author: 'llzx373', kind: 'Android App', ghRepo: 'llzx373/BetterLifeApp', note: '按个人情况推荐、每日打卡、条目库；AI 问答要自填 API Key；测试版，内置条目较早' },
  { id: 'mittsommer/daily-life-tip', name: '今日一条', author: 'mittsommer', kind: 'macOS 小组件', ghRepo: 'mittsommer/daily-life-tip', note: '每天一条，可换一条、一键生成带出处分享图，每天自动同步本仓库正文；免费无签名（MIT）' },
  { id: 'sinyu1012/shiye-tab', name: '拾页 Shiye Tab', author: 'sinyu1012', kind: 'Chrome 插件', ghRepo: 'sinyu1012/shiye-tab', note: '新标签页随机显示一条建议，可放 GitHub 周榜和 RSS；不用注册（MIT）' },
  { id: 'sin0317/htlb-dataset', name: '结构化数据集', author: 'sin0317', kind: '数据集', ghRepo: 'sin0317/htlb-dataset', note: '全书条目解析成 JSON/CSV/SQLite，每天自动同步（正文 CC BY 4.0，代码 MIT）' },
  { id: 'robiNeo2045/comics', name: '四格漫画 PDF', author: 'robiNeo2045', kind: '漫画', ghRepo: 'robiNeo2045/HowToLiveBetter', note: '基于 2026-10-03 PDF 快照，34 章 654 条，固定快照不自动同步（CC BY 4.0）' },
];

const out = { generatedAt: new Date().toISOString(), upstream: {}, derived: [] };

// ── 上游指纹 ──
const up = await ghApi(`/repos/${UPSTREAM}`);
const commits = await ghApi(`/repos/${UPSTREAM}/commits?per_page=1`);
const rel = await req(`https://raw.githubusercontent.com/${UPSTREAM}/main/%E8%A1%8D%E7%94%9F%E9%A1%B9%E7%9B%AE.md`);
out.upstream = {
  stars: up?.stargazers_count,
  forks: up?.forks_count,
  license: up?.license?.spdx_id,
  created: up?.created_at,
  pushed: up?.pushed_at,
  size: up?.size,
  homepage: up?.homepage,
  latestSha: commits?.[0]?.sha,
  latestCommitAt: commits?.[0]?.commit?.author?.date,
  latestCommitMsg: commits?.[0]?.commit?.message?.split('\n')[0],
  derivativesMdChars: rel.ok ? rel.body.length : null,
  derivativesMdLinks: rel.ok ? (rel.body.match(/\]\(http/g) || []).length : null,
};
const readmeBadges = (() => {
  // 用 commit sha 拉 README，抓版本指纹
  return out.upstream.latestSha ? `https://raw.githubusercontent.com/${UPSTREAM}/${out.upstream.latestSha}/README.md` : null;
})();
const rd = readmeBadges ? await req(readmeBadges) : { ok: false };
out.upstream.fingerprint = rd.ok
  ? {
      条目数: (rd.body.match(/条目-(\d+)/) || [])[1] || (rd.body.match(/(\d{3})\s*条建议/) || [])[1] || null,
      证据分级: (rd.body.match(/证据分级-([^)]*)/) || [])[1]?.replace(/--/g, ' · ') || null,
      原始文献: (rd.body.match(/原始文献-(\d+)/) || [])[1] || null,
      章节数: (rd.body.match(/第\s*(\d+)\s*节/g) || []).length || null,
    }
  : null;

console.log('上游:', JSON.stringify(out.upstream, null, 1));

// ── 逐项采集 ──
for (const d of DERIVED) {
  const rec = { ...d, probes: [], gh: null, signals: [] };
  const target = d.url || (d.ghRepo ? `https://github.com/${d.ghRepo}` : null);
  if (target) {
    for (let i = 0; i < 3; i++) {
      const r = await req(target);
      rec.probes.push({ ok: r.ok, status: r.status, ms: r.ms, ip: r.ip, cdn: r.cdn, err: r.err, bytes: r.body ? Buffer.byteLength(r.body) : 0 });
      if (i === 0 && r.ok && r.body) rec.signals = pick(r.body, r);
    }
  }
  if (d.ghRepo) {
    const g = await ghApi(`/repos/${d.ghRepo}`);
    if (g) {
      const c = await ghApi(`/repos/${d.ghRepo}/commits?per_page=1`);
      rec.gh = {
        stars: g.stargazers_count,
        forks: g.forks_count,
        pushed_at: g.pushed_at,
        created_at: g.created_at,
        archived: g.archived,
        license: g.license?.spdx_id || null,
        desc: (g.description || '').slice(0, 160),
        lastCommitAt: c?.[0]?.commit?.author?.date,
        lastCommitMsg: c?.[0]?.commit?.message?.split('\n')[0]?.slice(0, 90),
      };
    }
  }
  out.derived.push(rec);
  const okn = rec.probes.filter((p) => p.ok).length;
  console.log(`${okn}/3  ${d.id}  ${rec.probes.map((p) => (p.ok ? p.status : p.err)).join(',')}  ${rec.gh ? 'gh: ' + rec.gh.pushed_at : ''}`);
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('\n已写出: ' + OUT);
