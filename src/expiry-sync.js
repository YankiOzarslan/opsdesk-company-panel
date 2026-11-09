'use strict';
const repo = require('./repo');
const { ENTITIES } = require('./entities');
const lookup = require('./lookup');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const META_KEY = 'expiry_sync';
const SYSTEM_USER = 'sistem (otomatik kontrol)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Refreshes domains.expiry_date from RDAP/WHOIS once a day; changes go through repo.update (audited).
class ExpirySync {
  constructor(db, { logger = console, intervalMs = DAY_MS, checkEveryMs = HOUR_MS, delayMs = 1000 } = {}) {
    this.db = db;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.checkEveryMs = checkEveryMs;
    this.delayMs = delayMs;
    this.running = null;
    this.timers = [];
  }

  status() {
    const row = this.db.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY]);
    try { return row ? JSON.parse(row.value) : null; } catch (_) { return null; }
  }

  isDue(now = Date.now()) {
    const s = this.status();
    return !s || !s.finishedAt || !Number.isFinite(Date.parse(s.finishedAt)) || now - Date.parse(s.finishedAt) >= this.intervalMs;
  }

  run() {
    if (!this.running) this.running = this.runOnce().finally(() => { this.running = null; });
    return this.running;
  }

  recordStatus(id) {
    const row = this.db.get('SELECT value FROM app_meta WHERE key = ?', [`domain_check:${id}`]);
    try { return row ? JSON.parse(row.value) : null; } catch (_) { return null; }
  }

  async runOnce() {
    const entity = ENTITIES.domains;
    const rows = this.db.all('SELECT id, name, parent_domain_id FROM domains ORDER BY name');
    const result = { startedAt: new Date().toISOString(), attempted: rows.length, checked: 0, updated: [], failed: [], sslChecked: 0, sslFailed: [], dnsChecked: 0, dnsFailed: [] };
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
    for (const [i, row] of rows.entries()) {
      if (i && this.delayMs) await sleep(this.delayMs);
      const checkedAt = new Date().toISOString();
      const previous = this.recordStatus(row.id);
      const report = { name: row.name, checkedAt, registration: {state:'failed'}, ssl:{state:'failed'}, dns:{state:'failed'} };
      try {
        const host = lookup.normalizeHost(row.name, { stripWww: true });
        const [regR, sslR, dnsR] = await Promise.allSettled([
          row.parent_domain_id ? Promise.resolve(null) : lookup.lookupRegistration(host), lookup.lookupSsl(host), lookup.lookupDns(host)
        ]);
        const reg = regR.status === 'fulfilled' ? regR.value : null;
        const ssl = sslR.status === 'fulfilled' ? sslR.value : null;
        const dns = dnsR.status === 'fulfilled' ? dnsR.value : null;
        const fresh = repo.findById(this.db, entity, row.id);
        if (!fresh || fresh.name !== row.name || fresh.parent_domain_id !== row.parent_domain_id) continue;
        const changes = {};
        if (row.parent_domain_id) report.registration = {state:'inherited',parentId:row.parent_domain_id};
        else if (reg && validDate(reg.expiry_date)) {
          result.checked++;
          report.registration = {state:'verified', verifiedAt:checkedAt, source:reg.source, sourceUrl:reg.sourceUrl, expiry:reg.expiry_date, expiryType:reg.expiry_type || null, registryExpiry:reg.registry_expiry || null, registrarExpiry:reg.registrar_expiry || null, registrar:reg.registrar || null};
          if (fresh.expiry_date !== reg.expiry_date) {
            changes.expiry_date=reg.expiry_date;
            result.updated.push({name:row.name,from:fresh.expiry_date || null,to:reg.expiry_date});
          }
          // Preserve manually maintained registrar/DNS management/ownership fields.
          for (const field of ['registrar','registered_at']) if (!fresh[field] && reg[field] && (field !== 'registered_at' || validDate(reg[field]))) changes[field]=reg[field];
          if (fresh.registrar && reg.registrar && fresh.registrar.toLowerCase().replace(/[.,\s]/g,'') !== reg.registrar.toLowerCase().replace(/[.,\s]/g,'')) report.registration.registrarMismatch=true;
        } else {
          result.failed.push(row.name);
          report.registration={state:'failed',verifiedAt:previous?.registration?.verifiedAt || null,message:'Ayrı kayıt / yenileme bilgisi doğrulanamadı. Alt domain ise ana domain üzerinden takip edin.'};
        }
        if (ssl && validDate(ssl.ssl_expiry)) {
          result.sslChecked++;
          report.ssl={state:ssl.valid?'verified':'invalid',verifiedAt:checkedAt,expiry:ssl.ssl_expiry,issuer:ssl.ssl_issuer || null};
          if(fresh.ssl_expiry!==ssl.ssl_expiry)changes.ssl_expiry=ssl.ssl_expiry;
          if(ssl.ssl_issuer && fresh.ssl_issuer!==ssl.ssl_issuer)changes.ssl_issuer=ssl.ssl_issuer;
          if(changes.ssl_expiry || changes.ssl_issuer)result.sslUpdated=(result.sslUpdated || 0)+1;
          if(!ssl.valid)result.sslFailed.push(row.name);
        } else { result.sslFailed.push(row.name);report.ssl={state:'failed',verifiedAt:previous?.ssl?.verifiedAt || null,message:'Sertifika bu kontrolde okunamadı; eski kayıt korunuyor.'}; }
        if(dns) {result.dnsChecked++;report.dns={state:'verified',verifiedAt:checkedAt,...dns};}
        else {result.dnsFailed.push(row.name);report.dns={state:'failed',verifiedAt:previous?.dns?.verifiedAt || null,message:'DNS bu kontrolde çözümlenemedi.'};}
        if (Object.keys(changes).length) repo.update(this.db,entity,row.id,{...fresh,...changes},SYSTEM_USER);
      } catch (_) {
        if(!result.failed.includes(row.name))result.failed.push(row.name);
        if(!result.sslFailed.includes(row.name))result.sslFailed.push(row.name);
        if(!result.dnsFailed.includes(row.name))result.dnsFailed.push(row.name);
      }
      this.db.run('INSERT INTO app_meta (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at', [`domain_check:${row.id}`,JSON.stringify(report),checkedAt]);
    }
    result.finishedAt = new Date().toISOString();
    this.db.run('INSERT INTO app_meta (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at', [META_KEY,JSON.stringify(result),result.finishedAt]);
    this.logger.info(`[domain kontrolü] ${result.attempted} kayıt, ${result.checked} kayıt tarihi, ${result.sslChecked} SSL, ${result.dnsChecked} DNS kontrol edildi`);
    return result;
  }

  start() {
    const tick = () => { if (this.isDue()) this.run().catch((e) => this.logger.error('[bitiş kontrolü]', e)); };
    this.timers.push(setTimeout(tick, 30 * 1000), setInterval(tick, this.checkEveryMs));
    for (const t of this.timers) t.unref();
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

module.exports = { ExpirySync, SYSTEM_USER };
