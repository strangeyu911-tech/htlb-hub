/**
 * 「另见」区块的 5 个站点逐个真机截图（CDP）。
 *
 * 为什么不复用 capture.cjs：那个脚本的站单列表来自 data/projects.json（上游官方
 * 收录的 18 个衍生项目）。「另见」这几个是维护者自己的作品 + 两个未被收录的项目，
 * 不在那份数据里，所以单列一份硬编码列表。
 *
 * 产出与 capture.cjs 一致（raw/），后续 over.py / crop.py 直接复用：
 *   raw/<slug>-s1..sN.png  1280×900 原尺寸切片
 */
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./cdp.cjs');

const RAW = path.join(__dirname, 'raw');
fs.mkdirSync(RAW, { recursive: true });

/**
 * slug 会直接变成 site/shot/<slug>.webp 的文件名，别和已有 18 个撞。
 * 顺序按页面上出现的顺序。
 */
const LIST = [
  { slug: 'mirror', name: '以日为镜（增补版）', url: 'https://mirror.strangeyu.xyz/' },
  { slug: 'patch', name: '衰退时代补丁包', url: 'https://mirror.strangeyu.xyz/patch' },
  { slug: 'justin-sun-corpus', name: '孙割这十年', url: 'https://strangeyu911-tech.github.io/justin-sun-corpus/' },
  { slug: 'howtoworkbetter', name: '高性价比工作指南', url: 'https://nicecao.github.io/HowToWorkBetter/' },
  { slug: 'shangbanbao', name: '上班宝', url: 'https://shangbanbao.com/' },
];

const W = 1280;
const H = 900;
const MAX_SEG = 8;

const only = process.argv.slice(2);

(async () => {
  const targets = only.length ? LIST.filter((p) => only.some((k) => p.slug.includes(k))) : LIST;
  const s = await launch({ width: W, height: H });
  const meta = [];

  for (const p of targets) {
    const row = { slug: p.slug, name: p.name, src: p.url };
    const t0 = Date.now();
    try {
      await s.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await s.goto(p.url, 2600);

      await s.evaluate(
        `(async () => {
          const H = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          const step = Math.max(600, Math.round(H() / 22));
          for (let y = 0; y < H(); y += step) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 110)); }
          window.scrollTo(0, H());
          await new Promise(r => setTimeout(r, 900));
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 600));
          return H();
        })()`,
        true
      );

      // 冻结动画/过渡：这几站首屏多有淡入，半途拍会出现字叠字的「重影」
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
          heads: [...document.querySelectorAll('h1,h2,h3')].slice(0, 16).map(e => {
            const r = e.getBoundingClientRect();
            return { t: (e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,54), y: Math.round(r.top + window.scrollY), tag: e.tagName };
          })
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
      row.ms = Date.now() - t0;
      console.log(`✅ ${p.slug}  ${i.title.slice(0, 40)}  ${i.w}x${i.h}  segs=${segs}  ${row.ms}ms`);
    } catch (e) {
      row.error = String((e && e.message) || e).slice(0, 200);
      console.log(`❌ ${p.slug}  ${row.error}`);
    }
    meta.push(row);
  }

  fs.writeFileSync(path.join(RAW, '_meta-extra.json'), JSON.stringify(meta, null, 2));
  const ok = meta.filter((m) => !m.error);
  console.log(`\n--- 成功 ${ok.length} / 失败 ${meta.filter((m) => m.error).length} ---`);
  await s.close();
  process.exit(0);
})().catch((e) => {
  console.error('整体失败: ' + ((e && e.stack) || e));
  process.exit(1);
});
