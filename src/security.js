'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const AUTH_COOKIE = 'opsdesk_token';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a, b) {
  // Hash both sides so lengths match and comparison time does not leak content.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  res.locals.csrfToken = ensureCsrfToken(req);
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = req.get('x-csrf-token') || (req.body && typeof req.body._csrf === 'string' ? req.body._csrf : '');
  if (sent && safeEqual(sent, req.session.csrfToken)) return next();
  const err = new Error('Geçersiz veya eksik CSRF token. Sayfayı yenileyip tekrar deneyin.');
  err.status = 403;
  return next(err);
}

const { normalizeEmail } = require('./users');

function createAuth(config, users) {
  const dummyHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' };

  async function verifyCredentials(email, password) {
    const e = normalizeEmail(email);
    const pass = typeof password === 'string' ? password : '';
    const user = e && pass.length <= 1024 ? users.byEmail(e) : null;
    if (user && user.active && user.password_hash) {
      try { return await bcrypt.compare(pass, user.password_hash) ? user : null; } catch (_) { return null; }
    }
    await bcrypt.compare(pass, dummyHash);
    return null;
  }

  function issue(res, user) {
    const token = jwt.sign({ sub: String(user.id), tv: user.token_version }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '8h' });
    res.cookie(AUTH_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
  }

  function clear(res) {
    res.clearCookie(AUTH_COOKIE, cookieOptions);
  }

  function currentUser(req) {
    const token = req.cookies && req.cookies[AUTH_COOKIE];
    if (!token) return null;
    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      const u = typeof payload.sub === 'string' && /^\d+$/.test(payload.sub) ? users.byId(Number(payload.sub)) : null;
      return u && u.active && u.token_version === payload.tv ? u : null;
    } catch (_) {
      return null;
    }
  }

  function requireAuth(req, res, next) {
    const user = currentUser(req);
    if (user) {
      req.account = user;
      req.user = user.email;
      res.locals.account = user;
      res.locals.user = user.name || user.email;
      return next();
    }
    if (req.cookies && req.cookies[AUTH_COOKIE]) clear(res);
    if (req.xhr || (req.get('accept') || '').includes('application/json')) {
      return res.status(401).json({ ok: false, message: 'Oturum gerekli.' });
    }
    const nextUrl = req.method === 'GET' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
    return res.redirect(`/login${nextUrl}`);
  }

  function requireAdmin(req, res, next) {
    if (req.account && req.account.role === 'admin') return next();
    const err = new Error('Bu sayfa yalnızca yöneticilere açık.');
    err.status = 403;
    return next(err);
  }

  return { verifyCredentials, issue, clear, currentUser, requireAuth, requireAdmin, cookieOptions };
}

function safeNext(v) {
  return typeof v === 'string' && /^\/(?![/\\])[^\s]*$/.test(v) && !v.startsWith('/login') ? v : '/';
}

module.exports = { csrfProtection, createAuth, safeEqual, safeNext, AUTH_COOKIE, SESSION_TTL_MS };
