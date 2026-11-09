'use strict';
const express = require('express');
const { passwordError } = require('../users');

module.exports = function accountRouter({ auth, users }) {
  const router = express.Router();
  const render = (req, res, extra = {}, status = 200) => res.status(status).render('account', {
    title: 'Hesabım', active: 'account', errors: {}, name: req.account.name || '', ...extra,
  });

  router.get('/account', (req, res) => render(req, res));

  router.post('/account', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
    users.update(req.account.id, { name });
    req.flash('success', 'Bilgilerin güncellendi.');
    res.redirect('/account');
  });

  router.post('/account/password', async (req, res, next) => {
    try {
      const { current_password: current, password, password_confirm: confirm } = req.body;
      const errors = {};
      if (!(await auth.verifyCredentials(req.account.email, current))) errors.current_password = 'Mevcut parola hatalı.';
      const pe = passwordError(password, req.account.email) || (res.locals.mustChangePassword && password===current ? 'Başlangıç parolanızdan farklı bir parola seçin.' : null);
      if (pe) errors.password = pe;
      else if (password !== confirm) errors.password_confirm = 'Parolalar eşleşmiyor.';
      if (Object.keys(errors).length) return render(req, res, { errors }, 422);
      auth.issue(res, await users.setPassword(req.account.id, password));
      req.flash('success', 'Parolan değiştirildi. Diğer cihazlardaki oturumların kapatıldı.');
      return res.redirect('/account');
    } catch (err) {
      return next(err);
    }
  });

  return router;
};
