'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, login, post, idFromLocation, zipOf } = require('./helpers');
const catalog = require('../src/tech-catalog');
const { detectFromZip } = require('../src/detect');

describe('Teknoloji kataloğu', () => {
  let ctx;
  let agent;
  before(async () => {
    ctx = await makeApp();
    agent = await login(ctx.app);
  });
  after(() => ctx.cleanup());

  it('teknolojiler kategoriye ve popüler sürümlere eşlenir', () => {
    assert.equal(catalog.categoryOf('wordpress'), 'cms');
    assert.equal(catalog.categoryOf('Next.js'), 'fullstack');
    assert.equal(catalog.categoryOf('Unity'), 'game');
    assert.equal(catalog.categoryOf('Bilinmeyen'), null);
    assert.ok(catalog.versionsOf('Laravel').includes('11'));
    assert.ok(catalog.LANGUAGES.PHP.includes('8.3'));
  });

  it('proje formu kategori seçimi, katalog JSON ve sürüm listelerini içerir', async () => {
    const res = await agent.get('/projects/new');
    assert.equal(res.status, 200);
    assert.match(res.text, /id="techCatalog"/);
    assert.match(res.text, /name="tech_category"/);
    assert.match(res.text, /<option value="WordPress" label="WordPress — CMS \/ Site yönetimi">/);
    assert.match(res.text, /id="dl_tech_version"/);
    assert.match(res.text, /id="dl_language_version"/);
    const json = res.text.match(/id="techCatalog">([^<]*)<\/script>/)[1];
    assert.equal(JSON.parse(json).techs.laravel.category, 'backend');
  });

  it('proje listesi filtresinde teknolojiler kategori gruplarıyla gelir, kategoriye göre filtrelenir', async () => {
    const a = await post(agent, '/projects', { name: 'Oyun A', tech_category: 'game', technology: 'Unity', tech_version: '6.0 LTS' });
    assert.equal(a.status, 302);
    await post(agent, '/projects', { name: 'Site B', tech_category: 'cms', technology: 'WordPress', tech_version: '6.8' });
    await post(agent, '/projects', { name: 'Özel C', technology: 'BenimFramework' });

    const list = await agent.get('/projects');
    assert.match(list.text, /<optgroup label="Oyun">/);
    assert.match(list.text, /Unity \(1\)/);
    assert.match(list.text, /<optgroup label="Diğer">[\s\S]*BenimFramework \(1\)/);

    const games = await agent.get('/projects?tech_category=game');
    assert.match(games.text, /Oyun A/);
    assert.doesNotMatch(games.text, /Site B/);

    const versions = await agent.get('/projects?technology=Laravel');
    assert.doesNotMatch(versions.text, /<option value="12"/);
    assert.match(versions.text, /Kayıtlı sürüm yok/);

    const detail = await agent.get(`/projects/${idFromLocation(a)}`);
    assert.match(detail.text, /Oyun/);
  });

  it('sürüm seçenekleri yalnızca seçilen teknolojinin kayıtlarından gelir',async()=>{
    await post(agent,'/projects',{name:'React projesi',technology:'React',tech_version:'18'});
    const select=async query=>(await agent.get('/projects').query(query)).text.match(/<select[^>]*id="flt_tech_version"[\s\S]*?<\/select>/)[0];
    const wordpress=await select({technology:'WordPress'});assert.match(wordpress,/value="6.8"/);assert.doesNotMatch(wordpress,/value="18"/);
    const webflow=await select({technology:'Webflow'});assert.match(webflow,/disabled/);assert.doesNotMatch(webflow,/value="18"/);
    assert.match(await select({}),/value="18"/);
  });
  it('teknolojiye ait olmayan eski sürüm filtresi temizlenir',async()=>{
    const page=await agent.get('/projects?technology=Unity&tech_version=18');
    assert.match(page.text,/Oyun A/);assert.doesNotMatch(page.text,/value="18" selected/);
  });
  it('ana listelerde yeşil kayıt paneli vardır; başlangıç rehberi kaldırılmıştır',async()=>{
    for(const key of ['projects','domains','servers']) {
      const page=await agent.get('/'+key);assert.match(page.text,/record-create-panel/);assert.match(page.text,new RegExp('href="/'+key+'/new"'));assert.doesNotMatch(page.text,/href="\/welcome"/);
    }
    assert.equal((await agent.get('/welcome')).headers.location,'/');
  });

  it('geçersiz kategori reddedilir', async () => {
    const res = await post(agent, '/projects', { name: 'X', tech_category: 'uydurma' });
    assert.equal(res.status, 422);
  });

  it('bağımlılıksız package.json + index.html statik site olarak algılanır, vendor sürümleri okunur', () => {
    const r = detectFromZip(zipOf({
      'oyun/package.json': JSON.stringify({ name: 'x', scripts: { build: 'node build.mjs' } }),
      'oyun/vendor-versions.json': JSON.stringify({ three: '0.186.1', 'hls.js': '1.7.3' }),
      'oyun/dist/index.html': '<!doctype html>',
      'oyun/dist/vendor/three.module.min.js': '',
      'oyun/dist/vendor/hls.min.js': '',
    }));
    assert.equal(r.result.technology, 'Statik HTML');
    assert.equal(r.result.framework, 'Three.js 0.186.1 + hls.js 1.7.3');
    assert.ok(r.alternatives.some((a) => /Node\.js/.test(a)));
  });
});
