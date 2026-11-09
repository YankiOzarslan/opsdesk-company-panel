'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, login, post, idFromLocation, csrf, zipOf, request } = require('./helpers');

describe('Güvenlik', () => {
  let ctx;
  let agent;
  before(async () => {
    ctx = await makeApp();
    agent = await login(ctx.app);
  });
  after(() => ctx.cleanup());

  describe('CSRF', () => {
    const targets = ['/projects', '/domains', '/servers', '/clients', '/contacts', '/team', '/projects/1', '/projects/1/delete', '/backups', '/logout'];
    for (const url of targets) {
      it(`CSRF token olmadan POST ${url} → 403`, async () => {
        const res = await agent.post(url).type('form').send({ name: 'csrf-yok' });
        assert.equal(res.status, 403);
      });
    }

    it('login formu da CSRF ister', async () => {
      const res = await request(ctx.app).post('/login').type('form').send({ email: 'admin@opsdesk.test', password: 'x' });
      assert.equal(res.status, 403);
    });

    it('yanlış CSRF token → 403, hiçbir kayıt oluşmaz', async () => {
      const res = await agent.post('/team').type('form').send({ _csrf: 'a'.repeat(64), name: 'Sahte' });
      assert.equal(res.status, 403);
      assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM team_members').n, 0);
    });

    it('başka oturumun token’ı kabul edilmez', async () => {
      const other = request.agent(ctx.app);
      const foreign = await csrf(other);
      const res = await agent.post('/team').type('form').send({ _csrf: foreign, name: 'Sahte' });
      assert.equal(res.status, 403);
    });

    it('multipart detect isteği X-CSRF-Token header olmadan → 403', async () => {
      const res = await agent.post('/projects/detect').set('Accept', 'application/json').attach('archive', zipOf({ 'index.html': '<html></html>' }), 'a.zip');
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
    });
  });

  describe('HTTP başlıkları ve limitler', () => {
    it('helmet başlıkları var, CSP upgrade-insecure-requests içermiyor', async () => {
      const res = await agent.get('/');
      const csp = res.headers['content-security-policy'];
      assert.ok(csp);
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.doesNotMatch(csp, /upgrade-insecure-requests/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-powered-by'], undefined);
      assert.equal(res.headers['strict-transport-security'], undefined);
    });

    it('100 KB üzeri body → 413', async () => {
      const res = await post(agent, '/team', { name: 'Büyük', notes: 'x'.repeat(110 * 1024) });
      assert.equal(res.status, 413);
    });
  });

  describe('Mass assignment / timestamp tampering', () => {
    it('create: id, created_at, updated_at, created_by, updated_by yok sayılır', async () => {
      const res = await post(agent, '/projects', {
        name: 'Tamper', id: '999', created_at: '1999-01-01T00:00:00.000Z', updated_at: '1999-01-01T00:00:00.000Z',
        created_by: 'hacker', updated_by: 'hacker', bogus_column: 'x',
      });
      assert.equal(res.status, 302);
      const id = idFromLocation(res);
      assert.notEqual(id, 999);
      const row = ctx.db.get('SELECT * FROM projects WHERE id = ?', [id]);
      assert.notEqual(row.created_at.slice(0, 4), '1999');
      assert.ok(Date.now() - Date.parse(row.created_at) < 60_000);
      assert.equal(row.created_by, 'admin@opsdesk.test');
      assert.equal(row.updated_by, 'admin@opsdesk.test');
      assert.equal(row.bogus_column, undefined);
    });

    it('update: created_at/created_by değişmez, updated_by sunucu tarafından set edilir', async () => {
      const id = idFromLocation(await post(agent, '/contacts', { name: 'Kişi' }));
      const before1 = ctx.db.get('SELECT * FROM contacts WHERE id = ?', [id]);
      const res = await post(agent, `/contacts/${id}`, { name: 'Kişi 2', created_at: '2000-01-01', updated_at: '2000-01-01', id: '555' });
      assert.equal(res.status, 302);
      const after1 = ctx.db.get('SELECT * FROM contacts WHERE id = ?', [id]);
      assert.equal(after1.created_at, before1.created_at);
      assert.notEqual(after1.updated_at.slice(0, 4), '2000');
      assert.equal(after1.name, 'Kişi 2');
      assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM contacts WHERE id = 555').n, 0);
      const fields = ctx.db.all("SELECT field FROM audit_log WHERE entity_type = 'contacts' AND entity_id = ? AND action = 'update'", [id]).map((r) => r.field);
      assert.deepEqual(fields, ['name']);
    });

    it('tekrarlanan parametreler (HPP) tek skaler değere indirgenir', async () => {
      const res = await agent.post('/team').type('form').send(`_csrf=${agent.csrfToken}&name=a&name=b&name[x]=c`);
      assert.equal(res.status, 302);
      const row = ctx.db.get('SELECT name FROM team_members WHERE id = ?', [idFromLocation(res)]);
      assert.equal(typeof row.name, 'string');
      assert.ok(!row.name.includes(','));
    });

    it('var olmayan FK referansı kabul edilmez', async () => {
      const res = await post(agent, '/projects', { name: 'FK', server_id: '424242' });
      assert.equal(res.status, 422);
    });

    it('javascript: URL reddedilir', async () => {
      const res = await post(agent, '/projects', { name: 'URL', repo_url: 'javascript:alert(1)' });
      assert.equal(res.status, 422);
    });
  });

  describe('SQL injection / XSS', () => {
    it('arama ve filtre parametreleri SQL olarak çalışmaz', async () => {
      const count = ctx.db.get('SELECT COUNT(*) AS n FROM projects').n;
      for (const url of [
        "/projects?q=%27%20OR%201%3D1--",
        "/projects?q=x%27%3B%20DROP%20TABLE%20projects%3B--",
        "/projects?technology=%27%20OR%20%271%27%3D%271&server_id=1%20OR%201%3D1",
        '/projects?q=%25&status=active%27--',
        "/audit?entity_type=projects%27--&q=%27",
      ]) {
        assert.equal((await agent.get(url)).status, 200, url);
      }
      assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM projects').n, count);
      const res = await agent.get('/projects?q=%27%20OR%201%3D1--');
      assert.match(res.text, /Sonuç bulunamadı/);
    });

    it('kullanıcı girdisi HTML olarak escape edilir', async () => {
      const payload = '<script>alert(1)</script>';
      const id = idFromLocation(await post(agent, '/projects', { name: `XSS ${payload}`, notes: `"><img src=x onerror=alert(1)>` }));
      for (const url of [`/projects/${id}`, `/projects/${id}/edit`, '/projects', '/', '/audit']) {
        const res = await agent.get(url);
        assert.equal(res.status, 200);
        assert.ok(!res.text.includes(payload), `${url} ham script içeriyor`);
        assert.ok(!res.text.includes('<img src=x'), `${url} ham img içeriyor`);
      }
      assert.match((await agent.get(`/projects/${id}`)).text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    });
  });

  describe('Yedek indirme path traversal', () => {
    it('backup dizini dışına çıkılamaz', async () => {
      for (const p of ['..%2Fdata%2Fopsdesk.db', '..%2F..%2F..%2Fetc%2Fpasswd', '%2Fetc%2Fpasswd', 'opsdesk.db', 'opsdesk-20260101-000000-manual.sqlite%00.txt', '..%5C..%5Cdata%5Copsdesk.db']) {
        const res = await agent.get(`/backups/download/${p}`);
        assert.equal(res.status, 404, p);
      }
    });

    it('geçersiz isimli dosya silinemez', async () => {
      const res = await post(agent, '/backups/delete/..%2Fdata%2Fopsdesk.db');
      assert.equal(res.status, 404);
    });
  });
});
