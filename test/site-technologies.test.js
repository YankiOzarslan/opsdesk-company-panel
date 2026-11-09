'use strict';
const {it} = require('node:test');
const assert = require('node:assert/strict');
const {detectSiteTechnologies: detect} = require('../src/site-technologies');
const {lookupProjectDomain} = require('../src/project-domain');
const lookup = require('../src/lookup');

it('generator, header ve sürümlü kaynak URLleri kanıtlarıyla ayrıştırılır',()=>{
  const result=detect('<script src="https://cdn.example/jquery-3.7.1.min.js"></script><link href="https://cdn.example/bootstrap@5.3.3/dist/css/bootstrap.min.css">',new Headers({'x-powered-by':'PHP/8.3.12'}),'WordPress 6.8.2');
  assert.deepEqual(result.technologies.map(t=>[t.name,t.version]),[['WordPress','6.8.2'],['jQuery','3.7.1'],['Bootstrap','5.3.3'],['PHP','8.3.12']]);
  assert.equal(result.language.version,'8.3.12');
});
it('Next build kimliği ve eklenti parametresi framework sürümü sayılmaz',()=>{
  const result=detect('<script src="/_next/static/15.2.4/chunks/app-a1b2.js"></script><script src="/wp-content/plugins/demo/a.js?ver=9.9.9"></script>',new Headers({'x-powered-by':'Next.js'}),null);
  assert.equal(result.technologies.find(t=>t.name==='Next.js').version,null);
  assert.equal(result.technologies.find(t=>t.name==='WordPress').version,null);
  assert.equal(result.language,null);
});
it('Angular sürümü açık ng-version özelliğinden okunur',()=>{
  const result=detect('<app-root ng-version="19.2.1"></app-root>',new Headers(),null);
  assert.equal(result.technologies[0].version,'19.2.1');
});
it('proje alanları teknoloji ve kütüphane sürümlerini taşır; TypeScript varsayılmaz',async()=>{
  const original=lookup.lookupDomain;
  lookup.lookupDomain=async()=>({query:'site.example',fields:{},messages:[],info:{site:{hints:['Next.js'],technologies:[{name:'Next.js',version:'15.2.4'},{name:'React',version:'19.0.0'}]}}});
  try {
    const result=await lookupProjectDomain('site.example',{all:()=>[]});
    assert.equal(result.projectFields.technology,'Next.js');
    assert.equal(result.projectFields.tech_version,'15.2.4');
    assert.equal(result.projectFields.framework,'React 19.0.0');
    assert.equal(result.projectFields.language,undefined);
  } finally {lookup.lookupDomain=original;}
});
it('birden fazla generator ve ters meta özellik sırası okunur',()=>{
  const result=detect('<meta content="Astro v5.2.1" name="generator"><meta name="generator" content="WordPress 6.8.2"><meta name="generator" content="WooCommerce 10.1.0">',new Headers(),null);
  assert.deepEqual(result.technologies.map(t=>[t.name,t.version]),[['WordPress','6.8.2'],['WooCommerce','10.1.0'],['Astro','5.2.1']]);
});
it('yaygın CDN paketleri ve sürümsüz dosya adları algılanır',()=>{
  const result=detect(`<script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.8/dist/cdn.min.js"></script>
    <script src="https://cdn.example/ajax/libs/chart.js/4.4.7/chart.umd.min.js"></script>
    <link href="https://cdn.example/swiper@11.2.1/swiper-bundle.min.css">
    <script src="/assets/axios.min.js"></script><link href="/assets/bootstrap.min.css?ver=5.3.3&amp;theme=dark">`,new Headers(),null);
  const versions=Object.fromEntries(result.technologies.map(t=>[t.name,t.version]));
  assert.equal(versions.HTMX,'2.0.4');assert.equal(versions['Alpine.js'],'3.14.8');
  assert.equal(versions['Chart.js'],'4.4.7');assert.equal(versions.Swiper,'11.2.1');
  assert.equal(versions.Axios,null);assert.equal(versions.Bootstrap,'5.3.3');
});
it('sunucu ve runtime bilgileri yalnızca yayımlanan değerlerden alınır',()=>{
  const result=detect('',new Headers({'server':'nginx/1.24.0','x-powered-by':'Express, PHP/8.3.12','set-cookie':'laravel_session=private-value; HttpOnly'}),null);
  assert.ok(result.technologies.some(t=>t.name==='Express'));
  assert.ok(result.technologies.some(t=>t.name==='Laravel'));
  assert.equal(result.technologies.find(t=>t.name==='nginx').version,'1.24.0');
  assert.doesNotMatch(JSON.stringify(result),/private-value/);
});
it('aynı kütüphanenin farklı sürümleri kaybolmaz veya tek sürüm diye gösterilmez',()=>{
  const result=detect('<script src="/jquery-3.7.1.min.js"></script><script src="/jquery-1.12.4.min.js"></script>',new Headers(),null);
  const jquery=result.technologies.find(t=>t.name==='jQuery');
  assert.equal(jquery.version,null);assert.deepEqual(jquery.versions,['3.7.1','1.12.4']);
});
it('desteklenmeyen ve eklenti sürümleri tanınan bir ürüne atanmaz',()=>{
  const result=detect('<script src="/assets/app-19.2.1.js?ver=5.3.3"></script><script src="/wp-content/plugins/example/slider.js?ver=9.9.9"></script>',new Headers({'x-powered-by':'Custom App 7.8.9'}),null);
  assert.deepEqual(result.technologies.map(t=>[t.name,t.version]),[['WordPress',null]]);
});
it('e-ticaret ana teknoloji seçilir; altyapı ve kütüphaneler ayrıca korunur',async()=>{
  const original=lookup.lookupDomain;
  lookup.lookupDomain=async()=>({query:'site.example',fields:{},messages:[],info:{site:{hints:[],technologies:[{name:'WordPress',version:'6.8.2',kind:'application'},{name:'WooCommerce',version:'10.1.0',kind:'application'},{name:'nginx',version:'1.24.0',kind:'server'}]}}});
  try {
    const result=await lookupProjectDomain('site.example',{all:()=>[]});
    assert.equal(result.projectFields.technology,'WooCommerce');assert.equal(result.projectFields.tech_version,'10.1.0');
    assert.match(result.projectFields.framework,/WordPress 6.8.2/);assert.match(result.projectFields.framework,/nginx 1.24.0/);
  }finally{lookup.lookupDomain=original;}
});
it('yalnızca sunucu bulunursa ana teknoloji uydurulmaz',async()=>{
  const original=lookup.lookupDomain;
  lookup.lookupDomain=async()=>({query:'site.example',fields:{},messages:[],info:{site:{hints:['nginx'],technologies:[{name:'nginx',version:'1.24.0',kind:'server'}]}}});
  try {
    const result=await lookupProjectDomain('site.example',{all:()=>[]});
    assert.equal(result.projectFields.technology,undefined);assert.equal(result.projectFields.framework,'nginx 1.24.0');
  }finally{lookup.lookupDomain=original;}
});
