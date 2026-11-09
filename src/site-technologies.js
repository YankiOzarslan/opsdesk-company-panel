'use strict';

const VERSION = '\\d+\\.\\d+(?:\\.\\d+)?(?:-(?:alpha|beta|rc|canary|next)[.\\d]*)?';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const APPLICATIONS = [
  ['Next.js'], ['Nuxt', 'Nuxt.js'], ['WordPress'], ['Drupal'], ['Joomla'], ['Ghost'],
  ['WooCommerce'], ['Magento'], ['PrestaShop'], ['OpenCart'], ['Webflow'], ['Wix'], ['Shopify'],
  ['Astro'], ['Gatsby'], ['Hugo'], ['Jekyll'], ['Eleventy', '11ty'], ['SvelteKit'], ['Remix'],
  ['Laravel'], ['Symfony'], ['CodeIgniter'], ['Yii'], ['CakePHP'], ['Django'], ['Flask'],
  ['FastAPI'], ['Express'], ['NestJS'], ['Fastify'], ['Strapi'], ['Custom CMS'],
  ['ASP.NET Core'], ['ASP.NET'], ['Ruby on Rails', 'Rails'], ['Spring Boot'],
];
const LIBRARIES = [
  ['React','react'], ['React DOM','react-dom'], ['Vue','vue'], ['AngularJS','angular'],
  ['Svelte','svelte'], ['jQuery','jquery'], ['jQuery UI','jquery-ui'], ['Bootstrap','bootstrap'],
  ['Tailwind CSS','tailwindcss'], ['Alpine.js','alpinejs'], ['HTMX','htmx.org'],
  ['Lodash','lodash'], ['Axios','axios'], ['Moment.js','moment'], ['Day.js','dayjs'],
  ['Chart.js','chart.js'], ['D3.js','d3'], ['Three.js','three'], ['Phaser','phaser'],
  ['Swiper','swiper'], ['GSAP','gsap'], ['AOS','aos'], ['Animate.css','animate.css'],
  ['Font Awesome','font-awesome'], ['Font Awesome','@fortawesome/fontawesome-free'],
  ['DataTables','datatables.net'], ['DataTables','datatables'], ['Select2','select2'],
  ['SweetAlert2','sweetalert2'], ['Socket.IO','socket.io'], ['Popper','@popperjs/core'],
];

// Read only evidence published in the response. Never treat build IDs as versions.
function detectSiteTechnologies(html, headers, generator) {
  const found = [];
  const add = (name, version, source, kind = 'application') => {
    const existing = found.find(t => t.name === name);
    if (existing) {
      if (version && !existing.versions.includes(version)) existing.versions.push(version);
      existing.version = existing.versions.length === 1 ? existing.versions[0] : null;
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (version) existing.source = source;
    } else found.push({ name, version: version || null, versions: version ? [version] : [], source, sources: [source], kind });
  };
  const powered = headers.get('x-powered-by') || '';
  // Multiple generator tags (e.g. WordPress + WooCommerce) can coexist.
  const generators = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => {
    const tag = m[0];
    if (!/\bname\s*=\s*["']generator["']/i.test(tag)) return null;
    return tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
  }).filter(Boolean);
  if (generator) generators.push(generator);
  const metadata = [
    ...generators.map(value => [value, 'generator meta etiketi']),
    [powered, 'X-Powered-By başlığı'],
    [headers.get('x-generator') || '', 'X-Generator başlığı'],
  ];
  for (const [name, ...aliases] of APPLICATIONS) {
    for (const alias of [name, ...aliases]) {
      const pattern = new RegExp('(?:^|[\\s,;])' + escape(alias) + '(?=$|[\\s/;,!])(?:[\\s/!]+v?(' + VERSION + '))?', 'i');
      for (const [value, source] of metadata) {
        const match = value.match(pattern);
        if (match) add(name, match[1], source);
      }
    }
  }
  for (const [pattern, name] of [
    [/\/_next\/static\/|id=["']__NEXT_DATA__["']/, 'Next.js'],
    [/\/_nuxt\/|id=["']__NUXT_DATA__["']/, 'Nuxt'],
    [/\/wp-content\/|\/wp-includes\//, 'WordPress'],
    [/drupal-settings-json|Drupal\.settings/, 'Drupal'],
    [/cdn\.shopify\.com/, 'Shopify'],
    [/data-reactroot(?:=|\s|>)/, 'React'],
    [/data-v-[a-f\d]{6,}(?:=|\s|>)/i, 'Vue'],
    [/data-astro-cid-|<astro-island\b/, 'Astro'],
    [/__sveltekit_/, 'SvelteKit'],
    [/id=["']___gatsby["']|\/page-data\/app-data\.json/, 'Gatsby'],
    [/data-wf-site=["']/, 'Webflow'],
    [/\/wp-content\/plugins\/woocommerce\//, 'WooCommerce'],
    [/data-mage-init=|text\/x-magento-init/, 'Magento'],
  ]) if (pattern.test(html)) add(name, null, 'HTML / kaynak dosyası izi');
  const angular = html.match(new RegExp('ng-version=["\'](' + VERSION + ')["\']', 'i'));
  if (angular) add('Angular', angular[1], 'ng-version HTML özelliği');
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie().join('\n') : headers.get('set-cookie') || '';
  for (const [pattern, name] of [[/(?:^|[\n;,]\s*)laravel_session=/i,'Laravel'],[/(?:^|[\n;,]\s*)ci_session=/i,'CodeIgniter']]) {
    if (pattern.test(cookies)) add(name, null, 'Oturum çerezi adı');
  }
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1].replace(/&amp;/g,'&'));
  for (const [name, token] of LIBRARIES) {
    const escaped = escape(token);
    const versioned = new RegExp('(?:^|/)' + escaped + '(?:@|/|[-.])v?(' + VERSION + ')(?=[/.-]|$|[?#])', 'i');
    // A version query counts only on an exact library filename, not any plugin asset.
    const filename = new RegExp('(?:^|/)' + escaped + '(?:[.-](?:bundle|slim|full|global|production|development|esm|umd))*?(?:\\.min)?\\.(?:js|css)$', 'i');
    for (const asset of assets) {
      const match = asset.match(versioned);
      if (match) { add(name, match[1], 'Sürüm içeren kaynak dosyası adresi', 'library'); continue; }
      const [path, query = ''] = asset.split('?');
      if (!filename.test(path.split('#')[0])) continue;
      const published = new URLSearchParams(query.split('#')[0]).get('ver') || new URLSearchParams(query.split('#')[0]).get('version');
      const version = published && new RegExp('^' + VERSION + '$', 'i').test(published) ? published : null;
      add(name, version, version ? 'Kütüphanenin sürüm parametresi' : 'Kütüphanenin kaynak dosyası adı', 'library');
    }
  }
  // Server/runtime details are supplementary, never the primary project framework.
  for (const [name, pattern] of [
    ['nginx', /\bnginx(?:\/([\d.]+))?/i], ['Apache', /\bApache(?:\/([\d.]+))?/i],
    ['IIS', /\bMicrosoft-IIS(?:\/([\d.]+))?/i], ['LiteSpeed', /\bLiteSpeed(?:\/([\d.]+))?/i],
    ['Caddy', /\bCaddy(?:\/([\d.]+))?/i],
  ]) { const match = (headers.get('server') || '').match(pattern); if (match) add(name, match[1], 'Server başlığı', 'server'); }
  const php = powered.match(new RegExp('(?:^|[\\s,;])PHP/(' + VERSION + ')', 'i'));
  if (php) add('PHP', php[1], 'X-Powered-By başlığı', 'runtime');
  const asp = headers.get('x-aspnet-version');
  if (asp && new RegExp('^' + VERSION + '$').test(asp)) add('ASP.NET', asp, 'X-AspNet-Version başlığı', 'runtime');
  return { technologies: found, language: php ? { name: 'PHP', version: php[1], source: 'X-Powered-By başlığı' } : null };
}
module.exports = { detectSiteTechnologies };
