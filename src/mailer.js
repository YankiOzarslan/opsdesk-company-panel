'use strict';
const nodemailer = require('nodemailer');

function createMailer(config, logger = console) {
  const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;
  return {
    configured: !!transport,
    async send({ to, subject, text }) {
      if (!transport) {
        logger.warn(`[e-posta] SMTP ayarlı değil, gönderilmedi. Alıcı: ${to} · Konu: ${subject}\n${text}`);
        return { sent: false };
      }
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
      return { sent: true };
    },
  };
}

const linkFor = (config, token) => `${config.appUrl}/reset-password/${token}`;

function resetMail(config, user, token) {
  const link = linkFor(config, token);
  return {
    link,
    to: user.email,
    subject: 'OpsDesk Yönetim Paneli — parola sıfırlama',
    text: `Merhaba ${user.name || user.email},\n\nOpsDesk Yönetim Paneli hesabın için parola sıfırlama talebi aldık. Yeni parolanı belirlemek için aşağıdaki bağlantıyı aç (1 saat geçerli, tek kullanımlık):\n\n${link}\n\nBu talebi sen yapmadıysan bu e-postayı yok sayabilirsin; parolan değişmez.\n`,
  };
}

function inviteMail(config, user, token, invitedBy) {
  const link = linkFor(config, token);
  return {
    link,
    to: user.email,
    subject: 'OpsDesk Yönetim Paneli — hesabın oluşturuldu',
    text: `Merhaba ${user.name || user.email},\n\n${invitedBy} seni OpsDesk Yönetim Paneli'ne ekledi. Parolanı belirlemek için aşağıdaki bağlantıyı aç (72 saat geçerli, tek kullanımlık):\n\n${link}\n\nGiriş adresi: ${config.appUrl}/login\nKullanıcı adın bu e-posta adresi: ${user.email}\n`,
  };
}

module.exports = { createMailer, resetMail, inviteMail };
