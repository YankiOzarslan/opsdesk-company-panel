'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeApp, login, post, idFromLocation } = require('./helpers');
const { createVault, migrateSecrets } = require('../src/vault');
const repo = require('../src/repo');
const lookup = require('../src/lookup');
const { ENTITIES } = require('../src/entities');

describe('Şifreli erişim, ekip görevleri, taslaklar ve domain akışı', () => {
  let ctx, admin, dev, peer, designer, devTeam, peerTeam, designTeam, domain, server, project;
  const password='test-parola-123';
  const secret='TEST_ONLY_SECRET_NOT_A_REAL_CREDENTIAL';
  const jsonPost=(agent,url,body)=>agent.post(url).set('X-CSRF-Token',agent.csrfToken).set('Accept','application/json').send(body);
  before(async()=>{
    ctx=await makeApp();admin=await login(ctx.app);
    for(const [email,name,role] of [['dev@opsdesk.test','Ada','Yazılım geliştirici'],['peer@opsdesk.test','Can','Yazılım geliştirici'],['design@opsdesk.test','Ece','Tasarımcı']]) {
      const user=ctx.users.create({email,name});await ctx.users.setPassword(user.id,password);
      const team=idFromLocation(await post(admin,'/team',{name,email,job_role:role,user_id:String(user.id)}));
      assert.ok(team);if(name==='Ada')devTeam=team;else if(name==='Can')peerTeam=team;else designTeam=team;
    }
    dev=await login(ctx.app,{email:'dev@opsdesk.test',password});peer=await login(ctx.app,{email:'peer@opsdesk.test',password});designer=await login(ctx.app,{email:'design@opsdesk.test',password});
    domain=idFromLocation(await post(admin,'/domains',{name:'guvenli.com',nameservers:'ns1.TEST_ONLY_MARKER.test',dns_managed_by:'DNS_TEST_ONLY_MARKER',dns_panel_url:'https://dns.example.com/private-url',dns_username:'vault-user-sentinel',dns_password:secret}));
    server=idFromLocation(await post(admin,'/servers',{name:'Vault server',manager_team_id:String(devTeam),access_url:'https://server.example.com/private-panel',access_username:'root-private',access_password:secret,access_list:'TEST_ONLY_ACCESS_MARKER'}));
    project=idFromLocation(await post(admin,'/projects',{name:'Gizli Proje Sentinel',domain_id:String(domain),server_id:String(server),team_ids:[String(devTeam)]}));
    assert.ok(domain && server && project);
  });
  after(()=>ctx.cleanup());

  it('şifreler, DNS verileri ve URL’ler DB, audit ve yeni yedekte açık metin bulunmaz',async()=>{
    const raw=ctx.db.get('SELECT * FROM servers WHERE id=?',[server]);
    assert.match(raw.access_password,/^enc:v1:/);assert.match(raw.access_url,/^enc:v1:/);
    assert.equal(repo.findById(ctx.db,ENTITIES.servers,server).access_password,secret);
    const html=(await admin.get(`/servers/${server}`)).text;
    const edit=(await admin.get(`/servers/${server}/edit`)).text;
    for(const sensitive of [secret,'root-private','https://server.example.com/private-panel']) {assert.ok(!html.includes(sensitive));assert.ok(!edit.includes(sensitive));}
    const audit=JSON.stringify(ctx.db.all('SELECT * FROM audit_log'));
    assert.ok(!audit.includes(secret));assert.ok(!audit.includes('TEST_ONLY_ACCESS_MARKER'));
    const backup=ctx.backups.create('manual');
    const bytes=fs.readFileSync(ctx.backups.resolve(backup));
    for(const sensitive of [secret,'ns1.TEST_ONLY_MARKER.test','DNS_TEST_ONLY_MARKER','vault-user-sentinel','TEST_ONLY_ACCESS_MARKER'])assert.ok(!bytes.includes(Buffer.from(sensitive)),sensitive);
    const keyMode=fs.statSync(ctx.config.vaultKeyPath).mode & 0o777;assert.equal(keyMode,0o600);
  });
  it('şifreler yalnızca yönetici ve atanan kişi tarafından açılır; açma işlemi içeriksiz loglanır',async()=>{
    assert.equal((await jsonPost(admin,`/vault/domains/${domain}/dns_password`,{})).body.value,secret);
    assert.equal((await jsonPost(dev,`/vault/domains/${domain}/dns_password`,{})).body.value,secret);
    assert.equal((await jsonPost(peer,`/vault/domains/${domain}/dns_password`,{})).status,403);
    assert.equal((await jsonPost(designer,`/vault/servers/${server}/access_password`,{})).status,403);
    assert.equal((await jsonPost(dev,`/vault/servers/${server}/access_password`,{})).body.value,secret);
    assert.equal((await admin.post(`/vault/servers/${server}/access_password`).set('Accept','application/json')).status,403);
    assert.ok(ctx.db.get("SELECT id FROM audit_log WHERE action='reveal' AND changed_by='dev@opsdesk.test'"));
    assert.ok(!JSON.stringify(ctx.db.all('SELECT * FROM audit_log')).includes(secret));
  });
  it('aynı rol projeyi okur; başka rol okuyamaz; Hepsi / Benim farklı sonuç verir',async()=>{
    assert.equal((await peer.get(`/projects/${project}`)).status,200);
    assert.equal((await peer.get(`/projects/${project}/edit`)).status,403);
    assert.equal((await designer.get(`/projects/${project}`)).status,403);
    assert.match((await peer.get('/projects')).text,/Gizli Proje Sentinel/);
    assert.doesNotMatch((await peer.get('/projects?scope=mine')).text,/Gizli Proje Sentinel/);
    assert.match((await dev.get('/projects?scope=mine')).text,/Gizli Proje Sentinel/);
    assert.doesNotMatch((await designer.get('/')).text,/Gizli Proje Sentinel/);
    assert.doesNotMatch((await designer.get('/audit')).text,/Gizli Proje Sentinel/);
    assert.doesNotMatch((await designer.get(`/domains/${domain}`)).text,/Gizli Proje Sentinel/);
    assert.equal((await designer.get('/backups/export')).status,403);
    assert.match((await admin.get('/servers/new')).text,/Sorumlu ekip üyesi/);
    assert.doesNotMatch((await admin.get('/servers/new')).text,/name="manager_contact_id"/);
    assert.match((await dev.get('/team')).text,/Yazılım geliştirici/);
  });
  it('proje listesi ekip ve yedek durumunu gösterir; düzenleme/silme yetkileri ayrı korunur',async()=>{
    const page=(await admin.get('/projects')).text;
    assert.match(page,/project-list-panel/);assert.match(page,/Yedek kapalı/);assert.match(page,/guvenli.com/);
    assert.match(page,new RegExp(`href="/team/${devTeam}"`));
    assert.match(page,new RegExp(`action="/projects/${project}/delete"`));
    assert.ok(!page.includes(secret));assert.ok(!page.includes('DNS_TEST_ONLY_MARKER'));
    const assigned=(await dev.get('/projects')).text;
    assert.match(assigned,new RegExp(`href="/projects/${project}/edit"`));
    assert.doesNotMatch(assigned,new RegExp(`action="/projects/${project}/delete"`));
    const sameRole=(await peer.get('/projects')).text;
    assert.match(sameRole,new RegExp(`href="/projects/${project}"`));
    assert.doesNotMatch(sameRole,new RegExp(`href="/projects/${project}/edit"`));
    assert.doesNotMatch(sameRole,new RegExp(`action="/projects/${project}/delete"`));
    assert.equal((await post(dev,`/projects/${project}/delete`)).status,403);
  });
  it('proje araması ilişkili domain/sunucu/ekip adlarını bulur ve görünürlük sınırlarını korur',async()=>{
    for(const q of ['guvenli.com','Vault server','Ada']) {
      assert.match((await admin.get('/projects').query({q})).text,/Gizli Proje Sentinel/);
      assert.doesNotMatch((await designer.get('/projects').query({q})).text,/Gizli Proje Sentinel/);
    }
    const scoped=(await dev.get('/projects?scope=mine&q=guvenli.com')).text;
    assert.match(scoped,/name="scope" value="mine"/);
    assert.match(scoped,/href="\/projects\?q=guvenli.com(?:&amp;|&)/);
  });
  it('atama, rol veya kaynak bağlantısı değiştirilerek şifre erişimi kazanılamaz',async()=>{
    assert.equal((await post(peer,'/projects',{name:'Self claim',domain_id:String(domain),team_ids:[String(peerTeam)]})).status,403);
    assert.equal((await post(peer,`/servers/${server}`,{name:'Claim',manager_team_id:String(peerTeam)})).status,403);
    assert.equal((await post(peer,`/team/${peerTeam}`,{name:'Claim',job_role:'Yönetici'})).status,403);
    assert.equal((await post(dev,`/projects/${project}`,{name:'Claim',domain_id:'',server_id:String(server)})).status,403);
    assert.equal((await post(dev,`/projects/${project}`,{name:'Claim',domain_id:String(domain),server_id:String(server),team_ids:[String(peerTeam)]})).status,403);
    const response=await post(admin,`/projects/${project}`,{name:'Gizli Proje Sentinel',domain_id:String(domain),server_id:String(server),team_ids:[String(devTeam),String(peerTeam)]});
    assert.equal(response.status,302);assert.equal((await jsonPost(peer,`/vault/domains/${domain}/dns_password`,{})).status,200);
    await post(admin,`/projects/${project}`,{name:'Gizli Proje Sentinel',domain_id:String(domain),server_id:String(server),team_ids:[String(devTeam)]});
    assert.equal((await jsonPost(peer,`/vault/domains/${domain}/dns_password`,{})).status,403);
  });
  it('boş parola eski değeri korur; açık kaldır seçimi siler; hassas değişiklikler maskelenir',async()=>{
    assert.equal((await post(admin,`/servers/${server}`,{name:'Vault server',access_password:''})).status,302);
    assert.equal((await jsonPost(admin,`/vault/servers/${server}/access_password`,{})).body.value,secret);
    assert.equal((await post(admin,`/servers/${server}`,{name:'Vault server',_clear_access_password:'1'})).status,302);
    assert.equal(ctx.db.get('SELECT access_password FROM servers WHERE id=?',[server]).access_password,null);
    await post(admin,`/servers/${server}`,{name:'Vault server',access_password:secret,manager_team_id:String(devTeam)});
    assert.ok(!JSON.stringify(ctx.db.all('SELECT * FROM audit_log')).includes(secret));
  });
  it('AES-GCM benzersiz şifreler üretir; kurcalama, yanlış bağlam ve eksik anahtar reddedilir',()=>{
    const a=ctx.db.vault.seal(secret,'test:a'),b=ctx.db.vault.seal(secret,'test:a');assert.notEqual(a,b);
    assert.equal(ctx.db.vault.open(a,'test:a'),secret);
    assert.throws(()=>ctx.db.vault.open(a,'test:b'),/doğrulanamadı/);
    assert.throws(()=>ctx.db.vault.open(a.slice(0,-4)+'AAAA','test:a'),/doğrulanamadı/);
    assert.throws(()=>createVault(ctx.config.vaultKeyPath+'.missing',ctx.db),/anahtarı eksik/);
  });
  it('eski düz metin DNS ve audit kayıtları şifrelenir, eski SQLite sayfaları temizlenir',()=>{
    const marker='LEGACY_TEST_ONLY_MARKER_XYZ';
    ctx.db.run('UPDATE domains SET nameservers=? WHERE id=?',[marker,domain]);
    ctx.db.run('INSERT INTO audit_log (entity_type,entity_id,action,field,old_value,new_value,changed_at) VALUES (?,?,?,?,?,?,?)',['domains',domain,'update','nameservers',marker,marker,new Date().toISOString()]);
    migrateSecrets(ctx.db);migrateSecrets(ctx.db);
    assert.equal(repo.findById(ctx.db,ENTITIES.domains,domain).nameservers,marker);
    assert.ok(!ctx.db.export().includes(Buffer.from(marker)));
  });
  it('taslaklar kullanıcıya özeldir, bütünü şifrelidir, CSRF zorunludur ve başarılı kayıttan sonra temizlenir',async()=>{
    const data={name:'Taslak sunucu',access_password:secret,access_url:'https://draft.example/private',_step:'2'};
    assert.equal((await jsonPost(admin,'/drafts',{form:'/servers/new',data})).status,200);
    const raw=ctx.db.get("SELECT payload FROM form_drafts WHERE form_key='/servers/new'");assert.match(raw.payload,/^enc:v1:/);assert.ok(!raw.payload.includes(secret));
    const restored=await admin.get('/drafts?form=%2Fservers%2Fnew').set('Accept','application/json');assert.equal(restored.body.data.access_password,secret);
    const other=await dev.get('/drafts?form=%2Fservers%2Fnew').set('Accept','application/json');assert.equal(other.body.data,null);
    assert.equal((await admin.post('/drafts').send({form:'/servers/new',data})).status,403);
    assert.equal((await jsonPost(admin,'/drafts',{form:'/users/1/edit',data})).status,403);
    assert.equal((await jsonPost(admin,'/drafts',{form:'/projects/new',data:{name:'Taslak',team_ids:[String(devTeam)],_step:'2'}})).status,200);
    assert.equal((await admin.get('/drafts?form=%2Fprojects%2Fnew').set('Accept','application/json')).body.data._step,'2');
    assert.equal((await post(admin,'/servers',data)).status,302);
    assert.equal((await admin.get('/drafts?form=%2Fservers%2Fnew').set('Accept','application/json')).body.data,null);
  });
  it('özel kategoriler yönetilir; kullanılan kategori silinmez; ZIP ve repo alanı gösterilmez',async()=>{
    assert.equal((await post(admin,'/technology-categories',{label:'Belediye sistemleri'})).status,302);
    const c=ctx.db.get('SELECT key FROM technology_categories WHERE label=?',['Belediye sistemleri']);assert.ok(c);
    const page=(await admin.get('/projects/new')).text;assert.match(page,/Belediye sistemleri/);assert.doesNotMatch(page,/id="archiveInput"|name="repo_url"/);assert.match(page,/id="project-domain-input"/);
    assert.equal((await post(admin,'/projects',{name:'Özel kategorili',tech_category:c.key})).status,302);
    assert.equal((await post(admin,`/technology-categories/${c.key}/delete`)).status,409);
    assert.equal((await dev.get('/technology-categories')).status,403);
    assert.equal((await post(admin,`/technology-categories/${c.key}`,{label:'Belediye uygulamaları'})).status,302);
  });
  it('domain elle girilerek proje ile atomik oluşturulur; hatalı proje domain kaydı bırakmaz',async()=>{
    const first=await post(admin,'/projects',{name:'Manuel proje',domain_lookup:'manual.example.com',domain_registrar:'Elle',domain_expiry_date:'2030-01-01',domain_nameservers:'ns1.manual.test'});
    assert.equal(first.status,302);
    const p=ctx.db.get('SELECT domain_id FROM projects WHERE id=?',[idFromLocation(first)]);assert.ok(p.domain_id);
    assert.equal(repo.findById(ctx.db,ENTITIES.domains,p.domain_id).nameservers,'ns1.manual.test');
    assert.equal((await post(admin,'/projects',{name:'',status:'invalid',domain_lookup:'atomic.example.com'})).status,422);
    assert.equal(ctx.db.get('SELECT id FROM domains WHERE name=?',['atomic.example.com']),undefined);
    assert.equal((await post(admin,'/projects',{name:'Hatalı',domain_lookup:'bad domain'})).status,422);
    const count=ctx.db.get('SELECT COUNT(*) AS n FROM domains').n;
    assert.equal((await post(admin,'/projects',{name:'Aynı domain',domain_lookup:'manual.example.com'})).status,302);
    assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM domains').n,count);
  });
  it('domain sorgusu teknoloji ipucu döndürür; sonuç kayıt yaratmaz ve başarısız sorgu elle girişi engellemez',async()=>{
    const original=lookup.lookupDomain;
    lookup.lookupDomain=async()=>({query:'public.example.com',fields:{name:'public.example.com',registrar:'Example'},summary:['test'],messages:[],info:{site:{hints:['WordPress 6.8']}}});
    const count=ctx.db.get('SELECT COUNT(*) AS n FROM domains').n;
    try {
      const result=await jsonPost(admin,'/projects/lookup-domain',{query:'public.example.com'});assert.equal(result.status,200);assert.equal(result.body.projectFields.technology,'WordPress');assert.equal(result.body.projectFields.tech_version,'6.8');
      assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM domains').n,count);
      lookup.lookupDomain=async()=>{throw new lookup.LookupError('Kayıt bulunamadı');};
      assert.equal((await jsonPost(admin,'/projects/lookup-domain',{query:'public.example.com'})).status,422);
      assert.equal((await post(admin,'/projects',{name:'Sorgusuz manuel',domain_lookup:'public.example.com',technology:'Özel yazılım'})).status,302);
    } finally {lookup.lookupDomain=original;}
  });
});
