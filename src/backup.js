'use strict';
const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_RE = /^opsdesk-\d{8}-\d{6}-(auto|manual)\.sqlite$/;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

class BackupManager {
  constructor(db, dir, { keep = 30, intervalMs = DAY_MS, logger = console } = {}) {
    this.db = db;
    this.dir = dir;
    this.keep = keep;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.timer = null;
    fs.mkdirSync(dir, { recursive: true });
  }

  list() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => NAME_RE.test(f))
      .map((name) => {
        const st = fs.statSync(path.join(this.dir, name));
        return { name, size: st.size, mtime: st.mtime, kind: name.includes('-auto.') ? 'auto' : 'manual' };
      })
      .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  }

  create(kind = 'manual') {
    let name = `opsdesk-${stamp()}-${kind}.sqlite`;
    for (let i = 1; fs.existsSync(path.join(this.dir, name)); i += 1) {
      const d = new Date(Date.now() + i * 1000);
      name = `opsdesk-${stamp(d)}-${kind}.sqlite`;
    }
    fs.writeFileSync(path.join(this.dir, name), this.db.export(), { mode: 0o600 });
    this.prune();
    return name;
  }

  prune() {
    const autos = this.list().filter((b) => b.kind === 'auto');
    for (const b of autos.slice(this.keep)) fs.unlinkSync(path.join(this.dir, b.name));
  }

  // Returns an absolute path only for a known backup file inside the backup dir.
  resolve(requested) {
    const name = path.basename(String(requested || ''));
    if (!NAME_RE.test(name)) return null;
    const full = path.join(this.dir, name);
    if (path.dirname(full) !== path.resolve(this.dir)) return null;
    return fs.existsSync(full) ? full : null;
  }

  remove(requested) {
    const full = this.resolve(requested);
    if (!full) return false;
    fs.unlinkSync(full);
    return true;
  }

  lastAuto() {
    return this.list().find((b) => b.kind === 'auto') || null;
  }

  runIfDue() {
    const last = this.lastAuto();
    if (last && Date.now() - last.mtime.getTime() < this.intervalMs) return null;
    try {
      const name = this.create('auto');
      this.logger.log(`[yedek] Otomatik yedek alındı: ${name}`);
      return name;
    } catch (err) {
      this.logger.error('[yedek] Otomatik yedek başarısız:', err);
      return null;
    }
  }

  start() {
    this.runIfDue();
    // Hourly check keeps the 24h cadence even across sleep/restarts.
    this.timer = setInterval(() => this.runIfDue(), Math.min(this.intervalMs, 60 * 60 * 1000));
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { BackupManager, DAY_MS };
