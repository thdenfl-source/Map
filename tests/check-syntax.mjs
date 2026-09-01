#!/usr/bin/env node
// index.html 안의 인라인 스크립트를 뽑아 문법 검사한다.
// 배포 전 최소 방어선 — 문법 오류가 GitHub Pages 까지 나가는 것을 막는다.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
// 코드를 js/*.js 로 분리한 뒤에는 인라인 블록이 없을 수 있다. 둘 다 0 이면 이상.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfrsim-syntax-'));
let failed = 0;
blocks.forEach((code, i) => {
  const f = path.join(dir, `block${i}.js`);
  fs.writeFileSync(f, code);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed++; console.error(`✗ 스크립트 블록 ${i + 1} 문법 오류\n${e.stderr?.toString() || e.message}`); }
});

// 외부 js 파일도 함께 검사(파일 분할 이후).
// vendor/ 는 npm 배포본을 그대로 둔 사본이라 우리가 고칠 일이 없다 — 검사에서 뺀다.
const srcs = [...html.matchAll(/<script[^>]*\ssrc="(?!https?:)([^"]+)"/g)]
  .map(m => m[1]).filter(rel => !/^\.?\/?vendor\//.test(rel));
srcs.forEach(rel => {
  const f = path.join(ROOT, rel.replace(/^\.\//, ''));
  if (!fs.existsSync(f)) { failed++; console.error(`✗ 없는 스크립트: ${rel}`); return; }
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed++; console.error(`✗ ${rel} 문법 오류\n${e.stderr?.toString() || e.message}`); }
});

if (!blocks.length && !srcs.length) {
  console.error('검사할 스크립트를 찾지 못했습니다 — index.html 을 확인하세요.');
  process.exit(1);
}
console.log(failed ? `문법 검사 실패 ${failed}건` :
  `문법 검사 통과 — 인라인 ${blocks.length}블록, 외부 ${srcs.length}파일`);
process.exit(failed ? 1 : 0);
