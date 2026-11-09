'use strict';
const {describe,it,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {makeApp,login}=require('./helpers');
const repo=require('../src/repo');
const {ENTITIES}=require('../src/entities');
const lookup=require('../src/lookup');

describe('Domain doğrulama doğruluğu',()=>{
 let ctx,id,originals;
 beforeEach(async()=>{
  ctx=await makeApp();ctx.expirySync.delayMs=0;
  id=repo.create(ctx.db,ENTITIES.domains,{name:'ornek.com',expiry_date:'2027-10-01',ssl_expiry:'2027-01-07',ssl_issuer:'Eski CA',registrar:'Elle girilmiş firma',owner_name:'İç kayıt sahibi',managed_by_us:1},'test');
  originals={lookupRegistration:lookup.lookupRegistration,lookupSsl:lookup.lookupSsl,lookupDns:lookup.lookupDns};
  lookup.lookupRegistration=async()=>({source:'RDAP',sourceUrl:'https://rdap.example/domain/ornek.com',registrar:'Canlı Firma',expiry_date:'2027-10-01'});
  lookup.lookupSsl=async()=>({ssl_expiry:'2027-01-07',ssl_issuer:'Yeni CA',valid:true});
  lookup.lookupDns=async()=>({ips:['93.184.216.34'],nameservers:['ns1.example.com']});
 });
 afterEach(()=>{Object.assign(lookup,originals);ctx.cleanup();});
 it('SSL tarihi aynı kalsa da sağlayıcı yenilenir; iç kayıtlar korunur',async()=>{
  const result=await ctx.expirySync.run();
  const row=repo.findById(ctx.db,ENTITIES.domains,id);
  assert.equal(row.ssl_issuer,'Yeni CA');assert.equal(row.registrar,'Elle girilmiş firma');assert.equal(row.owner_name,'İç kayıt sahibi');assert.equal(row.managed_by_us,1);
  assert.equal(result.attempted,1);assert.equal(result.sslChecked,1);assert.equal(result.dnsChecked,1);assert.equal(result.sslUpdated,1);
  const report=ctx.expirySync.recordStatus(id);
  assert.equal(report.registration.registrarMismatch,true);assert.equal(report.registration.source,'RDAP');assert.equal(report.ssl.state,'verified');assert.deepEqual(report.dns.nameservers,['ns1.example.com']);
 });
 it('erişilemeyen kaynak eski veriyi silmez ve eski başarıyı yeni doğrulama saymaz',async()=>{
  await ctx.expirySync.run();const last=ctx.expirySync.recordStatus(id).ssl.verifiedAt;
  lookup.lookupRegistration=async()=>{throw new Error('timeout');};lookup.lookupSsl=async()=>null;lookup.lookupDns=async()=>{throw new Error('DNS');};
  const result=await ctx.expirySync.run();const report=ctx.expirySync.recordStatus(id);
  assert.equal(report.registration.state,'failed');assert.equal(report.ssl.state,'failed');assert.equal(report.ssl.verifiedAt,last);assert.equal(report.dns.state,'failed');
  assert.equal(result.checked,0);assert.deepEqual(result.sslFailed,['ornek.com']);assert.equal(repo.findById(ctx.db,ENTITIES.domains,id).ssl_expiry,'2027-01-07');
 });
 it('geçersiz sertifika doğrulanmış etiketi almaz',async()=>{
  lookup.lookupSsl=async()=>({ssl_expiry:'2027-01-07',ssl_issuer:'Yeni CA',valid:false});
  const result=await ctx.expirySync.run();assert.equal(ctx.expirySync.recordStatus(id).ssl.state,'invalid');assert.deepEqual(result.sslFailed,['ornek.com']);
 });
 it('bozuk tarih güncellenmez; bozuk global kontrol tarihi yeniden sorgulamayı engellemez',async()=>{
  lookup.lookupRegistration=async()=>({expiry_date:'2027-02-30'});await ctx.expirySync.run();
  assert.equal(repo.findById(ctx.db,ENTITIES.domains,id).expiry_date,'2027-10-01');assert.equal(ctx.expirySync.recordStatus(id).registration.state,'failed');
  ctx.db.run("UPDATE app_meta SET value=? WHERE key='expiry_sync'",[JSON.stringify({finishedAt:'invalid'})]);assert.equal(ctx.expirySync.isDue(),true);
 });
 it('elle tarih değişirse önceki kontrol güncel doğrulama diye gösterilmez',async()=>{
  await ctx.expirySync.run();ctx.db.run('UPDATE domains SET ssl_expiry=? WHERE id=?',['2030-01-01',id]);
  const agent=await login(ctx.app);const response=await agent.get('/domains');assert.equal(response.status,200);assert.match(response.text,/SSL bu kontrolde doğrulanamadı/);assert.doesNotMatch(response.text,/Son kontrolde geçerli/);
 });
});
it('registrar ve registry bitişleri ayrılır; registrar bitişi takip edilir',()=>{
 const result=lookup.parseRdapDomain({events:[{eventAction:'expiration',eventDate:'2028-10-01T10:00:00Z'},{eventAction:'registrar expiration',eventDate:'2027-10-01T10:00:00Z'}]});
 assert.equal(result.expiry_date,'2027-10-01');assert.equal(result.registry_expiry,'2028-10-01');assert.equal(result.expiry_type,'registrar');
});
