'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, login, post } = require('./helpers');
const dates = require('../src/dates');
const { daysUntil } = require('../src/view-helpers');

describe('Süresi dolacak domainler', () => {
  let ctx;
  let agent;
  const t = dates.today();
  before(async () => {
    ctx = await makeApp();
    agent = await login(ctx.app);
    for (const [name, offset] of [['dolmus.com', -5], ['bugun.com', 0], ['yakin.com', 10], ['sinir.com', 60], ['uzak.com', 61]]) {
      assert.equal((await post(agent, '/domains', { name, expiry_date: dates.addDays(t, offset) })).status, 302);
    }
    await post(agent, '/domains', { name: 'tarihsiz.com' });
  });
  after(() => ctx.cleanup());

  it('bugünün tarihi panel saat diliminde (Europe/Istanbul) hesaplanır', () => {
    assert.equal(dates.today(new Date('2026-01-01T22:30:00Z')), '2026-01-02');
    assert.equal(dates.addDays('2026-02-27', 2), '2026-03-01');
    assert.equal(daysUntil(t), 0);
    assert.equal(daysUntil(dates.addDays(t, -5)), -5);
  });

  it('dashboard: dolmuş + 60 gün içindekiler listelenir, sonrakiler ve tarihsizler listelenmez', async () => {
    const page = (await agent.get('/')).text;
    const html = page.match(/<section class="card renewal-panel">([\s\S]*?)<\/section>/)?.[1] || '';
    for (const d of ['dolmus.com', 'bugun.com', 'yakin.com', 'sinir.com']) assert.match(html, new RegExp(d.replace('.', '\\.')), d);
    assert.doesNotMatch(html, /uzak\.com/);
    assert.match(html, /5 gün önce doldu/);
    assert.match(html, /Bugün doluyor/);
    assert.match(html, /10 gün kaldı/);
    assert.match(page, /1 domainin bitiş tarihi belirtilmemiş/);
    assert.ok(html.indexOf('dolmus.com') < html.indexOf('yakin.com'), 'en yakın tarih önce');
    assert.doesNotMatch(page, /Teknoloji \/ sürüm kırılımı/);
  });

  it('"Tümü" linkinin filtresi dashboard ile aynı kayıtları döner', async () => {
    const html = (await agent.get('/domains?expiring=60')).text.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';
    for (const d of ['dolmus', 'bugun', 'yakin', 'sinir']) assert.match(html, new RegExp(`${d}\\.com`), d);
    assert.doesNotMatch(html, /uzak\.com|tarihsiz\.com/);
    const expired = (await agent.get('/domains?expiring=expired')).text.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';
    assert.match(expired, /dolmus\.com/);
    assert.doesNotMatch(expired, /bugun\.com|yakin\.com/);
  });
});
