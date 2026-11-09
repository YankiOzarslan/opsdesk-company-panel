'use strict';
const zlib = require('zlib');
const path = require('path');
const AdmZip = require('adm-zip');

const LIMITS = { entries: 50000, file: 1024 * 1024, lockFile: 8 * 1024 * 1024, totalRead: 48 * 1024 * 1024 };
const IGNORE_RE = /(^|\/)(node_modules|vendor|\.git|__MACOSX|bower_components|\.venv|venv|dist|build|\.next)\//;

class DetectError extends Error {}

function cleanVersion(v) {
  if (!v || typeof v !== 'string') return null;
  const m = v.match(/\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.]+)?/);
  return m ? m[0] : null;
}

function openArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new DetectError('Dosya geçerli bir .zip arşivi değil.');
  }
  let entries;
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch (_) {
    throw new DetectError('Zip arşivi okunamadı (bozuk olabilir).');
  }
  if (entries.length > LIMITS.entries) throw new DetectError('Arşivde çok fazla dosya var.');

  let files = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
    if (!name || name.split('/').includes('..')) continue;
    files.push({ name, entry, ignored: IGNORE_RE.test(`/${name}`) });
  }
  // Strip a single wrapping top-level folder (e.g. "my-site/…").
  for (let i = 0; i < 3; i += 1) {
    const tops = new Set(files.map((f) => (f.name.includes('/') ? f.name.split('/')[0] : '')));
    if (files.length && tops.size === 1 && !tops.has('')) {
      const prefix = `${[...tops][0]}/`;
      files = files.map((f) => ({ ...f, name: f.name.slice(prefix.length) }));
    } else break;
  }
  // Build output / vendored folders are not parsed, but their names still help static-site detection.
  const kept = files.filter((f) => !f.ignored);
  kept.allNames = files.map((f) => f.name);
  return kept;
}

function makeContext(files) {
  let totalRead = 0;
  const byName = new Map(files.map((f) => [f.name, f]));
  const evidence = [];

  function find(target, maxDepth = 3) {
    if (byName.has(target)) return byName.get(target);
    if (target.includes('/')) {
      return files.find((f) => f.name.endsWith(`/${target}`) && f.name.split('/').length - target.split('/').length <= maxDepth) || null;
    }
    let best = null;
    for (const f of files) {
      const depth = f.name.split('/').length - 1;
      if (depth > maxDepth || path.posix.basename(f.name) !== target) continue;
      if (!best || depth < best.depth) best = { ...f, depth };
    }
    return best;
  }

  function findByExt(ext, maxDepth = 2) {
    return files.filter((f) => f.name.endsWith(ext) && f.name.split('/').length - 1 <= maxDepth);
  }

  // Inflates with a hard output cap so zip bombs cannot exhaust memory.
  function readFile(file, max = LIMITS.file) {
    if (!file) return null;
    const { header } = file.entry;
    if (header.size > max || (header.flags & 1) === 1) return null;
    if (totalRead + header.size > LIMITS.totalRead) return null;
    try {
      const raw = file.entry.getCompressedData();
      let data;
      if (header.method === 0) data = raw;
      else if (header.method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: max + 1 });
      else return null;
      if (data.length > max) return null;
      totalRead += data.length;
      return data.toString('utf8');
    } catch (_) {
      return null;
    }
  }

  const read = (target, max) => readFile(find(target), max);
  const readJson = (target, max) => {
    const text = read(target, max);
    if (!text) return null;
    try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch (_) { return null; }
  };
  const has = (target, maxDepth) => !!find(target, maxDepth);
  const hasDir = (dir) => files.some((f) => f.name.startsWith(`${dir}/`) || f.name.includes(`/${dir}/`));
  const note = (msg) => { if (!evidence.includes(msg)) evidence.push(msg); };

  const allNames = files.allNames || files.map((f) => f.name);
  return { files, allNames, find, findByExt, readFile, read, readJson, has, hasDir, evidence, note };
}

function dockerVersion(ctx, image) {
  const text = ctx.read('Dockerfile');
  if (!text) return null;
  const m = text.match(new RegExp(`^\\s*FROM\\s+(?:[\\w.-]+/)?${image}:(\\d+(?:\\.\\d+){0,2})`, 'im'));
  if (m) ctx.note(`Dockerfile: ${image}:${m[1]}`);
  return m ? m[1] : null;
}

function toolVersion(ctx, tool) {
  const text = ctx.read('.tool-versions');
  const m = text && text.match(new RegExp(`^${tool}\\s+(\\S+)`, 'm'));
  return m ? cleanVersion(m[1]) : null;
}

function simpleFile(ctx, file) {
  const text = ctx.read(file);
  if (!text) return null;
  const v = cleanVersion(text.trim().split('\n')[0]);
  if (v) ctx.note(`${file}: ${v}`);
  return v;
}

// ---------- Node.js ----------
const NODE_FRAMEWORKS = [
  ['next', 'Next.js', 80], ['nuxt', 'Nuxt', 80], ['@nestjs/core', 'NestJS', 80], ['@sveltejs/kit', 'SvelteKit', 75],
  ['@remix-run/react', 'Remix', 75], ['astro', 'Astro', 75], ['gatsby', 'Gatsby', 75], ['@angular/core', 'Angular', 70],
  ['electron', 'Electron', 70], ['express', 'Express', 65], ['fastify', 'Fastify', 65], ['koa', 'Koa', 65],
  ['@hapi/hapi', 'hapi', 65], ['vue', 'Vue', 55], ['react', 'React', 55], ['svelte', 'Svelte', 55],
];

function detectNode(ctx) {
  const pkg = ctx.readJson('package.json');
  if (!pkg) return null;
  ctx.note('package.json bulundu');
  const deps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
  const lock = ctx.readJson('package-lock.json', LIMITS.lockFile);
  const yarn = !lock && ctx.read('yarn.lock', LIMITS.lockFile);

  const version = (name) => {
    if (lock) {
      const v = (lock.packages && lock.packages[`node_modules/${name}`]) || (lock.dependencies && lock.dependencies[name]);
      if (v && v.version) return v.version;
    }
    if (yarn) {
      const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      const m = yarn.match(new RegExp(`^"?${esc}@[^\\n]*:\\n\\s+version:? "?([^"\\n]+)"?`, 'm'));
      if (m) return m[1];
    }
    return cleanVersion(deps[name]);
  };

  const found = NODE_FRAMEWORKS.filter(([name]) => deps[name]).map(([name, label, score]) => ({ name, label, score, version: version(name) }));
  // Express/React alongside Next etc. are supporting libs, keep the strongest as primary.
  const main = found[0] || null;
  if (main) ctx.note(`Framework: ${main.label}${main.version ? ` ${main.version}` : ''} (package.json)`);

  const nodeVersion = cleanVersion(pkg.engines && pkg.engines.node) || simpleFile(ctx, '.nvmrc') || simpleFile(ctx, '.node-version')
    || toolVersion(ctx, 'nodejs') || dockerVersion(ctx, 'node');
  const isTs = !!deps.typescript || ctx.has('tsconfig.json', 1);
  if (isTs) ctx.note('TypeScript (tsconfig.json / typescript bağımlılığı)');

  return {
    // package.json without any dependency is usually just build scripts for a static site.
    score: main ? main.score : (Object.keys(deps).length ? 40 : 5),
    technology: main ? main.label : 'Node.js',
    tech_version: main ? main.version : nodeVersion,
    language: isTs ? 'TypeScript' : 'JavaScript',
    language_version: isTs ? version('typescript') : nodeVersion,
    framework: found.slice(0, 4).map((f) => `${f.label}${f.version ? ` ${f.version}` : ''}`).join(' + ') || null,
    runtime: nodeVersion ? `Node.js ${nodeVersion}` : 'Node.js',
  };
}

// ---------- PHP ----------
const PHP_FRAMEWORKS = [
  ['roots/wordpress', 'WordPress', 95], ['johnpbloch/wordpress', 'WordPress', 95], ['laravel/framework', 'Laravel', 90],
  ['laravel/lumen-framework', 'Lumen', 85], ['symfony/framework-bundle', 'Symfony', 90], ['drupal/core', 'Drupal', 90],
  ['drupal/core-recommended', 'Drupal', 90], ['yiisoft/yii2', 'Yii', 85], ['codeigniter4/framework', 'CodeIgniter', 85],
  ['cakephp/cakephp', 'CakePHP', 85], ['slim/slim', 'Slim', 70],
];

function detectPhp(ctx) {
  const candidates = [];
  const composer = ctx.readJson('composer.json');
  const lock = composer && ctx.readJson('composer.lock', LIMITS.lockFile);
  let phpVersion = null;
  if (composer) {
    ctx.note('composer.json bulundu');
    phpVersion = cleanVersion((composer.require && composer.require.php) || (composer.config && composer.config.platform && composer.config.platform.php));
  }
  phpVersion = phpVersion || simpleFile(ctx, '.php-version') || toolVersion(ctx, 'php') || dockerVersion(ctx, 'php');

  // WordPress core
  const wpVersionFile = ctx.read('wp-includes/version.php');
  if (wpVersionFile || ctx.has('wp-config.php', 2) || ctx.has('wp-config-sample.php', 2) || ctx.hasDir('wp-content')) {
    const v = wpVersionFile && wpVersionFile.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/);
    const reqPhp = wpVersionFile && wpVersionFile.match(/\$required_php_version\s*=\s*['"]([^'"]+)['"]/);
    ctx.note(v ? `WordPress ${v[1]} (wp-includes/version.php)` : 'WordPress dosya yapısı (wp-config / wp-content)');
    candidates.push({ score: 100, technology: 'WordPress', tech_version: v ? v[1] : null, language: 'PHP', language_version: phpVersion || (reqPhp ? `>=${reqPhp[1]}` : null), framework: 'WordPress' });
  }

  // Drupal / Joomla core files
  const drupal = ctx.read('core/lib/Drupal.php');
  const dm = drupal && drupal.match(/const\s+VERSION\s*=\s*'([^']+)'/);
  if (dm) { ctx.note(`Drupal ${dm[1]} (core/lib/Drupal.php)`); candidates.push({ score: 95, technology: 'Drupal', tech_version: dm[1], language: 'PHP', language_version: phpVersion, framework: 'Drupal' }); }
  const joomla = ctx.read('administrator/manifests/files/joomla.xml');
  const jm = joomla && joomla.match(/<version>([^<]+)<\/version>/);
  if (jm) { ctx.note(`Joomla ${jm[1]} (joomla.xml)`); candidates.push({ score: 95, technology: 'Joomla', tech_version: jm[1], language: 'PHP', language_version: phpVersion, framework: 'Joomla' }); }

  if (composer) {
    const req = { ...(composer['require-dev'] || {}), ...(composer.require || {}) };
    const lockVersion = (name) => {
      const all = lock ? [...(lock.packages || []), ...(lock['packages-dev'] || [])] : [];
      const p = all.find((x) => x.name === name);
      return p ? cleanVersion(p.version) : null;
    };
    const fw = PHP_FRAMEWORKS.find(([name]) => req[name]);
    if (fw) {
      const v = lockVersion(fw[0]) || cleanVersion(req[fw[0]]);
      ctx.note(`Framework: ${fw[1]}${v ? ` ${v}` : ''} (composer)`);
      candidates.push({ score: fw[2], technology: fw[1], tech_version: v, language: 'PHP', language_version: phpVersion, framework: `${fw[1]}${v ? ` ${v}` : ''}` });
    } else {
      candidates.push({ score: 60, technology: 'PHP', tech_version: phpVersion, language: 'PHP', language_version: phpVersion, framework: null });
    }
  } else if (ctx.has('artisan', 1)) {
    ctx.note('Laravel artisan dosyası');
    candidates.push({ score: 85, technology: 'Laravel', tech_version: null, language: 'PHP', language_version: phpVersion, framework: 'Laravel' });
  } else if (ctx.has('index.php', 1)) {
    ctx.note('index.php bulundu');
    candidates.push({ score: 30, technology: 'PHP', tech_version: phpVersion, language: 'PHP', language_version: phpVersion, framework: null });
  }
  if (phpVersion) candidates.forEach((c) => { c.runtime = `PHP ${phpVersion}`; });
  return candidates;
}

// ---------- Python ----------
const PY_FRAMEWORKS = [['django', 'Django', 90], ['fastapi', 'FastAPI', 80], ['flask', 'Flask', 80], ['streamlit', 'Streamlit', 65]];

function detectPython(ctx) {
  const sources = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg'].map((f) => [f, ctx.read(f)]).filter(([, t]) => t);
  const lockText = ctx.read('poetry.lock', LIMITS.lockFile) || '';
  if (!sources.length && !ctx.has('manage.py', 1)) return null;
  sources.forEach(([f]) => ctx.note(`${f} bulundu`));
  const all = sources.map(([, t]) => t).join('\n');

  let fw = null;
  for (const [name, label, score] of PY_FRAMEWORKS) {
    const re = new RegExp(`(^|["'\\s,\\[])${name}(\\[[^\\]]*\\])?\\s*(?:["']?\\s*=\\s*["']?|[=<>~^!]=?|@)?\\s*["'{]?\\s*(?:version\\s*=\\s*["'])?([=<>~^!]*\\s*\\d[\\w.*]*)?`, 'im');
    const m = all.match(re);
    if (!m) continue;
    let version = cleanVersion(m[3] || '');
    const lm = lockText.match(new RegExp(`name = "${name}"\\s*\\nversion = "([^"]+)"`, 'i'));
    if (lm) version = lm[1];
    fw = { label, score, version };
    break;
  }
  if (!fw && ctx.has('manage.py', 1)) fw = { label: 'Django', score: 85, version: null };
  if (fw) ctx.note(`Framework: ${fw.label}${fw.version ? ` ${fw.version}` : ''}`);

  const pyproject = ctx.read('pyproject.toml') || '';
  const pipfile = ctx.read('Pipfile') || '';
  const runtime = ctx.read('runtime.txt');
  const pyVersion = (runtime && cleanVersion(runtime.replace(/^python-/, '')))
    || simpleFile(ctx, '.python-version')
    || cleanVersion((pyproject.match(/requires-python\s*=\s*["']([^"']+)/) || [])[1])
    || cleanVersion((pyproject.match(/^python\s*=\s*["']([^"']+)/m) || [])[1])
    || cleanVersion((pipfile.match(/python_version\s*=\s*["']([^"']+)/) || [])[1])
    || toolVersion(ctx, 'python') || dockerVersion(ctx, 'python');

  return {
    score: fw ? fw.score : 50,
    technology: fw ? fw.label : 'Python',
    tech_version: fw ? fw.version : pyVersion,
    language: 'Python',
    language_version: pyVersion,
    framework: fw ? `${fw.label}${fw.version ? ` ${fw.version}` : ''}` : null,
    runtime: pyVersion ? `Python ${pyVersion}` : 'Python',
  };
}

// ---------- Ruby ----------
function detectRuby(ctx) {
  const gemfile = ctx.read('Gemfile');
  if (!gemfile) return null;
  ctx.note('Gemfile bulundu');
  const lock = ctx.read('Gemfile.lock', LIMITS.lockFile) || '';
  const gemVersion = (name) => {
    const lm = lock.match(new RegExp(`^\\s{4}${name} \\(([^)]+)\\)`, 'm'));
    if (lm) return lm[1];
    const gm = gemfile.match(new RegExp(`gem\\s+['"]${name}['"]\\s*,\\s*['"]([^'"]+)`));
    return gm ? cleanVersion(gm[1]) : null;
  };
  const rubyVersion = simpleFile(ctx, '.ruby-version')
    || cleanVersion((gemfile.match(/^\s*ruby\s+['"]([^'"]+)/m) || [])[1])
    || cleanVersion((lock.match(/RUBY VERSION\s+ruby\s+(\S+)/) || [])[1])
    || dockerVersion(ctx, 'ruby');
  let fw = null;
  if (/gem\s+['"]rails['"]/.test(gemfile)) fw = { label: 'Ruby on Rails', score: 90, version: gemVersion('rails') };
  else if (/gem\s+['"]sinatra['"]/.test(gemfile)) fw = { label: 'Sinatra', score: 70, version: gemVersion('sinatra') };
  else if (/gem\s+['"]jekyll['"]/.test(gemfile)) fw = { label: 'Jekyll', score: 70, version: gemVersion('jekyll') };
  if (fw) ctx.note(`Framework: ${fw.label}${fw.version ? ` ${fw.version}` : ''}`);
  return {
    score: fw ? fw.score : 50,
    technology: fw ? fw.label : 'Ruby',
    tech_version: fw ? fw.version : rubyVersion,
    language: 'Ruby',
    language_version: rubyVersion,
    framework: fw ? `${fw.label}${fw.version ? ` ${fw.version}` : ''}` : null,
    runtime: rubyVersion ? `Ruby ${rubyVersion}` : 'Ruby',
  };
}

// ---------- Go ----------
function detectGo(ctx) {
  const mod = ctx.read('go.mod');
  if (!mod) return null;
  ctx.note('go.mod bulundu');
  const goVersion = cleanVersion((mod.match(/^go\s+(\S+)/m) || [])[1]);
  const libs = [['github.com/gin-gonic/gin', 'Gin'], ['github.com/labstack/echo', 'Echo'], ['github.com/gofiber/fiber', 'Fiber'], ['github.com/go-chi/chi', 'chi'], ['github.com/gorilla/mux', 'Gorilla Mux']];
  let fw = null;
  for (const [mPath, label] of libs) {
    const m = mod.match(new RegExp(`${mPath.replace(/[./]/g, '\\$&')}(?:/v\\d+)?\\s+v([\\w.-]+)`));
    if (m) { fw = { label, version: cleanVersion(m[1]) }; break; }
  }
  if (fw) ctx.note(`Framework: ${fw.label}${fw.version ? ` ${fw.version}` : ''}`);
  return {
    score: fw ? 75 : 60,
    technology: fw ? fw.label : 'Go',
    tech_version: fw ? fw.version : goVersion,
    language: 'Go',
    language_version: goVersion,
    framework: fw ? `${fw.label}${fw.version ? ` ${fw.version}` : ''}` : null,
    runtime: goVersion ? `Go ${goVersion}` : 'Go',
  };
}

// ---------- Java / Kotlin ----------
function detectJava(ctx) {
  const pom = ctx.read('pom.xml');
  const gradle = ctx.read('build.gradle') || ctx.read('build.gradle.kts');
  if (!pom && !gradle) return null;
  let bootVersion = null;
  let javaVersion = null;
  let kotlin = false;
  if (pom) {
    ctx.note('pom.xml bulundu');
    bootVersion = (pom.match(/<artifactId>spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)<\/version>/) || [])[1] || null;
    if (!bootVersion && /spring-boot/.test(pom)) bootVersion = (pom.match(/<spring-boot\.version>([^<]+)</) || [])[1] || '';
    javaVersion = cleanVersion((pom.match(/<java\.version>([^<]+)</) || pom.match(/<maven\.compiler\.(?:source|release)>([^<]+)</) || [])[1]);
    kotlin = /kotlin-maven-plugin/.test(pom);
  }
  if (gradle) {
    ctx.note(ctx.has('build.gradle.kts') ? 'build.gradle.kts bulundu' : 'build.gradle bulundu');
    const bm = gradle.match(/org\.springframework\.boot['"]?\)?\s+version\s+['"]([^'"]+)/);
    if (bm) bootVersion = bm[1];
    javaVersion = javaVersion || cleanVersion((gradle.match(/JavaLanguageVersion\.of\((\d+)\)/) || gradle.match(/sourceCompatibility\s*=\s*['"]?(?:JavaVersion\.VERSION_)?([\d_.]+)/) || [])[1]?.replace(/_/g, '.'));
    kotlin = kotlin || /kotlin\(|org\.jetbrains\.kotlin/.test(gradle);
  }
  const isBoot = bootVersion !== null;
  if (isBoot) ctx.note(`Framework: Spring Boot${bootVersion ? ` ${bootVersion}` : ''}`);
  return {
    score: isBoot ? 90 : 55,
    technology: isBoot ? 'Spring Boot' : 'Java',
    tech_version: isBoot ? (bootVersion || null) : javaVersion,
    language: kotlin ? 'Kotlin' : 'Java',
    language_version: javaVersion,
    framework: isBoot ? `Spring Boot${bootVersion ? ` ${bootVersion}` : ''}` : null,
    runtime: javaVersion ? `Java ${javaVersion}` : 'JVM',
  };
}

// ---------- .NET ----------
function detectDotnet(ctx) {
  const proj = [...ctx.findByExt('.csproj'), ...ctx.findByExt('.fsproj'), ...ctx.findByExt('.vbproj')][0];
  if (!proj) return null;
  const text = ctx.readFile(proj);
  if (!text) return null;
  ctx.note(`${path.posix.basename(proj.name)} bulundu`);
  const tfm = (text.match(/<TargetFrameworks?>([^<;]+)/) || [])[1] || '';
  const ver = (tfm.match(/^net(?:coreapp)?(\d+\.\d+)/) || [])[1] || null;
  const web = /Sdk="Microsoft\.NET\.Sdk\.(Web|Razor|BlazorWebAssembly)"/.test(text);
  const language = proj.name.endsWith('.fsproj') ? 'F#' : proj.name.endsWith('.vbproj') ? 'VB.NET' : 'C#';
  const langVer = (text.match(/<LangVersion>([^<]+)</) || [])[1] || null;
  return {
    score: web ? 85 : 60,
    technology: web ? 'ASP.NET Core' : '.NET',
    tech_version: ver,
    language,
    language_version: langVer,
    framework: tfm ? `${web ? 'ASP.NET Core' : '.NET'} (${tfm})` : null,
    runtime: ver ? `.NET ${ver}` : '.NET',
  };
}

// ---------- Static ----------
const VENDOR_LIBS = [
  [/(^|\/)three(\.[a-z]+)*\.js$/i, 'Three.js', 'three'],
  [/(^|\/)hls(\.[a-z]+)*\.js$/i, 'hls.js', 'hls.js'],
  [/(^|\/)jquery([-.][\w.]+)?\.js$/i, 'jQuery', 'jquery'],
  [/(^|\/)bootstrap(\.[a-z]+)*\.(js|css)$/i, 'Bootstrap', 'bootstrap'],
  [/(^|\/)gsap(\.[a-z]+)*\.js$/i, 'GSAP', 'gsap'],
  [/(^|\/)swiper(-bundle)?(\.[a-z]+)*\.js$/i, 'Swiper', 'swiper'],
];

function detectStatic(ctx) {
  const index = ctx.allNames.filter((n) => /(^|\/)index\.html?$/i.test(n) && n.split('/').length <= 3)
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!index) return null;
  ctx.note(`${index} bulundu`);
  const pinned = ctx.readJson('vendor-versions.json') || {};
  const libs = VENDOR_LIBS.filter(([re]) => ctx.allNames.some((n) => re.test(n)))
    .map(([, label, key]) => `${label}${typeof pinned[key] === 'string' ? ` ${cleanVersion(pinned[key])}` : ''}`);
  if (libs.length) ctx.note(`Kütüphaneler: ${libs.join(', ')}`);
  return { score: 10, technology: 'Statik HTML', tech_version: null, language: 'HTML/CSS/JS', language_version: null, framework: libs.join(' + ') || null, runtime: null };
}

const FIELDS = ['technology', 'tech_version', 'language', 'language_version', 'framework'];

function detectFromZip(buffer) {
  const files = openArchive(buffer);
  if (!files.length) throw new DetectError('Arşiv boş görünüyor.');
  const ctx = makeContext(files);

  const candidates = [
    ...detectPhp(ctx), detectNode(ctx), detectPython(ctx), detectRuby(ctx),
    detectGo(ctx), detectJava(ctx), detectDotnet(ctx), detectStatic(ctx),
  ].filter(Boolean).sort((a, b) => b.score - a.score);

  if (ctx.has('Dockerfile', 1)) ctx.note('Dockerfile bulundu');
  if (!candidates.length) {
    return { detected: false, result: null, alternatives: [], evidence: ctx.evidence, fileCount: files.length };
  }
  const [best, ...rest] = candidates;
  const result = {};
  for (const f of FIELDS) result[f] = best[f] || null;
  const seen = new Set([best.technology]);
  const alternatives = [];
  for (const c of rest) {
    if (seen.has(c.technology)) continue;
    seen.add(c.technology);
    alternatives.push(`${c.technology}${c.tech_version ? ` ${c.tech_version}` : ''}`);
  }
  return { detected: true, result, runtime: best.runtime || null, alternatives, evidence: ctx.evidence, fileCount: files.length };
}

module.exports = { detectFromZip, DetectError, cleanVersion };
