// UI test of the whole app: opens EVERY page in a headless Microsoft Edge (Chrome DevTools protocol, no extra
// packages), clicks every tab on it, and reports per page:
//   * JavaScript crashes (uncaught exceptions) and console errors
//   * API calls that fail (HTTP 5xx = FAIL; 4xx other than 401 = warning) or never connect
//   * error screens (antd error result / error alert) and pages that bounce to the login
// Needs the dev servers running (API :4000, web :5173). Logs in through the API with the dev seed login.
//
//   node scripts/ui-test.mjs                 all pages
//   node scripts/ui-test.mjs accounts        only pages whose address contains "accounts"
//   node scripts/ui-test.mjs =/              exactly one page (here the dashboard)
//   UI_USER=admin UI_PASS=admin123 …         as another dev login (admin sees the admin-only pages)
//
// Report: docs/test-reports/ui-test-<date>.md (+ .json). Exit code 1 when any page FAILS.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.UI_API ?? 'http://127.0.0.1:4000/api';
const WEB = process.env.UI_WEB ?? 'http://localhost:5173';
const EDGE = process.env.UI_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const LOGIN = {
  loginType: 'employee', username: process.env.UI_USER ?? 'EMP001', password: process.env.UI_PASS ?? 'emp123', divCode: 'DIV1001',
  financialYear: (() => { const d = new Date(); const y = d.getFullYear() - (d.getMonth() < 3 ? 1 : 0); return `${y}-${y + 1}`; })(),
};

// every page of client/src/App.jsx (print pages with a demo bill no.)
const PAGES = [
  '/', '/tracking', '/project-flow', '/account/change-password', '/legacy', '/no-such-page',
  '/masters/state', '/masters/zone', '/masters/city', '/masters/commodity', '/masters/item', '/masters/department', '/masters/division',
  '/masters/district', '/masters/location', '/masters/container', '/masters/vehicle-name', '/masters/vehicle-maker', '/masters/train',
  '/masters/courier', '/masters/product', '/masters/booking-mode', '/masters/delivery-mode', '/masters/charge-code',
  '/masters/undelivered-reason', '/masters/nature-of-business', '/masters/distance', '/masters/sac', '/masters/designation',
  '/masters/country', '/masters/port', '/masters/currency', '/masters/carrier',
  '/masters/driver', '/masters/consignor', '/masters/temp-vendor',
  '/masters/branches', '/masters/vendors', '/masters/vehicles', '/masters/clients', '/masters/employees', '/masters/accounts',
  '/accounts/contra/new', '/accounts/contra/list', '/accounts/payment/new', '/accounts/payment/list', '/accounts/books',
  '/operation/docket/new', '/operation/docket/modify', '/operation/docket/cancel', '/operation/pickup/new', '/operation/pickup/list',
  '/operation/manifest/new', '/operation/manifest/list', '/operation/loading-sheet/new', '/operation/loading-sheet/list',
  '/operation/loading-sheet/docket', '/operation/challan/new', '/operation/challan/list', '/operation/arrival/new', '/operation/arrival/list',
  '/operation/drs/new', '/operation/drs/list', '/operation/delivery/new', '/operation/delivery/list', '/operation/pod/new', '/operation/pod/list',
  '/operation/pod-courier/new', '/operation/pod-courier/list', '/operation/pod-receive/new', '/operation/pod-receive/list',
  '/reports/docket-register', '/admin/access-rights', '/admin/users',
  '/rates/contracts', '/rates/general', '/rates/oda', '/rates/prs-drs', '/rates/vendor-road', '/rates/vendor-air', '/rates/vendor-train',
  '/rates/franchisee-commission', '/rates/franchisee-pickup-delivery',
  '/settings/branch-destinations', '/settings/franchisee-branches', '/settings/franchisee-clients', '/settings/docket-fy',
  '/settings/effective-dates', '/settings/oda-config', '/settings/shipper-stock', '/settings/gatepass-stock', '/settings/shipper-issue',
  '/settings/shipper-issue-franchisee', '/settings/special-booking-approval', '/settings/freight-margin-approval',
  '/settings/vendor-vehicles', '/settings/auto-mis',
  '/invoice/client-bill/new', '/invoice/client-bill/list', '/invoice/bill-submission', '/invoice/bill-finalize', '/invoice/bill-receive',
  '/invoice/misc-bill', '/invoice/warehouse-bill', '/invoice/octroi-bill', '/invoice/vendor-invoice', '/invoice/vendor-verification',
  '/invoice/franchisee-invoice', '/invoice/franchisee-invoice/cancel',
  '/print/client-bill/DMOBL00031',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ minimal CDP client
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.handlers = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`DevTools connection failed: ${e.message ?? e.type}`));
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
        } else if (msg.method) for (const h of this.handlers) h(msg.method, msg.params);
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); setTimeout(() => { if (this.pending.delete(id)) rej(new Error(`${method} timed out`)); }, 30000); });
  }
  on(h) { this.handlers.push(h); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function waitJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${url} did not answer`);
}

// ------------------------------------------------------------------ main
async function main() {
  const filter = process.argv[2] ?? '';
  // "=<page>" picks exactly that page (e.g. =/ for the dashboard), else every page whose address contains the text
  const pages = filter.startsWith('=') ? PAGES.filter((p) => p === filter.slice(1)) : PAGES.filter((p) => p.includes(filter));
  const started = Date.now();

  // 1. servers up + login token
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) throw new Error(`API not running at ${API} — start the dev servers first`);
  await fetch(WEB).catch(() => { throw new Error(`Web app not running at ${WEB}`); });
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LOGIN) }).then((r) => r.json());
  if (!login.token) throw new Error(`Login failed: ${JSON.stringify(login)}`);

  // 2. headless Edge
  const profile = mkdtempSync(join(tmpdir(), 'ramas-ui-'));
  const browser = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  let cdp;
  const results = [];
  try {
    const targets = await waitJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find((t) => t.type === 'page');
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();

    // event capture for the page being tested
    let cur = null; const inflight = new Map(); let lastNet = Date.now();
    cdp.on((method, p) => {
      // only API calls hold the page "loading": files served from the browser cache (production build) never report
      // loadingFinished, so counting them would wait forever
      if (method === 'Network.requestWillBeSent') { if (p.request.url.includes('/api/')) inflight.set(p.requestId, p.request.url); lastNet = Date.now(); }
      if (method === 'Network.requestServedFromCache') inflight.delete(p.requestId);
      if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        const url = inflight.get(p.requestId); inflight.delete(p.requestId); lastNet = Date.now();
        if (method === 'Network.loadingFailed' && cur && url?.includes('/api/') && !p.canceled) cur.fails.push(`API did not connect: ${url.replace(/.*\/api/, '/api')} (${p.errorText})`);
      }
      if (!cur) return;
      if (method === 'Network.responseReceived' && p.response.url.includes('/api/')) {
        const st = p.response.status; const u = p.response.url.replace(/.*\/api/, '/api');
        if (st >= 500) cur.fails.push(`API ${st}: ${u}`);
        else if (st === 401) cur.fails.push(`API 401 (logged out): ${u}`);
        else if (st >= 400) cur.warns.push(`API ${st}: ${u}`);
        cur.api += 1;
      }
      if (method === 'Runtime.exceptionThrown') cur.fails.push(`JS crash: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).split('\n')[0]}`);
      if (method === 'Runtime.consoleAPICalled' && p.type === 'error') {
        const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 220);
        // antd deprecation notices are warnings, not errors of the page
        if (/^Warning: \[antd|\[antd: /.test(text)) cur.warns.push(`antd: ${text.slice(0, 140)}`);
        // rc-util isEqual (inside antd Form) reports repeated primitive values (e.g. a date's day = month) as "circular":
        // a known false alarm of the library, printed only in development builds
        else if (/There may be circular references/.test(text)) cur.warns.push('library: rc-util isEqual "circular references" false alarm (dev only)');
        else {
          // where it came from: first frames outside node_modules (else the top frames)
          const frames = p.stackTrace?.callFrames ?? [];
          const own = frames.filter((f) => !f.url.includes('node_modules')).slice(0, 2);
          const at = (own.length ? own : frames.slice(0, 2)).map((f) => `${f.functionName || '?'} @ ${f.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '').replace(/^.*node_modules\/\.vite\/deps\//, 'deps/')}:${f.lineNumber + 1}`).join(' < ');
          cur.fails.push(`console error: ${text}${at ? `  [${at}]` : ''}`);
        }
      }
    });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');

    const settle = async (max = 20000) => {
      const t0 = Date.now();
      await sleep(400);
      while (Date.now() - t0 < max) {
        if (inflight.size === 0 && Date.now() - lastNet > 900) return true;
        await sleep(150);
      }
      return false;
    };

    // token into this origin's sessionStorage
    await cdp.send('Page.navigate', { url: `${WEB}/login` });
    await settle();
    await cdp.eval(`sessionStorage.setItem('ramas.token', ${JSON.stringify(login.token)}); true`);

    for (const path of pages) {
      cur = { page: path, fails: [], warns: [], api: 0, tabs: 0, ms: 0 };
      const t0 = Date.now();
      await cdp.send('Page.navigate', { url: WEB + path });
      if (!(await settle())) cur.warns.push('still loading after 20 s');
      const state = await cdp.eval(`(() => {
        const err = [...document.querySelectorAll('.ant-result-error .ant-result-title, .ant-alert-error .ant-alert-message')].map((e) => e.innerText.trim()).filter(Boolean);
        return { url: location.pathname, text: document.body.innerText.length, err, title: (document.querySelector('.ant-card-head-title') || document.querySelector('h1,h2,h3,h4'))?.innerText?.trim()?.slice(0, 60) ?? '' };
      })()`);
      if (state.url === '/login' && path !== '/login') cur.fails.push('sent back to the login page');
      if (state.text < 40) cur.fails.push('page is blank');
      for (const e of state.err) cur.fails.push(`error shown: ${e}`);
      cur.title = state.title;
      // click every tab of the page (tabs never save anything)
      const tabCount = await cdp.eval(`document.querySelectorAll('.ant-tabs-tab:not(.ant-tabs-tab-disabled)').length`);
      for (let i = 0; i < Math.min(tabCount, 12); i++) {
        await cdp.eval(`(() => { const t = document.querySelectorAll('.ant-tabs-tab:not(.ant-tabs-tab-disabled)')[${i}]; t && t.querySelector('.ant-tabs-tab-btn, div')?.click(); return true; })()`);
        await settle(15000);
        const tabErr = await cdp.eval(`[...document.querySelectorAll('.ant-tabs-tabpane-active .ant-result-error .ant-result-title, .ant-tabs-tabpane-active .ant-alert-error .ant-alert-message')].map((e) => e.innerText.trim())`);
        for (const e of tabErr) cur.fails.push(`tab ${i + 1}: error shown: ${e}`);
        cur.tabs += 1;
      }
      cur.ms = Date.now() - t0;
      cur.status = cur.fails.length ? 'FAIL' : cur.warns.length ? 'WARN' : 'PASS';
      results.push(cur);
      process.stdout.write(`${cur.status.padEnd(4)} ${path.padEnd(44)} ${String(cur.tabs).padStart(2)} tab(s) ${String(cur.api).padStart(3)} API ${String(cur.ms).padStart(6)} ms${cur.fails.length ? `  ← ${cur.fails[0]}` : ''}\n`);
      cur = null;
    }
  } finally {
    cdp?.close();
    browser.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold it */ }
  }

  // 3. report
  const count = (s) => results.filter((r) => r.status === s).length;
  const stamp = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${LOGIN.username.toLowerCase()}`;
  const dir = join(ROOT, 'docs', 'test-reports'); mkdirSync(dir, { recursive: true });
  const md = [
    `# UI test — ${new Date().toLocaleString('en-IN')} — login ${LOGIN.username} (${LOGIN.financialYear})`, '',
    `Pages: **${results.length}** · PASS **${count('PASS')}** · WARN **${count('WARN')}** · FAIL **${count('FAIL')}** · tabs clicked ${results.reduce((a, r) => a + r.tabs, 0)} · API calls ${results.reduce((a, r) => a + r.api, 0)} · ${Math.round((Date.now() - started) / 1000)} s`, '',
    '| Result | Page | Title | Tabs | API | Time | Problems |', '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.status} | \`${r.page}\` | ${r.title ?? ''} | ${r.tabs} | ${r.api} | ${(r.ms / 1000).toFixed(1)} s | ${[...r.fails, ...r.warns.map((w) => `(warn) ${w}`)].join('<br>').replace(/\|/g, '/') || '—'} |`),
  ].join('\n');
  writeFileSync(join(dir, `ui-test-${stamp}.md`), md);
  writeFileSync(join(dir, `ui-test-${stamp}.json`), JSON.stringify(results, null, 2));
  console.log(`\nPages ${results.length}: PASS ${count('PASS')}, WARN ${count('WARN')}, FAIL ${count('FAIL')}  →  docs/test-reports/ui-test-${stamp}.md`);
  process.exitCode = count('FAIL') ? 1 : 0;
}

main().catch((e) => { console.error(`UI test could not run: ${e.message}`); process.exitCode = 2; });
