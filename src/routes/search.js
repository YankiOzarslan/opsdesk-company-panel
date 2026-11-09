'use strict';
const express=require('express');
const repo=require('../repo');
const {projectIds}=require('../access');
module.exports=({db,entities})=>{
 const router=express.Router();
 router.get('/search',(req,res)=>{
  const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,200):'';
  const visible=projectIds(db,req.account);
  const groups=[];
  if(q)for(const entity of Object.values(entities)) {
   const safe={...entity,search:entity.search.filter(name=>!entity.fieldMap[name]?.secret && !entity.fieldMap[name]?.encrypted)};
   let {rows}=repo.list(db,safe,{q});
   if(entity.key==='projects' && visible)rows=rows.filter(row=>visible.has(row.id));
   if(rows.length)groups.push({key:entity.key,label:entity.plural,icon:entity.icon,total:rows.length,rows:rows.slice(0,8).map(row=>({id:row.id,name:row.name,description:entity.key==='projects'?[row.technology,row.tech_version].filter(Boolean).join(' '):entity.key==='servers'?[row.provider,row.os].filter(Boolean).join(' · '):''}))});
  }
  res.render('search',{title:'Genel arama',active:'search',q,groups,total:groups.reduce((n,g)=>n+g.total,0)});
 });return router;
};
