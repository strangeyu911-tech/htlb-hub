/**
 * 解析上游 book/ 全量历史 diff → 建立「条目数 → commit」映射表
 * 用法: node htlb-hub/verify-upstream.mjs
 * 输出: htlb-hub/data/upstream-timeline.json
 *
 * ⚠️ 本脚本**不 spawn 任何子进程**（本机沙箱里 node 起子进程会 EBUSY，
 *    连 git.exe 的绝对路径也一样）。git 取数由 `fetch-upstream.sh` 负责，
 *    本脚本只读它产出的两个文件：
 *      .cache/upstream-book.patch    ← git log --reverse -U0 -p -- book/
 *      .cache/upstream-commits.txt   ← git log --format=%H|%ci
 *    跑之前先执行：bash htlb-hub/fetch-upstream.sh
 *
 * 口径（来自上游自己的 tools/sync-stats.mjs）：条目数 = book/*.md 里的 ### 标题数
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'data', 'upstream-timeline.json');

const CACHE = path.join(DIR, '.cache');
const PATCH = path.join(CACHE, 'upstream-book.patch');
const COMMITS_TXT = path.join(CACHE, 'upstream-commits.txt');
const BOOKFILES_TXT = path.join(CACHE, 'upstream-bookfiles.txt');

for (const f of [PATCH, COMMITS_TXT]) {
  if (!fs.existsSync(f)) {
    console.error('缺少 ' + f + '\n先跑：bash htlb-hub/fetch-upstream.sh');
    process.exit(1);
  }
}

/** patch 里的路径可能被 git 加引号（中文文件名 + quotepath）→ 去掉引号并解转义 */
function unquotePath(s) {
  let p = s.trim();
  if (p.startsWith('"') && p.endsWith('"')) {
    p = p.slice(1, -1);
    // git 的 C 风格转义：\346\226\207 是八进制字节
    const bytes = [];
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '\\' && /[0-7]/.test(p[i + 1] || '')) {
        bytes.push(parseInt(p.slice(i + 1, i + 4), 8));
        i += 3;
      } else {
        bytes.push(...Buffer.from(p[i], 'utf8'));
      }
    }
    p = Buffer.from(bytes).toString('utf8');
  }
  return p;
}

// 全部 commit（不只是动 book 的）的 sha → 日期，用于查衍生项目自报的版本号
const allCommits = {};
for (const line of fs.readFileSync(COMMITS_TXT, 'utf8').split('\n')) {
  const i = line.indexOf('|');
  if (i < 0) continue;
  allCommits[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const raw = fs.readFileSync(PATCH, 'utf8');
const lines = raw.split('\n');

const commits = [];
let cur = null;
let count = 0;
let curFile = '';
const live = new Set(); // 当前所有条目标题
const addedInCommit = new Map(); // sha -> [title]
const bookFiles = new Set(); // book/ 下的全部文件（供 fork 逐条对比用）

for (const line of lines) {
  if (line.startsWith('@@@')) {
    if (cur) {
      cur.entries = count;
      cur.added = addedInCommit.get(cur.sha) || [];
      commits.push(cur);
    }
    const p = line.slice(3).split('|');
    cur = { sha: p[0], date: p[1], msg: (p[2] || '').slice(0, 100) };
    addedInCommit.set(cur.sha, []);
    continue;
  }
  if (!cur) continue;
  if (line.startsWith('+++ ')) {
    const raw = line.slice(4);
    if (raw === '/dev/null') continue;
    const stripped = raw.startsWith('b/') ? raw.slice(2) : raw;
    curFile = unquotePath(stripped);
    if (curFile.startsWith('book/') && curFile.endsWith('.md')) bookFiles.add(curFile);
    continue;
  }
  if (line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ')) continue;
  if (line.startsWith('+### ')) {
    const title = line.slice(5);
    count++;
    live.add(title);
    addedInCommit.get(cur.sha).push({ file: curFile, title });
  } else if (line.startsWith('-### ')) {
    const title = line.slice(5);
    count--;
    live.delete(title);
  }
}
if (cur) {
  cur.entries = count;
  cur.added = addedInCommit.get(cur.sha) || [];
  commits.push(cur);
}

// 合理性校验：不写死 687（上游每天在涨，写死会变成噪音告警）
if (count < 600) {
  console.error(`⚠️ 累积条目数 = ${count}，明显偏低 → 解析可能出错，报告里要标注`);
} else {
  console.log(`✅ 累积条目数 = ${count}（由 book/ 全量 diff 逐次累积得出）`);
}

// HEAD 的条目标题全集（用于做站点的"同步探针"）
const headTitles = [...live];

// 最近 K 次「有新增条目」的提交里加进来的标题 = 最锋利的新鲜度探针
const K = 14;
const withAdds = commits.filter((c) => c.added.length > 0);
const recent = withAdds.slice(-K);
const probes = [];
for (const c of recent) {
  for (const a of c.added) {
    if (!live.has(a.title)) continue; // 后来被改掉/删掉的，不作为探针
    const body = a.title.replace(/^\d+\.\s*/, '').trim();
    if (body.length < 6) continue;
    probes.push({ sha: c.sha, date: c.date, file: a.file, title: a.title, needle: body.slice(0, 22) });
  }
}

// 条目数 → 第一次达到该数量的提交
const byCount = {};
for (const c of commits) {
  if (!c.entries) continue;
  if (byCount[c.entries] === undefined) byCount[c.entries] = { sha: c.sha, date: c.date, msg: c.msg };
}

const out = {
  generatedAt: new Date().toISOString(),
  source: '本地克隆上游仓库 + book/ 全量历史 diff 累积统计',
  definition: '条目数 = book/*.md 里的 ### 标题数（上游 tools/sync-stats.mjs 官方口径）',
  headSha: commits.at(-1)?.sha,
  headEntries: count,
  totalCommits: Object.keys(allCommits).length,
  totalCommitsAll: Object.keys(allCommits).length,
  allCommits,
  commitsTouchingBook: commits.length,
  bookFiles: fs.existsSync(BOOKFILES_TXT)
    ? fs.readFileSync(BOOKFILES_TXT, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    : [...bookFiles].sort(),
  timeline: commits.map((c) => ({ sha: c.sha.slice(0, 8), date: c.date, entries: c.entries, added: c.added.length, msg: c.msg })),
  probes,
  headTitles,
  byCount,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');

console.log('');
console.log(`有提交历史的 book 相关提交 = ${commits.length} 次`);
console.log(`探针条目 = ${probes.length} 条（取自最近 ${K} 次有新增的提交）`);
console.log('最近 8 次有新增条目的提交：');
for (const c of withAdds.slice(-8)) {
  console.log(`  +${String(c.added.length).padStart(2)}  → 累计 ${String(c.entries).padStart(3)} 条  ${c.date.slice(0, 16)}  ${c.msg.slice(0, 52)}`);
}
console.log('');
console.log('关键条目数 → 首次达到的提交：');
for (const n of [614, 654, 670, 672, 676, 677, 687]) {
  const h = out.byCount[n];
  console.log(`  ${String(n).padStart(3)} 条 → ${h ? h.sha.slice(0, 8) + '  ' + h.date.slice(0, 16) : '（该数量未出现过，可能是别处加的）'}`);
}
console.log('');
console.log('已写出: ' + OUT);
