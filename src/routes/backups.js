'use strict';
const express = require('express');

module.exports = function backupsRouter({ backups, auth }) {
  const router = express.Router();
  router.use(auth.requireAdmin);

  router.get('/', (req, res) => {
    res.render('backups', { title: 'Yedekler', active: 'backups', list: backups.list(), lastAuto: backups.lastAuto() });
  });

  router.post('/', (req, res) => {
    const name = backups.create('manual');
    req.flash('success', `Yedek oluşturuldu: ${name}`);
    res.redirect('/backups');
  });

  router.get('/export', (req, res) => {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    res.set({
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="opsdesk-anlik-${stamp}.sqlite"`,
      'Cache-Control': 'no-store',
    });
    res.send(backups.db.export());
  });

  router.get('/download/:file', (req, res, next) => {
    const full = backups.resolve(req.params.file);
    if (!full) return next();
    res.set('Cache-Control', 'no-store');
    return res.download(full);
  });

  router.post('/delete/:file', (req, res, next) => {
    if (!backups.remove(req.params.file)) return next();
    req.flash('success', 'Yedek silindi.');
    return res.redirect('/backups');
  });

  return router;
};
