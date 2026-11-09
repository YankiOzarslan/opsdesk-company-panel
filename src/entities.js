'use strict';

const { CATEGORY_OPTIONS } = require('./tech-catalog');

const STATUS_OPTIONS = [
  { value: 'active', label: 'Yayında', color: 'success' },
  { value: 'development', label: 'Geliştirmede', color: 'primary' },
  { value: 'maintenance', label: 'Bakımda', color: 'warning' },
  { value: 'paused', label: 'Durduruldu', color: 'secondary' },
  { value: 'archived', label: 'Arşiv', color: 'dark' },
];

const OWNER_TYPES = [
  { value: 'opsdesk', label: 'OpsDesk' },
  { value: 'client', label: 'Müşteri' },
  { value: 'public', label: 'Kamu kurumu' },
  { value: 'third_party', label: 'Üçüncü taraf' },
];

const DOMAIN_STATUS = [
  { value: 'active', label: 'Aktif', color: 'success' },
  { value: 'transfer', label: 'Transfer sürecinde', color: 'primary' },
  { value: 'parked', label: 'Park edilmiş / kullanılmıyor', color: 'secondary' },
  { value: 'expired', label: 'Süresi dolmuş', color: 'danger' },
  { value: 'released', label: 'Bırakıldı', color: 'dark' },
];

const AUTO_RENEW = [
  { value: 'on', label: 'Açık' },
  { value: 'off', label: 'Kapalı' },
];

const RENEWAL_BY = [
  { value: 'opsdesk', label: 'OpsDesk (biz)' },
  { value: 'client', label: 'Müşteri' },
  { value: 'third_party', label: 'Üçüncü taraf' },
];

const SERVER_TYPES = [
  { value: 'vps', label: 'VPS' },
  { value: 'dedicated', label: 'Dedicated' },
  { value: 'cloud', label: 'Cloud (IaaS)' },
  { value: 'shared', label: 'Paylaşımlı hosting' },
  { value: 'container', label: 'Container / PaaS' },
  { value: 'on_premise', label: 'Yerinde (on-premise)' },
  { value: 'other', label: 'Diğer' },
];

// Field types: text, textarea, email, tel, url, date, bool, select, fk
const ENTITIES = {
  projects: {
    key: 'projects',
    table: 'projects',
    singular: 'Proje',
    plural: 'Projeler',
    icon: 'bi-kanban',
    userColumns: true,
    sections: ['Temel', 'Teknoloji', 'Konum / Deploy', 'Müşteri / Yedek'],
    fields: [
      { name: 'name', label: 'Proje / site adı', type: 'text', required: true, section: 'Temel', max: 200 },
      { name: 'status', label: 'Durum', type: 'select', options: STATUS_OPTIONS, section: 'Temel', default: 'active' },
      { name: 'domain_id', label: 'Domain', type: 'fk', ref: 'domains', section: 'Temel' },
      { name: 'team_ids', label: 'Atanan ekip üyeleri', type: 'multi_fk', ref: 'team', virtual: true, section: 'Temel' },
      { name: 'client_need', label: 'Müşteri ihtiyacı / amaç', type: 'textarea', section: 'Temel' },
      { name: 'tech_category', label: 'Teknoloji kategorisi', type: 'select', options: CATEGORY_OPTIONS, section: 'Teknoloji' },
      { name: 'technology', label: 'Teknoloji', type: 'text', section: 'Teknoloji', placeholder: 'WordPress, Laravel, Next.js…', datalist: true },
      { name: 'tech_version', label: 'Teknoloji sürümü', type: 'text', section: 'Teknoloji', max: 50, placeholder: 'Listeden seçin veya yazın', datalist: true },
      { name: 'language', label: 'Dil', type: 'text', section: 'Teknoloji', placeholder: 'PHP, TypeScript…', datalist: true },
      { name: 'language_version', label: 'Dil sürümü', type: 'text', section: 'Teknoloji', max: 50, placeholder: 'Listeden seçin veya yazın', datalist: true },
      { name: 'framework', label: 'Framework / kütüphaneler', type: 'text', section: 'Teknoloji', max: 2000 },
      { name: 'repo_url', label: 'Repo URL', type: 'url', section: 'Teknoloji', hidden: true, placeholder: 'https://github.com/…' },
      { name: 'server_id', label: 'Sunucu', type: 'fk', ref: 'servers', section: 'Konum / Deploy' },
      { name: 'deploy_path', label: 'Deploy yolu', type: 'text', section: 'Konum / Deploy', placeholder: '/var/www/site' },
      { name: 'attack_response', label: 'Saldırı / olay müdahale prosedürü', type: 'textarea', section: 'Konum / Deploy' },
      { name: 'client_id', label: 'Müşteri', type: 'fk', ref: 'clients', section: 'Müşteri / Yedek' },
      { name: 'client_contact_id', label: 'Müşteri irtibat kişisi', type: 'fk', ref: 'contacts', section: 'Müşteri / Yedek' },
      { name: 'backup_enabled', label: 'Yedekleme aktif', type: 'bool', section: 'Müşteri / Yedek' },
      { name: 'backup_location', label: 'Yedek konumu', type: 'text', section: 'Müşteri / Yedek' },
      { name: 'backup_schedule', label: 'Yedek periyodu', type: 'text', section: 'Müşteri / Yedek', placeholder: 'Günlük 03:00' },
      { name: 'notes', label: 'Notlar', type: 'textarea', section: 'Müşteri / Yedek' },
    ],
    columns: [
      { field: 'name', link: true },
      { field: 'technology', format: 'tech' },
      { field: 'domain_id' },
      { field: 'server_id' },
      { field: 'client_id' },
      { field: 'status' },
    ],
    search: ['name', 'technology', 'tech_version', 'framework', 'language', 'language_version', 'deploy_path', 'repo_url', 'notes', 'client_need'],
    filters: [
      { name: 'tech_category', label: 'Kategori', kind: 'options' },
      { name: 'technology', label: 'Teknoloji', kind: 'distinct' },
      { name: 'tech_version', label: 'Sürüm', kind: 'distinct' },
      { name: 'server_id', label: 'Sunucu', kind: 'fk', ref: 'servers' },
      { name: 'status', label: 'Durum', kind: 'options' },
      { name: 'client_id', label: 'Müşteri', kind: 'fk', ref: 'clients' },
      { name: 'backup_enabled', label: 'Yedekleme', kind: 'static', options: [{value:'1',label:'Aktif'}, {value:'0',label:'Kapalı'}] },
      { name: 'domain_id', label: 'Domain', kind: 'fk', ref: 'domains' },
      { name: 'assignment', label: 'Ekip ataması', kind: 'custom', options: [{value:'none',label:'Atanmamış'},{value:'assigned',label:'Atanmış'}] },
    ],
    orderBy: 'name COLLATE NOCASE',
  },

  domains: {
    key: 'domains',
    table: 'domains',
    singular: 'Domain',
    plural: 'Domainler',
    icon: 'bi-globe2',
    userColumns: true,
    sections: ['Domain', 'Yenileme', 'DNS', 'SSL', 'Sahiplik', 'Diğer'],
    fields: [
      { name: 'name', label: 'Domain adı', type: 'text', required: true, section: 'Domain', max: 253, placeholder: 'ornek.com', lowercase: true, pattern: /^(?=.{1,253}$)([a-z0-9\u00a1-\uffff]([a-z0-9\u00a1-\uffff-]{0,61}[a-z0-9\u00a1-\uffff])?\.)+[a-z\u00a1-\uffff]{2,63}$/i, patternMessage: 'Geçerli bir domain adı girin (ör. ornek.com).' },
      { name: 'status', label: 'Durum', type: 'select', options: DOMAIN_STATUS, section: 'Domain', default: 'active' },
      { name: 'parent_domain_id', label: 'Ana domain', type: 'fk', ref: 'domains', section: 'Domain' },
      { name: 'registrar', label: 'Kayıt firması (registrar)', type: 'text', section: 'Domain', datalist: true, placeholder: 'Listeden seçin veya yazın' },
      { name: 'registrar_account', label: 'Registrar hesabı', type: 'text', section: 'Domain', max: 200, placeholder: 'Hangi hesapta kayıtlı (ör. Natro – info@…)' },
      { name: 'managed_by_us', label: 'Biz yönetiyoruz', type: 'bool', section: 'Domain', default: 1 },
      { name: 'registered_at', label: 'Kayıt tarihi', type: 'date', section: 'Yenileme' },
      { name: 'expiry_date', label: 'Bitiş tarihi', type: 'date', section: 'Yenileme' },
      { name: 'auto_renew', label: 'Otomatik yenileme', type: 'select', options: AUTO_RENEW, section: 'Yenileme' },
      { name: 'renewal_by', label: 'Yenilemeden sorumlu', type: 'select', options: RENEWAL_BY, section: 'Yenileme' },
      { name: 'renewal_price', label: 'Yenileme ücreti', type: 'text', section: 'Yenileme', max: 50, placeholder: 'ör. 15 USD / yıl' },
      { name: 'nameservers', encrypted: true, label: 'Name server\'lar', type: 'textarea', section: 'DNS', placeholder: 'Her satıra bir NS', rows: 2 },
      { name: 'dns_managed_by', encrypted: true, label: 'DNS yönetimi (nerede)', type: 'text', section: 'DNS', placeholder: 'Cloudflare, registrar…', datalist: true },
      { name: 'dns_panel_url', label: 'DNS panel adresi', type: 'url', section: 'DNS', secret: true, encrypted: true },
      { name: 'dns_username', label: 'DNS kullanıcı adı', type: 'text', section: 'DNS', secret: true, encrypted: true },
      { name: 'dns_password', label: 'DNS şifresi', type: 'text', section: 'DNS', secret: true, encrypted: true },
      { name: 'dns_manager_contact_id', label: 'DNS sorumlusu', type: 'fk', ref: 'contacts', section: 'DNS' },
      { name: 'ssl_issuer', label: 'SSL sağlayıcısı', type: 'text', section: 'SSL', datalist: true, placeholder: "Let's Encrypt, Sectigo…" },
      { name: 'ssl_expiry', label: 'SSL bitiş tarihi', type: 'date', section: 'SSL' },
      { name: 'owner_type', label: 'Sahip tipi', type: 'select', options: OWNER_TYPES, section: 'Sahiplik' },
      { name: 'owner_name', label: 'Asıl sahip', type: 'text', section: 'Sahiplik' },
      { name: 'owner_contact_id', label: 'Sahip irtibat kişisi', type: 'fk', ref: 'contacts', section: 'Sahiplik' },
      { name: 'contact_info', label: 'İletişim bilgisi', type: 'textarea', section: 'Sahiplik', rows: 2 },
      { name: 'notes', label: 'Notlar', type: 'textarea', section: 'Diğer' },
    ],
    columns: [
      { field: 'name', link: true, external: true },
      { field: 'parent_domain_id' },
      { field: 'registrar' },
      { field: 'dns_managed_by' },
      { field: 'owner_name' },
      { field: 'expiry_date', format: 'expiry' },
      { field: 'ssl_expiry', format: 'expiry' },
      { field: 'managed_by_us' },
    ],
    search: ['name', 'registrar', 'registrar_account', 'nameservers', 'dns_managed_by', 'owner_name', 'contact_info', 'notes'],
    filters: [
      { name: 'parent_domain_id', label: 'Ana domain', kind: 'fk', ref: 'domains' },
      { name: 'status', label: 'Durum', kind: 'options' },
      { name: 'registrar', label: 'Registrar', kind: 'distinct' },
      { name: 'owner_type', label: 'Sahip tipi', kind: 'options' },
      { name: 'managed_by_us', label: 'Yönetim', kind: 'static', options: [{ value: '1', label: 'Biz yönetiyoruz' }, { value: '0', label: 'Başkası yönetiyor' }] },
      { name: 'expiring', label: 'Bitiş', kind: 'custom', options: [{ value: 'expired', label: 'Süresi dolmuş' }, { value: '30', label: '30 gün içinde / dolmuş' }, { value: '60', label: '60 gün içinde / dolmuş' }, { value: '90', label: '90 gün içinde / dolmuş' }] },
      { name: 'ssl_expiring', label: 'SSL bitişi', kind: 'custom', options: [{value:'expired',label:'Süresi dolmuş'},{value:'30',label:'30 gün içinde / dolmuş'},{value:'60',label:'60 gün içinde / dolmuş'}] },
    ],
    orderBy: 'name COLLATE NOCASE',
    related: [
      { entity: 'domains', fk: 'parent_domain_id', title: 'Alt domainler' },
      { entity: 'projects', fk: 'domain_id', title: 'Bu domaindeki projeler' },
    ],
  },

  servers: {
    key: 'servers',
    table: 'servers',
    singular: 'Sunucu',
    plural: 'Sunucular',
    icon: 'bi-hdd-rack',
    userColumns: true,
    sections: ['Sunucu', 'Erişim', 'Diğer'],
    fields: [
      { name: 'name', label: 'Sunucu adı', type: 'text', required: true, section: 'Sunucu', max: 200 },
      { name: 'hostname', label: 'Hostname', type: 'text', section: 'Sunucu' },
      { name: 'ip_address', label: 'IP adresi', type: 'text', section: 'Sunucu', max: 200, pattern: /^[0-9a-fA-F:.,\s/]+$/, patternMessage: 'IPv4/IPv6 adresi girin (birden fazlaysa virgülle ayırın).' },
      { name: 'provider', label: 'Sağlayıcı', type: 'text', section: 'Sunucu', placeholder: 'AWS, Hetzner…', datalist: true },
      { name: 'server_type', label: 'Tip', type: 'select', options: SERVER_TYPES, section: 'Sunucu' },
      { name: 'os', label: 'İşletim sistemi', type: 'text', section: 'Sunucu', placeholder: 'Ubuntu 22.04', datalist: true },
      { name: 'location', label: 'Konum / bölge', type: 'text', section: 'Sunucu' },
      { name: 'manager_team_id', label: 'Sorumlu ekip üyesi', type: 'fk', ref: 'team', section: 'Erişim' },
      { name: 'manager_contact_id', hidden: true, label: 'Önceki sorumlu kişi', type: 'fk', ref: 'contacts', section: 'Erişim' },
      { name: 'access_url', label: 'Sunucu / yönetim paneli URL', type: 'url', section: 'Erişim', encrypted: true, secret: true },
      { name: 'access_username', label: 'Sunucu kullanıcı adı', type: 'text', section: 'Erişim', encrypted: true, secret: true },
      { name: 'access_password', label: 'Sunucu şifresi', type: 'text', section: 'Erişim', encrypted: true, secret: true },
      { name: 'access_list', encrypted: true, label: 'Erişimi olanlar', type: 'textarea', section: 'Erişim', rows: 2 },
      { name: 'working_hours', label: 'Çalışma / bakım saatleri', type: 'text', section: 'Erişim' },
      { name: 'support_contact_id', label: 'Destek irtibatı', type: 'fk', ref: 'contacts', section: 'Erişim' },
      { name: 'notes', label: 'Notlar', type: 'textarea', section: 'Diğer' },
    ],
    columns: [
      { field: 'name', link: true },
      { field: 'ip_address', format: 'mono' },
      { field: 'provider' },
      { field: 'server_type' },
      { field: 'os' },
      { field: 'manager_team_id' },
    ],
    search: ['name', 'hostname', 'ip_address', 'provider', 'os', 'location', 'access_list', 'notes'],
    filters: [
      { name: 'provider', label: 'Sağlayıcı', kind: 'distinct' },
      { name: 'server_type', label: 'Tip', kind: 'options' },
      { name: 'os', label: 'İşletim sistemi', kind: 'distinct' },
    ],
    orderBy: 'name COLLATE NOCASE',
    related: [{ entity: 'projects', fk: 'server_id', title: 'Bu sunucudaki projeler' }],
  },

  clients: {
    key: 'clients',
    table: 'clients',
    singular: 'Müşteri',
    plural: 'Müşteriler',
    icon: 'bi-briefcase',
    userColumns: true,
    cards: true,
    sections: ['Müşteri', 'IT irtibatı', 'Yönetim irtibatı', 'Diğer'],
    fields: [
      { name: 'name', label: 'Müşteri / kurum adı', type: 'text', required: true, section: 'Müşteri', max: 200 },
      { name: 'contact_name', label: 'Yetkili kişi', type: 'text', section: 'Müşteri' },
      { name: 'contact_title', label: 'Unvan', type: 'text', section: 'Müşteri' },
      { name: 'email', label: 'E-posta', type: 'email', section: 'Müşteri' },
      { name: 'phone', label: 'Telefon', type: 'tel', section: 'Müşteri' },
      { name: 'it_contact_name', label: 'IT irtibat adı', type: 'text', section: 'IT irtibatı' },
      { name: 'it_contact_email', label: 'IT e-posta', type: 'email', section: 'IT irtibatı' },
      { name: 'it_contact_phone', label: 'IT telefon', type: 'tel', section: 'IT irtibatı' },
      { name: 'management_contact_name', label: 'Yönetim irtibat adı', type: 'text', section: 'Yönetim irtibatı' },
      { name: 'management_contact_email', label: 'Yönetim e-posta', type: 'email', section: 'Yönetim irtibatı' },
      { name: 'management_contact_phone', label: 'Yönetim telefon', type: 'tel', section: 'Yönetim irtibatı' },
      { name: 'notes', label: 'Notlar', type: 'textarea', section: 'Diğer' },
    ],
    search: ['name', 'contact_name', 'email', 'phone', 'it_contact_name', 'it_contact_email', 'management_contact_name', 'management_contact_email', 'notes'],
    filters: [],
    orderBy: 'name COLLATE NOCASE',
    related: [{ entity: 'projects', fk: 'client_id', title: 'Müşterinin projeleri' }],
  },

  contacts: {
    key: 'contacts',
    table: 'contacts',
    singular: 'Kişi',
    plural: 'Kişiler',
    icon: 'bi-person-lines-fill',
    userColumns: false,
    cards: true,
    sections: ['Kişi', 'Diğer'],
    fields: [
      { name: 'name', label: 'Ad soyad', type: 'text', required: true, section: 'Kişi', max: 200 },
      { name: 'role', label: 'Rol / görev', type: 'text', section: 'Kişi', datalist: true },
      { name: 'company', label: 'Şirket / kurum', type: 'text', section: 'Kişi', datalist: true },
      { name: 'email', label: 'E-posta', type: 'email', section: 'Kişi' },
      { name: 'phone', label: 'Telefon', type: 'tel', section: 'Kişi' },
      { name: 'notes', label: 'Notlar', type: 'textarea', section: 'Diğer' },
    ],
    search: ['name', 'role', 'company', 'email', 'phone', 'notes'],
    filters: [
      { name: 'company', label: 'Şirket', kind: 'distinct' },
      { name: 'role', label: 'Rol', kind: 'distinct' },
    ],
    orderBy: 'name COLLATE NOCASE',
    related: [
      { entity: 'projects', fk: 'client_contact_id', title: 'İrtibat kişisi olduğu projeler' },
      { entity: 'servers', fk: 'manager_contact_id', title: 'Sorumlu olduğu sunucular' },
      { entity: 'domains', fk: 'dns_manager_contact_id', title: 'DNS sorumlusu olduğu domainler' },
    ],
  },

  team: {
    key: 'team',
    table: 'team_members',
    singular: 'Ekip üyesi',
    plural: 'Ekip',
    icon: 'bi-people',
    userColumns: false,
    cards: true,
    sections: ['Ekip üyesi'],
    fields: [
      { name: 'job_role', label: 'İş rolü', type: 'text', section: 'Ekip üyesi', max: 100, datalist: true, placeholder: 'Yazılım geliştirici, tasarımcı…' },
      { name: 'user_id', label: 'Panel kullanıcı hesabı', type: 'fk', ref: 'users', section: 'Ekip üyesi' },
      { name: 'name', label: 'Ad soyad', type: 'text', required: true, section: 'Ekip üyesi', max: 200 },
      { name: 'email', label: 'E-posta', type: 'email', section: 'Ekip üyesi' },
      { name: 'phone', label: 'Telefon', type: 'tel', section: 'Ekip üyesi' },
      { name: 'notes', label: 'Notlar / sorumluluklar', type: 'textarea', section: 'Ekip üyesi' },
    ],
    search: ['name', 'email', 'phone', 'job_role', 'notes'],
    filters: [{ name: 'job_role', label: 'İş rolü', kind: 'distinct' }],
    orderBy: 'name COLLATE NOCASE',
  },
};

for (const entity of Object.values(ENTITIES)) {
  entity.fieldMap = Object.fromEntries(entity.fields.map((f) => [f.name, f]));
  entity.allowed = entity.fields.filter((f) => !f.virtual).map((f) => f.name);
}

const BY_TABLE = Object.fromEntries(Object.values(ENTITIES).map((e) => [e.table, e]));

function optionLabel(field, value) {
  if (!field || !field.options) return value;
  const opt = field.options.find((o) => o.value === value);
  return opt ? opt.label : value;
}

module.exports = { ENTITIES, BY_TABLE, STATUS_OPTIONS, optionLabel };
