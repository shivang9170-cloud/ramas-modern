// Security checks against the dev database: SQL injection probes, XSS-safe responses and headers, cross-site (CSRF)
// guard, CORS, rate limits, source maps never served, secrets kept off the wire, sensitive values kept out of logs, and the
// forced change of a default password. Skipped when DB_NAME is not a *_dev database.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { closeDb, initDb, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { redactUrl } from '../src/middleware/security.js';
import { isWeakPassword } from '../src/modules/auth/auth.service.js';

const enabled = Boolean(config.db?.database?.endsWith('_dev'));
const today = new Date().toISOString().slice(0, 10);
const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
const LOGIN = { loginType: 'employee', username: 'EMP001', password: 'emp123', divCode: 'DIV1001', financialYear: `${y}-${y + 1}` };

describe('Security (dev database)', { skip: !enabled && 'DB_NAME is not a *_dev database' }, () => {
  let app; let tok;
  const at = () => ({ Authorization: `Bearer ${tok}` });
  const saved = {};

  before(async () => {
    assertConfig();
    await initDb();
    saved.rateLimit = { ...config.rateLimit };
    saved.force = config.forcePasswordChange;
    saved.dist = config.clientDist;
    config.rateLimit.off = true;
    config.forcePasswordChange = false;
    app = createApp();
    const r = await request(app).post('/api/auth/login').send(LOGIN);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tok = r.body.token;
  });

  after(async () => {
    Object.assign(config.rateLimit, saved.rateLimit);
    config.forcePasswordChange = saved.force;
    config.clientDist = saved.dist;
    await query("update users set user_password = 'emp123' where user_id = 'EMP001'");   // in case the password test stopped half-way
    await closeDb();
  });

  // ------------------------------------------------------------------ SQL injection
  test('SQL injection probes are treated as plain text', async () => {
    for (const probe of ["' OR 1=1 --", "x'; drop table grn_master; --", "%' union select name, null from sys.tables --"]) {
      const cities = await request(app).get('/api/dockets/lookup/cities').set(at()).query({ q: probe });
      assert.equal(cities.status, 200, probe);
      assert.ok(Array.isArray(cities.body) && cities.body.length === 0, `no rows for ${probe}`);
      const list = await request(app).get('/api/payments').set(at()).query({ q: probe });
      assert.equal(list.status, 200, probe);
    }
    const bad = await request(app).post('/api/auth/login').send({ ...LOGIN, username: "' OR '1'='1", password: "' OR '1'='1" });
    assert.equal(bad.status, 401);
    const [t] = await query("select count(*) as n from sys.tables where name = 'grn_master'");
    assert.equal(t.n, 1);   // still there
  });

  // ------------------------------------------------------------------ XSS
  test('responses are JSON / nosniff with a content security policy (no HTML from the API)', async () => {
    const r = await request(app).get('/api/dockets/lookup/cities').set(at()).query({ q: '<script>alert(1)</script>' });
    assert.match(r.headers['content-type'], /application\/json/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(r.headers['content-security-policy']);
    assert.equal(r.headers['x-powered-by'], undefined);
    const nf = await request(app).get('/api/<img src=x onerror=alert(1)>');
    assert.match(nf.headers['content-type'], /application\/json/);
  });

  // ------------------------------------------------------------------ CSRF
  test('cross-site requests are blocked; only JSON bodies are accepted', async () => {
    const evil = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send(LOGIN);
    assert.equal(evil.status, 403);
    assert.match(evil.body.error, /Cross-site/);
    const ref = await request(app).post('/api/payments').set(at()).set('Referer', 'https://evil.example/page').send({});
    assert.equal(ref.status, 403);
    const form = await request(app).post('/api/auth/login').type('form').send('username=EMP001&password=emp123');
    assert.equal(form.status, 415);
    const text = await request(app).post('/api/auth/login').set('Content-Type', 'text/plain').send(JSON.stringify(LOGIN));
    assert.equal(text.status, 415);
    const ok = await request(app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send(LOGIN);
    assert.equal(ok.status, 200);
    // the built app served by this server behind a tunnel: Origin = the public address = the Host header
    const tunnel = await request(app).post('/api/auth/login').set('Host', 'abc-def.trycloudflare.com').set('Origin', 'https://abc-def.trycloudflare.com').send(LOGIN);
    assert.equal(tunnel.status, 200);
    const other = await request(app).post('/api/auth/login').set('Host', 'abc-def.trycloudflare.com').set('Origin', 'https://evil-def.trycloudflare.com').send(LOGIN);
    assert.equal(other.status, 403);
    // the dev app opened by IP / from another PC through the Vite proxy: Origin = X-Forwarded-Host
    const lan = await request(app).post('/api/auth/login').set('X-Forwarded-Host', '192.168.1.20:5173').set('Origin', 'http://192.168.1.20:5173').send(LOGIN);
    assert.equal(lan.status, 200);
    const lanEvil = await request(app).post('/api/auth/login').set('X-Forwarded-Host', '192.168.1.20:5173').set('Origin', 'http://192.168.1.99:5173').send(LOGIN);
    assert.equal(lanEvil.status, 403);
  });

  // ------------------------------------------------------------------ CORS
  test('CORS answers only the configured origins, methods and headers', async () => {
    const evil = await request(app).options('/api/payments').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
    const good = await request(app).options('/api/payments').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    assert.equal(good.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(good.headers['access-control-allow-credentials'], undefined);
    assert.deepEqual(good.headers['access-control-allow-methods'].split(',').sort(), ['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
    assert.equal(good.headers['access-control-allow-headers'], 'Content-Type,Authorization');
  });

  // ------------------------------------------------------------------ rate limiting
  test('rate limits: the whole API and, tighter, writes', async () => {
    Object.assign(config.rateLimit, { off: false, windowMs: 60_000, max: 4, writeMax: 2 });
    const limited = createApp();
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await request(limited).get('/api/health')).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 429]);
    const limited2 = createApp();
    const writes = [];
    for (let i = 0; i < 3; i++) writes.push((await request(limited2).post('/api/payments').send({})).status);
    assert.deepEqual(writes.slice(0, 2).map((c) => c !== 429), [true, true]);
    assert.equal(writes[2], 429);
    const r = await request(limited).get('/api/health');
    assert.match(r.body.error, /Too many requests/);
    Object.assign(config.rateLimit, { off: true });
  });

  // ------------------------------------------------------------------ source maps
  test('source maps are never served with the built app', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title>');
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, 'app.js.map'), '{"version":3}');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
    config.clientDist = dir;
    const served = createApp();
    assert.equal((await request(served).get('/app.js')).status, 200);
    assert.equal((await request(served).get('/app.js.map')).status, 404);
    assert.notEqual((await request(served).get('/.env')).text, 'SECRET=1');
    config.clientDist = saved.dist;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------ secrets
  test('no password or secret travels to the browser', async () => {
    const login = await request(app).post('/api/auth/login').send(LOGIN);
    const body = JSON.stringify(login.body).toLowerCase();
    assert.ok(!body.includes('emp123') && !body.includes('user_password') && !body.includes(config.jwt.secret.toLowerCase()));
    const me = JSON.stringify((await request(app).get('/api/auth/me').set(at())).body).toLowerCase();
    assert.ok(!me.includes('password') && !me.includes('emp123'));
    const staff = JSON.stringify((await request(app).get('/api/pickups/options').set(at())).body).toLowerCase();
    assert.ok(!staff.includes('password'));
  });

  // ------------------------------------------------------------------ logs
  test('sensitive values are redacted from logged URLs', () => {
    assert.equal(redactUrl('/api/x?password=abc&q=bus&token=xyz'), '/api/x?password=***&q=bus&token=***');
    assert.equal(redactUrl('/api/x?api_key=1&page=2'), '/api/x?api_key=***&page=2');
    assert.equal(redactUrl('/api/dockets?q=MUMBAI'), '/api/dockets?q=MUMBAI');
  });

  // ------------------------------------------------------------------ default passwords
  test('a default password must be changed before anything else; weak new passwords are refused', async () => {
    assert.ok(isWeakPassword('emp123') && isWeakPassword('admin123') && isWeakPassword('Abcdefgh') && isWeakPassword('EMP001x9', 'EMP001x9'));
    assert.ok(!isWeakPassword('Ramas@2026x'));
    config.forcePasswordChange = true;
    const login = await request(app).post('/api/auth/login').send(LOGIN);
    assert.equal(login.status, 200);
    assert.equal(login.body.mustChangePassword, true);
    const limited = { Authorization: `Bearer ${login.body.token}` };
    const menu = await request(app).get('/api/menu').set(limited);
    assert.deepEqual([menu.status, menu.body.code], [403, 'PASSWORD_CHANGE_REQUIRED']);
    assert.equal((await request(app).get('/api/auth/me').set(limited)).status, 200);
    const weak = await request(app).post('/api/auth/change-password').set(limited).send({ oldPassword: 'emp123', newPassword: 'password123' });
    assert.equal(weak.status, 400);
    const short = await request(app).post('/api/auth/change-password').set(limited).send({ oldPassword: 'emp123', newPassword: 'ab1' });
    assert.equal(short.status, 400);
    const wrongOld = await request(app).post('/api/auth/change-password').set(limited).send({ oldPassword: 'nope', newPassword: 'Ramas@2026x' });
    assert.equal(wrongOld.status, 400);
    const ok = await request(app).post('/api/auth/change-password').set(limited).send({ oldPassword: 'emp123', newPassword: 'Ramas@2026x' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.token && !ok.body.user.pwc);
    assert.equal((await request(app).get('/api/menu').set({ Authorization: `Bearer ${ok.body.token}` })).status, 200);
    // a strong password logs in normally
    const again = await request(app).post('/api/auth/login').send({ ...LOGIN, password: 'Ramas@2026x' });
    assert.deepEqual([again.status, again.body.mustChangePassword], [200, false]);
    // back to the dev seed password for the other suites
    await query("update users set user_password = 'emp123' where user_id = 'EMP001'");
    config.forcePasswordChange = false;
  });
});
