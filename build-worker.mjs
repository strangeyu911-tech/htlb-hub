/**
 * 把 site/index.html + data/projects.json 注入 worker.template.js
 * 用法: node htlb-hub/build-worker.mjs
 * 输出: htlb-hub/deploy/worker.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(DIR, 'site', 'index.html'), 'utf8');
const dataText = fs.readFileSync(path.join(DIR, 'data', 'projects.json'), 'utf8');
let tpl = fs.readFileSync(path.join(DIR, 'worker.template.js'), 'utf8');

if (!tpl.includes("/*__HTML__*/ ''") || !tpl.includes('/*__DATA__*/ { upstream: {}, projects: [] }')) {
  throw new Error('模板占位符不见了 —— worker.template.js 被改过？');
}

// 用函数式 replace，避免 JSON 里的 $& / $1 被当反向引用
tpl = tpl.replace("/*__HTML__*/ ''", () => JSON.stringify(html));
tpl = tpl.replace('/*__DATA__*/ { upstream: {}, projects: [] }', () => dataText);

if (tpl.includes('/*__HTML__*/') || tpl.includes('/*__DATA__*/')) throw new Error('注入失败，占位符仍在');

const outDir = path.join(DIR, 'deploy');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'worker.js');
fs.writeFileSync(out, tpl, 'utf8');

// 语法自检：真的 import 一次，语法错立刻炸
const mod = await import(new URL('./deploy/worker.js?t=' + Date.now(), import.meta.url).href);
if (typeof mod.default?.fetch !== 'function') throw new Error('worker 没有导出 fetch 处理器');

console.log('已生成: deploy/worker.js  (' + Buffer.byteLength(tpl) + ' B)');
console.log('  ✅ 已 import 验证：export default.fetch 存在');
console.log('  其中 HTML   ' + html.length + ' 字符');
console.log('  其中 DATA   ' + dataText.length + ' 字符');
