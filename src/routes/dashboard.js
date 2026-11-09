'use strict';
const express = require('express');
const repo = require('../repo');
const dates = require('../dates');
const { projectIds } = require('../access');

module.exports = function dashboardRouter({ db }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const visible = projectIds(db,req.account);
    const projects = db.all('SELECT * FROM projects ORDER BY created_at DESC, id DESC').filter(p=>!visible || visible.has(p.id));
    const count = (table, where = '') => db.get(`SELECT COUNT(*) AS n FROM ${table} ${where}`).n;
    const counts = {
      projects: projects.length,
      activeProjects: projects.filter(p=>p.status === 'active').length,
      domains: count('domains'),
      managedDomains: count('domains', 'WHERE managed_by_us = 1'),
      servers: count('servers'),
      clients: count('clients'),
      contacts: count('contacts'),
      team: count('team_members'),
      noBackup: projects.filter(p=>!p.backup_enabled && p.status !== 'archived').length,
    };

    const expiryLimit = dates.addDays(dates.today(), 60);
    const expiring = db.all(`
      SELECT id, name, registrar, expiry_date, managed_by_us FROM domains
      WHERE parent_domain_id IS NULL AND expiry_date IS NOT NULL AND expiry_date <= ?
      ORDER BY expiry_date, name LIMIT 10`, [expiryLimit]);
    const expiringTotal = db.get('SELECT COUNT(*) AS n FROM domains WHERE parent_domain_id IS NULL AND expiry_date IS NOT NULL AND expiry_date <= ?', [expiryLimit]).n;
    const sslExpiring = db.get('SELECT COUNT(*) AS n FROM domains WHERE ssl_expiry IS NOT NULL AND ssl_expiry <= ?', [dates.addDays(dates.today(),30)]).n;
    const noExpiry = db.get('SELECT COUNT(*) AS n FROM domains WHERE parent_domain_id IS NULL AND expiry_date IS NULL').n;
    const recentProjects = projects.slice(0,6);
    const recentChanges = db.all('SELECT * FROM audit_log ORDER BY id DESC').filter(a=>a.entity_type !== 'projects' || !visible || visible.has(a.entity_id)).slice(0,8);

    res.render('dashboard', {
      title: 'Dashboard', active: 'dashboard', counts, expiring, expiringTotal, noExpiry, recentProjects, recentChanges, lk: repo.lookups(db), sslExpiring,
    });
  });

  return router;
};
