'use strict';
require('dotenv').config();
const { createApp } = require('./src/app');

createApp()
  .then(({ app, config, close }) => {
    for (const w of config.warnings) console.warn(`[uyarı] ${w}`);
    if (config.generatedPassword) {
      console.warn('[uyarı] ADMIN_PASSWORD_HASH / ADMIN_PASSWORD tanımlı değil. Yönetici hesabı için şifre üretildi:');
      console.warn(`        e-posta: ${config.adminEmail}   şifre: ${config.generatedPassword}`);
      console.warn('        Kalıcı şifre için .env dosyasını ayarlayın (bkz. README).');
    }
    const server = app.listen(config.port, config.host, () => {
      const host = config.host === '0.0.0.0' || config.host === '127.0.0.1' ? 'localhost' : config.host;
      console.log(`OpsDesk Yönetim Paneli: http://${host}:${config.port}`);
    });
    const shutdown = () => {
      server.close(() => {
        close();
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error('Başlatılamadı:', err.message);
    process.exit(1);
  });
