'use strict';
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let sqlPromise;
function loadSql() {
  if (!sqlPromise) {
    const distDir = path.dirname(require.resolve('sql.js'));
    sqlPromise = initSqlJs({ locateFile: (file) => path.join(distDir, file) });
  }
  return sqlPromise;
}

class Database {
  constructor(raw, file) {
    this.raw = raw;
    this.file = file;
    this.txDepth = 0;
    this.applyPragmas();
  }

  applyPragmas() {
    this.raw.run('PRAGMA foreign_keys = ON;');
    this.raw.run('PRAGMA secure_delete = ON;');
  }

  all(sql, params = []) {
    const stmt = this.raw.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0];
  }

  run(sql, params = []) {
    this.raw.run(sql, params);
    const changes = this.raw.getRowsModified();
    const { id } = this.get('SELECT last_insert_rowid() AS id');
    this.persist();
    return { changes, lastInsertRowid: id };
  }

  exec(sql) {
    this.raw.exec(sql);
    this.persist();
  }

  transaction(fn) {
    const depth = this.txDepth;
    const savepoint = `opsdesk_${depth}`;
    this.raw.run(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN');
    this.txDepth += 1;
    try {
      const result = fn();
      this.raw.run(depth ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      this.txDepth = depth;
      this.persist();
      return result;
    } catch (err) {
      this.txDepth = depth;
      try {
        this.raw.run(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK');
        if (depth) this.raw.run(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (_) { /* already rolled back */ }
      throw err;
    }
  }

  export() {
    const data = Buffer.from(this.raw.export());
    // sql.js export() reopens the database, which resets connection pragmas.
    this.applyPragmas();
    return data;
  }

  persist() {
    if (this.txDepth > 0 || !this.file) return;
    const data = this.export();
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  close() {
    this.raw.close();
  }
}

async function openDatabase(file) {
  const SQL = await loadSql();
  let raw;
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    raw = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  } else {
    raw = new SQL.Database();
  }
  return new Database(raw, file);
}

module.exports = { openDatabase };
