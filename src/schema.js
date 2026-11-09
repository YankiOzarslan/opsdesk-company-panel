'use strict';

const TABLES = {
  contacts: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT,
    email TEXT,
    phone TEXT,
    company TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL`,
  clients: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_name TEXT,
    contact_title TEXT,
    email TEXT,
    phone TEXT,
    it_contact_name TEXT,
    it_contact_email TEXT,
    it_contact_phone TEXT,
    management_contact_name TEXT,
    management_contact_email TEXT,
    management_contact_phone TEXT,
    notes TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL`,
  domains: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    parent_domain_id INTEGER REFERENCES domains(id) ON DELETE SET NULL,
    registrar TEXT,
    nameservers TEXT,
    dns_managed_by TEXT,
    dns_manager_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    dns_panel_url TEXT,
    dns_username TEXT,
    dns_password TEXT,
    owner_type TEXT,
    owner_name TEXT,
    owner_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    contact_info TEXT,
    expiry_date TEXT,
    status TEXT DEFAULT 'active',
    registrar_account TEXT,
    registered_at TEXT,
    auto_renew TEXT,
    renewal_by TEXT,
    renewal_price TEXT,
    ssl_issuer TEXT,
    ssl_expiry TEXT,
    managed_by_us INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL`,
  servers: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    hostname TEXT,
    ip_address TEXT,
    provider TEXT,
    server_type TEXT,
    os TEXT,
    location TEXT,
    manager_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    manager_team_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
    access_url TEXT,
    access_username TEXT,
    access_password TEXT,
    access_list TEXT,
    working_hours TEXT,
    support_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    notes TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL`,
  projects: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain_id INTEGER REFERENCES domains(id) ON DELETE SET NULL,
    server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
    tech_category TEXT,
    technology TEXT,
    tech_version TEXT,
    language TEXT,
    language_version TEXT,
    framework TEXT,
    repo_url TEXT,
    deploy_path TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    client_need TEXT,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    client_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    backup_enabled INTEGER NOT NULL DEFAULT 0,
    backup_location TEXT,
    backup_schedule TEXT,
    attack_response TEXT,
    notes TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL`,
  team_members: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    job_role TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL`,
  users: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    active INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL`,
  password_resets: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL DEFAULT 'reset',
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL`,
  project_assignments: `
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE`,
  form_drafts: `
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    form_key TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL`,
  technology_categories: `
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL UNIQUE`,
  app_meta: `
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT`,
  audit_log: `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    entity_name TEXT,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT,
    changed_at TEXT NOT NULL`,
};

const INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_pair ON project_assignments(project_id, team_member_id)',
  'CREATE INDEX IF NOT EXISTS idx_assignments_member ON project_assignments(team_member_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_owner ON form_drafts(user_id, form_key)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_team_user ON team_members(user_id) WHERE user_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_projects_domain ON projects(domain_id)',
  'CREATE INDEX IF NOT EXISTS idx_projects_server ON projects(server_id)',
  'CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id)',
  'CREATE INDEX IF NOT EXISTS idx_projects_tech ON projects(technology, tech_version)',
  'CREATE INDEX IF NOT EXISTS idx_domains_parent ON domains(parent_domain_id)',
  'CREATE INDEX IF NOT EXISTS idx_domains_expiry ON domains(expiry_date)',
  'CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_changed_at ON audit_log(changed_at)',
];

// Parses "col TYPE ..." lines so missing columns can be added to older databases.
function columnDefs(body) {
  return body
    .split('\n')
    .map((l) => l.trim().replace(/,$/, ''))
    .filter(Boolean)
    .map((line) => ({ name: line.split(/\s+/)[0], line }));
}

function migrate(db) {
  db.transaction(() => {
    for (const [table, body] of Object.entries(TABLES)) {
      db.raw.run(`CREATE TABLE IF NOT EXISTS ${table} (${body})`);
      const existing = new Set(db.all(`PRAGMA table_info(${table})`).map((c) => c.name));
      for (const col of columnDefs(body)) {
        if (existing.has(col.name)) continue;
        // ALTER TABLE ADD COLUMN cannot add NOT NULL without default / PK / UNIQUE.
        const def = col.line
          .replace(/\bPRIMARY KEY AUTOINCREMENT\b/, '')
          .replace(/\bUNIQUE\b/, '')
          .replace(/\bNOT NULL\b(?!\s+DEFAULT)/, '');
        db.raw.run(`ALTER TABLE ${table} ADD COLUMN ${def}`);
      }
    }
    for (const sql of INDEXES) db.raw.run(sql);
    const { CATEGORY_OPTIONS } = require('./tech-catalog');
    // Seed only once, so deleted unused categories stay deleted.
    if (!db.get("SELECT key FROM app_meta WHERE key = 'categories_seeded'")) {
      for (const c of CATEGORY_OPTIONS) db.run('INSERT OR IGNORE INTO technology_categories (key, label) VALUES (?, ?)', [c.value, c.label]);
      db.run("INSERT INTO app_meta (key, value) VALUES ('categories_seeded', '1')");
    }
  });
}

module.exports = { migrate, TABLES };
