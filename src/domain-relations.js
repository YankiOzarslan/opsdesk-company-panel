'use strict';
const repo = require('./repo');
const { ENTITIES } = require('./entities');
const { validate } = require('./validate');

// A strict DNS suffix also prevents cycles: a child must have a longer name.
function validateDomainRelations(db, values, id = null) {
  const errors = {};
  const name = values.name || '';
  if (values.parent_domain_id) {
    const parent = repo.findById(db, ENTITIES.domains, values.parent_domain_id);
    if (!parent) errors.parent_domain_id = 'Seçilen ana domain bulunamadı.';
    else if (Number(values.parent_domain_id) === id) errors.parent_domain_id = 'Domain kendisine bağlanamaz.';
    else if (!name.endsWith(`.${parent.name}`)) errors.name = `Alt domain adı .${parent.name} ile bitmeli (ör. panel.${parent.name}).`;
  }
  if (id && name) {
    const children = db.all('SELECT name FROM domains WHERE parent_domain_id = ?', [id]);
    if (children.some(child => !child.name.endsWith(`.${name}`))) {
      errors.name = 'Bu domaine bağlı alt domainler var. Önce alt domainlerin adını veya ana domain bağlantısını düzenleyin.';
    }
  }
  return errors;
}

function subdomainRoutes(router, ctx) {
  const { db } = ctx;
  const entity = ENTITIES.domains;
  const findParent = (id) => repo.findById(db, entity, Number(id));
  const render = (req, res, parent, values = {}, errors = {}, status = 200) => res.status(status).render('domains/subdomain', {
    title: 'Yeni alt domain', active: 'domains', parent, values, errors,
  });

  router.get('/:id(\\d+)/subdomains/new', (req, res, next) => {
    const parent = findParent(req.params.id);
    if (!parent) return next();
    return render(req, res, parent, { label: '', status: 'active', notes: '' });
  });

  router.post('/:id(\\d+)/subdomains', (req, res, next) => {
    const parent = findParent(req.params.id);
    if (!parent) return next();
    const label = typeof req.body.label === 'string' ? req.body.label.trim().toLowerCase() : '';
    const input = { label, status: req.body.status, notes: req.body.notes };
    const result = validate(entity, {
      name: `${label}.${parent.name}`,
      parent_domain_id: String(parent.id),
      status: input.status,
      notes: input.notes,
      managed_by_us: parent.managed_by_us ? '1' : '0',
    }, (ref, id) => repo.refExists(db, ref, id));
    const errors = { ...result.errors, ...validateDomainRelations(db, result.values) };
    if (!label) errors.label = 'Alt domain adı zorunlu.';
    else if (!/^([a-z0-9\u00a1-\uffff](?:[a-z0-9\u00a1-\uffff-]{0,61}[a-z0-9\u00a1-\uffff])?)(\.[a-z0-9\u00a1-\uffff](?:[a-z0-9\u00a1-\uffff-]{0,61}[a-z0-9\u00a1-\uffff])?)*$/i.test(label)) errors.label = 'Geçerli bir alt domain ön eki girin (ör. panel).';
    if (errors.name) { errors.label = errors.name; delete errors.name; }
    if (Object.keys(errors).length) return render(req, res, parent, input, errors, 422);
    let id;
    try {
      id = repo.create(db, entity, result.values, req.user);
    } catch (error) {
      if (/UNIQUE constraint failed/.test(error.message)) {
        return render(req, res, parent, input, { label: 'Bu alt domain zaten kayıtlı.' }, 409);
      }
      return next(error);
    }
    require('./routes/drafts').clearDraft(db,req.account,`/domains/${parent.id}/subdomains/new`);
    req.flash('success', `Alt domain oluşturuldu: ${result.values.name}`);
    return res.redirect(`/domains/${id}`);
  });
}

module.exports = { validateDomainRelations, subdomainRoutes };
