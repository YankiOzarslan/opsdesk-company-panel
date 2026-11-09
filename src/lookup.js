'use strict';
// Public registration / network lookups (RDAP, WHOIS, DNS, HTTP). No API keys needed.
const dnsPromises = require('dns').promises;
const net = require('net');
const tls = require('tls');
const url = require('url');
const dates = require('./dates');

const TIMEOUT_MS = 8000;
const MAX_BODY = 300 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const WHOIS_SERVERS = { tr: 'whois.trabis.gov.tr' };
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

class LookupError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

function whoisQuery(host, query) {
  return new Promise((resolve, reject) => {
    let data = '';
    const sock = net.connect(43, host, () => sock.write(`${query}\r\n`));
    sock.setEncoding('utf8');
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy(new Error('WHOIS zaman aşımı')));
    sock.on('data', (c) => { data += c; if (data.length > 200000) sock.destroy(); });
    sock.on('close', () => resolve(data));
    sock.on('error', reject);
  });
}

function tlsCertificate(host, ip) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: ip, port: 443, servername: host, rejectUnauthorized: false, timeout: TIMEOUT_MS }, () => {
      const c = sock.getPeerCertificate();
      const out = c && c.valid_to ? { validTo: c.valid_to, issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || null, authorized: sock.authorized && !tls.checkServerIdentity(host, c) } : null;
      sock.end();
      resolve(out);
    });
    sock.on('timeout', () => sock.destroy(new Error('TLS zaman aşımı')));
    sock.on('error', reject);
  });
}

const deps = {
  tlsCert: tlsCertificate,
  fetch: (u, opts = {}) => fetch(u, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) }),
  dns: dnsPromises,
  whois: whoisQuery,
};
let bootstrap = { at: 0, map: null };

// Test hook: swap network functions; returns a restore function.
function _setDeps(over) {
  const prev = { ...deps };
  Object.assign(deps, over);
  bootstrap = { at: 0, map: null };
  return () => { Object.assign(deps, prev); bootstrap = { at: 0, map: null }; };
}

const PRIVATE = new net.BlockList();
for (const c of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/3']) {
  const [a, p] = c.split('/');
  PRIVATE.addSubnet(a, Number(p), 'ipv4');
}
for (const c of ['::/127', 'fc00::/7', 'fe80::/10', 'ff00::/8']) {
  const [a, p] = c.split('/');
  PRIVATE.addSubnet(a, Number(p), 'ipv6');
}
function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (!v) return false;
  const mapped = v === 6 && ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIp(mapped[1]);
  return !PRIVATE.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

function normalizeHost(input, { stripWww = false } = {}) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (stripWww && s.startsWith('www.')) s = s.slice(4);
  const ascii = s ? url.domainToASCII(s) : '';
  if (!ascii || !DOMAIN_RE.test(ascii)) throw new LookupError('Geçerli bir alan adı girin (ör. ornek.com).');
  return ascii;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const isoDate = (y, m, d) => {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s ? null : s;
};

// Accepts the date formats registries commonly use; returns YYYY-MM-DD in the panel's timezone.
function parseLooseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\.$/, '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}/);
  if (m) { const d = new Date(s.replace(' ', 'T')); return Number.isNaN(d.getTime()) ? isoDate(m[1], m[2], m[3]) : dates.today(d); }
  if ((m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/))) return isoDate(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{4})-([a-z]{3})-(\d{1,2})\b/i)) && MONTHS[m[2].toLowerCase()]) return isoDate(m[1], MONTHS[m[2].toLowerCase()], m[3]);
  if ((m = s.match(/^(\d{1,2})-([a-z]{3})-(\d{4})\b/i)) && MONTHS[m[2].toLowerCase()]) return isoDate(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/))) return isoDate(m[3], m[2], m[1]);
  return null;
}

async function getJson(u) {
  const res = await deps.fetch(u, { headers: { accept: 'application/rdap+json, application/json', 'user-agent': 'OpsDeskPanel/1.0' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function rdapBase(tld) {
  if (!bootstrap.map || Date.now() - bootstrap.at > DAY_MS) {
    const j = await getJson(BOOTSTRAP_URL);
    const map = {};
    for (const [tlds, urls] of (j && j.services) || []) {
      const base = urls.find((x) => x.startsWith('https://')) || urls[0];
      for (const t of tlds) map[t.toLowerCase()] = base.endsWith('/') ? base : `${base}/`;
    }
    bootstrap = { at: Date.now(), map };
  }
  return bootstrap.map[tld] || null;
}

const vcardName = (entity) => {
  const v = (entity && entity.vcardArray && entity.vcardArray[1]) || [];
  const row = v.find((x) => x[0] === 'fn') || v.find((x) => x[0] === 'org');
  return row && typeof row[3] === 'string' && row[3].trim() ? row[3].trim() : null;
};

function parseRdapDomain(j) {
  const registryExpiry = (j.events || []).find((e) => e.eventAction === 'expiration');
  const registrarExpiry = (j.events || []).find((e) => e.eventAction === 'registrar expiration');
  const exp = registrarExpiry || registryExpiry;
  const created = (j.events || []).find((e) => e.eventAction === 'registration');
  const reg = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
  return {
    expiry_date: exp ? parseLooseDate(exp.eventDate) : null,
    registry_expiry: registryExpiry ? parseLooseDate(registryExpiry.eventDate) : null,
    registrar_expiry: registrarExpiry ? parseLooseDate(registrarExpiry.eventDate) : null,
    expiry_type: registrarExpiry ? 'registrar' : 'registry',
    registered_at: created ? parseLooseDate(created.eventDate) : null,
    registrar: reg ? vcardName(reg) : null,
    nameservers: (j.nameservers || []).map((n) => String(n.ldhName || '').toLowerCase()).filter(Boolean),
  };
}

function parseWhois(text) {
  const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const expiryRaw = pick(/^[ \t]*(?:Registry Expiry Date|Registrar Registration Expiration Date|Expiration Date|Expiry Date|Expires On|Expire Date|paid-till|Expiration Time|Renewal Date)[ \t.]*:[ \t]*(\S.*)$/im);
  const createdRaw = pick(/^[ \t]*(?:Creation Date|Created On|Registered On|Registration Date|Registration Time|created)[ \t.]*:[ \t]*(\S.*)$/im);
  let registrar = pick(/^[ \t]*Registrar(?: Name)?:[ \t]*(\S.*)$/im);
  if (!registrar) {
    const sec = text.split(/\*\*[ \t]*Registrar:/i)[1];
    const m = sec && sec.match(/Organization Name[ \t]*:[ \t]*(\S.*)/i);
    if (m) registrar = m[1].trim();
  }
  let nameservers = [...text.matchAll(/^[ \t]*(?:Name Server|nserver)[ \t]*:[ \t]*(\S+)/gim)].map((m) => m[1].toLowerCase());
  if (!nameservers.length) {
    const sec = text.split(/\*\*[ \t]*Domain Servers:/i)[1];
    if (sec) nameservers = sec.split(/\r?\n[ \t]*\r?\n/)[0].split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0].toLowerCase()).filter((x) => x.includes('.'));
  }
  return { expiry_date: parseLooseDate(expiryRaw), registered_at: parseLooseDate(createdRaw), registrar, nameservers: [...new Set(nameservers)] };
}

async function whoisServer(tld) {
  if (WHOIS_SERVERS[tld]) return WHOIS_SERVERS[tld];
  const iana = await deps.whois('whois.iana.org', tld);
  const m = iana.match(/^whois:[ \t]*(\S+)/im);
  return m ? m[1] : null;
}

// Registrar, expiry date and nameservers via RDAP, falling back to WHOIS (e.g. .tr has no RDAP).
async function lookupRegistration(name) {
  const tld = name.split('.').pop();
  const errors = [];
  try {
    const base = await rdapBase(tld);
    if (base) {
      const j = await getJson(`${base}domain/${name}`);
      if (j) {
        const r = parseRdapDomain(j);
        if (r.expiry_date || r.registrar) return { source: 'RDAP', sourceUrl: `${base}domain/${name}`, ...r };
      }
    }
  } catch (e) { errors.push(e); }
  try {
    const server = await whoisServer(tld);
    if (server) {
      const r = parseWhois(await deps.whois(server, name));
      if (r.expiry_date || r.registrar || r.nameservers.length) return { source: `WHOIS (${server})`, ...r };
    }
  } catch (e) { errors.push(e); }
  if (errors.length) throw new LookupError('Kayıt bilgisi sorgulanamadı (RDAP/WHOIS servisine ulaşılamadı).', 502);
  return null;
}

const DNS_PROVIDERS = [
  [/cloudflare\.com$/, 'Cloudflare'], [/awsdns/, 'AWS Route 53'], [/domaincontrol\.com$/, 'GoDaddy'],
  [/googledomains\.com$|ns-cloud-.*\.googledomains|google\.com$/, 'Google Cloud DNS'], [/azure-dns\./, 'Azure DNS'],
  [/digitalocean\.com$/, 'DigitalOcean'], [/hetzner\.(com|de)$|your-server\.de$/, 'Hetzner'], [/natro/, 'Natro'],
  [/wordpress\.com$/, 'WordPress.com'], [/registrar-servers\.com$/, 'Namecheap'], [/isimtescil\.net$/, 'İsimtescil'],
];
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'gen', 'web', 'biz', 'info', 'co', 'gov', 'edu', 'av', 'bel', 'name', 'tv', 'ac', 'k12']);
function registrable(host) {
  const parts = host.split('.');
  const n = parts.length > 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}
function dnsManagedBy(nameservers) {
  if (!nameservers.length) return null;
  for (const [re, label] of DNS_PROVIDERS) if (nameservers.some((n) => re.test(n))) return label;
  return registrable(nameservers[0]);
}

async function resolveIps(host) {
  const [v4, v6] = await Promise.all([
    deps.dns.resolve4(host).catch(() => []),
    deps.dns.resolve6(host).catch(() => []),
  ]);
  return [...v4, ...v6];
}
const reverseOf = (ip) => deps.dns.reverse(ip).then((r) => r[0] || null).catch(() => null);

async function readLimited(res) {
  if (!res.body || !res.body.getReader) return typeof res.text === 'function' ? (await res.text()).slice(0, MAX_BODY) : '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < MAX_BODY) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8').slice(0, MAX_BODY);
}

const metaContent = (html, name) => {
  const a = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i'));
  return ((a || b) || [])[1] || null;
};

// Fetches the home page (public IPs only, same-site redirects) to read server / CMS hints.
async function probeSite(host, ips) {
  if (!ips.length || !ips.every(isPublicIp)) return null;
  let target = new URL(`https://${host}/`);
  let res;
  for (let i = 0; i < 4; i += 1) {
    res = await deps.fetch(target.href, { redirect: 'manual', headers: { 'user-agent': 'OpsDeskPanel/1.0' } });
    const loc = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!loc) break;
    const next = new URL(loc, target);
    const sameSite = next.hostname === host || next.hostname === `www.${host}` || `www.${next.hostname}` === host;
    if (!sameSite || !['https:', 'http:'].includes(next.protocol)) break;
    target = next;
  }
  const html = res.status < 300 ? await readLimited(res) : '';
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie().join('\n') : (res.headers.get('set-cookie') || '');
  const hints = [];
  const add = (cond, label) => { if (cond && !hints.includes(label)) hints.push(label); };
  const generator = metaContent(html, 'generator');
  const author = metaContent(html, 'author');
  add(generator, generator);
  add(author && /cms/i.test(author), author);
  add(/\/wp-content\/|\/wp-includes\//.test(html), 'WordPress');
  add(/\bci_session=/.test(cookies), 'CodeIgniter');
  add(/\blaravel_session=/.test(cookies), 'Laravel');
  add(/\/_next\/static\//.test(html), 'Next.js');
  add(/\/_nuxt\//.test(html), 'Nuxt');
  add(/cdn\.shopify\.com/.test(html), 'Shopify');
  add(/Drupal\.settings|drupal-settings-json/.test(html), 'Drupal');
  add(/\bPHPSESSID=/.test(cookies), 'PHP');
  const detected = require('./site-technologies').detectSiteTechnologies(html, res.headers, generator);
  for (const tech of detected.technologies) add(true, tech.name + (tech.version ? ` ${tech.version}` : ''));
  return {
    ...detected,
    url: target.href,
    status: res.status,
    server: res.headers.get('server') || null,
    poweredBy: res.headers.get('x-powered-by') || null,
    hints,
  };
}

async function lookupDns(input) {
  const host = normalizeHost(input);
  const [ips, ns] = await Promise.all([resolveIps(host),
    typeof deps.dns.resolveNs === 'function' ? deps.dns.resolveNs(host).catch(()=>[]) : Promise.resolve([])]);
  if (!ips.length && !ns.length) throw new LookupError('DNS kaydı bu kontrolde çözümlenemedi.', 502);
  return { ips, nameservers: ns.map(name=>name.toLowerCase().replace(/\.$/, '')).sort() };
}

// SSL certificate of the site (public IPs only).
async function sslInfo(host, ips) {
  if (!ips.length || !ips.every(isPublicIp)) return null;
  const ip = ips.find((x) => net.isIPv4(x)) || ips[0];
  const c = await deps.tlsCert(host, ip);
  if (!c) return null;
  const d = new Date(c.validTo);
  return { ssl_expiry: Number.isNaN(d.getTime()) ? null : dates.today(d), ssl_issuer: c.issuer, valid: !!c.authorized };
}

async function lookupSsl(input) {
  const name = normalizeHost(input, { stripWww: true });
  return sslInfo(name, await resolveIps(name));
}

async function lookupDomain(input) {
  const name = normalizeHost(input, { stripWww: true });
  const [regR, ipsR] = await Promise.allSettled([lookupRegistration(name), resolveIps(name)]);
  const reg = regR.status === 'fulfilled' ? regR.value : null;
  const ips = ipsR.status === 'fulfilled' ? ipsR.value : [];
  const [reverse, site, ssl] = await Promise.all([
    ips[0] ? reverseOf(ips[0]) : null,
    probeSite(name, ips).catch(() => null),
    sslInfo(name, ips).catch(() => null),
  ]);

  const fields = { name };
  const messages = [];
  if (reg) {
    if (reg.registrar) fields.registrar = reg.registrar;
    if (reg.registered_at) fields.registered_at = reg.registered_at;
    if (reg.expiry_date) fields.expiry_date = reg.expiry_date;
    if (reg.nameservers.length) {
      fields.nameservers = reg.nameservers.join('\n');
      fields.dns_managed_by = dnsManagedBy(reg.nameservers);
    }
    if (!reg.expiry_date) messages.push('Bitiş tarihi kayıtta bulunamadı, elle girin.');
  } else {
    messages.push(regR.status === 'rejected' ? regR.reason.message : 'Bu adres için ayrı kayıt bilgisi bulunamadı. Alt domainler için ana domainin kaydını kontrol edin; bu sonuç adresin kayıtsız olduğunu göstermez.');
  }
  if (!ips.length) messages.push('Alan adının DNS kaydı (A/AAAA) bulunamadı.');
  if (ssl) {
    if (ssl.ssl_issuer) fields.ssl_issuer = ssl.ssl_issuer;
    if (ssl.ssl_expiry) fields.ssl_expiry = ssl.ssl_expiry;
    if (!ssl.valid) messages.push('SSL sertifikası tarayıcılar tarafından geçerli kabul edilmiyor (süresi dolmuş, alan adıyla eşleşmiyor veya kendinden imzalı olabilir).');
  } else if (ips.length) {
    messages.push('SSL sertifikası okunamadı (site HTTPS sunmuyor olabilir).');
  }

  const summary = [];
  if (reg) summary.push(`Kaynak: ${reg.source}`);
  if (ips.length) summary.push(`IP: ${ips.slice(0, 2).join(', ')}${reverse ? ` (${reverse})` : ''}`);
  if (site && site.server) summary.push(`Web sunucusu: ${site.server}`);
  if (site && site.hints.length) summary.push(`Site altyapısı ipuçları: ${site.hints.join(', ')}`);
  return { query: name, fields, summary, messages, info: { source: reg && reg.source, ips, reverse, site } };
}

const regionName = (code) => {
  try { return code ? new Intl.DisplayNames(['tr'], { type: 'region' }).of(code.toUpperCase()) : null; } catch (_) { return code; }
};

async function lookupServer(input) {
  const raw = String(input || '').trim();
  let ip = net.isIP(raw) ? raw : null;
  let hostname = null;
  if (!ip) {
    hostname = normalizeHost(raw);
    const ips = await resolveIps(hostname);
    if (!ips.length) throw new LookupError(`${hostname} için IP adresi bulunamadı.`);
    [ip] = ips;
  }
  if (!isPublicIp(ip)) throw new LookupError('Özel / yerel ağ IP adresleri dışarıdan sorgulanamaz.');
  const reverse = await reverseOf(ip);

  let network = null;
  try { network = await getJson(`https://rdap.org/ip/${ip}`); } catch (_) { network = null; }
  const fields = { ip_address: ip };
  if (hostname || reverse) {
    fields.hostname = hostname || reverse;
    fields.name = hostname || reverse;
  }
  const messages = [];
  const summary = [];
  if (network) {
    const remark = (network.remarks || []).flatMap((r) => r.description || []).find((d) => d && d.trim());
    const org = (network.entities || []).filter((e) => (e.roles || []).some((r) => r === 'registrant' || r === 'administrative')).map(vcardName).find(Boolean);
    const label = (remark || org || network.name || '').trim();
    if (label) fields.provider = network.name && !label.includes(network.name) ? `${label} (${network.name})` : label;
    const country = regionName(network.country);
    if (country) fields.location = country;
    summary.push(`Ağ: ${[network.name, network.startAddress && `${network.startAddress} – ${network.endAddress}`].filter(Boolean).join(' · ')}`);
    messages.push('Sağlayıcı, IP bloğunun sahibi olan ağ / veri merkezidir; sunucuyu bir hosting firmasından kiralıyorsanız onu yazın. Konum ülke düzeyindedir.');
  } else {
    messages.push('IP ağ bilgisi (RDAP) alınamadı.');
  }
  if (reverse) summary.push(`Ters DNS: ${reverse}`);
  return { query: hostname || ip, fields, summary, messages, info: { ip, reverse } };
}

module.exports = {
  LookupError, lookupDomain, lookupServer, lookupRegistration, lookupSsl, lookupDns, parseWhois, parseRdapDomain, parseLooseDate,
  dnsManagedBy, isPublicIp, normalizeHost, _setDeps,
};
