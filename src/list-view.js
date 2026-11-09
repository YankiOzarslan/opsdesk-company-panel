'use strict';
const SORT_OPTIONS=[{value:'name_asc',label:'Ad: A–Z'},{value:'name_desc',label:'Ad: Z–A'},{value:'updated_desc',label:'Son güncellenen'},{value:'created_desc',label:'Son eklenen'}];
const compare=new Intl.Collator('tr-TR',{numeric:true,sensitivity:'base'}).compare;
function listView(input,query={}) {
 const sort=SORT_OPTIONS.some(s=>s.value===query.sort)?query.sort:'name_asc';
 const perPage=[25,50,100].includes(Number(query.per_page))?Number(query.per_page):25;
 const rows=[...input].sort((a,b)=>{
  const primary=sort==='name_desc'?compare(b.name || '',a.name || ''):sort==='updated_desc'?compare(b.updated_at || '',a.updated_at || ''):sort==='created_desc'?compare(b.created_at || '',a.created_at || ''):compare(a.name || '',b.name || '');
  return primary || Number(a.id)-Number(b.id);
 });
 const total=rows.length,pages=Math.max(1,Math.ceil(total/perPage));
 const requested=/^\d{1,9}$/.test(String(query.page))?Number(query.page):1;
 const page=Math.min(pages,Math.max(1,requested));
 return {rows:rows.slice((page-1)*perPage,page*perPage),pagination:{page,pages,total,perPage,sort,from:total?(page-1)*perPage+1:0,to:Math.min(page*perPage,total)},sortOptions:SORT_OPTIONS};
}
module.exports={listView};
