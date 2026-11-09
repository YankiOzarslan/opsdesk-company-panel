'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { migrate } = require('./schema');
const { ENTITIES } = require('./entities');
const { BackupManager } = require('./backup');
const { csrfProtection, createAuth, SESSION_TTL_MS } = require('./security');
const helpers = require('./view-helpers');
const crudRouter = require('./routes/crud');
const lookupRoutes = require('./routes/lookup');
const { ExpirySync } = require('./expiry-sync');
const { createUsers } = require('./users');
const { createMailer } = require('./mailer');

async function createApp(options = {}) {
  const config = loadConfig(options);
  const db = await openDatabase(config.dbPath);
  migrate(db);
  const { createVault, migrateSecrets } = require('./vault');
  db.vault = createVault(config.vaultKeyPath, db);
  migrateSecrets(db);
  const users = createUsers(db, { bcryptRounds: config.bcryptRounds });
  config.generatedPassword = (await users.ensureAdmin(config)).generatedPassword;
  const mailer = options.mailer || createMailer(config, options.logger || console);
  if (!mailer.configured) config.warnings.push('SMTP ayarlı değil; parola sıfırlama / davet bağlantıları sunucu kaydına yazılır.');
  const backups = new BackupManager(db, config.backupDir, { keep: config.backupKeep, logger: options.logger || console });
  if (config.autoBackup) backups.start();
  const auth = createAuth(config, users);
  const expirySync = new ExpirySync(db, { logger: options.logger || console });
  if (config.autoExpirySync) expirySync.start();
  const ctx = { db, config, backups, auth, expirySync, users, mailer, logger: options.logger || console, entities: ENTITIES };

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.root, 'views'));
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
        'style-src': ["'self'", 'https://cdn.jsdelivr.net'],
        'font-src': ["'self'", 'https://cdn.jsdelivr.net'],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': null,
      },
    },
    hsts: config.cookieSecure ? { maxAge: 15552000 } : false,
    referrerPolicy: { policy: 'same-origin' },
  }));

  app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: config.production ? '1d' : 0 }));
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(session({
    name: 'opsdesk.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({ checkPeriod: 60 * 60 * 1000 }),
    cookie: { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, maxAge: SESSION_TTL_MS },
  }));

  app.use((req, res, next) => {
    req.flash = (type, message) => {
      req.session.flash = [...(req.session.flash || []), { type, message }];
    };
    res.locals.flash = req.session.flash || [];
    if (req.session.flash) delete req.session.flash;
    res.locals.h = helpers;
    res.locals.entities = ENTITIES;
    res.locals.path = req.path;
    res.locals.query = req.query;
    res.locals.user = null;
    res.locals.account = null;
    try {res.locals.company=JSON.parse(db.get("SELECT value FROM app_meta WHERE key='company_profile'")?.value || '{}');} catch(_){res.locals.company={};}
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(csrfProtection);

  app.use(require('./routes/auth')(ctx));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use(auth.requireAuth);
  app.use((req,res,next)=>{
    res.locals.mustChangePassword=db.get('SELECT value FROM app_meta WHERE key=?',[`password_change:${req.account.id}`])?.value==='1';
    if(res.locals.mustChangePassword && !((req.method==='GET' && ['/account','/help'].includes(req.path)) || (req.method==='POST' && req.path==='/account/password'))) {
      if(req.method!=='GET' || (req.get('accept') || '').includes('application/json'))return res.status(403).json({ok:false,message:'Devam etmek için başlangıç parolanızı Hesabım ekranından değiştirin.'});
      return res.redirect('/account');
    }
    next();
  });
  app.use(require('./routes/getting-started')(ctx));
  app.use(require('./routes/account')(ctx));
  app.use('/drafts', require('./routes/drafts')(ctx));
  app.use('/vault', require('./routes/vault')(ctx));
  app.use('/technology-categories', require('./routes/categories')(ctx));
  app.use('/users', require('./routes/users')(ctx));
  app.use(require('./routes/search')(ctx));
  app.use(require('./routes/system')(ctx));
  app.use('/', require('./routes/dashboard')(ctx));
  app.use('/projects', require('./routes/projects')(ctx));
  for (const key of ['domains', 'servers', 'clients', 'contacts', 'team']) {
    const extend = key === 'domains' || key === 'servers' ? lookupRoutes(ctx, key) : undefined;
    app.use(`/${key}`, crudRouter(ctx, ENTITIES[key], { extend }));
  }
  app.use('/audit', require('./routes/audit')(ctx));
  app.use('/backups', require('./routes/backups')(ctx));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Bulunamadı', status: 404, message: 'Aradığınız sayfa veya kayıt bulunamadı.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    if (err.type === 'entity.too.large') status = 413;
    const message = status === 413 ? 'İstek boyutu çok büyük (en fazla 100 KB).'
      : status < 500 ? err.message || 'Geçersiz istek.' : 'Beklenmeyen bir hata oluştu.';
    if (status >= 500) (options.logger || console).error(err);
    if (req.path === '/projects/detect' || (req.get('accept') || '').includes('application/json')) {
      return res.status(status).json({ ok: false, message });
    }
    return res.status(status).render('error', { title: 'Hata', status, message });
  });

  const close = () => {
    backups.stop();
    expirySync.stop();
    db.close();
  };

  return { app, db, config, backups, expirySync, users, mailer, close };
}

module.exports = { createApp };
