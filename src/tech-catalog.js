'use strict';

// Common technologies grouped by category with popular versions (newest first).
// Suggestions only: users may still type any technology or version.
const CATEGORIES = [
  { value: 'cms', label: 'CMS / Site yönetimi', items: [
    ['WordPress', 'PHP', ['6.8', '6.7', '6.6', '6.5', '6.4']],
    ['Custom CMS', 'PHP', []],
    ['Drupal', 'PHP', ['11', '10', '9']],
    ['Joomla', 'PHP', ['5', '4', '3']],
    ['Ghost', 'JavaScript', ['6', '5']],
    ['Strapi', 'TypeScript', ['5', '4']],
    ['Webflow', null, []],
    ['Wix', null, []],
  ] },
  { value: 'ecommerce', label: 'E-ticaret', items: [
    ['WooCommerce', 'PHP', ['10', '9', '8']],
    ['Magento', 'PHP', ['2.4.8', '2.4.7', '2.4.6']],
    ['PrestaShop', 'PHP', ['9', '8.2', '8.1', '1.7']],
    ['OpenCart', 'PHP', ['4.1', '4.0', '3.0']],
    ['Shopify', null, []],
    ['İdeasoft', null, []],
    ['Ticimax', null, []],
  ] },
  { value: 'backend', label: 'Backend / API', items: [
    ['Laravel', 'PHP', ['12', '11', '10', '9', '8']],
    ['Symfony', 'PHP', ['7.3', '7.2', '6.4', '5.4']],
    ['CodeIgniter', 'PHP', ['4.6', '4.5', '4.4', '3.1']],
    ['Yii', 'PHP', ['2.0']],
    ['CakePHP', 'PHP', ['5', '4']],
    ['PHP', 'PHP', ['8.4', '8.3', '8.2', '8.1', '7.4']],
    ['Django', 'Python', ['5.2', '5.1', '5.0', '4.2']],
    ['Flask', 'Python', ['3.1', '3.0', '2.3']],
    ['FastAPI', 'Python', ['0.115', '0.110']],
    ['Node.js', 'JavaScript', ['24', '22', '20', '18']],
    ['Express', 'JavaScript', ['5', '4']],
    ['NestJS', 'TypeScript', ['11', '10', '9']],
    ['Fastify', 'JavaScript', ['5', '4']],
    ['Ruby on Rails', 'Ruby', ['8.0', '7.2', '7.1', '6.1']],
    ['Spring Boot', 'Java', ['3.5', '3.4', '3.3', '2.7']],
    ['ASP.NET Core', 'C#', ['10.0', '9.0', '8.0', '6.0']],
    ['Gin', 'Go', ['1.10', '1.9']],
    ['Fiber', 'Go', ['3', '2']],
  ] },
  { value: 'fullstack', label: 'Full-stack / SSR', items: [
    ['Next.js', 'TypeScript', ['16', '15', '14', '13']],
    ['Nuxt', 'TypeScript', ['4', '3', '2']],
    ['SvelteKit', 'TypeScript', ['2', '1']],
    ['Remix', 'TypeScript', ['2']],
    ['Astro', 'TypeScript', ['5', '4', '3']],
    ['Gatsby', 'JavaScript', ['5', '4']],
  ] },
  { value: 'frontend', label: 'Frontend / SPA', items: [
    ['React', 'JavaScript', ['19', '18', '17']],
    ['Vue', 'JavaScript', ['3.5', '3.4', '2.7']],
    ['Angular', 'TypeScript', ['20', '19', '18', '17']],
    ['Svelte', 'JavaScript', ['5', '4']],
    ['jQuery', 'JavaScript', ['3.7', '3.6', '1.12']],
  ] },
  { value: 'static', label: 'Statik site', items: [
    ['Statik HTML', 'HTML/CSS/JS', []],
    ['Hugo', 'Go', []],
    ['Jekyll', 'Ruby', ['4.4', '4.3']],
    ['Eleventy', 'JavaScript', ['3', '2']],
  ] },
  { value: 'mobile', label: 'Mobil uygulama', items: [
    ['React Native', 'TypeScript', ['0.81', '0.80', '0.79']],
    ['Expo', 'TypeScript', ['54', '53', '52']],
    ['Flutter', 'Dart', ['3.35', '3.32', '3.29', '3.27']],
    ['SwiftUI', 'Swift', []],
    ['Kotlin / Android', 'Kotlin', []],
    ['Ionic', 'TypeScript', ['8', '7']],
  ] },
  { value: 'game', label: 'Oyun', items: [
    ['Unity', 'C#', ['6.2', '6.1', '6.0 LTS', '2022.3 LTS', '2021.3 LTS']],
    ['Unreal Engine', 'C++', ['5.6', '5.5', '5.4', '5.3']],
    ['Godot', 'GDScript', ['4.5', '4.4', '4.3', '3.6']],
    ['Phaser', 'JavaScript', ['3.90', '3.80']],
    ['Three.js', 'JavaScript', []],
  ] },
];

const LANGUAGES = {
  PHP: ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
  JavaScript: ['24', '22', '20', '18'],
  TypeScript: ['5.9', '5.8', '5.7', '5.6', '5.4'],
  Python: ['3.14', '3.13', '3.12', '3.11', '3.10'],
  Go: ['1.25', '1.24', '1.23'],
  Java: ['25', '21', '17', '11', '8'],
  'C#': ['14', '13', '12', '10'],
  Ruby: ['3.4', '3.3', '3.2'],
  Kotlin: ['2.2', '2.1', '2.0'],
  Swift: ['6.2', '6.1', '6.0', '5.10'],
  Dart: ['3.9', '3.8', '3.7'],
  'C++': ['23', '20', '17'],
  GDScript: [],
  'HTML/CSS/JS': [],
};

const OTHER = { value: 'other', label: 'Diğer' };
const CATEGORY_OPTIONS = [...CATEGORIES.map(({ value, label }) => ({ value, label })), OTHER];
const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((c) => [c.value, c.label]));

const TECHS = new Map();
for (const c of CATEGORIES) {
  for (const [name, language, versions] of c.items) {
    const key = name.toLowerCase();
    if (!TECHS.has(key)) TECHS.set(key, { name, category: c.value, language, versions });
  }
}

const lookup = (tech) => (tech ? TECHS.get(String(tech).trim().toLowerCase()) || null : null);
const categoryOf = (tech) => { const t = lookup(tech); return t ? t.category : null; };
const versionsOf = (tech) => { const t = lookup(tech); return t ? t.versions : []; };

// <datalist> entries for the technology input; values already in the DB are kept.
function techDatalist(used = []) {
  const out = [];
  const seen = new Set();
  for (const t of TECHS.values()) {
    out.push({ value: t.name, label: `${t.name} — ${CATEGORY_LABEL[t.category]}` });
    seen.add(t.name.toLowerCase());
  }
  for (const v of used) if (!seen.has(String(v).toLowerCase())) out.push({ value: v });
  return out;
}

// <optgroup> structure for the technology filter; counts are shown for used values.
function groupedTechOptions(counts = {}) {
  const used = new Map(Object.entries(counts).map(([k, n]) => [k.toLowerCase(), { value: k, n }]));
  const groups = [];
  const label = (name, u) => (u ? `${name} (${u.n})` : name);
  for (const c of CATEGORIES) {
    const options = [];
    for (const [name] of c.items) {
      const u = used.get(name.toLowerCase());
      used.delete(name.toLowerCase());
      options.push({ value: u ? u.value : name, label: label(name, u) });
    }
    groups.push({ group: c.label, options });
  }
  if (used.size) groups.push({ group: OTHER.label, options: [...used.values()].map((u) => ({ value: u.value, label: label(u.value, u) })) });
  return groups;
}

function clientJson() {
  const techs = {};
  for (const [key, t] of TECHS) techs[key] = t;
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.items.map(([name]) => name)]));
  return JSON.stringify({ categoryLabels: CATEGORY_LABEL, techs, byCategory, languages: LANGUAGES }).replace(/</g, '\\u003c');
}

module.exports = {
  CATEGORIES, CATEGORY_OPTIONS, CATEGORY_LABEL, LANGUAGES,
  lookup, categoryOf, versionsOf, techDatalist, groupedTechOptions, clientJson,
};
