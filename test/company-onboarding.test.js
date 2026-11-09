'use strict';
const {describe,it,before,after}=require('node:test');const assert=require('node:assert/strict');
const {makeApp,login,post,request,csrf}=require('./helpers');
describe('Şirket içinde kolay başlangıç',()=>{
 let ctx,admin,user;
 before(async()=>{ctx=await makeApp();admin=await login(ctx.app);const row=ctx.users.create({email:'employee@test.example',name:'Çalışan'});await ctx.users.setPassword(row.id,'employee-password');user=await login(ctx.app,{email:row.email,password:'employee-password'});});
 after(()=>ctx.cleanup());
 it('şirket ayarları yalnızca yöneticiye açıktır; girişte şirket adı güvenli gösterilir',async()=>{
  assert.equal((await user.get('/company')).status,403);assert.equal((await post(user,'/company',{name:'Yetkisiz'})).status,403);
  assert.equal((await post(admin,'/company',{name:'Örnek <script> şirketi',support_email:'bad'})).status,422);
  assert.equal((await post(admin,'/company',{name:'Örnek <script> şirketi',support_email:'help@example.com'})).status,302);
  const page=await request(ctx.app).get('/login');assert.match(page.text,/Örnek &lt;script&gt; şirketi/);assert.doesNotMatch(page.text,/Örnek <script>/);
 });
 it('kaldırılmış rehber genel bakışa gider, yardım rol sınırlarını korur',async()=>{
  assert.equal((await admin.get('/welcome')).headers.location,'/');
  const page=await user.get('/help');assert.equal(page.status,200);assert.doesNotMatch(page.text,/href="\/users\/new"/);assert.doesNotMatch(page.text,/href="\/welcome"/);assert.match(page.text,/help@example.com/);
 });
 it('kullanıcı ve ekip birlikte oluşturulur; zayıf/eşleşmeyen parolada kayıt oluşmaz',async()=>{
  const bad=await post(admin,'/users',{email:'bad@test.example',role:'user',password:'kisa',password_confirm:'kisa'});assert.equal(bad.status,422);assert.equal(ctx.users.byEmail('bad@test.example'),null);
  const good=await post(admin,'/users',{email:'new@test.example',name:'Yeni Çalışan',role:'user',password:'new-initial-123',password_confirm:'new-initial-123',create_team:'1',job_role:'Tasarımcı'});assert.equal(good.status,302);assert.equal(ctx.mailer.sent.length,0);
  const created=ctx.users.byEmail('new@test.example');assert.ok(ctx.db.get('SELECT id FROM team_members WHERE user_id=? AND job_role=?',[created.id,'Tasarımcı']));
  const session=request.agent(ctx.app);const token=await csrf(session,'/login');await session.post('/login').type('form').send({_csrf:token,email:created.email,password:'new-initial-123'});
  assert.equal((await session.get('/projects')).headers.location,'/account');assert.equal((await session.get('/projects').set('Accept','application/json')).status,403);
  session.csrfToken=await csrf(session,'/account');assert.equal((await post(session,'/account/password',{current_password:'new-initial-123',password:'new-initial-123',password_confirm:'new-initial-123'})).status,422);
  await post(session,'/account/password',{current_password:'new-initial-123',password:'own-password-456',password_confirm:'own-password-456'});assert.equal((await session.get('/projects')).status,200);
 });
 it('yönetici başlangıç parolasını yenileyebilir; yeni giriş tekrar parola değişimine yönlenir',async()=>{
  const employee=ctx.users.byEmail('employee@test.example');
  assert.equal((await post(user,`/users/${employee.id}/temporary-password`,{password:'changed-password',password_confirm:'changed-password'})).status,403);
  assert.equal((await post(admin,`/users/${employee.id}/temporary-password`,{password:'changed-password',password_confirm:'changed-password'})).status,302);
  assert.equal((await user.get('/projects')).status,302);
 });
});

it('çok baytlı uzun parolalar sessizce kesilmez',()=>{assert.ok(require('../src/users').passwordError('🔐'.repeat(20)));});
