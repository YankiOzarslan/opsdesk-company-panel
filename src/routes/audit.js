'use strict';
const express = require('express');
const repo = require('../repo');

module.exports = function auditRouter({ db }) {
  const router = express.Router();
  router.get('/', (req, res) => {
    const data = repo.auditList(db, req.query, req.account);
    res.render('audit', { title: 'Değişiklik kaydı', active: 'audit', ...data, lk: repo.lookups(db) });
  });
  return router;
};
