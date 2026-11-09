'use strict';
// Usage: npm run hash-password -- "yeni-şifre"   (or run without args to type it)
const bcrypt = require('bcryptjs');
const readline = require('readline');

function out(password) {
  if (!password || password.length < 8) {
    console.error('Şifre en az 8 karakter olmalı.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 12);
  console.log(`\nADMIN_PASSWORD_HASH='${hash}'\n`);
}

if (process.argv[2]) out(process.argv[2]);
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Şifre: ', (pw) => { rl.close(); out(pw); });
}
