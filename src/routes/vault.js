'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { canReveal, deny } = require('../access');
const repo = require('../repo');
module.exports = function vaultRouter({ db, entities }) {
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
  router.post('/:entity/:id(\\d+)/:field', (req, res, next) => {
    const entity = ['domains','servers'].includes(req.params.entity) && entities[req.params.entity];
    if (!entity || !entity.fieldMap[req.params.field]?.secret) return next();
    const id = Number(req.params.id);
    if (!canReveal(db, req.account, entity.key, id)) return next(deny('Bu erişim bilgisini yalnızca yöneticiler ve ilgili projeye atanmış kişiler açabilir.'));
    const row = repo.findById(db, entity, id);
    if (!row) return next();
    db.run('INSERT INTO audit_log (entity_type, entity_id, entity_name, action, field, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [entity.key,id,row.name,'reveal',req.params.field,req.account.email,new Date().toISOString()]);
    return res.json({ ok: true, value: row[req.params.field] || '' });
  });
  return router;
};
