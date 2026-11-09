'use strict';
const {describe,it,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {makeApp,login,post,idFromLocation}=require('./helpers');
const {listView}=require('../src/list-view');
const repo=require('../src/repo');const {ENTITIES}=require('../src/entities');

it('sayfalama geçersiz boyut/sıralamayı sınırlar ve deterministik sayfalar üretir',()=>{
 const data=Array.from({length:31},(_,i)=>({id:i+1,name:'Proje '+String(i+1).padStart(2,'0')}));
 const first=listView(data,{page:'1',per_page:'999',sort:'SQL injection'}),last=listView(data,{page:'999999999'});
 assert.equal(first.rows.length,25);assert.equal(first.pagination.perPage,25);assert.equal(last.pagination.page,2);assert.equal(last.rows.length,6);
 assert.equal(listView(data,{sort:'name_desc'}).rows[0].name,'Proje 31');
 assert.equal(new Set([...first.rows,...last.rows].map(r=>r.id)).size,31);
});
describe('Platform genelindeki iyileştirmeler',()=>{
 let ctx,admin,user,team,domain;
 before(async()=>{
  ctx=await makeApp();admin=await login(ctx.app);
  const account=ctx.users.create({email:'platform@opsdesk.test',name:'Platform kullanıcısı'});await ctx.users.setPassword(account.id,'platform-password-123');
  team=idFromLocation(await post(admin,'/team',{name:'Platform ekibi',user_id:String(account.id),job_role:'Geliştirici'}));
  user=await login(ctx.app,{email:'platform@opsdesk.test',password:'platform-password-123'});
  domain=idFromLocation(await post(admin,'/domains',{name:'platform.example.com',ssl_expiry:'2000-01-01'}));
  for(let i=1;i<=31;i++)repo.create(ctx.db,ENTITIES.projects,{name:'Kayıt '+String(i).padStart(2,'0'),status:'active',backup_enabled:i%2,domain_id:domain,team_ids:i<=2?[team]:[],technology:'Next.js'},'admin@opsdesk.test');
  repo.create(ctx.db,ENTITIES.projects,{name:'Gizli proje işareti',status:'active',backup_enabled:0,team_ids:[]},'admin@opsdesk.test');
 });
 after(()=>ctx.cleanup());
 it('genel arama yetkili sonuçları gösterir, gizli projeleri göstermez',async()=>{
  assert.match((await admin.get('/search?q=Gizli')).text,/Gizli proje işareti/);
  assert.doesNotMatch((await user.get('/search?q=Gizli')).text,/Gizli proje işareti/);
  const res=await user.get('/search?q=Next.js');assert.equal(res.status,200);assert.match(res.text,/2 kayıt eşleşti/);
  assert.match((await admin.get('/search?q=platform.example.com')).text,/Domainler/);
 });
 it('listelerde yetki filtrelerinden sonra sayfalama yapılır',async()=>{
  const page=await admin.get('/projects?sort=name_desc&page=2&per_page=25');assert.equal(page.status,200);assert.match(page.text,/list-pagination/);assert.match(page.text,/aria-current=page/);
  const visible=await user.get('/projects?scope=mine&page=99');assert.equal(visible.status,200);assert.match(visible.text,/Kayıt 01/);assert.match(visible.text,/Kayıt 02/);assert.doesNotMatch(visible.text,/Kayıt 03/);
 });
 it('yönetici sistem durumunu görür, normal kullanıcı erişemez',async()=>{
  assert.equal((await user.get('/system')).status,403);
  const page=await admin.get('/system');assert.equal(page.status,200);assert.match(page.text,/Ekip atanmamış projeler/);assert.match(page.text,/Yapılandırıldı/);
 });
 it('ekip/domain filtreleri ve SSL uyarısı gerçek kayıtlarla eşleşir',async()=>{
  const unassigned=(await admin.get('/projects?assignment=none&per_page=100')).text;assert.doesNotMatch(unassigned,/href="\/projects\/1"/);assert.match(unassigned,/Kayıt 03/);
  assert.match((await admin.get('/domains?ssl_expiring=expired')).text,/platform.example.com/);
  assert.match((await admin.get('/')).text,/SSL sertifikalarını kontrol edin/);
 });
 it('proje adı boşken domain adı kullanılır, domainsiz adsız proje reddedilir',async()=>{
  const created=await post(admin,'/projects',{name:'',domain_id:String(domain)});assert.equal(created.status,302);
  assert.equal(ctx.db.get('SELECT name FROM projects WHERE id=?',[idFromLocation(created)]).name,'platform.example.com');
  assert.equal((await post(admin,'/projects',{name:''})).status,422);
  const typed=await post(admin,'/projects',{name:'',domain_lookup:'https://yeni.example.com/'});assert.equal(typed.status,302);
  assert.equal(ctx.db.get('SELECT name FROM projects WHERE id=?',[idFromLocation(typed)]).name,'yeni.example.com');
 });
 it('e-posta paketi gerçek SMTP göndermeden ileti oluşturabilir',async()=>{
  const mail=require('nodemailer');const transport=mail.createTransport({jsonTransport:true});
  const result=await transport.sendMail({from:'panel@example.com',to:'member@example.com',subject:'Test',text:'Davet akışı'});
  assert.match(result.message,/Davet akışı/);
 });
});
