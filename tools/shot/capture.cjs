/**
 * 18 个衍生项目逐个真机截图（CDP）。
 *
 * ⚠️ 上一版踩的坑：对整页做原尺寸截图。打勾清单那类页面有 699 个条目，
 *    页面高度几万像素，1280×20000 的 PNG 编码几乎不收敛（挂 9 分钟没出图）。
 *    现在：逐屏切片保持原尺寸（1280×900，快且字看得清），
 *    「整页长相」改用 clip.scale = 400/1280 一次性成像（像素量降到 1/10）。
 *
 * 产出（raw/）：
 *   <slug>-s1..sN.png  1280×900 原尺寸切片 —— 用来核对细节
 *   <slug>-over.png    宽 400 的整页长图 —— 用来看整页结构、挑最有价值的一屏
 *   _meta.json         最终 URL / title / 高度 / 标题结构
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./cdp.cjs');

const RAW = path.join(__dirname, 'raw');
fs.mkdirSync(RAW, { recursive: true });

const P = require(path.join(__dirname, '..', '..', 'data', 'projects.json'));
const LIST = Array.isArray(P) ? P : P.projects || P.rows || [];

const W = 1280;
const H = 900;
const MAX_SEG = 7;
const OVER_W = 400;
const OVER_H_MAX = 14000;

const only = process.argv.slice(2);

(async () => {
  const targets = only.length ? LIST.filter((p) => only.some((k) => p.slug.includes(k))) : LIST;
  const s = await launch({ width: W, height: H });
  const meta = [];

  for (const p of targets) {
    const row = { slug: p.slug, name: p.name, kind: p.kind || '', src: p.url };
    const t0 = Date.now();
    try {
      await s.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await s.goto(p.url, 2200);

      await s.evaluate(
        `(async () => {
          const H = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          const step = Math.max(600, Math.round(H() / 22));
          for (let y = 0; y < H(); y += step) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 110)); }
          window.scrollTo(0, H());
          await new Promise(r => setTimeout(r, 800));
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 500));
          return H();
        })()`,
        true
      );

      // 冻结动画/过渡再拍：better.aigcwei.cn 首屏有一层文字淡入，
      // 拍到一半会出现字叠字的「重影」，看着像页面坏了。
      await s.evaluate(`(() => {
        const st = document.createElement('style');
        st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
        (document.head || document.documentElement).appendChild(st);
        return 1;
      })()`);
      await new Promise((r) => setTimeout(r, 700));

      const i = JSON.parse(
        await s.evaluate(`JSON.stringify({
          href: location.href, title: document.title,
          h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
          w: document.documentElement.scrollWidth,
          textLen: (document.body.innerText || '').length,
          heads: [...document.querySelectorAll('h1,h2,h3')].slice(0, 14).map(e => (e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,52))
        })`)
      );
      Object.assign(row, i);
      row.redirected = i.href !== p.url;

      const segs = Math.min(MAX_SEG, Math.max(1, Math.ceil(i.h / H)));
      for (let k = 0; k < segs; k++) {
        const y = k * H;
        fs.writeFileSync(
          path.join(RAW, `${p.slug}-s${k + 1}.png`),
          await s.screenshot({ x: 0, y, width: W, height: Math.min(H, i.h - y), scale: 1 })
        );
      }
      row.segments = segs;

      // ⚠️ 整页缩略**不在这里拍**。captureBeyondViewport 会先把整页渲染一遍，
      //    打勾清单那种几万像素高的页面会卡到天荒地老（实测挂 9 分钟 0 输出）。
      //    改成拿上面的切片在 Python 侧拼（见 over.py）。
      row.ms = Date.now() - t0;
      console.log(`✅ ${p.slug}  ${i.title.slice(0, 34)}  ${i.w}x${i.h}  segs=${segs}  ${row.ms}ms`);
    } catch (e) {
      row.error = String((e && e.message) || e).slice(0, 200);
      console.log(`❌ ${p.slug}  ${row.error}`);
    }
    meta.push(row);
  }

  fs.writeFileSync(path.join(RAW, '_meta.json'), JSON.stringify(meta, null, 2));
  const ok = meta.filter((m) => !m.error);
  console.log(`\n--- 成功 ${ok.length} / 失败 ${meta.filter((m) => m.error).length} ---`);
  await s.close();
  process.exit(0);
})().catch((e) => {
  console.error('整体失败: ' + ((e && e.stack) || e));
  process.exit(1);
});
