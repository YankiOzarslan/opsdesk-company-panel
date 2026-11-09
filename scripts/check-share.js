'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>!['.git','node_modules'].includes(e.name)).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.relative(root,path.join(dir,e.name))]);}
let files;try{files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);}catch(_){files=walk(root);}
if(!files.length)files=walk(root);
const errors=[];
for(const file of files){
 if(/(^|\/)(?:data|backups|\.secrets|\.upgrade-backups|node_modules)(?:\/|$)/.test(file) || /\.(?:sqlite(?:3)?|db|key|pem)(?:$|\.)/i.test(file) || (/(^|\/)\.env(?:$|\.)/.test(file) && file!=='.env.example'))errors.push(file+': runtime/private file');
 const full=path.join(root,file);if(!fs.existsSync(full) || !fs.statSync(full).isFile())continue;
 const text=fs.readFileSync(full,'utf8');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) || /gh[pousr]_[A-Za-z0-9]{30,}/.test(text) || /github_pat_[A-Za-z0-9_]{40,}/.test(text))errors.push(file+': possible private key or access token');
 if(/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(text))errors.push(file+': personal filesystem path');
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Sharing checks passed for ${files.length} files. Review the diff before publishing.`);
