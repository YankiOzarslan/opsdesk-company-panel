'use strict';
const express=require('express');const {validEmail}=require('../users');const {projectIds}=require('../access');
module.exports=({db,auth})=>{
 const router=express.Router();
 router.get('/welcome',(req,res)=>res.redirect('/'));
 router.get('/help',(req,res)=>res.render('help',{title:'Yardım ve kullanım',active:'help'}));
 router.get('/company',auth.requireAdmin,(req,res)=>res.render('company',{title:'Şirket ayarları',active:'company',values:res.locals.company,error:null}));
 router.post('/company',auth.requireAdmin,(req,res)=>{
  const values=Object.fromEntries(['name','industry','support_email'].map(k=>[k,typeof req.body[k]==='string'?req.body[k].trim().slice(0,k==='support_email'?254:100):'']));
  const error=!values.name?'Şirket adını girin.':values.support_email && !validEmail(values.support_email)?'Geçerli bir destek e-postası girin.':null;
  if(error)return res.status(422).render('company',{title:'Şirket ayarları',active:'company',values,error});
  db.run("INSERT INTO app_meta (key,value,updated_at) VALUES ('company_profile',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",[JSON.stringify(values),new Date().toISOString()]);
  req.flash('success','Şirket bilgileri kaydedildi.');res.redirect('/company');
 });return router;
};
