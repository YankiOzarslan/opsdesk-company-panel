'use strict';
const express = require('express');
const crypto = require('node:crypto');
module.exports = function categoriesRouter({ db, auth }) {
  const router=express.Router(); router.use(auth.requireAdmin);
  const render=(res,error=null,status=200)=>res.status(status).render('categories',{title:'Teknoloji kategorileri',active:'categories',rows:db.all('SELECT c.*, (SELECT COUNT(*) FROM projects WHERE tech_category=c.key) AS used FROM technology_categories c ORDER BY label'),error});
  const labelOf=req=>typeof req.body.label==='string'?req.body.label.trim():'';
  router.get('/',(req,res)=>render(res));
  router.post('/',(req,res)=>{
    const label=labelOf(req);
    if(!label || label.length>100) return render(res,'Kategori adı 1–100 karakter olmalı.',422);
    if(db.get('SELECT key FROM technology_categories WHERE label=?',[label])) return render(res,'Bu kategori zaten var.',409);
    db.run('INSERT INTO technology_categories (key,label) VALUES (?,?)',['custom_'+crypto.randomBytes(8).toString('hex'),label]);
    req.flash('success','Kategori eklendi.'); return res.redirect('/technology-categories');
  });
  router.post('/:key',(req,res,next)=>{
    if(!db.get('SELECT key FROM technology_categories WHERE key=?',[req.params.key]))return next();
    const label=labelOf(req);
    if(!label || label.length>100)return render(res,'Kategori adı 1–100 karakter olmalı.',422);
    if(db.get('SELECT key FROM technology_categories WHERE label=? AND key<>?',[label,req.params.key]))return render(res,'Bu kategori zaten var.',409);
    db.run('UPDATE technology_categories SET label=? WHERE key=?',[label,req.params.key]); return res.redirect('/technology-categories');
  });
  router.post('/:key/delete',(req,res,next)=>{
    if(!db.get('SELECT key FROM technology_categories WHERE key=?',[req.params.key]))return next();
    if(db.get('SELECT id FROM projects WHERE tech_category=? LIMIT 1',[req.params.key]))return render(res,'Bu kategori projelerde kullanılıyor. Önce projelerin kategorisini değiştirin.',409);
    db.run('DELETE FROM technology_categories WHERE key=?',[req.params.key]);return res.redirect('/technology-categories');
  });
  return router;
};
