'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { safeNext } = require('../security');
const { normalizeEmail, validEmail, passwordError } = require('../users');
const { resetMail } = require('../mailer');

module.exports = function authRouter({ auth, users, mailer, config, logger }) {
  const router = express.Router();
  const limiter = (limit, handler) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler });

  const loginLimiter = limiter(10, (req, res) => {
    res.status(429).render('login', { title: 'Giriş', error: 'Çok fazla deneme yapıldı. 15 dakika sonra tekrar deneyin.', email: '', next: '/' });
  });
  const forgotLimiter = limiter(5, (req, res) => {
    res.status(429).render('auth/forgot', { title: 'Parolamı unuttum', error: 'Çok fazla istek yapıldı. 15 dakika sonra tekrar deneyin.', email: '', sent: false });
  });
  const resetLimiter = limiter(20, (req, res) => {
    res.status(429).render('auth/reset', { title: 'Yeni parola', invalid: true, error: null, token: '', email: '', purpose: 'reset' });
  });

  router.get('/login', (req, res) => {
    if (auth.currentUser(req)) return res.redirect('/');
    return res.render('login', { title: 'Giriş', error: null, email: '', next: safeNext(req.query.next) });
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const user = await auth.verifyCredentials(req.body.email, req.body.password);
      const nextUrl = safeNext(req.body.next);
      if (!user) {
        return res.status(401).render('login', {
          title: 'Giriş', error: 'E-posta veya parola hatalı.', email: typeof req.body.email === 'string' ? req.body.email.slice(0, 254) : '', next: nextUrl,
        });
      }
      // New session id + CSRF token after login (session fixation protection).
      return req.session.regenerate((err) => {
        if (err) return next(err);
        auth.issue(res, user);
        users.touchLogin(user.id);
        req.flash('success', `Hoş geldin, ${user.name || user.email}.`);
        return res.redirect(nextUrl);
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/forgot-password', (req, res) => {
    res.render('auth/forgot', { title: 'Parolamı unuttum', error: null, email: '', sent: false });
  });

  // Same response whether or not the address exists (no account enumeration).
  router.post('/forgot-password', forgotLimiter, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!validEmail(email)) {
      return res.status(422).render('auth/forgot', { title: 'Parolamı unuttum', error: 'Geçerli bir e-posta adresi girin.', email: email.slice(0, 254), sent: false });
    }
    const user = users.byEmail(email);
    if (user && user.active) {
      const mail = resetMail(config, user, users.createToken(user.id, 'reset'));
      try { await mailer.send(mail); } catch (e) { logger.error('[e-posta] gönderilemedi:', e.message); }
    }
    return res.render('auth/forgot', { title: 'Parolamı unuttum', error: null, email, sent: true });
  });

  router.get('/reset-password/:token', resetLimiter, (req, res) => {
    const user = users.tokenUser(req.params.token);
    res.status(user ? 200 : 400).render('auth/reset', {
      title: user && user.reset_purpose === 'invite' ? 'Parolanı belirle' : 'Yeni parola',
      invalid: !user, error: null, token: user ? req.params.token : '', email: user ? user.email : '', purpose: user ? user.reset_purpose : 'reset',
    });
  });

  router.post('/reset-password/:token', resetLimiter, async (req, res, next) => {
    try {
      const user = users.tokenUser(req.params.token);
      const view = { title: 'Yeni parola', invalid: !user, error: null, token: req.params.token, email: user ? user.email : '', purpose: user ? user.reset_purpose : 'reset' };
      if (!user) return res.status(400).render('auth/reset', view);
      const { password, password_confirm: confirm } = req.body;
      const error = passwordError(password, user.email) || (password !== confirm ? 'Parolalar eşleşmiyor.' : null);
      if (error) return res.status(422).render('auth/reset', { ...view, error });
      await users.setPassword(user.id, password);
      req.flash('success', 'Parolan kaydedildi. Yeni parolanla giriş yapabilirsin.');
      return res.redirect('/login');
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', (req, res) => {
    auth.clear(res);
    req.session.destroy(() => {
      res.clearCookie('opsdesk.sid', { path: '/' });
      res.redirect('/login');
    });
  });

  return router;
};
