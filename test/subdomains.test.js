'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, login, post, idFromLocation } = require('./helpers');
const { migrate } = require('../src/schema');
const lookup = require('../src/lookup');

describe('Ana domaine bağlı alt domainler', () => {
  let ctx, agent, parentId, childId;
  before(async () => {
    ctx = await makeApp(); agent = await login(ctx.app);
    parentId = idFromLocation(await post(agent, '/domains', { name: 'ornek.com', managed_by_us: '1' }));
    assert.ok(parentId);
  });
  after(() => ctx.cleanup());
  it('migration tekrar çalışır; form ve ekleme bağlantısı açılır', async () => {
    migrate(ctx.db); migrate(ctx.db);
    const page = await agent.get(`/domains/${parentId}/subdomains/new`);
    assert.equal(page.status, 200);
    assert.match(page.text, /data-subdomain-parent="ornek.com"/);
    assert.match((await agent.get(`/domains/${parentId}`)).text, /Alt domain ekle/);
    assert.equal((await agent.get('/domains/999999/subdomains/new')).status, 404);
    assert.equal((await post(agent, '/domains/999999/subdomains', { label: 'api' })).status, 404);
  });
  it('ön ek normalleşir; üst domain, proje ve audit bağlantıları çalışır', async () => {
    const response = await post(agent, `/domains/${parentId}/subdomains`, { label: ' PANEL ', notes: 'Müşteri paneli', parent_domain_id: '99999' });
    assert.equal(response.status, 302); childId = idFromLocation(response);
    const child = ctx.db.get('SELECT * FROM domains WHERE id = ?', [childId]);
    assert.equal(child.name, 'panel.ornek.com'); assert.equal(child.parent_domain_id, parentId);
    assert.equal(child.managed_by_us, 1); assert.equal(child.expiry_date, null);
    assert.equal(ctx.db.get("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'domains' AND entity_id = ? AND action = 'create'", [childId]).n, 1);
    assert.match((await agent.get(`/domains/${parentId}`)).text, /panel\.ornek\.com/);
    assert.match((await agent.get(`/domains/${childId}`)).text, /Bu bir alt domain/);
    const project = await post(agent, '/projects', { name: 'Panel projesi', domain_id: String(childId) });
    assert.equal(project.status, 302);
    assert.equal(ctx.db.get('SELECT domain_id FROM projects WHERE id = ?', [idFromLocation(project)]).domain_id, childId);
    assert.match((await agent.get(`/domains?parent_domain_id=${parentId}`)).text, /panel\.ornek\.com/);
    assert.doesNotMatch((await agent.get('/domains?parent_domain_id=none')).text, /https:\/\/panel\.ornek\.com/);
  });
  it('boş, hatalı, tekrarlı, uzun girdiler ve CSRF reddedilir', async () => {
    for (const label of ['', 'bad label', '-api', 'https://api', 'bad..api', 'x'.repeat(64), '<script>alert(1)</script>']) {
      assert.equal((await post(agent, `/domains/${parentId}/subdomains`, { label })).status, 422, label);
    }
    assert.equal((await post(agent, `/domains/${parentId}/subdomains`, { label: 'panel' })).status, 409);
    assert.equal((await post(agent, `/domains/${parentId}/subdomains`, { label: 'api', status: 'invalid' })).status, 422);
    assert.equal((await agent.post(`/domains/${parentId}/subdomains`).type('form').send({ label: 'api' })).status, 403);
    assert.equal((await post(agent, `/domains/${parentId}/subdomains`, { label: 'test.api' })).status, 302);
  });
  it('CRUD: yanlış bağlantı, döngü ve bağlı kayıtları bozacak yeniden adlandırma engellenir', async () => {
    for (const [url, data] of [
      ['/domains', { name: 'other.com', parent_domain_id: String(parentId) }],
      ['/domains', { name: 'api.ornek.com', parent_domain_id: '99999' }],
      [`/domains/${parentId}`, { name: 'ornek.com', parent_domain_id: String(parentId) }],
      [`/domains/${parentId}`, { name: 'yeniornek.com' }],
      [`/domains/${childId}`, { name: 'baska.net', parent_domain_id: String(parentId) }],
      [`/domains/${parentId}`, { name: 'ornek.com', parent_domain_id: String(childId) }],
    ]) assert.equal((await post(agent, url, data)).status, 422);
    assert.equal((await post(agent, `/domains/${childId}`, { name: 'portal.ornek.com', parent_domain_id: String(parentId) })).status, 302);
    const nested = await post(agent, `/domains/${childId}/subdomains`, { label: 'test' });
    assert.equal(nested.status, 302);
    assert.equal(ctx.db.get('SELECT name FROM domains WHERE id = ?', [idFromLocation(nested)]).name, 'test.portal.ornek.com');
  });
  it('alt domain için registrar sorgulanmaz; SSL sorgulanır; sahte yenileme uyarısı oluşmaz', async () => {
    const originalRegistration = lookup.lookupRegistration, originalSsl = lookup.lookupSsl;
    const registrationHosts = [], sslHosts = [];
    lookup.lookupRegistration = async host => { registrationHosts.push(host); return { expiry_date: '2030-01-01' }; };
    lookup.lookupSsl = async host => { sslHosts.push(host); return { ssl_expiry: '2030-02-01', ssl_issuer: 'Test CA' }; };
    const delay = ctx.expirySync.delayMs; ctx.expirySync.delayMs = 0;
    try {
      const result = await ctx.expirySync.run();
      assert.deepEqual(registrationHosts, ['ornek.com']); assert.ok(sslHosts.includes('portal.ornek.com'));
      assert.equal(result.checked, 1); assert.deepEqual(result.failed, []);
      assert.equal(ctx.db.get('SELECT expiry_date FROM domains WHERE id = ?', [childId]).expiry_date, null);
      assert.equal(ctx.db.get('SELECT ssl_issuer FROM domains WHERE id = ?', [childId]).ssl_issuer, 'Test CA');
      assert.doesNotMatch((await agent.get('/')).text, /Eksik tarihleri ekleyin/);
    } finally { ctx.expirySync.delayMs = delay; lookup.lookupRegistration = originalRegistration; lookup.lookupSsl = originalSsl; }
  });
  it('ana domain silinse bile alt domain ve projesi korunur; bağlantı audit ile temizlenir', async () => {
    assert.equal((await post(agent, `/domains/${parentId}/delete`)).status, 302);
    const child = ctx.db.get('SELECT * FROM domains WHERE id = ?', [childId]);
    assert.ok(child); assert.equal(child.parent_domain_id, null);
    assert.equal(ctx.db.get('SELECT domain_id FROM projects WHERE name = ?', ['Panel projesi']).domain_id, childId);
    assert.ok(ctx.db.get("SELECT id FROM audit_log WHERE entity_type = 'domains' AND entity_id = ? AND field = 'parent_domain_id' AND new_value IS NULL", [childId]));
  });
});
