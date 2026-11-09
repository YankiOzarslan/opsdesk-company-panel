'use strict';
const express = require('express');
const { ENTITIES } = require('../entities');
const { canEditProject, canReveal, deny } = require('../access');
const repo = require('../repo');
function draftContext(db, account, key) {
  if (typeof key !== 'string' || key.length > 150) return null;
  const match = key.match(/^\/(projects|domains|servers|clients|contacts|team)\/(new|\d+\/edit|\d+\/subdomains\/new)$/);
  if (!match || (match[2].includes('subdomains') && match[1] !== 'domains')) return null;
  const entity = ENTITIES[match[1]];
  if (entity.key === 'team' && account.role !== 'admin') return null;
  let id = null;
  if (match[2] !== 'new') {
    id = Number(match[2].split('/')[0]);
    const row = repo.findById(db, entity, id);
    if (!row || (entity.key === 'projects' && !canEditProject(db, account, row))) return null;
  }
  const allowed = entity.fields.filter(f => !f.hidden && (!f.secret || (id ? canReveal(db,account,entity.key,id) : account.role === 'admin'))).flatMap(f => f.secret ? [f.name, `_clear_${f.name}`] : [f.name]);
  return { allowed: [...allowed,'label','domain_lookup',...require('../project-domain').DOMAIN_FIELDS.map(f=>`domain_${f}`),'_step'], entity, id };
}
function clearDraft(db, account, key) { db.run('DELETE FROM form_drafts WHERE user_id = ? AND form_key = ?', [account.id,key]); }
module.exports = function draftsRouter({ db }) {
  const router = express.Router();
  router.get('/', (req, res, next) => {
    const context = draftContext(db,req.account,req.query.form);
    if (!context) return next(deny('Bu form taslağına erişilemiyor.'));
    const row = db.get('SELECT payload, updated_at FROM form_drafts WHERE user_id = ? AND form_key = ?', [req.account.id, req.query.form]);
    const stored = row ? JSON.parse(db.vault.open(row.payload,`draft:${req.account.id}:${req.query.form}`)) : null;
    // Re-evaluate permissions when restoring an older draft.
    const data = stored ? Object.fromEntries(Object.entries(stored).filter(([key])=>context.allowed.includes(key))) : null;
    return res.json({ ok: true, data, updatedAt: row?.updated_at || null });
  });
  router.post('/', (req, res, next) => {
    const context = draftContext(db,req.account,req.body.form);
    if (!context) return next(deny('Bu form taslağına erişilemiyor.'));
    if (req.body.discard === true) { clearDraft(db,req.account,req.body.form); return res.json({ok:true}); }
    const input = req.body.data;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(422).json({ok:false,message:'Geçersiz taslak.'});
    const data = {};
    for (const key of context.allowed) {
      const value = input[key];
      if (typeof value === 'string' && value.length <= 10000) data[key] = value;
      else if (Array.isArray(value) && value.length <= 50 && value.every(v=>typeof v === 'string' && v.length <= 100)) data[key] = value;
    }
    const payload = db.vault.seal(JSON.stringify(data),`draft:${req.account.id}:${req.body.form}`);
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO form_drafts (user_id,form_key,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,form_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',[req.account.id,req.body.form,payload,timestamp]);
    return res.json({ok:true,updatedAt:timestamp});
  });
  return router;
};
module.exports.clearDraft = clearDraft;
