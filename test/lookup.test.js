'use strict';
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, login, post } = require('./helpers');
const lookup = require('../src/lookup');

const TR_WHOIS = `** Domain Name: ornek.com.tr
Domain Status: Active

** Registrar:
NIC Handle\t\t: ogv40
Organization Name\t: ODTÜ GELİŞTİRME VAKFI BİLGİ TEKNOLOJİLERİ SAN. VE TİC. A.Ş.

** Domain Servers:
ns1.ornek.com.tr 203.0.113.10
ns2.ornek.com.tr 203.0.113.10

** Additional Info:
Created on..............: 2012-Sep-25.
Expires on..............: 2027-Sep-24.
`;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeNet(state) {
  return {
    fetch: async (u, opts = {}) => {
      state.fetched.push(u);
      if (u === 'https://data.iana.org/rdap/dns.json') return json({ services: [[['games', 'com'], ['https://rdap.example/']]] });
      if (u === 'https://rdap.example/domain/example.com') {
        return json({
          events: [{ eventAction: 'registration', eventDate: '2021-10-01T14:23:59Z' }, { eventAction: 'expiration', eventDate: state.expiry || '2027-10-01T14:23:59Z' }],
          entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Automattic Inc.']]] }],
          nameservers: [{ ldhName: 'NS1.example.com.tr' }, { ldhName: 'ns2.example.com.tr' }],
        });
      }
      if (u === 'https://rdap.example/domain/yok.com') return new Response('', { status: 404 });
      if (u.startsWith('https://rdap.org/ip/')) {
        return json({ name: 'EXAMPLE-NET', country: 'TR', startAddress: '203.0.113.0', endAddress: '203.0.113.255', remarks: [{ description: ['EXAMPLE NETWORKS - Cloud Hosting'] }] });
      }
      if (u === 'https://example.com/') {
        assert.equal(opts.redirect, 'manual');
        const res = new Response('<html><head><meta name="author" content="Custom CMS" /></head></html>', { status: 200, headers: { server: 'nginx' } });
        return res;
      }
      throw new Error(`beklenmeyen istek ${u}`);
    },
    dns: {
      resolve4: async (h) => (state.ips[h] || Promise.reject(new Error('ENOTFOUND'))),
      resolve6: async () => [],
      reverse: async (ip) => (ip === '203.0.113.10' ? ['cloud.example.com.tr'] : []),
    },
    tlsCert: async (host) => (host === 'example.com' ? { validTo: 'Dec 30 23:59:59 2026 GMT', issuer: "Let's Encrypt", authorized: true } : null),
    whois: async (host, q) => {
      state.whois.push([host, q]);
      if (host === 'whois.trabis.gov.tr') return TR_WHOIS;
      throw new Error('whois yok');
    },
  };
}

describe('Dış kaynaktan bilgi getirme', () => {
  let ctx;
  let agent;
  let state;
  let restore;
  before(async () => {
    ctx = await makeApp();
    agent = await login(ctx.app);
  });
  after(() => ctx.cleanup());
  beforeEach(() => {
    state = { fetched: [], whois: [], ips: { 'example.com': ['203.0.113.10'], 'cloud.example.com.tr': ['203.0.113.10'], 'ic.ornek.com': ['10.0.0.5'], 'ornek.com.tr': ['203.0.113.10'] } };
    restore = lookup._setDeps(fakeNet(state));
  });
  afterEach(() => restore());

  const ask = (key, query) => agent.post(`/${key}/lookup`).set('X-CSRF-Token', agent.csrfToken).set('Accept', 'application/json').send({ query });

  it('domain kaydı tam URL ile gönderildiğinde yalnızca hostname saklanır', () => {
    const { validate } = require('../src/validate');
    const { ENTITIES } = require('../src/entities');
    const result = validate(ENTITIES.domains, { name: 'https://portal.example.org/' }, () => true);
    assert.equal(result.values.name, 'portal.example.org');
    assert.equal(result.errors.name, undefined);
    const invalid = validate(ENTITIES.domains, { name: 'https://user:password@example.com/' }, () => true);
    assert.ok(invalid.errors.name);
  });

  it('tarih formatları ayrıştırılır', () => {
    assert.equal(lookup.parseLooseDate('2027-Sep-24.'), '2027-09-24');
    assert.equal(lookup.parseLooseDate('2027-10-01T14:23:59Z'), '2027-10-01');
    assert.equal(lookup.parseLooseDate('2027-10-01T22:30:00Z'), '2027-10-02');
    assert.equal(lookup.parseLooseDate('24.09.2027'), '2027-09-24');
    assert.equal(lookup.parseLooseDate('2027-02-30'), null);
    assert.equal(lookup.parseLooseDate('bilinmiyor'), null);
  });

  it('RDAP: registrar, bitiş tarihi, NS ve site ipuçları gelir; adres normalize edilir', async () => {
    const res = await ask('domains', 'https://www.example.com/oyunlar');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.fields, {
      name: 'example.com',
      registrar: 'Automattic Inc.',
      registered_at: '2021-10-01',
      expiry_date: '2027-10-01',
      nameservers: 'ns1.example.com.tr\nns2.example.com.tr',
      dns_managed_by: 'example.com.tr',
      ssl_issuer: "Let's Encrypt",
      ssl_expiry: '2026-12-31',
    });
    const summary = res.body.summary.join(' | ');
    assert.match(summary, /Kaynak: RDAP/);
    assert.match(summary, /203\.0\.113\.10 \(cloud\.example\.com\.tr\)/);
    assert.match(summary, /nginx/);
    assert.match(summary, /Custom CMS/);
  });

  it('.com.tr: RDAP olmadığı için TRABIS WHOIS kullanılır', async () => {
    const res = await ask('domains', 'ornek.com.tr');
    assert.equal(res.status, 200);
    assert.deepEqual(state.whois, [['whois.trabis.gov.tr', 'ornek.com.tr']]);
    assert.equal(res.body.fields.expiry_date, '2027-09-24');
    assert.equal(res.body.fields.registered_at, '2012-09-25');
    assert.match(res.body.fields.registrar, /ODTÜ GELİŞTİRME VAKFI/);
    assert.equal(res.body.fields.nameservers, 'ns1.ornek.com.tr\nns2.ornek.com.tr');
    assert.match(res.body.summary.join(' '), /WHOIS \(whois\.trabis\.gov\.tr\)/);
  });

  it('kayıt bulunamazsa uyarı döner, geçersiz alan adı 422', async () => {
    const res = await ask('domains', 'yok.com');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.fields, { name: 'yok.com' });
    assert.ok(res.body.messages.length >= 1);
    assert.equal((await ask('domains', 'geçersiz domain')).status, 422);
    assert.equal((await ask('domains', '')).status, 422);
  });

  it('özel IP çözümlenen sitenin sayfası çekilmez (SSRF koruması)', async () => {
    state.ips['example.com'] = ['127.0.0.1'];
    const res = await ask('domains', 'example.com');
    assert.equal(res.status, 200);
    assert.ok(!state.fetched.includes('https://example.com/'));
  });

  it('sunucu: hostname → IP, ters DNS, sağlayıcı, ülke', async () => {
    const res = await ask('servers', 'cloud.example.com.tr');
    assert.equal(res.status, 200);
    assert.equal(res.body.fields.ip_address, '203.0.113.10');
    assert.equal(res.body.fields.hostname, 'cloud.example.com.tr');
    assert.equal(res.body.fields.provider, 'EXAMPLE NETWORKS - Cloud Hosting (EXAMPLE-NET)');
    assert.equal(res.body.fields.location, 'Türkiye');
    const byIp = await ask('servers', '203.0.113.10');
    assert.equal(byIp.body.fields.hostname, 'cloud.example.com.tr');
  });

  it('sunucu: özel IP ve yerel ağ hostname reddedilir', async () => {
    assert.equal((await ask('servers', '192.168.1.10')).status, 422);
    assert.equal((await ask('servers', 'ic.ornek.com')).status, 422);
    assert.equal((await ask('servers', '::1')).status, 422);
  });

  it('CSRF token olmadan lookup 403', async () => {
    const res = await agent.post('/domains/lookup').set('Accept', 'application/json').send({ query: 'example.com' });
    assert.equal(res.status, 403);
  });

  it('formlarda "Bilgileri getir" butonu, domain listesinde kontrol durumu görünür', async () => {
    assert.match((await agent.get('/domains/new')).text, /id="lookupBtn"/);
    assert.match((await agent.get('/servers/new')).text, /data-lookup-url="\/servers\/lookup"/);
    assert.doesNotMatch((await agent.get('/contacts/new')).text, /lookupBtn/);
    assert.match((await agent.get('/domains')).text, /Henüz canlı doğrulama yapılmadı/);
    const form = (await agent.get('/domains/new')).text;
    for (const n of ['status', 'registrar_account', 'registered_at', 'auto_renew', 'renewal_by', 'renewal_price', 'ssl_issuer', 'ssl_expiry']) assert.match(form, new RegExp(`name="${n}"`));
    assert.match(form, /<option value="Natro">/);
    assert.match(form, /<option value="Let&#39;s Encrypt">/);
  });

  it('günlük bitiş kontrolü değişen tarihi günceller ve değişiklik kaydına yazar', async () => {
    const created = await post(agent, '/domains', { name: 'example.com', expiry_date: '2026-10-01', registrar: 'Elle', notes: 'korunmalı' });
    assert.equal(created.status, 302);
    await post(agent, '/domains', { name: 'yok.com' });
    ctx.expirySync.delayMs = 0;
    assert.equal(ctx.expirySync.isDue(), true);

    const r = await ctx.expirySync.run();
    assert.equal(r.checked, 1);
    assert.deepEqual(r.updated, [{ name: 'example.com', from: '2026-10-01', to: '2027-10-01' }]);
    assert.deepEqual(r.failed, ['yok.com']);
    assert.equal(ctx.expirySync.isDue(), false);

    const row = ctx.db.get("SELECT * FROM domains WHERE name = 'example.com'");
    assert.equal(row.expiry_date, '2027-10-01');
    assert.equal(row.registrar, 'Elle');
    assert.equal(row.notes, 'korunmalı');
    assert.equal(row.updated_by, 'sistem (otomatik kontrol)');
    assert.equal(row.ssl_expiry, '2026-12-31');
    assert.equal(row.ssl_issuer, "Let's Encrypt");
    const audit = ctx.db.all("SELECT field, old_value, new_value, changed_by FROM audit_log WHERE entity_type = 'domains' AND action = 'update' AND field = 'expiry_date'");
    assert.deepEqual(audit, [{ field: 'expiry_date', old_value: '2026-10-01', new_value: '2027-10-01', changed_by: 'sistem (otomatik kontrol)' }]);

    const again = await ctx.expirySync.run();
    assert.equal(again.updated.length, 0);
    assert.equal(again.sslUpdated, undefined);

    const list = await agent.get('/domains');
    assert.match(list.text, /1 domain, 0 güncellendi/);
    assert.match(list.text, /href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer"/);
    const detail = await agent.get(`/domains/${row.id}`);
    assert.match(detail.text, /Siteyi aç/);
    assert.match(detail.text, /Let&#39;s Encrypt/);
    const manual = await post(agent, '/domains/sync-expiry', {});
    assert.equal(manual.status, 302);
  });
});
