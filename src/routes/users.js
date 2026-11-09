'use strict';
const express = require('express');
const { normalizeEmail, validEmail, passwordError, ROLES } = require('../users');
const { resetMail } = require('../mailer');

module.exports = function usersRouter({ auth, users, mailer, config, logger, db }) {
  const router = express.Router();
  router.use(auth.requireAdmin);

  const renderForm = (res, { mode, values, errors = {}, id = null, status = 200 }) => res.status(status).render('users/form', {
    title: mode === 'create' ? 'Yeni kullanıcı' : `${values.name || values.email} — düzenle`, active: 'users', mode, values, errors, id, roles: ROLES,
  });

  function readBody(body) {
    return {
      email: normalizeEmail(body.email),
      name: typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '',
      role: ROLES.some((r) => r.value === body.role) ? body.role : null,
      active: body.active === '1' ? 1 : 0,
    };
  }

  function checkBody(values, existingId = null) {
    const errors = {};
    if (!validEmail(values.email)) errors.email = 'Geçerli bir e-posta adresi girin.';
    else {
      const other = users.byEmail(values.email);
      if (other && other.id !== existingId) errors.email = 'Bu e-posta ile kayıtlı bir kullanıcı var.';
    }
    if (!values.role) errors.role = 'Rol seçin.';
    return errors;
  }

  async function deliver(req, mail, validity) {
    let sent = false;
    try { ({ sent } = await mailer.send(mail)); } catch (e) { logger.error('[e-posta] gönderilemedi:', e.message); }
    if (sent) req.flash('success', `${mail.to} adresine e-posta gönderildi.`);
    else req.flash('warning', `E-posta gönderilemedi (SMTP ayarlı değil veya hata oluştu). Bu bağlantıyı kullanıcıya iletin (${validity} geçerli): ${mail.link}`);
  }

  const load = (req) => (/^\d+$/.test(req.params.id) ? users.byId(Number(req.params.id)) : null);
  const leavesNoAdmin = (target, next) => target.role === 'admin' && target.active && (next.role !== 'admin' || !next.active) && users.activeAdmins() <= 1;

  router.get('/', (req, res) => {
    res.render('users/list', { title: 'Kullanıcılar', active: 'users', rows: users.list(), mailConfigured: mailer.configured, adminEmail: config.adminEmail, roles: ROLES });
  });

  router.get('/new', (req, res) => renderForm(res, { mode: 'create', values: { email: '', name: '', role: 'user', active: 1 } }));

  router.post('/', async (req, res, next) => {
    try {
      const values = readBody(req.body);
      const errors = checkBody(values);
      const pe=passwordError(req.body.password,values.email);
      if(pe)errors.password=pe;
      else if(req.body.password!==req.body.password_confirm)errors.password_confirm='Parolalar eşleşmiyor.';
      if (Object.keys(errors).length) return renderForm(res, { mode: 'create', values, errors, status: 422 });
      const hash=await require('bcryptjs').hash(req.body.password,config.bcryptRounds);
      db.transaction(()=>{
        const user=users.create({email:values.email,name:values.name,role:values.role,passwordHash:hash});
        db.run('INSERT INTO app_meta (key,value,updated_at) VALUES (?,?,?)',[`password_change:${user.id}`,'1',new Date().toISOString()]);
        if(req.body.create_team==='1')require('../repo').create(db,require('../entities').ENTITIES.team,{name:values.name || values.email,email:values.email,user_id:user.id,job_role:typeof req.body.job_role==='string'?req.body.job_role.trim().slice(0,100):'Çalışan'},req.account.email);
      });
      req.flash('success','Kullanıcı oluşturuldu. E-posta ve başlangıç parolasını güvenli bir yoldan paylaşın. İlk girişte kendi parolasını belirlemesi gerekir.');
      return res.redirect('/users');
    } catch (err) { return next(err); }
  });

  router.get('/:id/edit', (req, res, next) => {
    const u = load(req);
    if (!u) return next();
    return renderForm(res, { mode: 'edit', values: u, id: u.id });
  });

  router.post('/:id', (req, res, next) => {
    const u = load(req);
    if (!u) return next();
    const values = readBody(req.body);
    const errors = checkBody(values, u.id);
    if (u.id === req.account.id && (values.role !== 'admin' || !values.active)) errors.role = 'Kendi yönetici yetkini veya hesabını kapatamazsın.';
    else if (leavesNoAdmin(u, values)) errors.role = 'En az bir aktif yönetici kalmalı.';
    if (Object.keys(errors).length) return renderForm(res, { mode: 'edit', values: { ...u, ...values }, errors, id: u.id, status: 422 });
    const updated = users.update(u.id, values);
    if (u.id === req.account.id) auth.issue(res, updated);
    req.flash('success', `${updated.email} güncellendi.`);
    return res.redirect('/users');
  });

  router.post('/:id/temporary-password', async(req,res,next)=>{
    try{
      const user=load(req);if(!user)return next();
      if(user.id===req.account.id){req.flash('danger','Kendi parolanızı Hesabım ekranından değiştirin.');return res.redirect('/account');}
      const error=passwordError(req.body.password,user.email) || (req.body.password!==req.body.password_confirm?'Parolalar eşleşmiyor.':null);
      if(error)return renderForm(res,{mode:'edit',values:user,id:user.id,errors:{password:error},status:422});
      await users.setPassword(user.id,req.body.password);
      db.run('INSERT INTO app_meta (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',[`password_change:${user.id}`,'1',new Date().toISOString()]);
      req.flash('success','Başlangıç parolası yenilendi. Kullanıcının eski oturumları kapatıldı; ilk girişte parolasını değiştirmesi gerekir.');res.redirect('/users');
    }catch(error){next(error);}
  });

  router.post('/:id/reset', async (req, res, next) => {
    try {
      const u = load(req);
      if (!u) return next();
      await deliver(req, resetMail(config, u, users.createToken(u.id, 'reset')), '1 saat');
      return res.redirect('/users');
    } catch (err) { return next(err); }
  });

  router.post('/:id/delete', (req, res, next) => {
    const u = load(req);
    if (!u) return next();
    if (u.id === req.account.id) req.flash('danger', 'Kendi hesabını silemezsin.');
    else if (leavesNoAdmin(u, { role: 'user', active: 0 })) req.flash('danger', 'En az bir aktif yönetici kalmalı.');
    else {
      users.remove(u.id);
      req.flash('success', `${u.email} silindi.`);
    }
    return res.redirect('/users');
  });

  return router;
};
