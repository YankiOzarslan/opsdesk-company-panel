'use strict';
const { ENTITIES, optionLabel } = require('./entities');
const { TZ, today } = require('./dates');
const dateFmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });

function formatDate(v) {
  if (!v) return '';
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(v) : dateFmt.format(d);
}

function formatDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : dateTimeFmt.format(d);
}

function daysUntil(v) {
  if (!v) return null;
  const target = Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const base = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((target - base) / 86400000);
}

function expiryBadge(v) {
  const d = daysUntil(v);
  if (d === null) return null;
  if (d < 0) return { cls: 'text-bg-danger', text: `${-d} gün önce doldu` };
  if (d === 0) return { cls: 'text-bg-danger', text: 'Bugün doluyor' };
  if (d <= 30) return { cls: 'text-bg-warning', text: `${d} gün kaldı` };
  if (d <= 60) return { cls: 'text-bg-info', text: `${d} gün kaldı` };
  return { cls: 'text-bg-light border', text: `${d} gün` };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Turns a stored value into display parts; templates escape the text.
function display(entity, fieldName, value, lk) {
  const f = entity.fieldMap[fieldName];
  if (value === null || value === undefined || value === '') return { text: '', empty: true };
  if (!f) return { text: String(value) };
  if (f.type === 'multi_fk') return { text: (Array.isArray(value) ? value : []).map(id => lk?.[f.ref]?.byId.get(Number(id))).filter(Boolean).join(', ') || 'Atanmamış' };
  switch (f.type) {
    case 'bool': return { text: Number(value) ? 'Evet' : 'Hayır', bool: !!Number(value) };
    case 'fk': {
      const name = lk && lk[f.ref] && lk[f.ref].byId.get(Number(value));
      return name ? { text: name, href: `/${f.ref}/${value}` } : { text: `#${value} (silinmiş)`, muted: true };
    }
    case 'select': {
      const opt = f.options.find((o) => o.value === value);
      return { text: opt ? opt.label : String(value), color: opt && opt.color };
    }
    case 'date': return { text: formatDate(value), expiry: fieldName === 'expiry_date' || fieldName === 'ssl_expiry' ? expiryBadge(value) : null };
    case 'email': return { text: value, href: `mailto:${value}` };
    case 'tel': return { text: value, href: `tel:${String(value).replace(/[^\d+]/g, '')}` };
    case 'url': return /^https?:\/\//i.test(value) ? { text: value, href: value, external: true } : { text: value, mono: true };
    default: return { text: String(value), multiline: f.type === 'textarea' };
  }
}

function auditValue(entityKey, field, value, lk) {
  const entity = ENTITIES[entityKey];
  if (value === null || value === undefined || value === '') return '—';
  if (!entity || !field) return String(value);
  const d = display(entity, field, value, lk);
  const text = d.text || '—';
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function fieldLabel(entityKey, field) {
  const entity = ENTITIES[entityKey];
  return (entity && entity.fieldMap[field] && entity.fieldMap[field].label) || field;
}

function snapshotSummary(entityKey, json, lk) {
  try {
    const obj = JSON.parse(json);
    return Object.entries(obj).map(([k, v]) => ({ label: fieldLabel(entityKey, k), value: auditValue(entityKey, k, v, lk) }));
  } catch (_) {
    return [];
  }
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toLocaleUpperCase('tr-TR')).join('');
}

function qs(base, params) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return s ? `${base}?${s}` : base;
}

module.exports = { formatDate, formatDateTime, daysUntil, expiryBadge, formatBytes, display, auditValue, fieldLabel, snapshotSummary, initials, optionLabel, qs, ENTITIES };
