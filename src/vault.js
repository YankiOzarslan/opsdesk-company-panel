'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ENTITIES } = require('./entities');
const PREFIX = 'enc:v1:';

function createVault(keyPath, db) {
  if (!fs.existsSync(keyPath)) {
    const encryptedExists = db.get("SELECT 1 AS n FROM form_drafts WHERE payload LIKE 'enc:v1:%' LIMIT 1") || Object.values(ENTITIES).some(e => e.fields.filter(f => f.encrypted).some(f => db.get(`SELECT 1 AS n FROM ${e.table} WHERE ${f.name} LIKE 'enc:v1:%' LIMIT 1`)));
    if (encryptedExists) throw new Error('Şifreleme anahtarı eksik. Mevcut vault.key dosyasını geri yükleyin; yeni anahtar oluşturulmadı.');
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(keyPath, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Şifreleme anahtarı 32 bayt olmalı.');
  const seal = (value, context) => {
    if (value === null || value === undefined || value === '') return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  };
  const open = (value, context) => {
    if (!value || !String(value).startsWith(PREFIX)) return value;
    try {
      const packed = Buffer.from(value.slice(PREFIX.length), 'base64');
      if (packed.length < 28) throw new Error('Invalid ciphertext');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12), { authTagLength: 16 });
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(packed.subarray(12, 28));
      return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
    } catch (_) { throw new Error('Şifreli veri doğrulanamadı; anahtarı ve yedeği kontrol edin.'); }
  };
  return { seal, open };
}

function hydrate(db, entity, row) {
  if (!row) return null;
  const output = { ...row };
  for (const f of entity.fields.filter(f => f.encrypted)) output[f.name] = db.vault.open(output[f.name], `${entity.table}:${f.name}`);
  if (entity.key === 'projects') output.team_ids = db.all('SELECT team_member_id FROM project_assignments WHERE project_id = ? ORDER BY team_member_id', [row.id]).map(r => r.team_member_id);
  return output;
}
function storageValue(db, entity, field, value) {
  return entity.fieldMap[field]?.encrypted ? db.vault.seal(value, `${entity.table}:${field}`) : value;
}
function migrateSecrets(db) {
  db.transaction(() => {
    for (const e of Object.values(ENTITIES)) {
      for (const f of e.fields.filter(f => f.encrypted)) {
        for (const row of db.all(`SELECT id, ${f.name} AS value FROM ${e.table} WHERE ${f.name} IS NOT NULL`)) {
          if (String(row.value).startsWith(PREFIX)) db.vault.open(row.value, `${e.table}:${f.name}`);
          else db.run(`UPDATE ${e.table} SET ${f.name} = ? WHERE id = ?`, [db.vault.seal(row.value, `${e.table}:${f.name}`), row.id]);
        }
      }
    }
    // Earlier snapshots/diffs may contain fields now considered sensitive.
    for (const row of db.all('SELECT id, entity_type, field, old_value, new_value FROM audit_log')) {
      const entity = ENTITIES[row.entity_type];
      if (!entity) continue;
      const fields = entity.fields.filter(f => f.encrypted).map(f => f.name);
      const redact = value => {
        if (value === null) return null;
        if (fields.includes(row.field)) return '[Şifreli alan güncellendi]';
        if (row.field) return value;
        try { const data = JSON.parse(value); for (const f of fields) if (data[f] != null) data[f] = '[Şifreli]'; return JSON.stringify(data); }
        catch (_) { return value; }
      };
      const oldValue = redact(row.old_value), newValue = redact(row.new_value);
      if (oldValue !== row.old_value || newValue !== row.new_value) db.run('UPDATE audit_log SET old_value = ?, new_value = ? WHERE id = ?', [oldValue, newValue, row.id]);
    }
  });
  // Rebuild old SQLite pages so overwritten plaintext cannot remain in free space.
  db.raw.run('VACUUM');
  db.persist();
}
module.exports = { createVault, hydrate, storageValue, migrateSecrets };
