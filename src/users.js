'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const ROLES = [{ value: 'admin', label: 'Yönetici' }, { value: 'user', label: 'Kullanıcı' }];
const RESET_TTL_MS = 60 * 60 * 1000;
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normalizeEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
const validEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);

function passwordError(p, email) {
  if (typeof p !== 'string' || p.length < 10) return 'Parola en az 10 karakter olmalı.';
  if (p.length > 200) return 'Parola en fazla 200 karakter olabilir.';
  if (Buffer.byteLength(p,'utf8')>72) return 'Parola çok uzun. Daha kısa bir parola seçin.';
  if (email && p.toLowerCase() === email.toLowerCase()) return 'Parola e-posta adresiyle aynı olamaz.';
  return null;
}

function createUsers(db, { bcryptRounds = 12 } = {}) {
  const byId = (id) => db.get('SELECT * FROM users WHERE id = ?', [id]) || null;
  const byEmail = (email) => db.get('SELECT * FROM users WHERE email = ?', [normalizeEmail(email)]) || null;
  const list = () => db.all("SELECT * FROM users ORDER BY role = 'admin' DESC, COALESCE(name, email) COLLATE NOCASE");
  const activeAdmins = () => db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n;
  const hash = (p) => bcrypt.hash(p, bcryptRounds);

  function create({ email, name = null, role = 'user', passwordHash = null }) {
    const ts = now();
    db.run(
      'INSERT INTO users (email, name, password_hash, role, active, token_version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?, ?)',
      [normalizeEmail(email), name || null, passwordHash, role, ts, ts]
    );
    return byEmail(email);
  }

  // Role / active / email changes invalidate the user's existing sessions.
  function update(id, { name, email, role, active }) {
    const u = byId(id);
    if (!u) return null;
    const next = {
      name: name !== undefined ? name || null : u.name,
      email: email !== undefined ? normalizeEmail(email) : u.email,
      role: role || u.role,
      active: active !== undefined ? (active ? 1 : 0) : u.active,
    };
    const bump = next.role !== u.role || next.active !== u.active || next.email !== u.email ? 1 : 0;
    db.run(
      'UPDATE users SET name = ?, email = ?, role = ?, active = ?, token_version = token_version + ?, updated_at = ? WHERE id = ?',
      [next.name, next.email, next.role, next.active, bump, now(), id]
    );
    return byId(id);
  }

  // New password: bumps token_version (logs out other sessions) and burns pending reset links.
  async function setPassword(id, plain) {
    const h = await hash(plain);
    const ts = now();
    db.transaction(() => {
      db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?', [h, ts, id]);
      db.run('DELETE FROM app_meta WHERE key = ?', [`password_change:${id}`]);
      db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [ts, id]);
    });
    return byId(id);
  }

  const touchLogin = (id) => db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), id]);
  const remove = (id) => db.run('DELETE FROM users WHERE id = ?', [id]);

  // Only the SHA-256 of the token is stored; the raw token is sent by e-mail.
  function createToken(userId, purpose = 'reset') {
    const raw = crypto.randomBytes(32).toString('base64url');
    const ts = now();
    const ttl = purpose === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS;
    db.transaction(() => {
      db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [ts, userId]);
      db.run(
        'INSERT INTO password_resets (user_id, token_hash, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        [userId, sha256(raw), purpose, new Date(Date.now() + ttl).toISOString(), ts]
      );
    });
    return raw;
  }

  function tokenUser(raw) {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return null;
    const row = db.get(
      'SELECT r.purpose AS reset_purpose, r.expires_at AS reset_expires_at, u.* FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used_at IS NULL',
      [sha256(raw)]
    );
    if (!row || !row.active || Date.parse(row.reset_expires_at) < Date.now()) return null;
    return row;
  }

  // ADMIN_EMAIL is always an active admin. ADMIN_PASSWORD(_HASH) only sets the password while none exists.
  async function ensureAdmin(config) {
    let u = byEmail(config.adminEmail);
    let generatedPassword = null;
    if (!u || !u.password_hash) {
      let ph = config.adminPasswordHash || (config.adminPassword ? await hash(config.adminPassword) : null);
      if (!ph && !config.production) {
        generatedPassword = crypto.randomBytes(9).toString('base64url');
        ph = await hash(generatedPassword);
      }
      if (!u) u = create({ email: config.adminEmail, name: 'Yönetici', role: 'admin', passwordHash: ph });
      else if (ph) db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [ph, now(), u.id]);
    }
    u = byId(u.id);
    if (u.role !== 'admin' || !u.active) u = update(u.id, { role: 'admin', active: 1 });
    return { user: u, generatedPassword };
  }

  return { byId, byEmail, list, activeAdmins, create, update, setPassword, touchLogin, remove, createToken, tokenUser, ensureAdmin };
}

module.exports = { createUsers, normalizeEmail, validEmail, passwordError, ROLES, RESET_TTL_MS, INVITE_TTL_MS };
