'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeApp, login, post } = require('./helpers');

describe('Yedekleme', () => {
  let ctx;
  let agent;
  before(async () => {
    ctx = await makeApp();
    agent = await login(ctx.app);
  });
  after(() => ctx.cleanup());

  it('manuel yedek oluşturulur, listelenir ve indirilir', async () => {
    await post(agent, '/team', { name: 'Yedek Testi' });
    const res = await post(agent, '/backups');
    assert.equal(res.status, 302);
    const [b] = ctx.backups.list();
    assert.match(b.name, /^opsdesk-\d{8}-\d{6}-manual\.sqlite$/);
    assert.match((await agent.get('/backups')).text, new RegExp(b.name));
    const dl = await agent.get(`/backups/download/${b.name}`).buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(dl.status, 200);
    assert.equal(dl.body.subarray(0, 15).toString(), 'SQLite format 3');
    assert.match(dl.headers['content-disposition'], /attachment/);
  });

  it('anlık DB export indirilir', async () => {
    const res = await agent.get('/backups/export').buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.subarray(0, 15).toString(), 'SQLite format 3');
  });

  it('otomatik yedek 24 saatte bir alınır', () => {
    const first = ctx.backups.runIfDue();
    assert.match(first, /-auto\.sqlite$/);
    assert.equal(ctx.backups.runIfDue(), null);
    const file = path.join(ctx.config.backupDir, first);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(file, old, old);
    assert.match(ctx.backups.runIfDue(), /-auto\.sqlite$/);
  });

  it('yedek silinir', async () => {
    const name = ctx.backups.list().find((b) => b.kind === 'manual').name;
    assert.equal((await post(agent, `/backups/delete/${name}`)).status, 302);
    assert.ok(!ctx.backups.list().some((b) => b.name === name));
  });
});
