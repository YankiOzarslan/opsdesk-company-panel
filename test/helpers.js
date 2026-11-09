'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const AdmZip = require('adm-zip');
const { createApp } = require('../src/app');

const PASSWORD = 'dogru-sifre-123';
const ADMIN_EMAIL = 'admin@opsdesk.test';

function fakeMailer() {
  return { configured: true, sent: [], async send(m) { this.sent.push(m); return { sent: this.configured }; } };
}
const silent = { log() {}, info() {}, warn() {}, error() {} };

async function makeApp(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opsdesk-test-'));
  const instance = await createApp({
    dataDir: path.join(dir, 'data'),
    backupDir: path.join(dir, 'backups'),
    autoBackup: false,
    autoExpirySync: false,
    mailer: fakeMailer(),
    logger: silent,
    env: {
      NODE_ENV: 'test',
      ADMIN_EMAIL,
      ADMIN_PASSWORD: PASSWORD,
      ADMIN_PASSWORD_HASH: '',
      BCRYPT_ROUNDS: '4',
      APP_URL: 'https://panel.opsdesk.test',
      JWT_SECRET: 'j'.repeat(48),
      SESSION_SECRET: 's'.repeat(48),
      COOKIE_SECURE: 'false',
      ...env,
    },
  });
  instance.dir = dir;
  instance.cleanup = () => {
    instance.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return instance;
}

function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([a-f0-9]+)"/) || html.match(/name="csrf-token" content="([a-f0-9]+)"/);
  if (!m) throw new Error('CSRF token bulunamadı');
  return m[1];
}

async function csrf(agent, url = '/login') {
  const res = await agent.get(url);
  return extractCsrf(res.text);
}

async function login(app, { email = ADMIN_EMAIL, password = PASSWORD } = {}) {
  const agent = request.agent(app);
  const token = await csrf(agent, '/login');
  const res = await agent.post('/login').type('form').send({ _csrf: token, email, password, next: '/' });
  if (res.status !== 302) throw new Error(`Giriş başarısız: ${res.status}`);
  agent.csrfToken = await csrf(agent, '/');
  return agent;
}

function post(agent, url, data = {}) {
  return agent.post(url).type('form').send({ _csrf: agent.csrfToken, ...data });
}

function idFromLocation(res) {
  const m = /\/(\d+)$/.exec(res.headers.location || '');
  return m ? Number(m[1]) : null;
}

function zipOf(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

module.exports = { makeApp, login, csrf, post, extractCsrf, idFromLocation, zipOf, PASSWORD, ADMIN_EMAIL, request };
