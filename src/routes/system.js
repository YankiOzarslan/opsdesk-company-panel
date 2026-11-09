'use strict';
const express=require('express');
module.exports=ctx=>{
 const router=express.Router();router.use('/system',ctx.auth.requireAdmin);
 router.get('/system',(req,res)=>{
  const count=sql=>ctx.db.get(sql).n;
  const issues=[
   {label:'Domain bağlantısı eksik projeler',count:count("SELECT COUNT(*) n FROM projects WHERE domain_id IS NULL"),href:'/projects?domain_id=none'},
   {label:'Sunucu bağlantısı eksik projeler',count:count("SELECT COUNT(*) n FROM projects WHERE server_id IS NULL"),href:'/projects?server_id=none'},
   {label:'Yedeklemesi kapalı projeler',count:count("SELECT COUNT(*) n FROM projects WHERE backup_enabled=0"),href:'/projects?backup_enabled=0'},
   {label:'Ekip atanmamış projeler',count:count("SELECT COUNT(*) n FROM projects WHERE id NOT IN (SELECT project_id FROM project_assignments)"),href:'/projects?assignment=none'},
  ];
  const all=ctx.db.all('SELECT id,name FROM domains');
  const unverified=all.filter(row=>{const r=ctx.expirySync.recordStatus(row.id);return !r || r.name!==row.name || Date.now()-Date.parse(r.checkedAt)>86400000 || r.ssl?.state!=='verified' || r.dns?.state!=='verified' || !['verified','inherited'].includes(r.registration?.state);}).length;
  issues.push({label:'Kontrol gerektiren domainler',count:unverified,href:'/domains'});
  res.render('system',{title:'Sistem durumu',active:'system',issues,lastAuto:ctx.backups.lastAuto(),backupCount:ctx.backups.list().length,autoBackup:ctx.config.autoBackup,autoExpirySync:ctx.config.autoExpirySync,smtpConfigured:ctx.mailer.configured,verification:ctx.expirySync.status()});
 });return router;
};
