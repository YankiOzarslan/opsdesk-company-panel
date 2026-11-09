'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { makeApp, login, zipOf, request } = require('./helpers');
const { detectFromZip } = require('../src/detect');

describe('/projects/detect', () => {
  let ctx;
  let agent;
  before(async () => {
    ctx = await makeApp();
    agent = await login(ctx.app);
  });
  after(() => ctx.cleanup());

  const upload = (buf, name = 'proje.zip') => agent.post('/projects/detect')
    .set('X-CSRF-Token', agent.csrfToken)
    .set('Accept', 'application/json')
    .attach('archive', buf, name);

  it('Next.js projesi: teknoloji, sürüm, dil ve framework algılanır', async () => {
    const res = await upload(zipOf({
      'site/package.json': JSON.stringify({ dependencies: { next: '^14.2.3', react: '18.3.1' }, devDependencies: { typescript: '~5.4.5' }, engines: { node: '>=20' } }),
      'site/tsconfig.json': '{}',
      'site/node_modules/left-pad/package.json': JSON.stringify({ name: 'left-pad' }),
    }));
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.detected, true);
    assert.equal(res.body.result.technology, 'Next.js');
    assert.equal(res.body.result.tech_version, '14.2.3');
    assert.equal(res.body.result.language, 'TypeScript');
    assert.equal(res.body.result.language_version, '5.4.5');
    assert.match(res.body.result.framework, /React/);
  });

  it('WordPress projesi: version.php’den sürüm okunur', async () => {
    const res = await upload(zipOf({
      'wp-includes/version.php': "<?php\n$wp_version = '6.5.2';\n$required_php_version = '7.0.0';",
      'wp-config.php': '<?php',
      'wp-content/index.php': '<?php',
    }));
    assert.equal(res.status, 200);
    assert.equal(res.body.result.technology, 'WordPress');
    assert.equal(res.body.result.tech_version, '6.5.2');
    assert.equal(res.body.result.language, 'PHP');
  });

  it('Laravel / Django / Go projeleri algılanır', () => {
    const laravel = detectFromZip(zipOf({ 'composer.json': JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^11.0' } }), artisan: '' }));
    assert.equal(laravel.result.technology, 'Laravel');
    assert.equal(laravel.result.language, 'PHP');
    const django = detectFromZip(zipOf({ 'requirements.txt': 'Django==5.0.4\npsycopg2==2.9', 'manage.py': '' }));
    assert.equal(django.result.technology, 'Django');
    assert.equal(django.result.tech_version, '5.0.4');
    const go = detectFromZip(zipOf({ 'go.mod': 'module x\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.10.0\n' }));
    assert.equal(go.result.language, 'Go');
    assert.equal(go.result.language_version, '1.22');
  });

  it('algılanamayan arşiv: ok=true, detected=false', async () => {
    const res = await upload(zipOf({ 'readme.txt': 'merhaba' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.detected, false);
  });

  it('.zip olmayan dosya → 400', async () => {
    const res = await upload(Buffer.from('hello'), 'proje.tar.gz');
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  });

  it('bozuk zip → 400', async () => {
    const res = await upload(Buffer.from('PK\u0003\u0004bozuk'), 'bozuk.zip');
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  });

  it('dosya yoksa → 400', async () => {
    const res = await agent.post('/projects/detect').set('X-CSRF-Token', agent.csrfToken).set('Accept', 'application/json').field('x', '1');
    assert.equal(res.status, 400);
  });

  it('zip slip girdileri (../) yok sayılır, diske yazılmaz', () => {
    const zip = new AdmZip();
    zip.addFile('ok/index.html', Buffer.from('<html></html>'));
    zip.addFile('placeholder/package.json', Buffer.from(JSON.stringify({ dependencies: { express: '4.19.2' } })));
    const buf = zip.toBuffer();
    // Rename the second entry to a traversal path at the byte level (same length).
    const evil = Buffer.from(buf.toString('latin1').split('placeholder/package.json').join('../../../../package.json'), 'latin1');
    const out = detectFromZip(evil);
    assert.notEqual(out.result && out.result.technology, 'Express');
  });

  it('oturumsuz istek reddedilir', async () => {
    const res = await request(ctx.app).post('/projects/detect').set('Accept', 'application/json').attach('archive', zipOf({ 'a.html': '' }), 'a.zip');
    assert.ok([401, 403].includes(res.status));
  });
});
