#!/usr/bin/env node
// index.html 이 바뀐 PR 인데 sw.js 의 캐시 버전이 그대로면 경고한다.
// 버전을 안 올리면 서비스워커가 옛 파일을 계속 내주어 "고쳤는데 반영이 안 된다"가 된다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const base = process.argv[2];
if (!base) { console.log('기준 커밋이 없어 건너뜁니다.'); process.exit(0); }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
let changed = '';
try { changed = git('diff', '--name-only', base, 'HEAD'); }
catch (e) { console.log('diff 실패 — 건너뜁니다:', e.message); process.exit(0); }

const files = changed.split('\n').filter(Boolean);
if (!files.includes('index.html') && !files.some(f => f.startsWith('js/'))) {
  console.log('앱 파일 변경 없음 — 확인 불필요.'); process.exit(0);
}

const ver = s => (s.match(/const CACHE\s*=\s*'([^']+)'/) || [])[1];
const now = ver(fs.readFileSync('sw.js', 'utf8'));
let before = null;
try { before = ver(git('show', `${base}:sw.js`)); } catch (e) { /* 새 파일 */ }

if (before && now === before) {
  console.error(`✗ 앱 파일이 바뀌었는데 sw.js 캐시 버전이 그대로입니다 (${now}).\n` +
                `  sw.js 의 CACHE 값을 올려 주세요 — 안 올리면 사용자에게 갱신이 가지 않습니다.`);
  process.exit(1);
}
console.log(`✓ 캐시 버전 ${before || '(신규)'} → ${now}`);
