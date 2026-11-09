'use strict';

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const URL_RE = /^(https?:\/\/|ssh:\/\/|git@)[^\s<>"]+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MAX = { text: 500, email: 254, tel: 50, url: 500, textarea: 10000 };

function scalar(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return '';
  return String(v);
}

// Only fields declared in entity.fields are read (mass-assignment protection).
// Server-managed columns (id, created_*, updated_*) are never part of that list.
function validate(entity, body, refExists) {
  const values = {};
  const errors = {};
  const src = body || {};

  for (const f of entity.fields) {
    if (f.type === 'multi_fk') {
      const rawIds = src[f.name] === undefined ? [] : (Array.isArray(src[f.name]) ? src[f.name] : [src[f.name]]);
      const ids = [...new Set(rawIds.filter(v => v !== '').map(String))];
      values[f.name] = ids.filter(v => /^\d{1,10}$/.test(v)).map(Number);
      if (ids.length > 50 || ids.some(v => !/^\d{1,10}$/.test(v) || !refExists(f.ref, Number(v)))) errors[f.name] = 'Geçerli ekip üyeleri seçin (en fazla 50).';
      continue;
    }
    const raw = scalar(src[f.name]);

    if (f.type === 'bool') {
      values[f.name] = ['1', 'on', 'true', 'yes'].includes(raw.toLowerCase()) ? 1 : 0;
      continue;
    }

    let v = raw.replace(/\r\n/g, '\n').trim();
    if (f.lowercase) v = v.toLowerCase();
    if (entity.key === 'domains' && f.name === 'name' && /^https?:\/\//i.test(v)) {
      try {
        const address = new URL(v);
        if (!address.username && !address.password) v = address.hostname.replace(/\.$/, '');
      } catch (_) { /* Invalid addresses are handled by the domain pattern below. */ }
    }


    if (!v && f.default !== undefined && f.default !== null) v = String(f.default);
    if (!v) {
      values[f.name] = null;
      if (f.required) errors[f.name] = `${f.label} zorunlu.`;
      continue;
    }

    const max = f.max || DEFAULT_MAX[f.type] || 500;
    if (v.length > max) {
      errors[f.name] = `${f.label} en fazla ${max} karakter olabilir.`;
    } else if (f.type === 'email' && !EMAIL_RE.test(v)) {
      errors[f.name] = 'Geçerli bir e-posta adresi girin.';
    } else if (f.type === 'url' && !URL_RE.test(v)) {
      errors[f.name] = 'URL http(s)://, ssh:// veya git@ ile başlamalı.';
    } else if (f.type === 'date') {
      const d = new Date(`${v}T00:00:00Z`);
      if (!DATE_RE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
        errors[f.name] = 'Tarih YYYY-AA-GG biçiminde olmalı.';
      }
    } else if (f.type === 'select' && !f.options.some((o) => o.value === v)) {
      errors[f.name] = `${f.label} için geçersiz seçim.`;
    } else if (f.type === 'fk') {
      if (!/^\d{1,10}$/.test(v)) {
        errors[f.name] = `${f.label} için geçersiz seçim.`;
      } else {
        const id = Number(v);
        if (!refExists(f.ref, id)) errors[f.name] = `Seçilen ${f.label.toLowerCase()} bulunamadı.`;
        else v = id;
      }
    } else if (f.pattern && !f.pattern.test(v)) {
      errors[f.name] = f.patternMessage || `${f.label} geçersiz.`;
    }

    values[f.name] = v;
  }

  return { values, errors, valid: Object.keys(errors).length === 0 };
}

function parseId(v) {
  return /^\d{1,10}$/.test(String(v)) ? Number(v) : null;
}

module.exports = { validate, parseId };
