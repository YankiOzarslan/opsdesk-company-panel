'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, login, csrf, post, PASSWORD, ADMIN_EMAIL, request } = require('./helpers');

const tokenOf = (text) => {
  const m = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(text);
  assert.ok(m, 'bağlantı bulunamadı');
  return m[1];
};

async function setPassword(app, token, password, confirm = password) {
  const agent = request.agent(app);
  const t = await csrf(agent, `/reset-password/${token}`);
  return agent.post(`/reset-password/${token}`).type('form').send({ _csrf: t, password, password_confirm: confirm });
}

describe('Kullanıcı hesapları', () => {
  let ctx;
  let admin;
  before(async () => {
    ctx = await makeApp();
    admin = await login(ctx.app);
  });
  after(() => ctx.cleanup());
  beforeEach(() => { ctx.mailer.sent = []; ctx.mailer.configured = true; });

  it('ADMIN_EMAIL yönetici olarak oluşturulur, parola bcrypt ile saklanır', () => {
    const u = ctx.users.byEmail(ADMIN_EMAIL);
    assert.equal(u.role, 'admin');
    assert.match(u.password_hash, /^\$2[aby]\$/);
    assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM users').n, 1);
  });

  it('e-posta büyük/küçük harf ve boşluk duyarsız giriş', async () => {
    await login(ctx.app, { email: `  ${ADMIN_EMAIL.toUpperCase()} ` });
  });

  it('yönetici doğrudan kullanıcı oluşturur; ilk girişte parola değiştirilir ve yönetim yetkisi verilmez', async () => {
    const temporary='baslangic-parola-123';
    const res=await post(admin,'/users',{email:'Ayse@OpsDesk.test',name:'Ayşe',role:'user',password:temporary,password_confirm:temporary});
    assert.equal(res.status,302);assert.equal(ctx.mailer.sent.length,0);
    const first=request.agent(ctx.app);const token=await csrf(first,'/login');
    await first.post('/login').type('form').send({_csrf:token,email:'ayse@opsdesk.test',password:temporary});
    assert.equal((await first.get('/')).headers.location,'/account');
    first.csrfToken=await csrf(first,'/account');
    assert.equal((await post(first,'/account/password',{current_password:temporary,password:'ayse-parola-123',password_confirm:'ayse-parola-123'})).status,302);
    assert.equal((await first.get('/')).status,200);

    const ayse = await login(ctx.app, { email: 'ayse@opsdesk.test', password: 'ayse-parola-123' });
    assert.equal((await ayse.get('/users')).status, 403);
    assert.equal((await post(ayse, '/users', { email: 'x@opsdesk.test', role: 'admin' })).status, 403);
    assert.doesNotMatch((await ayse.get('/')).text, /href="\/users"/);
    assert.match((await admin.get('/')).text, /href="\/users"/);
    const created = await post(ayse, '/contacts', { name: 'İrtibat kişisi' });
    assert.equal(created.status, 302);
    assert.equal(ctx.db.get("SELECT changed_by FROM audit_log WHERE entity_type = 'contacts' AND entity_name = 'İrtibat kişisi' AND action = 'create'").changed_by, 'ayse@opsdesk.test');
    assert.equal((await post(ayse, '/team', { name: 'Yetkisiz ekip üyesi' })).status, 403);
  });

  it('parolamı unuttum: kayıtlı olmayan adres aynı yanıtı alır, e-posta gönderilmez; Host başlığı bağlantıya girmez', async () => {
    const agent = request.agent(ctx.app);
    let t = await csrf(agent, '/forgot-password');
    const unknown = await agent.post('/forgot-password').type('form').send({ _csrf: t, email: 'yok@opsdesk.test' });
    assert.equal(unknown.status, 200);
    assert.match(unknown.text, /kayıtlıysa sıfırlama bağlantısı gönderildi/);
    assert.equal(ctx.mailer.sent.length, 0);

    t = await csrf(agent, '/forgot-password');
    const known = await agent.post('/forgot-password').set('Host', 'evil.example').type('form').send({ _csrf: t, email: ADMIN_EMAIL });
    assert.equal(known.status, 200);
    assert.match(known.text, /kayıtlıysa sıfırlama bağlantısı gönderildi/);
    assert.equal(ctx.mailer.sent.length, 1);
    assert.doesNotMatch(ctx.mailer.sent[0].text, /evil\.example/);
  });

  it('sıfırlama: eski oturumlar ve eski parola geçersiz olur, süresi dolan bağlantı reddedilir', async () => {
    const other = await login(ctx.app);
    const agent = request.agent(ctx.app);
    const t = await csrf(agent, '/forgot-password');
    await agent.post('/forgot-password').type('form').send({ _csrf: t, email: ADMIN_EMAIL });
    const token = tokenOf(ctx.mailer.sent[0].text);
    assert.equal((await setPassword(ctx.app, token, 'yeni-admin-parola-1')).status, 302);
    assert.equal((await other.get('/')).status, 302, 'eski oturum kapanmalı');
    await assert.rejects(login(ctx.app), /401/);
    admin = await login(ctx.app, { password: 'yeni-admin-parola-1' });

    const u = ctx.users.byEmail(ADMIN_EMAIL);
    const expired = ctx.users.createToken(u.id, 'reset');
    ctx.db.run("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL");
    assert.equal((await request(ctx.app).get(`/reset-password/${expired}`)).status, 400);
    assert.equal((await request(ctx.app).get('/reset-password/gecersiz-token-degeri-xxxxxxxx')).status, 400);
    const stored = ctx.db.get('SELECT token_hash FROM password_resets ORDER BY id DESC LIMIT 1').token_hash;
    assert.notEqual(stored, expired, 'token düz metin saklanmamalı');
  });

  it('hesabım: mevcut parola yanlışsa 422, doğruysa değişir ve oturum açık kalır', async () => {
    const bad = await post(admin, '/account/password', { current_password: 'yanlis', password: 'en-yeni-parola-1', password_confirm: 'en-yeni-parola-1' });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /Mevcut parola hatalı/);
    const ok = await post(admin, '/account/password', { current_password: 'yeni-admin-parola-1', password: 'en-yeni-parola-1', password_confirm: 'en-yeni-parola-1' });
    assert.equal(ok.status, 302);
    assert.equal((await admin.get('/account')).status, 200);
    await login(ctx.app, { password: 'en-yeni-parola-1' });
    assert.equal((await post(admin, '/account', { name: 'Example Admin' })).status, 302);
    assert.equal(ctx.users.byEmail(ADMIN_EMAIL).name, 'Example Admin');
  });

  it('SMTP olmadan kullanıcı oluşturulur ve davet gönderilmez',async()=>{
    ctx.mailer.configured=false;
    const res=await post(admin,'/users',{email:'mehmet@opsdesk.test',name:'Mehmet',role:'user',password:'mehmet-ilk-parola',password_confirm:'mehmet-ilk-parola'});
    assert.equal(res.status,302);assert.equal(ctx.mailer.sent.length,0);
    assert.ok(ctx.users.byEmail('mehmet@opsdesk.test').password_hash);
    assert.doesNotMatch((await admin.get('/users')).text,/Oluştur ve davet gönder/);
  });

  it('pasif yapılan kullanıcının oturumu hemen kapanır; son yönetici kendini düşüremez; kendini silemez', async () => {
    const ayseRow = ctx.users.byEmail('ayse@opsdesk.test');
    const ayse = await login(ctx.app, { email: 'ayse@opsdesk.test', password: 'ayse-parola-123' });
    assert.equal((await post(admin, `/users/${ayseRow.id}`, { email: 'ayse@opsdesk.test', name: 'Ayşe', role: 'user', active: '0' })).status, 302);
    assert.equal((await ayse.get('/')).status, 302);
    await assert.rejects(login(ctx.app, { email: 'ayse@opsdesk.test', password: 'ayse-parola-123' }), /401/);

    const me = ctx.users.byEmail(ADMIN_EMAIL);
    const demote = await post(admin, `/users/${me.id}`, { email: ADMIN_EMAIL, role: 'user', active: '1' });
    assert.equal(demote.status, 422);
    assert.equal(ctx.users.byEmail(ADMIN_EMAIL).role, 'admin');
    await post(admin, `/users/${me.id}/delete`, {});
    assert.ok(ctx.users.byEmail(ADMIN_EMAIL));
    assert.equal((await post(admin, '/users', { email: ADMIN_EMAIL.toUpperCase(), role: 'user' })).status, 422);
    assert.equal((await post(admin, `/users/${ayseRow.id}/delete`, {})).status, 302);
    assert.equal(ctx.users.byEmail('ayse@opsdesk.test'), null);
  });

  it('CSRF olmadan parola sıfırlama POST 403; sayfalar 200', async () => {
    assert.equal((await request(ctx.app).post('/forgot-password').type('form').send({ email: ADMIN_EMAIL })).status, 403);
    for (const p of ['/account', '/users', '/users/new']) assert.equal((await admin.get(p)).status, 200, p);
    assert.equal((await request(ctx.app).get('/forgot-password')).status, 200);
  });
});

describe('Parola sıfırlama rate limit', () => {
  let ctx;
  before(async () => { ctx = await makeApp(); });
  after(() => ctx.cleanup());

  it('15 dakikada 5 istekten sonra 429', async () => {
    const agent = request.agent(ctx.app);
    const t = await csrf(agent, '/forgot-password');
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await agent.post('/forgot-password').type('form').send({ _csrf: t, email: `x${i}@opsdesk.test` })).status, 200);
    }
    assert.equal((await agent.post('/forgot-password').type('form').send({ _csrf: t, email: ADMIN_EMAIL })).status, 429);
  });
});
