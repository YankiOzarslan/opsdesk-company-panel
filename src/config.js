'use strict';
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function loadConfig(overrides = {}) {
  const env = { ...process.env, ...(overrides.env || {}) };
  const production = env.NODE_ENV === 'production';
  const dataDir = overrides.dataDir || env.DATA_DIR || path.join(ROOT, 'data');
  const warnings = [];
  const port = Number(env.PORT) || 4000;
  const adminEmail = String(env.ADMIN_EMAIL || (production ? '' : 'admin@opsdesk.local')).trim().toLowerCase();
  if (!adminEmail) throw new Error('ADMIN_EMAIL tanımlanmalı.');
  const smtpPort = Number(env.SMTP_PORT) || 587;
  const smtp = env.SMTP_HOST ? {
    host: env.SMTP_HOST,
    port: smtpPort,
    secure: bool(env.SMTP_SECURE, smtpPort === 465),
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
  } : null;
  if (production && !env.APP_URL) warnings.push('APP_URL tanımlı değil; e-postalardaki bağlantılar localhost adresini gösterecek.');

  function secret(name) {
    if (env[name] && env[name].length >= 32) return env[name];
    if (production) throw new Error(`${name} en az 32 karakter olmalı.`);
    if (env[name]) warnings.push(`${name} 32 karakterden kısa; rastgele bir değer kullanılıyor.`);
    return crypto.randomBytes(48).toString('hex');
  }

  return {
    root: ROOT,
    production,
    port,
    host: env.HOST || '127.0.0.1',
    dataDir,
    vaultKeyPath: env.VAULT_KEY_FILE || path.join(path.dirname(path.resolve(dataDir)), '.secrets', 'vault.key'),
    dbPath: overrides.dbPath || path.join(dataDir, 'opsdesk.db'),
    backupDir: overrides.backupDir || env.BACKUP_DIR || path.join(ROOT, 'backups'),
    backupKeep: Number(env.BACKUP_KEEP) || 30,
    autoBackup: overrides.autoBackup !== undefined ? overrides.autoBackup : bool(env.AUTO_BACKUP, true),
    autoExpirySync: overrides.autoExpirySync !== undefined ? overrides.autoExpirySync : bool(env.AUTO_EXPIRY_SYNC, true),
    jwtSecret: secret('JWT_SECRET'),
    sessionSecret: secret('SESSION_SECRET'),
    cookieSecure: bool(env.COOKIE_SECURE, false),
    trustProxy: bool(env.TRUST_PROXY, false),
    uploadMaxMb: Number(env.UPLOAD_MAX_MB) || 20,
    adminEmail,
    adminPassword: env.ADMIN_PASSWORD || null,
    adminPasswordHash: (env.ADMIN_PASSWORD_HASH || '').trim() || null,
    bcryptRounds: Number(env.BCRYPT_ROUNDS) || 12,
    appUrl: (env.APP_URL || '').trim().replace(/\/+$/, '') || `http://localhost:${port}`,
    smtp,
    mailFrom: env.MAIL_FROM || env.SMTP_USER || 'OpsDesk Panel <no-reply@localhost>',
    generatedPassword: null,
    warnings,
  };
}

module.exports = { loadConfig };
