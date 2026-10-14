/**
 * 极简 CDP 客户端（零依赖，Node 22 自带全局 WebSocket）。
 * 用途：无头 Chrome 里跑真页面 —— 求值、量尺寸、按元素裁图。
 *
 * 为什么不用 --dump-dom / --screenshot：
 *   1) --virtual-time-budget 下 iframe 的 load 事件不推进，异步探针永远卡住；
 *   2) 按“页面里最有价值的那一块”裁图，需要先拿到元素的 boundingBox，再 clip 截图，
 *      命令行开关做不到。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Chrome/Edge');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });
}

async function httpJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP 端点无响应: ' + url);
}

class Session {
  constructor(proc, ws, userDataDir) {
    this.proc = proc;
    this.ws = ws;
    this.userDataDir = userDataDir;
    this.seq = 0;
    this.waiting = new Map();
    this.events = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id != null && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message + ' (' + JSON.stringify(msg.error.data || '') + ')'));
        else resolve(msg.result);
      } else if (msg.method) {
        const hs = this.events.get(msg.method) || [];
        for (const h of hs) h(msg.params);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 120000);
    });
  }

  on(method, fn) {
    const arr = this.events.get(method) || [];
    arr.push(fn);
    this.events.set(method, arr);
  }

  /** 在页面里求值；awaitPromise=true 时可返回 Promise */
  async evaluate(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      allowUnsafeEvalBlockedByCSP: true,
    });
    if (r.exceptionDetails) {
      throw new Error('页面内异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }

  async goto(url, waitMs = 1200) {
    await this.send('Page.enable');
    const done = new Promise((res) => this.on('Page.loadEventFired', res));
    await this.send('Page.navigate', { url });
    await Promise.race([done, sleep(30000)]);
    await sleep(waitMs);
  }

  /** 全页截图（captureBeyondViewport），返回 Buffer */
  async screenshotFullPage() {
    const m = await this.send('Page.getLayoutMetrics');
    const cs = m.cssContentSize || m.contentSize;
    const r = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(cs.width),
        height: Math.ceil(Math.min(cs.height, 20000)),
        scale: 1,
      },
    });
    return Buffer.from(r.data, 'base64');
  }

  /** 按视口截图（clip 可传 {x,y,width,height,scale}） */
  async screenshot(clip, format = 'png') {
    const params = { format, captureBeyondViewport: true };
    if (clip) params.clip = { scale: 1, ...clip };
    const r = await this.send('Page.captureScreenshot', params);
    return Buffer.from(r.data, 'base64');
  }

  async close() {
    try { this.ws.close(); } catch {}
    try { this.proc.kill(); } catch {}
    // chrome 会另起子进程，补一刀
    await sleep(300);
    if (this.userDataDir) {
      try { fs.rmSync(this.userDataDir, { recursive: true, force: true }); } catch {}
    }
  }
}

async function launch({ width = 1440, height = 900, mobile = false, extraArgs = [] } = {}) {
  const exe = findChrome();
  const port = await freePort();
  const userDataDir = path.join(
    process.env.TEMP || '/tmp',
    'cdp-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)
  );
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--allow-file-access-from-files',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDataDir,
    '--window-size=' + width + ',' + height,
    'about:blank',
    ...extraArgs,
  ];
  const proc = spawn(exe, args, { stdio: 'ignore', detached: false });

  const ver = await httpJson('http://127.0.0.1:' + port + '/json/version');
  const list = await httpJson('http://127.0.0.1:' + port + '/json/list');
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('找不到 page target');

  const ws = new WebSocket(ver.webSocketDebuggerUrl.replace(/\/devtools\/browser\/.*/, ''));
  // 连到页面级 ws 更省事
  const pageWs = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    pageWs.addEventListener('open', res, { once: true });
    pageWs.addEventListener('error', rej, { once: true });
  });

  const s = new Session(proc, pageWs, userDataDir);
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  const ua = mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  await s.send('Emulation.setUserAgentOverride', { userAgent: ua });
  if (mobile) {
    await s.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
    });
  }
  return s;
}

module.exports = { launch, sleep, findChrome };
