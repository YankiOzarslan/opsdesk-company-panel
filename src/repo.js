'use strict';

const catalog = require('./tech-catalog');
const { ENTITIES } = require('./entities');
const dates = require('./dates');
const { hydrate, storageValue } = require('./vault');

const now = () => new Date().toISOString();
const PAGE_SIZE = 50;

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function scalar(v) {
  if (Array.isArray(v)) v = v[v.length - 1];
  return typeof v === 'string' ? v.trim() : '';
}

function norm(v) {
  return v === null || v === undefined || v === '' ? null : String(v);
}

function refExists(db, ref, id) {
  if (ref === 'users') return !!db.get('SELECT 1 AS ok FROM users WHERE id = ? AND active = 1', [id]);
  const entity = ENTITIES[ref];
  return !!db.get(`SELECT 1 AS ok FROM ${entity.table} WHERE id = ?`, [id]);
}

function findById(db, entity, id) {
  return hydrate(db, entity, db.get(`SELECT * FROM ${entity.table} WHERE id = ?`, [id]));
}

// id -> name maps (and option lists) for every entity referenced by foreign keys.
function lookups(db) {
  const out = {};
  for (const key of ['contacts', 'domains', 'servers', 'clients', 'team', 'users']) {
    const table = key === 'users' ? 'users' : ENTITIES[key].table;
    const rows = db.all(key === 'users' ? 'SELECT id, COALESCE(name, email) AS name FROM users WHERE active = 1 ORDER BY name' : `SELECT id, name${key === 'team' ? ', job_role, user_id' : ''} FROM ${table} ORDER BY name COLLATE NOCASE`);
    if (key === 'team') rows.forEach(r => { if (r.job_role) r.name += ` · ${r.job_role}`; });
    out[key] = { list: rows, byId: new Map(rows.map((r) => [r.id, r.name])) };
  }
  return out;
}

function distinctValues(db, entity, column) {
  return db
    .all(`SELECT DISTINCT ${column} AS v FROM ${entity.table} WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY ${column} COLLATE NOCASE`)
    .map((r) => entity.fieldMap[column]?.encrypted ? db.vault.open(r.v, `${entity.table}:${column}`) : r.v);
}

function list(db, entity, query = {}) {
  const where = [];
  const params = [];
  const applied = {};

  const q = scalar(query.q).slice(0, 200);
  if (q && entity.search.length) applied.q = q;

  for (const filter of entity.filters) {
    const val = scalar(query[filter.name]).slice(0, 200);
    if (!val) continue;
    const col = filter.name;
    if(entity.key==='projects' && col==='tech_version' && !techFilterOptions(db,entity,'tech_version',query).some(o=>o.value===val))continue;
    if (filter.kind === 'fk') {
      if (val === 'none') where.push(`${col} IS NULL`);
      else if (/^\d{1,10}$/.test(val)) { where.push(`${col} = ?`); params.push(Number(val)); }
      else continue;
    } else if (filter.kind === 'custom' && col === 'assignment') {
      if (!['none','assigned'].includes(val)) continue;
      where.push(`id ${val === 'none' ? 'NOT IN' : 'IN'} (SELECT project_id FROM project_assignments)`);
    } else if (filter.kind === 'custom' && col === 'ssl_expiring') {
      if (val === 'expired') {where.push('ssl_expiry IS NOT NULL AND ssl_expiry < ?');params.push(dates.today());}
      else if (['30','60'].includes(val)) {where.push('ssl_expiry IS NOT NULL AND ssl_expiry <= ?');params.push(dates.addDays(dates.today(),Number(val)));}
      else continue;
    } else if (filter.kind === 'custom' && col === 'expiring') {
      const today = dates.today();
      if (val === 'expired') { where.push('parent_domain_id IS NULL AND expiry_date IS NOT NULL AND expiry_date < ?'); params.push(today); }
      else if (['30', '60', '90'].includes(val)) {
        where.push('parent_domain_id IS NULL AND expiry_date IS NOT NULL AND expiry_date <= ?');
        params.push(dates.addDays(today, Number(val)));
      } else continue;
    } else if (filter.kind === 'static' && ['managed_by_us','backup_enabled'].includes(col)) {
      if (!['0', '1'].includes(val)) continue;
      where.push(`${col} = ?`);
      params.push(Number(val));
    } else {
      where.push(`${col} = ?${entity.key==='projects' && col==='technology'?' COLLATE NOCASE':''}`);
      params.push(val);
    }
    applied[col] = val;
  }

  const sql = `SELECT * FROM ${entity.table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${entity.orderBy}`;
  let rows = db.all(sql, params).map(row => hydrate(db, entity, row));
  if (q) {
    const searchText = q.toLocaleLowerCase('tr-TR');
    const refs = entity.key === 'projects' ? lookups(db) : null;
    rows = rows.filter(row => {
      const terms = entity.search.map(field => row[field]);
      if (refs) {
        for (const [field, ref] of [['domain_id','domains'],['server_id','servers'],['client_id','clients']]) terms.push(refs[ref].byId.get(row[field]));
        for (const id of row.team_ids || []) terms.push(refs.team.byId.get(id));
      }
      return terms.some(value => String(value || '').toLocaleLowerCase('tr-TR').includes(searchText));
    });
  }
  return { rows, applied };
}

function techFilterOptions(db, entity, name, query) {
  if (name === 'technology') {
    const counts = {};
    for (const r of db.all(`SELECT technology AS v, COUNT(*) AS n FROM ${entity.table} WHERE technology IS NOT NULL AND technology <> '' GROUP BY technology`)) counts[r.v] = r.n;
    return catalog.groupedTechOptions(counts);
  }
  const technology=scalar(query.technology).slice(0,200);
  const used=db.all(`SELECT DISTINCT tech_version AS value FROM projects WHERE tech_version IS NOT NULL AND tech_version <> ''${technology?' AND technology = ? COLLATE NOCASE':''} ORDER BY tech_version COLLATE NOCASE`,technology?[technology]:[]);
  return used.map(row=>({value:row.value,label:row.value}));
}

function filterOptions(db, entity, lk, query = {}) {
  const out = {};
  for (const f of entity.filters) {
    if (entity.key === 'projects' && (f.name === 'technology' || f.name === 'tech_version')) out[f.name] = techFilterOptions(db, entity, f.name, query);
    else if (f.kind === 'distinct') out[f.name] = distinctValues(db, entity, f.name).map((v) => ({ value: v, label: v }));
    else if (f.kind === 'fk') out[f.name] = [{ value: 'none', label: '— Atanmamış —' }, ...lk[f.ref].list.map((r) => ({ value: String(r.id), label: r.name }))];
    else if (f.kind === 'options') out[f.name] = entity.fieldMap[f.name].options;
    else out[f.name] = f.options;
  }
  return out;
}

function writeAudit(db, e) {
  db.run(
    `INSERT INTO audit_log (entity_type, entity_id, entity_name, action, field, old_value, new_value, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.entityType, e.entityId, e.entityName || null, e.action, e.field || null, norm(e.oldValue), norm(e.newValue), e.user || null, e.at || now()],
  );
}

function snapshot(entity, row) {
  const out = {};
  for (const c of entity.allowed) if (norm(row[c]) !== null) out[c] = entity.fieldMap[c]?.encrypted ? '[Şifreli]' : row[c];
  return JSON.stringify(out);
}

function create(db, entity, values, user) {
  return db.transaction(() => {
    const ts = now();
    const cols = [...entity.allowed, 'created_at', 'updated_at'];
    const vals = [...entity.allowed.map((c) => storageValue(db, entity, c, values[c] === undefined ? null : values[c])), ts, ts];
    if (entity.userColumns) {
      cols.push('created_by', 'updated_by');
      vals.push(user, user);
    }
    const { lastInsertRowid: id } = db.run(
      `INSERT INTO ${entity.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      vals,
    );
    if (entity.key === 'projects') syncAssignments(db, id, values.team_ids || []);
    writeAudit(db, { entityType: entity.key, entityId: id, entityName: values.name, action: 'create', newValue: snapshot(entity, values), user, at: ts });
    return id;
  });
}

function update(db, entity, id, values, user) {
  const old = findById(db, entity, id);
  if (!old) return null;
  const changed = entity.allowed.filter((c) => norm(old[c]) !== norm(values[c]));
  if (entity.key === 'projects' && JSON.stringify([...(old.team_ids || [])].sort((a,b)=>a-b)) !== JSON.stringify([...(values.team_ids || [])].sort((a,b)=>a-b))) changed.push('team_ids');
  if (!changed.length) return { changed };

  db.transaction(() => {
    const ts = now();
    const stored = changed.filter(c => c !== 'team_ids');
    const sets = [...stored.map((c) => `${c} = ?`), 'updated_at = ?'];
    const vals = [...stored.map((c) => storageValue(db, entity, c, values[c] === undefined ? null : values[c])), ts];
    if (entity.userColumns) {
      sets.push('updated_by = ?');
      vals.push(user);
    }
    db.run(`UPDATE ${entity.table} SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    if (changed.includes('team_ids')) syncAssignments(db, id, values.team_ids || []);
    const name = values.name || old.name;
    for (const field of changed) {
      writeAudit(db, { entityType: entity.key, entityId: id, entityName: name, action: 'update', field, oldValue: entity.fieldMap[field]?.encrypted ? '[Şifreli]' : old[field], newValue: entity.fieldMap[field]?.encrypted ? '[Şifreli alan güncellendi]' : values[field], user, at: ts });
    }
  });
  return { changed };
}

function syncAssignments(db, projectId, ids) {
  db.run('DELETE FROM project_assignments WHERE project_id = ?', [projectId]);
  for (const id of [...new Set(ids)]) db.run('INSERT INTO project_assignments (project_id, team_member_id) VALUES (?, ?)', [projectId, id]);
}

// Rows in other tables whose FK will be nulled by ON DELETE SET NULL.
function dependents(db, entity, id) {
  const out = [];
  for (const other of Object.values(ENTITIES)) {
    for (const f of other.fields) {
      if (f.type !== 'fk' || f.ref !== entity.key) continue;
      for (const row of db.all(`SELECT id, name FROM ${other.table} WHERE ${f.name} = ?`, [id])) {
        out.push({ entity: other, field: f.name, row });
      }
    }
  }
  return out;
}

function remove(db, entity, id, user) {
  const old = findById(db, entity, id);
  if (!old) return null;
  const deps = dependents(db, entity, id);
  db.transaction(() => {
    const ts = now();
    db.run(`DELETE FROM ${entity.table} WHERE id = ?`, [id]);
    writeAudit(db, { entityType: entity.key, entityId: id, entityName: old.name, action: 'delete', oldValue: snapshot(entity, old), user, at: ts });
    for (const d of deps) {
      writeAudit(db, { entityType: d.entity.key, entityId: d.row.id, entityName: d.row.name, action: 'update', field: d.field, oldValue: id, newValue: null, user, at: ts });
    }
  });
  return { old, dependents: deps.length };
}

function history(db, entityKey, id, limit = 100) {
  return db.all('SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?', [entityKey, id, limit]);
}

function auditList(db, query = {}, account = null) {
  const where = [];
  const params = [];
  const applied = {};
  if (account) {
    const visible = require('./access').projectIds(db,account);
    if (visible) {
      const ids = [...visible];
      where.push(`(entity_type <> 'projects'${ids.length ? ` OR entity_id IN (${ids.map(()=>'?').join(',')})` : ''})`);
      params.push(...ids);
    }
  }
  const type = scalar(query.entity_type);
  if (type && ENTITIES[type]) { where.push('entity_type = ?'); params.push(type); applied.entity_type = type; }
  const action = scalar(query.action);
  if (['create', 'update', 'delete', 'reveal'].includes(action)) { where.push('action = ?'); params.push(action); applied.action = action; }
  const by = scalar(query.changed_by).slice(0, 100);
  if (by) { where.push('changed_by = ?'); params.push(by); applied.changed_by = by; }
  const q = scalar(query.q).slice(0, 200);
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(entity_name LIKE ? ESCAPE '\\' OR field LIKE ? ESCAPE '\\' OR old_value LIKE ? ESCAPE '\\' OR new_value LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like);
    applied.q = q;
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM audit_log${whereSql}`, params).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, parseInt(scalar(query.page), 10) || 1));
  const rows = db.all(`SELECT * FROM audit_log${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
  const users = db.all('SELECT DISTINCT changed_by AS u FROM audit_log WHERE changed_by IS NOT NULL ORDER BY u').map((r) => r.u);
  return { rows, total, page, pages, applied, users };
}

module.exports = { refExists, findById, lookups, list, filterOptions, distinctValues, create, update, remove, history, auditList, dependents };
