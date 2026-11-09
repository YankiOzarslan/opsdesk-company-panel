'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, login, post, idFromLocation } = require('./helpers');
const { migrate } = require('../src/schema');

const PAGES = ['/', '/projects', '/projects/new', '/domains', '/domains/new', '/servers', '/servers/new', '/clients', '/clients/new', '/contacts', '/contacts/new', '/team', '/team/new', '/audit', '/backups'];

describe('CRUD smoke testleri', () => {
  let ctx;
  let agent;
  const ids = {};
  before(async () => {
    ctx = await makeApp();
    agent = await login(ctx.app);
  });
  after(() => ctx.cleanup());

  it('ilk açılışta DB boş, migration idempotent', () => {
    for (const t of ['contacts', 'domains', 'servers', 'projects', 'clients', 'team_members', 'audit_log']) {
      assert.equal(ctx.db.get(`SELECT COUNT(*) AS n FROM ${t}`).n, 0, t);
    }
    migrate(ctx.db);
    migrate(ctx.db);
    assert.ok(ctx.db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'"));
  });

  it('boş DB ile tüm sayfalar 200 döner', async () => {
    for (const p of PAGES) assert.equal((await agent.get(p)).status, 200, p);
  });

  it('tüm varlıklar oluşturulur', async () => {
    const create = async (key, data) => {
      const res = await post(agent, `/${key}`, data);
      assert.equal(res.status, 302, `${key}: ${res.status}`);
      ids[key] = idFromLocation(res);
      assert.ok(ids[key]);
    };
    await create('contacts', { name: 'Ayşe Yılmaz', role: 'Müşteri IT', email: 'ayse@ornek.com', phone: '+90 555 000 00 00', company: 'Örnek' });
    await create('team', { name: 'Can Demir', email: 'can@example.test' });
    await create('clients', { name: 'Örnek A.Ş.', contact_name: 'Mehmet', email: 'info@ornek.com', it_contact_name: 'Ayşe', it_contact_email: 'it@ornek.com' });
    await create('servers', { name: 'web-01', hostname: 'web01.ornek.com', ip_address: '10.0.0.5', provider: 'Hetzner', server_type: 'vps', os: 'Ubuntu 24.04', manager_contact_id: String(ids.contacts) });
    await create('domains', { name: 'Ornek.COM', registrar: 'Natro', expiry_date: '2030-01-01', managed_by_us: '1', dns_manager_contact_id: String(ids.contacts) });
    await create('projects', {
      name: 'Kurumsal Site', status: 'active', domain_id: String(ids.domains), server_id: String(ids.servers), client_id: String(ids.clients),
      client_contact_id: String(ids.contacts), technology: 'WordPress', tech_version: '6.5', language: 'PHP', language_version: '8.2',
      repo_url: 'https://github.com/opsdesk/site', backup_enabled: '1', backup_schedule: 'Günlük',
    });
    assert.equal(ctx.db.get('SELECT name FROM domains WHERE id = ?', [ids.domains]).name, 'ornek.com');
    assert.equal(ctx.db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'create'").n, 6);
  });

  it('doluyken tüm liste/detay/düzenleme sayfaları 200 döner', async () => {
    const urls = [...PAGES];
    for (const [key, id] of Object.entries(ids)) urls.push(`/${key}/${id}`, `/${key}/${id}/edit`);
    urls.push(`/projects?technology=WordPress&tech_version=6.5&server_id=${ids.servers}&status=active&q=Kurumsal`, '/projects?server_id=none', '/domains?expiring=90&managed_by_us=1', '/audit?action=create&entity_type=projects', '/contacts?company=Örnek');
    for (const u of urls) assert.equal((await agent.get(encodeURI(u))).status, 200, u);
  });

  it('liste filtreleri çalışır', async () => {
    assert.match((await agent.get('/projects?technology=WordPress')).text, /Kurumsal Site/);
    assert.doesNotMatch((await agent.get('/projects?technology=Laravel')).text, /Kurumsal Site/);
    assert.match((await agent.get(`/projects?server_id=${ids.servers}`)).text, /Kurumsal Site/);
    assert.doesNotMatch((await agent.get('/projects?status=archived')).text, /Kurumsal Site/);
    assert.match((await agent.get('/projects?q=kurumsal')).text, /Kurumsal Site/);
    assert.match((await agent.get('/clients')).text, /it@ornek\.com/);
    assert.match((await agent.get('/team')).text, /can@example\.test/);
  });

  it('proje listesinde müşteri ve sürüm araması, yedekleme filtresi çalışır', async () => {
    for(const q of ['Örnek A.Ş.','6.5']) assert.match((await agent.get('/projects').query({q})).text,/Kurumsal Site/);
    assert.match((await agent.get('/projects?backup_enabled=1')).text,/Kurumsal Site/);
    assert.doesNotMatch((await agent.get('/projects?backup_enabled=0')).text,/Kurumsal Site/);
    assert.match((await agent.get('/projects?backup_enabled=invalid')).text,/Kurumsal Site/);
  });

  it('update yalnızca değişen alanları audit log’a yazar (eski → yeni)', async () => {
    const current = ctx.db.get('SELECT * FROM projects WHERE id = ?', [ids.projects]);
    const form = {};
    for (const k of ['name', 'status', 'domain_id', 'server_id', 'client_id', 'client_contact_id', 'technology', 'tech_version', 'language', 'language_version', 'repo_url', 'backup_schedule']) {
      if (current[k] !== null) form[k] = String(current[k]);
    }
    form.backup_enabled = '1';
    form.tech_version = '6.6';
    form.status = 'maintenance';
    const res = await post(agent, `/projects/${ids.projects}`, form);
    assert.equal(res.status, 302);
    const rows = ctx.db.all("SELECT field, old_value, new_value, changed_by FROM audit_log WHERE entity_type = 'projects' AND entity_id = ? AND action = 'update' ORDER BY field", [ids.projects]);
    assert.deepEqual(rows, [
      { field: 'status', old_value: 'active', new_value: 'maintenance', changed_by: 'admin@opsdesk.test' },
      { field: 'tech_version', old_value: '6.5', new_value: '6.6', changed_by: 'admin@opsdesk.test' },
    ]);
    const show = await agent.get(`/projects/${ids.projects}`);
    assert.match(show.text, /Teknoloji sürümü:/);

    const again = await post(agent, `/projects/${ids.projects}`, { ...form });
    assert.equal(again.status, 302);
    assert.equal(ctx.db.get("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'projects' AND action = 'update'").n, 2);
  });

  it('validation hataları 422 ile formu tekrar gösterir', async () => {
    const res = await post(agent, '/domains', { name: 'gecersiz domain' });
    assert.equal(res.status, 422);
    assert.match(res.text, /Geçerli bir domain adı/);
    assert.equal((await post(agent, '/contacts', { name: '' })).status, 422);
    assert.equal((await post(agent, '/contacts', { name: 'X', email: 'mail-degil' })).status, 422);
    assert.equal((await post(agent, '/projects', { name: 'X', status: 'uydurma' })).status, 422);
    assert.equal((await post(agent, '/domains', { name: 'x.com', expiry_date: '2025-13-45' })).status, 422);
  });

  it('aynı domain ikinci kez eklenemez (UNIQUE) → 409', async () => {
    const res = await post(agent, '/domains', { name: 'ornek.com' });
    assert.equal(res.status, 409);
  });

  it('silme: delete audit yazılır ve bağlı FK referansları boşaltılır', async () => {
    const res = await post(agent, `/servers/${ids.servers}/delete`);
    assert.equal(res.status, 302);
    assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM servers').n, 0);
    assert.equal(ctx.db.get('SELECT server_id FROM projects WHERE id = ?', [ids.projects]).server_id, null);
    const del = ctx.db.get("SELECT * FROM audit_log WHERE entity_type = 'servers' AND action = 'delete'");
    assert.equal(del.entity_name, 'web-01');
    assert.match(del.old_value, /10\.0\.0\.5/);
    const fk = ctx.db.get("SELECT * FROM audit_log WHERE entity_type = 'projects' AND field = 'server_id'");
    assert.equal(fk.old_value, String(ids.servers));
    assert.equal(fk.new_value, null);
    assert.equal((await agent.get(`/servers/${ids.servers}`)).status, 404);
    assert.equal((await agent.get('/audit')).status, 200);
  });

  it('tüm varlıklar silinebilir', async () => {
    for (const key of ['projects', 'domains', 'clients', 'contacts', 'team']) {
      assert.equal((await post(agent, `/${key}/${ids[key]}/delete`)).status, 302, key);
      assert.equal((await agent.get(`/${key}/${ids[key]}`)).status, 404, key);
    }
    assert.equal((await post(agent, '/team/99999/delete')).status, 404);
  });
});
