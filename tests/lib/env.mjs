// 테스트용 사본 생성
// 외부 라이브러리를 vendor/ 에 직접 들고 있으므로(vendor/README.md) index.html 을
// 손댈 필요 없이 그대로 복사해 띄운다. 종전에는 CDN 태그를 걷어내고 로컬 Leaflet 을
// 끼워 넣었는데, 그러면 검사 대상이 실제 배포본과 달라지는 데다 maplibre·pdf.js 는
// 아예 없는 상태로 돌았다. 이제 사용자가 받는 것과 같은 파일을 검사한다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

export function buildEnv() {
  const vendor = path.join(ROOT, 'vendor');
  if (!fs.existsSync(path.join(vendor, 'leaflet.js'))) {
    throw new Error('vendor/leaflet.js 가 없습니다 — 저장소가 온전한지 확인하세요.');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfrsim-test-'));
  for (const d of ['vendor', 'js']) {
    const src = path.join(ROOT, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, d), { recursive: true });
  }
  const file = path.join(dir, 'index.html');
  fs.copyFileSync(path.join(ROOT, 'index.html'), file);
  return { dir, file, url: 'file://' + file };
}

// 페이지를 띄우고 도움말 오버레이를 닫은 상태로 반환
export async function openApp(browser, { cdu = false } = {}) {
  const { url } = buildEnv();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(url);
  // 최상위 let/const 는 window 프로퍼티가 아니므로 식별자로 직접 확인한다
  await page.waitForFunction(
    () => typeof S === 'object' && S !== null && typeof distance === 'function' && typeof leafMap === 'object',
    null, { timeout: 20000 });
  await page.getByText('시작하기').click().catch(() => {});
  await page.waitForTimeout(200);
  if (cdu) { await page.evaluate(() => selectPanel('right', 'cdu')); await page.waitForTimeout(300); }
  return page;
}
