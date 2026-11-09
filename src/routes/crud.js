'use strict';
const express = require('express');
const repo = require('../repo');
const catalog = require('../tech-catalog');
const access = require('../access');
const { clearDraft } = require('./drafts');
const { prepareProjectDomain, DOMAIN_FIELDS } = require('../project-domain');
const { validate, parseId } = require('../validate');
const { validateDomainRelations, subdomainRoutes } = require('../domain-relations');

const SUGGESTIONS = {
  language: Object.keys(catalog.LANGUAGES),
  registrar: ['Natro', 'İsimtescil', 'Turhost', 'Güzel Hosting', 'Turkticaret.net', 'Radore', 'Metunic', 'Domainnameapi', 'Hostinger',
    'GoDaddy', 'Namecheap', 'Cloudflare Registrar', 'Squarespace (Google Domains)', 'Automattic Inc. (WordPress.com)', 'Porkbun',
    'Gandi', 'OVHcloud', 'IONOS', 'Hetzner', 'Name.com', 'MarkMonitor'],
  dns_managed_by: ['Cloudflare', 'Registrar paneli', 'AWS Route 53', 'Google Cloud DNS', 'Azure DNS', 'DigitalOcean', 'Hetzner DNS',
    'Sunucu (cPanel)', 'Sunucu (Plesk)', 'Kendi DNS sunucumuz'],
  ssl_issuer: ["Let's Encrypt", 'Sectigo', 'DigiCert', 'GlobalSign', 'Google Trust Services', 'Cloudflare', 'ZeroSSL', 'GoDaddy', 'Amazon', 'RapidSSL'],
  provider: ['AWS', 'Hetzner', 'DigitalOcean', 'Google Cloud', 'Azure', 'Natro', 'Turhost'],
  os: ['Ubuntu 24.04', 'Ubuntu 22.04', 'Debian 12', 'AlmaLinux 9', 'Windows Server 2022'],
  role: ['Yazılım', 'Sistem yöneticisi', 'Proje yöneticisi', 'Müşteri IT', 'Tasarım'],
  company: ['OpsDesk'],
  job_role: ['Yazılım geliştirici', 'Frontend geliştirici', 'Backend geliştirici', 'Tasarımcı', 'Proje yöneticisi', 'Sistem yöneticisi', 'Test uzmanı'],
};

function datalists(db, entity) {
  const out = {};
  for (const f of entity.fields) {
    if (!f.datalist) continue;
    if (entity.key === 'projects' && f.name === 'technology') {
      out[f.name] = catalog.techDatalist(repo.distinctValues(db, entity, f.name));
      continue;
    }
    const merged = new Set([...repo.distinctValues(db, entity, f.name), ...(SUGGESTIONS[f.name] || [])]);
    out[f.name] = [...merged];
  }
  return out;
}

function defaults(entity) {
  const v = {};
  for (const f of entity.fields) v[f.name] = f.default !== undefined ? f.default : null;
  return v;
}

module.exports = function crudRouter(ctx, entity, { formView = 'entity/form', extend } = {}) {
  const { db } = ctx;
  const router = express.Router();
  const base = `/${entity.key}`;
  const refExists = (ref, id) => repo.refExists(db, ref, id);
  function definition() {
    if (entity.key !== 'projects') return entity;
    const options = db.all('SELECT key AS value, label FROM technology_categories ORDER BY label COLLATE NOCASE');
    const fields = entity.fields.map(f => f.name === 'tech_category' ? { ...f, options } : f);
    return { ...entity, fields, fieldMap: Object.fromEntries(fields.map(f => [f.name, f])) };
  }
  function readBody(req, id = null) {
    const old = id ? repo.findById(db, entity, id) : null;
    const body = { ...req.body };
    for (const f of entity.fields) {
      if (f.hidden && old) body[f.name] = old[f.name];
      if (!f.secret) continue;
      const allowed = id ? access.canReveal(db,req.account,entity.key,id) : req.account.role === 'admin';
      const supplied = body[f.name] !== undefined && body[f.name] !== '';
      const clear = body[`_clear_${f.name}`] === '1';
      if ((supplied || clear) && !allowed) throw access.deny('Erişim bilgilerini değiştirme yetkiniz yok.');
      if (old && !supplied && !clear) body[f.name] = old[f.name];
      if (clear) body[f.name] = '';
    }
    if (req.account.role !== 'admin') {
      if (entity.key === 'projects') {
        const current = old?.team_ids || [];
        const incoming = body.team_ids === undefined ? current : [body.team_ids].flat().filter(Boolean).map(Number);
        if (JSON.stringify([...new Set(incoming)].sort()) !== JSON.stringify([...current].sort())) throw access.deny('Proje atamalarını yalnızca yönetici değiştirebilir.');
        body.team_ids = current.map(String);
        if (old) for (const field of ['domain_id','server_id']) {
          if (body[field] !== undefined && String(body[field] || '') !== String(old[field] || '')) throw access.deny('Projenin domain ve sunucu bağlantısını yalnızca yönetici değiştirebilir.');
          body[field] = old[field];
        }
      }
      if (entity.key === 'servers') {
        if (body.manager_team_id && String(body.manager_team_id) !== String(old?.manager_team_id || '')) throw access.deny('Sunucu sorumlusunu yalnızca yönetici değiştirebilir.');
        body.manager_team_id = old?.manager_team_id || '';
      }
    }
    return body;
  }
  router.use((req,res,next) => {
    if (entity.key === 'team' && (req.method === 'POST' || req.path === '/new' || req.path.endsWith('/edit')) && req.account.role !== 'admin') return next(access.deny('Ekip üyelerini ve iş rollerini yalnızca yönetici düzenleyebilir.'));
    const match = req.path.match(/^\/(\d+)(?:\/|$)/);
    if (entity.key !== 'projects' || !match) return next();
    const row = repo.findById(db,entity,Number(match[1]));
    if (!row) return next();
    const visible = access.projectIds(db,req.account);
    if (visible && !visible.has(row.id)) return next(access.deny('Bu projeyi görüntüleme yetkiniz yok.'));
    const writing = req.method === 'POST' || req.path.endsWith('/edit');
    if (writing && !access.canEditProject(db,req.account,row)) return next(access.deny('Aynı iş rolündeki projeleri görüntüleyebilirsiniz; düzenlemek için projeye atanmalısınız.'));
    if (req.path.endsWith('/delete') && req.account.role !== 'admin' && row.created_by !== req.account.email) return next(access.deny('Bu projeyi silme yetkiniz yok.'));
    next();
  });

  function renderForm(req, res, { values, errors = {}, mode, id, status = 200 }) {
    res.status(status).render(formView, {
      title: mode === 'create' ? `Yeni ${entity.singular.toLocaleLowerCase('tr-TR')}` : `${values.name || entity.singular} — düzenle`,
      active: entity.key,
      entity: definition(),
      values: Object.fromEntries(Object.entries(values).map(([key,value]) => [key, entity.fieldMap[key]?.secret ? null : value])),
      hasSecrets: Object.fromEntries(entity.fields.filter(f=>f.secret).map(f=>[f.name,Boolean(values[f.name])])),
      canSecrets: id ? access.canReveal(db,req.account,entity.key,id) : req.account.role === 'admin',
      domainInput: entity.key === 'projects' ? (typeof req.body.domain_lookup === 'string' ? req.body.domain_lookup : '') : '',
      domainMetadata: Object.fromEntries(DOMAIN_FIELDS.map(f=>[f, typeof req.body[`domain_${f}`] === 'string' ? req.body[`domain_${f}`] : ''])),
      errors,
      mode,
      id,
      action: mode === 'create' ? base : `${base}/${id}`,
      lk: repo.lookups(db),
      datalists: datalists(db, entity),
      techCatalogJson: entity.key === 'projects' ? catalog.clientJson() : null,
    });
  }

  if (extend) extend(router);
  if (entity.key === 'domains') subdomainRoutes(router, ctx);

  router.get('/', (req, res) => {
    const lk = repo.lookups(db);
    let { rows, applied } = repo.list(db, definition(), req.query);
    if (entity.key === 'projects') {
      const scope = req.query.scope === 'mine' ? 'mine' : 'all';
      const visible = access.projectIds(db,req.account,scope);
      if (visible) rows = rows.filter(row=>visible.has(row.id));
      if (scope === 'mine') applied.scope = 'mine';
    }
    const matched = rows.length;
    const {listView}=require('../list-view');
    const listState=listView(rows,req.query);rows=listState.rows;
    rows.forEach(row => {
      row.canEdit = entity.key === 'projects' ? access.canEditProject(db,req.account,row) : (entity.key !== 'team' || req.account.role === 'admin');
      if (entity.key === 'domains') row.verification = ctx.expirySync.recordStatus(row.id);
      row.canDelete = row.canEdit && (entity.key !== 'projects' || req.account.role === 'admin' || row.created_by === req.account.email);
    });
    const total = entity.key === 'projects' ? (access.projectIds(db,req.account,applied.scope === 'mine' ? 'mine' : 'all')?.size ?? db.get('SELECT COUNT(*) AS n FROM projects').n) : db.get(`SELECT COUNT(*) AS n FROM ${entity.table}`).n;
    res.render('entity/list', {
      title: entity.plural, active: entity.key, entity: definition(), rows, applied, total, lk, matched, pagination:listState.pagination, sortOptions:listState.sortOptions,
      filterOptions: repo.filterOptions(db, definition(), lk, req.query),
    });
  });

  router.get('/new', (req, res) => {
    const values = defaults(entity);
    // Allow prefilling relations, e.g. /projects/new?domain_id=3
    for (const f of entity.fields) {
      if (f.type !== 'fk' || req.query[f.name] === undefined) continue;
      const id = parseId(req.query[f.name]);
      if (id && refExists(f.ref, id)) values[f.name] = id;
    }
    renderForm(req, res, { values, mode: 'create' });
  });

  router.post('/', (req, res) => {
    const { values, errors } = validate(definition(), readBody(req), refExists);
    const newDomain = entity.key === 'projects' ? prepareProjectDomain(db,req,values,errors) : null;
    if (entity.key === 'domains') Object.assign(errors, validateDomainRelations(db, values));
    if (Object.keys(errors).length) return renderForm(req, res, { values, errors, mode: 'create', status: 422 });
    let id;
    try {
      id = db.transaction(() => {
        if (newDomain) values.domain_id = repo.create(db,ctx.entities.domains,newDomain,req.user);
        return repo.create(db, entity, values, req.user);
      });
    } catch (err) {
      if (/UNIQUE constraint failed/.test(err.message)) {
        return renderForm(req, res, { values, errors: entity.key === 'team' && values.user_id ? { user_id: 'Bu panel hesabı zaten başka bir ekip üyesine bağlı.' } : { name: `Bu ${entity.singular.toLocaleLowerCase('tr-TR')} zaten kayıtlı.` }, mode: 'create', status: 409 });
      }
      throw err;
    }
    clearDraft(db,req.account,`${base}/new`);
    req.flash('success', `${entity.singular} oluşturuldu: ${values.name}`);
    return res.redirect(`${base}/${id}`);
  });

  router.get('/:id(\\d+)', (req, res, next) => {
    const id = Number(req.params.id);
    const row = repo.findById(db, entity, id);
    if (!row) return next();
    const lk = repo.lookups(db);
    const visibleProjects = access.projectIds(db,req.account);
    const related = (entity.related || []).map((r) => ({
      ...r,
      rows: db.all(`SELECT * FROM ${ctx.entities[r.entity].table} WHERE ${r.fk} = ? ORDER BY name COLLATE NOCASE`, [id]).filter(row => r.entity !== 'projects' || !visibleProjects || visibleProjects.has(row.id)),
      target: ctx.entities[r.entity],
    }));
    if (entity.key === 'team') {
      const rows = db.all('SELECT p.* FROM projects p JOIN project_assignments a ON a.project_id=p.id WHERE a.team_member_id=? ORDER BY p.name',[id]).filter(p=>!visibleProjects || visibleProjects.has(p.id));
      related.push({entity:'projects',fk:null,title:'Atandığı projeler',rows,target:ctx.entities.projects});
    }
    return res.render('entity/show', {
      title: row.name, active: entity.key, entity: definition(), row, lk, related, canEdit: entity.key === 'projects' ? access.canEditProject(db,req.account,row) : (entity.key !== 'team' || req.account.role === 'admin'), canDelete: req.account.role === 'admin' || (entity.key !== 'projects' && entity.key !== 'team') || row.created_by === req.account.email, canSecrets: access.canReveal(db,req.account,entity.key,id), history: repo.history(db, entity.key, id),
    });
  });

  router.get('/:id(\\d+)/edit', (req, res, next) => {
    const id = Number(req.params.id);
    const row = repo.findById(db, entity, id);
    if (!row) return next();
    return renderForm(req, res, { values: row, mode: 'edit', id });
  });

  router.post('/:id(\\d+)', (req, res, next) => {
    const id = Number(req.params.id);
    if (!repo.findById(db, entity, id)) return next();
    const { values, errors } = validate(definition(), readBody(req,id), refExists);
    const newDomain = entity.key === 'projects' ? prepareProjectDomain(db,req,values,errors,id) : null;
    if (entity.key === 'domains') Object.assign(errors, validateDomainRelations(db, values, id));
    if (Object.keys(errors).length) return renderForm(req, res, { values, errors, mode: 'edit', id, status: 422 });
    let result;
    try {
      result = db.transaction(() => {
        if (newDomain) values.domain_id = repo.create(db,ctx.entities.domains,newDomain,req.user);
        return repo.update(db, entity, id, values, req.user);
      });
    } catch (err) {
      if (/UNIQUE constraint failed/.test(err.message)) {
        return renderForm(req, res, { values, errors: entity.key === 'team' && values.user_id ? { user_id: 'Bu panel hesabı zaten başka bir ekip üyesine bağlı.' } : { name: `Bu ${entity.singular.toLocaleLowerCase('tr-TR')} zaten kayıtlı.` }, mode: 'edit', id, status: 409 });
      }
      throw err;
    }
    if (!result) return next();
    clearDraft(db,req.account,`${base}/${id}/edit`);
    if (result.changed.length) req.flash('success', `Kaydedildi — ${result.changed.length} alan güncellendi.`);
    else req.flash('info', 'Değişiklik yapılmadı.');
    return res.redirect(`${base}/${id}`);
  });

  router.post('/:id(\\d+)/delete', (req, res, next) => {
    const result = repo.remove(db, entity, Number(req.params.id), req.user);
    if (!result) return next();
    const extra = result.dependents ? ` (${result.dependents} bağlı kayıttaki referans temizlendi)` : '';
    req.flash('success', `${entity.singular} silindi: ${result.old.name}${extra}`);
    return res.redirect(base);
  });

  return router;
};
