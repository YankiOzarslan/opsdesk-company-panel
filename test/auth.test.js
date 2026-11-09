'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { makeApp, login, csrf, PASSWORD, ADMIN_EMAIL, request } = require('./helpers');

describe('Kimlik doğrulama', () => {
  let ctx;
  before(async () => { ctx = await makeApp(); });
  after(() => ctx.cleanup());

  it('oturumsuz istek login sayfasına yönlenir', async () => {
    const res = await request(ctx.app).get('/projects');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login?next=%2Fprojects');
    assert.equal((await request(ctx.app).get('/login')).status, 200);
  });

  it('başarılı login: httpOnly + SameSite=Strict JWT cookie, 8 saat', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrf(agent);
    const res = await agent.post('/login').type('form').send({ _csrf: token, email: ADMIN_EMAIL, password: PASSWORD });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('opsdesk_token='));
    assert.ok(cookie, 'opsdesk_token cookie set edilmeli');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Max-Age=28800/);
    const payload = jwt.decode(cookie.split(';')[0].split('=')[1]);
    assert.match(payload.sub, /^\d+$/);
    assert.equal(typeof payload.tv, 'number');
    assert.equal(payload.exp - payload.iat, 8 * 60 * 60);
    assert.equal((await agent.get('/')).status, 200);
  });

  it('login sonrası session yenilenir ve eski CSRF token geçersiz olur', async () => {
    const agent = request.agent(ctx.app);
    const before1 = await csrf(agent);
    await agent.post('/login').type('form').send({ _csrf: before1, email: ADMIN_EMAIL, password: PASSWORD });
    const after1 = await csrf(agent, '/');
    assert.notEqual(before1, after1);
    const res = await agent.post('/team').type('form').send({ _csrf: before1, name: 'X' });
    assert.equal(res.status, 403);
  });

  it('hatalı şifre 401 döner ve cookie verilmez', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrf(agent);
    const res = await agent.post('/login').type('form').send({ _csrf: token, email: ADMIN_EMAIL, password: 'yanlis' });
    assert.equal(res.status, 401);
    assert.match(res.text, /E-posta veya parola hatalı/);
    assert.ok(!(res.headers['set-cookie'] || []).some((c) => c.startsWith('opsdesk_token=')));
  });

  it('bilinmeyen kullanıcı da 401 döner', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrf(agent);
    const res = await agent.post('/login').type('form').send({ _csrf: token, email: 'root@opsdesk.test', password: PASSWORD });
    assert.equal(res.status, 401);
  });

  it('sahte / farklı anahtarla imzalı JWT reddedilir', async () => {
    const forged = jwt.sign({ sub: '1', tv: 0 }, 'baska-anahtar', { algorithm: 'HS256', expiresIn: '8h' });
    const res = await request(ctx.app).get('/').set('Cookie', `opsdesk_token=${forged}`);
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^\/login/);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"1","tv":0}').toString('base64url')}.`;
    assert.equal((await request(ctx.app).get('/').set('Cookie', `opsdesk_token=${none}`)).status, 302);
  });

  it('süresi dolmuş JWT reddedilir', async () => {
    const expired = jwt.sign({ sub: '1', tv: 0, iat: Math.floor(Date.now() / 1000) - 9 * 3600, exp: Math.floor(Date.now() / 1000) - 3600 }, ctx.config.jwtSecret);
    assert.equal((await request(ctx.app).get('/').set('Cookie', `opsdesk_token=${expired}`)).status, 302);
  });

  it('open redirect engellenir (next=//evil.com)', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrf(agent);
    const res = await agent.post('/login').type('form').send({ _csrf: token, email: ADMIN_EMAIL, password: PASSWORD, next: '//evil.com' });
    assert.equal(res.headers.location, '/');
  });

  it('logout cookie temizler', async () => {
    const agent = await login(ctx.app);
    const res = await agent.post('/logout').type('form').send({ _csrf: agent.csrfToken });
    assert.equal(res.status, 302);
    assert.ok(res.headers['set-cookie'].some((c) => /^opsdesk_token=;/.test(c)));
    assert.equal((await agent.get('/')).status, 302);
  });
});

describe('ADMIN_PASSWORD_HASH (bcrypt)', () => {
  let ctx;
  before(async () => {
    ctx = await makeApp({ ADMIN_PASSWORD: '', ADMIN_PASSWORD_HASH: bcrypt.hashSync('hashli-sifre', 4) });
  });
  after(() => ctx.cleanup());

  it('bcrypt hash ile giriş yapılır, yanlış şifre reddedilir', async () => {
    await login(ctx.app, { password: 'hashli-sifre' });
    await assert.rejects(login(ctx.app, { password: 'hashli-sifre ' }), /401/);
  });
});

describe('Login rate limit (15 dk / 10 deneme)', () => {
  let ctx;
  before(async () => { ctx = await makeApp(); });
  after(() => ctx.cleanup());

  it('10 denemeden sonra 429 döner', async () => {
    const agent = request.agent(ctx.app);
    const token = await csrf(agent);
    for (let i = 0; i < 10; i += 1) {
      const res = await agent.post('/login').type('form').send({ _csrf: token, email: ADMIN_EMAIL, password: `x${i}` });
      assert.equal(res.status, 401);
    }
    const blocked = await agent.post('/login').type('form').send({ _csrf: token, email: ADMIN_EMAIL, password: PASSWORD });
    assert.equal(blocked.status, 429);
    assert.match(blocked.headers.ratelimit || blocked.headers['ratelimit-policy'] || '', /10/);
  });
});
