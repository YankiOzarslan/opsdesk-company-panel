'use strict';
const repo = require('./repo');
const lookup = require('./lookup');
const { ENTITIES } = require('./entities');
const { validate } = require('./validate');
const { deny } = require('./access');
function findDomain(db, host) {
  return db.all('SELECT id, name FROM domains').find(row => { try { return lookup.normalizeHost(row.name,{stripWww:true}) === host; } catch (_) { return false; } });
}
const DOMAIN_FIELDS = ['registrar','registered_at','expiry_date','nameservers','dns_managed_by','ssl_issuer','ssl_expiry'];
function prepareProjectDomain(db, req, values, errors, id = null) {
  const raw = req.body.domain_lookup;
  const fallbackName=host=>{if(!values.name){values.name=host.length>200?host.slice(0,197)+'…':host;delete errors.name;}};
  if (typeof raw !== 'string' || !raw.trim()) {
    if(values.domain_id){const selected=repo.findById(db,ENTITIES.domains,values.domain_id);if(selected)fallbackName(selected.name);}
    return null;
  }
  let host;
  try { host = lookup.normalizeHost(raw, { stripWww: true }); }
  catch (_) { errors.domain_lookup = 'Geçerli bir domain girin (ör. ornek.com).'; return null; }
  fallbackName(host);
  const existing = findDomain(db,host);
  if (id && req.account.role !== 'admin') {
    const previous = repo.findById(db,ENTITIES.projects,id);
    if (!existing || previous.domain_id !== existing.id) throw deny('Projenin domain bağlantısını yalnızca yönetici değiştirebilir.');
  }
  if (existing) { values.domain_id = existing.id; return null; }
  const source = { name: host, managed_by_us: '1' };
  for (const f of DOMAIN_FIELDS) source[f] = req.body[`domain_${f}`];
  const checked = validate(ENTITIES.domains,source,(ref,pk)=>repo.refExists(db,ref,pk));
  for (const [field,message] of Object.entries(checked.errors)) errors[`domain_${field}`] = message;
  return checked.values;
}
async function lookupProjectDomain(input, db) {
  const result = await lookup.lookupDomain(input);
  const catalog = require('./tech-catalog');
  const fields = {};
  const hints = result.info?.site?.hints || [];
  for (const hint of hints) {
    const technology = [...catalog.CATEGORIES.flatMap(c=>c.items.map(([name])=>catalog.lookup(name)))].find(t=>String(hint).toLowerCase() === t.name.toLowerCase() || String(hint).toLowerCase().startsWith(t.name.toLowerCase()+' '));
    if (!technology) continue;
    fields.technology = technology.name;
    fields.tech_category = technology.category;
    // A framework's usual language does not prove this site's source language.
    const version=String(hint).slice(technology.name.length).trim().match(/^\d+(?:\.\d+){0,3}/);
    if(version) fields.tech_version=version[0];
    break;
  }
  const site = result.info?.site;
  if (site?.technologies?.length) {
    const priority = {ecommerce:0,fullstack:1,cms:2,backend:3,frontend:4,static:5};
    const primary = site.technologies
      .filter(t => !['server','runtime'].includes(t.kind) && catalog.lookup(t.name))
      .sort((a,b) => (priority[catalog.lookup(a.name).category] ?? 9) - (priority[catalog.lookup(b.name).category] ?? 9))[0];
    delete fields.technology;delete fields.tech_category;delete fields.tech_version;
    if (primary) {
      const entry = catalog.lookup(primary.name);
      fields.technology = entry.name;
      fields.tech_category = entry.category;
      delete fields.tech_version;
      if (primary.version) fields.tech_version = primary.version;
    }
    const libraries = site.technologies.filter(t => t.name !== fields.technology);
    if (libraries.length) fields.framework = libraries.map(t => t.name + (t.versions?.length > 1 ? ` ${t.versions.join(' / ')}` : t.version ? ` ${t.version}` : '')).join(', ');
  }
  if (site?.technologies?.some(t=>t.versions?.length > 1)) result.messages.push('Aynı teknoloji için birden fazla sürüm bulundu; güncellemeden önce kaynakları kontrol edin.');
  if (site?.language) { fields.language = site.language.name; if(site.language.version) fields.language_version = site.language.version; }
  if (fields.technology && !fields.tech_version && !site?.technologies?.find(t=>t.name===fields.technology && t.versions?.length>1)) result.messages.push('Teknoloji sürümü site tarafından yayımlanmıyor; sürüm alanı boş bırakıldı.');
  if (!fields.technology) result.messages.push('Teknoloji dışarıdan kesin belirlenemedi. Kategori ve teknolojiyi elle seçin.');
  const existing=findDomain(db,result.query);
  // Do not return any locally saved credentials or encrypted DNS account fields.
  return { ...result, projectFields: fields, domainId: existing?.id || null };
}
module.exports={DOMAIN_FIELDS,prepareProjectDomain,lookupProjectDomain};
