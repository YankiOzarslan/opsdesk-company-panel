'use strict';
const rateLimit = require('express-rate-limit');
const lookup = require('../lookup');

// Extra routes mounted into the domains / servers CRUD routers.
module.exports = function lookupRoutes(ctx, key) {
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ ok: false, message: 'Çok fazla sorgu yapıldı, bir dakika sonra tekrar deneyin.' }),
  });
  const fn = key === 'domains' ? lookup.lookupDomain : lookup.lookupServer;

  return (router) => {
    router.post('/lookup', limiter, async (req, res) => {
      const query = req.body && typeof req.body.query === 'string' ? req.body.query.slice(0, 300) : '';
      try {
        res.json({ ok: true, ...(await fn(query)) });
      } catch (e) {
        const known = e instanceof lookup.LookupError;
        res.status(known ? e.status : 502).json({ ok: false, message: known ? e.message : 'Dış servise ulaşılamadı, daha sonra tekrar deneyin.' });
      }
    });

    if (key !== 'domains') return;
    router.get('/', (req, res, next) => {
      res.locals.expirySync = ctx.expirySync.status();
      next();
    });
    router.post('/sync-expiry', async (req, res, next) => {
      try {
        const r = await ctx.expirySync.run();
        const parts = [`${r.attempted} kayıt tarandı`, `${r.checked} kayıt tarihi doğrulandı`, `${r.updated.length} tarih güncellendi`, `${r.sslChecked} SSL kontrol edildi`, `${r.dnsChecked} DNS çözümlendi`];
        if(r.sslFailed.length) parts.push(`${r.sslFailed.length} SSL doğrulanamadı`);
        if(r.dnsFailed.length) parts.push(`${r.dnsFailed.length} DNS çözümlenemedi`);
        if (r.failed.length) parts.push(`${r.failed.length} için tarih alınamadı (${r.failed.slice(0, 5).join(', ')})`);
        req.flash(r.failed.length || r.sslFailed.length || r.dnsFailed.length ? 'warning' : 'success', `Bitiş tarihi kontrolü: ${parts.join(', ')}.`);
        res.redirect('/domains');
      } catch (e) { next(e); }
    });
  };
};
