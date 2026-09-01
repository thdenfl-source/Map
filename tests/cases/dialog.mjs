// 인앱 다이얼로그 — 브라우저 기본 alert/confirm/prompt 를 대체한 uiAlert/uiConfirm/uiPrompt.
// 기본 모달은 시뮬레이션 루프를 통째로 멈추기 때문에 전부 걷어냈다. 여기서는
// (1) 소스에 기본 모달이 다시 새어들지 않는지, (2) 대체 구현이 실제로
// 확인/취소/Esc/Enter 를 옳게 돌려주는지 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/env.mjs';

export const name = '인앱 다이얼로그';

export async function run(page, t) {
  // ── 정적: 기본 모달 호출이 남아 있지 않은가 ──
  // `.prompt(` 처럼 메서드 호출은 제외한다(PWA 설치 배너 _deferredPrompt.prompt()).
  const RE = /(?<![A-Za-z0-9_.$])(alert|confirm|prompt)\s*\(/g;
  const leftovers = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;   // 설명 주석은 봐준다
      for (const m of line.matchAll(RE)) leftovers.push(`${f}:${i + 1} ${m[1]}`);
    });
  }
  t.eq(leftovers.length, 0,
    `기본 alert/confirm/prompt 호출 없음${leftovers.length ? ' (' + leftovers.slice(0, 5).join(', ') + ')' : ''}`);

  // 기본 모달이 뜨면 테스트가 멈추므로, 떠 버리면 즉시 잡아낸다.
  let nativeDialog = null;
  page.on('dialog', d => { nativeDialog = d.type(); d.dismiss().catch(() => {}); });

  // ── 동적: 확인 다이얼로그 ──
  const clickBtn = async (label) => {
    await page.waitForSelector('.ui-dlg', { timeout: 3000 });
    await page.locator('.ui-dlg-btns button', { hasText: label }).click();
  };

  let p = page.evaluate(() => uiConfirm('테스트 물음'));
  await clickBtn('확인');
  t.eq(await p, true, 'uiConfirm 확인 → true');

  p = page.evaluate(() => uiConfirm('테스트 물음'));
  await clickBtn('취소');
  t.eq(await p, false, 'uiConfirm 취소 → false');

  // Esc = 취소
  p = page.evaluate(() => uiConfirm('테스트 물음'));
  await page.waitForSelector('.ui-dlg');
  await page.keyboard.press('Escape');
  t.eq(await p, false, 'uiConfirm Esc → false');

  // 버튼 문구는 호출부가 바꿀 수 있다
  p = page.evaluate(() => uiConfirm('삭제할까요?', { okText: '삭제', cancelText: '그만' }));
  await clickBtn('삭제');
  t.eq(await p, true, 'okText/cancelText 반영');

  // ── 입력 다이얼로그 ──
  p = page.evaluate(() => uiPrompt('이름', '기본값'));
  await page.waitForSelector('.ui-dlg-in');
  t.eq(await page.inputValue('.ui-dlg-in'), '기본값', 'uiPrompt 기본값이 채워짐');
  await page.fill('.ui-dlg-in', 'RKSI');
  await page.keyboard.press('Enter');                     // Enter = 확인
  t.eq(await p, 'RKSI', 'uiPrompt Enter → 입력값');

  p = page.evaluate(() => uiPrompt('이름', 'x'));
  await page.waitForSelector('.ui-dlg-in');
  await page.keyboard.press('Escape');
  t.eq(await p, null, 'uiPrompt Esc → null');

  // 숫자/비밀 옵션
  p = page.evaluate(() => uiPrompt('고도', 3000, { numeric: true }));
  await page.waitForSelector('.ui-dlg-in');
  t.eq(await page.getAttribute('.ui-dlg-in', 'inputmode'), 'decimal', 'numeric → 숫자 키패드');
  await page.keyboard.press('Escape'); await p;

  p = page.evaluate(() => uiPrompt('코드', '', { password: true }));
  await page.waitForSelector('.ui-dlg-in');
  t.eq(await page.getAttribute('.ui-dlg-in', 'type'), 'password', 'password → 가려진 입력');
  await page.keyboard.press('Escape'); await p;

  // ── 알림 ──
  p = page.evaluate(() => uiAlert('알림'));
  await page.waitForSelector('.ui-dlg');
  t.eq(await page.locator('.ui-dlg-btns button').count(), 1, 'uiAlert 는 버튼이 하나');
  await clickBtn('확인');
  await p;
  t.eq(await page.locator('.ui-dlg').count(), 0, '닫으면 DOM 에서 사라짐');

  // ── 겹쳐 띄우면 줄을 선다(뒤에 있는 화면이 클릭에 새지 않게) ──
  const both = page.evaluate(async () => {
    const a = uiConfirm('첫째'), b = uiConfirm('둘째');
    return [await a, await b];
  });
  await page.waitForSelector('.ui-dlg');
  t.eq(await page.locator('.ui-dlg').count(), 1, '동시에 뜨는 다이얼로그는 하나뿐');
  await clickBtn('확인');
  await page.waitForTimeout(50);
  await clickBtn('취소');
  t.eq(JSON.stringify(await both), '[true,false]', '줄 선 순서대로 각자의 답을 받음');

  // ── 토스트 ──
  await page.evaluate(() => uiToast('저장했습니다'));
  t.eq(await page.locator('.ui-toast').count(), 1, 'uiToast 표시');

  // ── 시뮬레이션이 멈추지 않는가 ──
  // 기본 모달이었다면 여기서 시각이 정지한다.
  p = page.evaluate(() => uiConfirm('비행 중'));
  await page.waitForSelector('.ui-dlg');
  const frames = await page.evaluate(() => new Promise(res => {
    let n = 0;
    const t0 = performance.now();
    (function tick() {
      n++;
      if (performance.now() - t0 < 400) requestAnimationFrame(tick); else res(n);
    })();
  }));
  t.ok(frames > 5, `다이얼로그가 떠 있어도 렌더 루프가 계속 돈다 (400ms 동안 ${frames}프레임)`);
  await clickBtn('취소'); await p;

  t.eq(nativeDialog, null, `브라우저 기본 모달이 뜨지 않음${nativeDialog ? ' (' + nativeDialog + ')' : ''}`);

  // ── 바깥 사이트로 나가는 길 ──
  // 홈 화면에 설치한 PWA 에서 window.open 을 부르면 새 탭이 아니라 앱 창 자체가
  // 그 주소로 덮여 시뮬레이터가 사라진다. 그래서 전부 uiOpenExternal(앵커 클릭)로
  // 바꿨다. 다시 window.open 이 새어들면 여기서 잡는다.
  const winOpen = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      if (/window\.open\s*\(/.test(line)) winOpen.push(`${f}:${i + 1}`);
    });
  }
  t.eq(winOpen.length, 0,
    `window.open 을 직접 부르는 곳 없음${winOpen.length ? ' (' + winOpen.join(', ') + ')' : ''}`);

  const link = await page.evaluate(() => {
    let got = null;
    const on = e => {
      const a = e.target.closest && e.target.closest('a');
      if (a) { got = { href: a.href, target: a.target, rel: a.rel }; e.preventDefault(); }
    };
    document.addEventListener('click', on, true);
    uiOpenExternal('https://example.org/x');
    document.removeEventListener('click', on, true);
    return got;
  });
  t.eq(link && link.target, '_blank', 'uiOpenExternal 은 새 탭 앵커를 눌러 나간다');
  t.eq(link && link.href, 'https://example.org/x', `주소가 그대로 전달된다 (${link && link.href})`);
  t.ok(link && /noopener/.test(link.rel), '연 창이 원래 창을 건드리지 못하게 noopener 를 붙인다');
  await page.waitForTimeout(150);   // 앵커는 클릭 직후 다음 틱에 치운다
  const left = await page.evaluate(() => [...document.querySelectorAll('a[href="https://example.org/x"]')].map(a => a.outerHTML));
  t.eq(left.length, 0, `쓰고 난 앵커는 문서에 남지 않는다 ${JSON.stringify(left)}`);

  // UBIKAIS 는 모바일 브라우저를 서버에서 막는다. UA 를 앱이 바꿀 수는 없으니
  // '데스크톱 사이트' 로 바꾸는 방법을 함께 띄우고, 확인 버튼은 링크여야 한다.
  // PC 에서는 안내 없이 곧장 나간다
  const direct = await page.evaluate(() => {
    let href = null;
    const on = e => { const a = e.target.closest && e.target.closest('a');
                      if (a) { href = a.href; e.preventDefault(); } };
    window.uiIsMobile = () => false;
    document.addEventListener('click', on, true);
    CDU_ACT.openUbikais();
    document.removeEventListener('click', on, true);
    return { href, dlg: document.querySelectorAll('.ui-dlg').length };
  });
  t.ok(/ubikais\.fois\.go\.kr/.test(direct.href || '') && direct.dlg === 0,
    'PC 에서는 안내 없이 곧바로 새 탭으로 연다');

  p = page.evaluate(() => { window.uiIsMobile = () => true; CDU_ACT.openUbikais(); });
  await page.waitForSelector('.ui-dlg');
  const ok = page.locator('.ui-dlg-btns .ui-dlg-ok');
  const msg = await page.locator('.ui-dlg-msg').innerText();
  t.eq(await ok.evaluate(el => el.tagName), 'A', 'UBIKAIS 확인 버튼은 앵커라 팝업 차단에 걸리지 않는다');
  t.ok(/ubikais\.fois\.go\.kr/.test(await ok.getAttribute('href') || ''), 'UBIKAIS 주소로 연결된다');
  t.ok(/데스크/.test(msg), `모바일에서 막히는 이유와 푸는 방법을 함께 알려 준다`);
  await clickBtn('취소'); await p.catch(() => {});
}
