/**
 * 打印一个页面里各标题 / 大图 / 主要板块的纵向坐标（CSS 像素，相对文档顶）。
 * 用法: node locate.cjs <url> [视口宽]
 * 目的：裁图取景靠坐标算，不靠肉眼看缩略图估。
 */
const { launch } = require('./cdp.cjs');

const url = process.argv[2];
const W = Number(process.argv[3] || 1280);

(async () => {
  const s = await launch({ width: W, height: 900 });
  await s.send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: false });
  await s.goto(url, 2600);
  await s.evaluate(
    `(async () => {
      const H = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const step = Math.max(600, Math.round(H()/22));
      for (let y = 0; y < H(); y += step) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 110)); }
      window.scrollTo(0, H()); await new Promise(r => setTimeout(r, 900));
      window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 600));
      const st = document.createElement('style');
      st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
      document.head.appendChild(st);
      await new Promise(r => setTimeout(r, 400));
      return 1;
    })()`,
    true
  );
  const out = await s.evaluate(`(() => {
    const abs = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
    const heads = [...document.querySelectorAll('h1,h2,h3,h4')]
      .filter(e => (e.innerText || '').trim())
      .slice(0, 40)
      .map(e => ({ t: e.tagName, y: abs(e), n: e.innerText.trim().replace(/\\s+/g, ' ').slice(0, 46) }));
    const imgs = [...document.querySelectorAll('img')]
      .map(e => ({ y: abs(e), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), s: (e.currentSrc || e.src || '').slice(-42) }))
      .filter(o => o.w >= 140 && o.h >= 100)
      .slice(0, 25);
    return JSON.stringify({ pageH: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), heads, imgs });
  })()`);
  const d = JSON.parse(out);
  console.log('页面高 ' + d.pageH + 'px\n');
  console.log('— 标题 —');
  for (const h of d.heads) console.log(String(h.y).padStart(6) + '  ' + h.t + '  ' + h.n);
  console.log('\n— 大图（宽≥140 高≥100）—');
  for (const i of d.imgs) console.log(String(i.y).padStart(6) + '  ' + i.w + 'x' + i.h + '  ' + i.s);
  await s.close();
  process.exit(0);
})().catch((e) => {
  console.error('失败: ' + ((e && e.stack) || e));
  process.exit(1);
});
