// 스모크 — 페이지 로드 오류, 주요 화면 렌더, 죽은 버튼(참조 불가 핸들러) 검출
export const name = '스모크';

export async function run(page, t) {
  t.eq(page.errors.length, 0, `로드 시 페이지 오류 없음${page.errors.length ? ': ' + page.errors.join(' | ') : ''}`);

  // 핵심 전역이 준비됐는가.
  // 최상위 let/const 는 window 프로퍼티가 아니지만 전역 스코프에는 있으므로,
  // 인라인 핸들러와 같은 방식(new Function)으로 확인한다.
  const globals = await page.evaluate(() => ['S', 'distance', 'bearing', 'destPoint', 'normA',
    'leafMap', 'switchMode', 'selectPanel', 'CDU_ACT']
    .filter(n => { try { return new Function('return typeof ' + n)() === 'undefined'; } catch (e) { return true; } }));
  t.eq(globals.length, 0, `핵심 전역 존재${globals.length ? ' (없음: ' + globals.join(',') + ')' : ''}`);

  // 인라인 onclick 이 부르는 함수가 전역에서 실제로 호출 가능한가
  // (CDU 캡슐화 이후 clBack 처럼 "조용히 죽은 버튼"이 생겼던 이력이 있다)
  const dead = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[onclick]').forEach(el => {
      const code = el.getAttribute('onclick') || '';
      // 점 앞에 오는 것은 메서드 호출이므로 제외한다(event.stopPropagation 등)
      [...code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].forEach(mm => {
        const fn = mm[2];
        if (['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof'].includes(fn)) return;
        // 인라인 핸들러는 전역 렉시컬 스코프(let/const 포함)에서 이름을 찾는다.
        // window[fn] 로만 보면 let 선언 함수를 죽은 것으로 오판한다.
        let ok = false;
        try { ok = new Function('return typeof ' + fn)() === 'function'; } catch (e) { ok = false; }
        if (!ok) out.push({ fn, text: (el.textContent || '').trim().slice(0, 14) });
      });
    });
    return out;
  });
  t.eq(dead.length, 0,
    `인라인 onclick 핸들러 전부 호출 가능${dead.length ? ' — 죽은 버튼: ' + dead.map(d => `${d.fn}(${d.text})`).join(', ') : ''}`);

  // data-act 이름이 전부 등록돼 있는가
  const unreg = await page.evaluate(() => {
    const names = new Set();
    document.querySelectorAll('[data-act]').forEach(el => names.add(el.dataset.act));
    const reg = n => { try { return new Function('return (typeof CDU_ACT!=="undefined"&&typeof CDU_ACT[' + JSON.stringify(n) + ']==="function")||(typeof APP_ACT!=="undefined"&&typeof APP_ACT[' + JSON.stringify(n) + ']==="function")')(); } catch (e) { return false; } };
    return [...names].filter(n => !reg(n));
  });
  t.eq(unreg.length, 0, `data-act 전부 등록됨${unreg.length ? ' (미등록: ' + unreg.join(',') + ')' : ''}`);

  // 무시된 예외 집계기가 동작하는가 + 같은 예외가 반복되지 않는가
  // (반복되면 매 프레임 던지는 실동작 문제일 가능성이 높다)
  const sw = await page.evaluate(() => {
    if (typeof _swallowSummary !== 'function') return null;
    return { top: _swallowSummary().slice(0, 3), total: _swallowed().length };
  });
  t.ok(sw !== null, '무시 예외 집계기(_swallowSummary) 존재');
  if (sw) {
    const worst = sw.top[0] ? sw.top[0][1] : 0;
    t.ok(worst < 20,
      `기동 중 같은 예외 반복 ${worst}회 (총 ${sw.total})${worst >= 20 ? ' — ' + sw.top[0][0] : ''}`);
  }

  // CDU 주요 화면이 오류 없이 렌더되는가
  await page.evaluate(() => selectPanel('right', 'cdu'));
  await page.waitForTimeout(250);
  const modes = ['HOME', 'AIRFIELD', 'CHARTS', 'UTIL', 'PERF', 'AUDIO', 'INTERCOM',
                 'XPDR_MODE', 'TRACKPOINT', 'SETTINGS', 'CHECKLIST'];
  page.errors.length = 0;
  for (const m of modes) {
    await page.evaluate(mm => { try { switchMode(mm); } catch (e) { throw e; } }, m);
    await page.waitForTimeout(90);
  }
  t.eq(page.errors.length, 0,
    `CDU ${modes.length}개 화면 렌더 오류 없음${page.errors.length ? ': ' + page.errors.join(' | ') : ''}`);

  // Back 버튼이 실제로 화면을 바꾸는가 (체크리스트 하위 → 상위)
  page.errors.length = 0;
  await page.evaluate(() => CDU_ACT.clOpen());
  await page.waitForTimeout(200);
  await page.evaluate(() => CDU_ACT.clInto(0));
  await page.waitForTimeout(200);
  const back = await page.$('#cdu-wrap .nav-btn:has-text("Back")');
  t.ok(!!back, '체크리스트 Back 버튼 존재');
  if (back) { await back.click(); await page.waitForTimeout(250); }
  const mode = await page.evaluate(() => window.currentMode);
  t.eq(mode, 'CHECKLIST', 'Back 1회 — 체크리스트 상위로 복귀');
  t.eq(page.errors.length, 0, `Back 클릭 오류 없음${page.errors.length ? ': ' + page.errors.join(' | ') : ''}`);

  await runDegenerate(page, t);
}

// 계기 캔버스가 접힌 상태(폭·높이 0)에서도 예외 없이 넘어가는가
// — 분할 전환·전체화면 직후 W·H 가 0 이 되며 ctx.arc 반지름이 음수가 되던 이력
export async function runDegenerate(page, t) {
  page.errors.length = 0;
  const thrown = await page.evaluate(() => {
    const w = cvs.width, h = cvs.height;
    const errs = [];
    for (const [W, H] of [[0, 0], [10, 10], [79, 79], [200, 40], [40, 200]]) {
      cvs.width = W; cvs.height = H;
      try { drawPFD(); } catch (e) { errs.push(`${W}x${H}: ${e.message}`); }
    }
    cvs.width = w; cvs.height = h;
    try { drawPFD(); } catch (e) { errs.push('restore: ' + e.message); }
    return errs;
  });
  t.eq(thrown.length, 0, `접힌 캔버스 5종에서 drawPFD 예외 없음${thrown.length ? ': ' + thrown.join(' | ') : ''}`);
  t.eq(page.errors.length, 0, '접힌 캔버스 렌더 중 페이지 오류 없음');
}
