// 액션 위임 — 소스에 쓰인 data-act 이름이 전부 등록돼 있는가(정적) + 실제 동작(동적)
// 인라인 onclick 은 전역 스코프에 의존해 "조용히 죽는 버튼"을 만들었다.
// 위임으로 옮긴 뒤에는 미등록 이름이 곧 죽은 버튼이므로 여기서 막는다.
//
// 종전에는 index.html 만 훑었다. 그래서 자바스크립트가 문자열로 만들어 내는
// 마크업(PDF 뷰어의 ◀/▶·📍, Flight Plan, 홀딩 입력창 …)은 검사 밖이었고,
// 실제로 그 41개가 죽은 채로 배포됐다. 이제 js/*.js 의 템플릿까지 함께 본다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/env.mjs';

export const name = '액션 위임';

export async function run(page, t) {
  // ── 정적: index.html + js/*.js 를 훑어 data-act 이름 대조 ──
  const files = [path.join(ROOT, 'index.html'),
    ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))
        .map(f => path.join(ROOT, 'js', f))];
  const used = new Set();
  const srcAll = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/data-act="([A-Za-z_$][\w$]*)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bact\('([A-Za-z_$][\w$]*)'/g)) used.add(m[1]);
  }
  used.delete('foo');   // 주석의 설명용 예시

  const registered = await page.evaluate(() =>
    [...new Set([...Object.keys(APP_ACT), ...Object.keys(CDU_ACT)])]);
  const reg = new Set(registered);
  const missing = [...used].filter(n => !reg.has(n)).sort();
  t.eq(missing.length, 0,
    `소스의 data-act ${used.size}개 전부 등록됨${missing.length ? ' (미등록: ' + missing.join(', ') + ')' : ''}`);

  // 등록된 값이 전부 함수인가
  const notFn = await page.evaluate(() =>
    [...Object.entries(APP_ACT), ...Object.entries(CDU_ACT)]
      .filter(([, v]) => typeof v !== 'function').map(([k]) => k));
  t.eq(notFn.length, 0, `등록 항목이 전부 함수${notFn.length ? ' (아님: ' + notFn.join(',') + ')' : ''}`);

  // ── 레지스트리 경계 ──
  // APP_ACT 에 등록된 화면이 CDU 안(#cdu-wrap)에 그려지는 일이 실제로 있다
  // (PDF 뷰어·Flight Plan). 듣는 자리로 갈라 놓으면 그 버튼들이 통째로 죽는다.
  // 어느 쪽 레지스트리에 있든, 어디에 그려지든 눌리는지 양방향으로 확인한다.
  const cross = await page.evaluate(async () => {
    const out = {};
    const mk = (parentSel, name) => {
      const p = document.querySelector(parentSel);
      const el = document.createElement('button');
      el.dataset.act = name; el.textContent = 'x';
      p.appendChild(el);
      return el;
    };
    // APP_ACT 전용 이름을 CDU 안에 그린다
    APP_ACT.__probeApp = () => { out.appInCdu = true; };
    mk('#cdu-wrap', '__probeApp').click();
    // CDU_ACT 전용 이름을 CDU 밖에 그린다
    CDU_ACT.__probeCdu = () => { out.cduOutside = true; };
    mk('body', '__probeCdu').click();
    delete APP_ACT.__probeApp; delete CDU_ACT.__probeCdu;
    return out;
  });
  t.ok(cross.appInCdu, 'APP_ACT 액션이 CDU 안에서도 눌린다');
  t.ok(cross.cduOutside, 'CDU_ACT 액션이 CDU 밖에서도 눌린다');

  // 핸들러가 화면을 다시 그려 자기 버튼을 지우더라도 딱 한 번만 실행돼야 한다.
  // (버튼이 DOM 에서 떨어지면 "CDU 안인가?" 판정이 무너져 문서 리스너가
  //  같은 클릭을 한 번 더 처리하던 이력 — Back 한 번에 두 단계 올라갔다)
  const fired = await page.evaluate(() => {
    let n = 0;
    const el = document.createElement('button');
    el.dataset.act = '__probeOnce';
    document.querySelector('#cdu-wrap').appendChild(el);
    CDU_ACT.__probeOnce = () => { n++; el.remove(); };   // 실행되며 자신을 지운다
    el.click();
    delete CDU_ACT.__probeOnce;
    return n;
  });
  t.eq(fired, 1, `자신을 지우는 핸들러도 딱 한 번 실행 (${fired}회)`);

  // ── 동적: 대표 버튼을 실제로 눌러 상태가 바뀌는가 ──
  const cases = [
    ['#obs-btn',      () => obsOn,      'OBS'],
    ['#nav-ap-btn',   () => navApOn,    'NAV'],
    ['#brg1-tog',     () => brg1Visible, 'BRG1'],
    ['#fix-btn',      () => document.getElementById('fix-panel').classList.contains('open'), 'FIX 패널'],
    ['#aspc-btn',     () => document.getElementById('aspc-panel').classList.contains('open'), '공역 패널'],
  ];
  for (const [sel, probe, label] of cases) {
    const el = await page.$(sel);
    if (!el) { t.ok(false, `${label} 버튼 존재`); continue; }
    const before = await page.evaluate(p => new Function('return (' + p + ')()')(), probe.toString());
    await el.click();
    await page.waitForTimeout(120);
    const after = await page.evaluate(p => new Function('return (' + p + ')()')(), probe.toString());
    t.ok(before !== after, `${label} 클릭 시 상태 변화 (${before} → ${after})`);
    await el.click().catch(() => {});   // 원복
    await page.waitForTimeout(80);
  }

  // 인라인 onclick 이 남아 있는 곳은 전부 전역에서 호출 가능한가(소스 기준)
  const inline = [...srcAll.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
  const fns = new Set();
  inline.forEach(code => {
    if (code.includes('${')) return;   // 템플릿 보간은 런타임 값이라 정적 판단 불가
    // 점 앞에 오는 것은 메서드 호출(event.stopPropagation 등)이므로 전역 판정에서 제외
    for (const m of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) fns.add(m[2]);
  });
  const dead = await page.evaluate(list => list.filter(n => {
    try { return new Function('return typeof ' + n)() !== 'function'; } catch (e) { return true; }
  }), [...fns]);
  t.eq(dead.length, 0,
    `남은 인라인 onclick(${inline.length}개)의 함수 ${fns.size}종 전부 호출 가능${dead.length ? ' (죽음: ' + dead.join(',') + ')' : ''}`);
}
