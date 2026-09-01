// 보조 항법장치 모드 — 이 앱의 성격이 실제로 화면에 나오는가
//
// 세 가지를 본다.
//   ① 스마트폰 크기로 열면 한 화면(MAP) + 하단 탭이 뜬다. 태블릿은 종전 3분할.
//   ② 기체를 조종하는 조작부(FCP·AFCS·트림·배속·FLY)가 화면에 없다.
//   ③ GPS 가 끊기면 추측항법(DR)으로 위치를 이어 그리고, 오래 끊기면 멈춘다.
export const name = '보조 항법 모드';

const PHONE = { width: 390, height: 844 };     // iPhone 14 세로
const TABLET = { width: 1400, height: 900 };

async function open(browser, url, viewport, init) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  // 자동 GPS 연결은 여기서 끈다 — 검사 환경엔 위치 권한이 없어 언제 거부 오류가
  // 돌아올지 알 수 없고, 그것이 gpsMode 를 뒤집으면 DR 검사가 흔들린다.
  // DR 은 GPS 가 붙은 직후와 같은 상태를 손으로 만들어 확인한다.
  await p.addInitScript(() => { try { localStorage.setItem('gpsDenied', '1'); } catch (e) {} });
  if (init) await p.addInitScript(init);
  await p.goto(url);
  await p.waitForFunction(() => typeof S === 'object' && typeof isPhoneLayout === 'function',
    null, { timeout: 20000 });
  // 시작 안내 창은 화면을 통째로 덮는다 — 열려 있으면 무엇을 눌러도
  // 그 창이 잡히고, elementFromPoint 도 지도 대신 창을 돌려준다.
  await p.evaluate(() => { const o = document.getElementById('help-overlay'); if (o) o.style.display = 'none'; });
  await p.waitForTimeout(700);
  return [ctx, p];
}

export async function run(page, t) {
  const browser = page.context().browser();
  const url = page.url();

  // ── ① 스마트폰: 한 화면(MAP) ──────────────────────────────────
  const [pctx, phone] = await open(browser, url, PHONE);
  const ph = await phone.evaluate(() => {
    const vis = id => {
      const e = document.getElementById(id);
      return !!e && e.getBoundingClientRect().height > 0;
    };
    return {
      phoneClass: document.body.classList.contains('phone-mode'),
      solo: _soloActive, cur: _soloCurrent,
      barShown: vis('phone-bar'),
      barH: Math.round(document.getElementById('phone-bar').getBoundingClientRect().height),
      tabH: Math.round(document.querySelector('#phone-bar [data-nav="map"]').getBoundingClientRect().height),
      activeTab: (document.querySelector('#phone-bar button.active') || {}).dataset?.nav,
      // 지도 창이 화면을 채우는가(옆에 다른 창이 남지 않는가)
      mapW: Math.round(document.getElementById('map-wrap').getBoundingClientRect().width),
      full: Math.round(window.innerWidth),
      // 하단 탭이 본문을 가리지 않는가
      appBottom: Math.round(document.getElementById('app').getBoundingClientRect().bottom),
      winH: Math.round(window.innerHeight),
    };
  });
  t.eq(ph.phoneClass, true, '폰 크기에서는 body.phone-mode 가 붙는다');
  t.eq(ph.solo, true, '분할이 아니라 한 화면으로 뜬다');
  t.eq(ph.cur, 'map', `첫 화면은 MAP 이다 (${ph.cur})`);
  t.eq(ph.barShown, true, '하단 탭바가 보인다');
  t.eq(ph.activeTab, 'map', `MAP 탭이 눌린 상태로 표시된다 (${ph.activeTab})`);
  t.ok(ph.tabH >= 44, `탭 하나가 손가락으로 누를 크기다 (${ph.tabH}px ≥ 44)`);
  t.ok(ph.mapW > ph.full * 0.95, `지도가 화면을 가득 채운다 (${ph.mapW}px / ${ph.full}px)`);
  t.ok(ph.appBottom <= ph.winH - ph.barH + 2,
    `본문이 하단 탭 위에서 끝난다 (본문 ${ph.appBottom}px · 화면 ${ph.winH}px · 탭 ${ph.barH}px)`);

  // 탭을 누르면 그 창으로 갈아 끼워진다 — 그리고 그 선택이 다음 실행까지 남는다
  const tap = await phone.evaluate(() => {
    document.querySelector('#phone-bar [data-nav="cdu"]').click();
    return { cur: _soloCurrent, saved: localStorage.getItem('phoneScreen'),
             cduW: Math.round(document.getElementById('cdu-wrap').getBoundingClientRect().width),
             active: (document.querySelector('#phone-bar button.active') || {}).dataset?.nav };
  });
  t.eq(tap.cur, 'cdu', 'CDU 탭을 누르면 CDU 로 바뀐다');
  t.eq(tap.active, 'cdu', '눌린 탭 표시도 따라온다');
  t.eq(tap.saved, 'cdu', '마지막으로 본 창을 기억한다');
  t.ok(tap.cduW > 0, `CDU 가 실제로 자리를 차지한다 (${tap.cduW}px)`);

  // 켤 때 설명 창이 첫 화면을 가리지 않는다 — 열자마자 위치가 보여야 한다.
  // 안내 자체는 CDU 설정에서 열 수 있으므로, 자동으로 뜨지 않는지만 본다.
  const help = await phone.evaluate(() => {
    const ov = document.getElementById('help-overlay');
    const shown = getComputedStyle(ov).display !== 'none';
    CDU_ACT.showHelpOverlay();                           // 설정에서 부르는 길
    const opened = getComputedStyle(ov).display !== 'none';
    closeHelp();
    return { shown, opened, closed: getComputedStyle(ov).display === 'none' };
  });
  t.eq(help.shown, false, '켜자마자 설명 창이 뜨지 않는다');
  t.eq(help.opened, true, '설정에서 부르면 그때는 열린다');
  t.eq(help.closed, true, '닫기로 닫힌다');

  // ── ② 조종 조작부가 화면에 없다 ────────────────────────────────
  // getBoundingClientRect 로 본다 — display:none 이면 0×0 이다.
  const hidden = await phone.evaluate(() => {
    const gone = id => {
      const e = document.getElementById(id);
      if (!e) return true;
      const r = e.getBoundingClientRect();
      return r.width === 0 && r.height === 0;
    };
    return {
      navaid: document.body.classList.contains('navaid'),
      // 조종·시뮬 전용
      spd: gone('spd-up'), vs: gone('vs-up'), alt: gone('alt-up'),
      hdg: gone('hdg-up'), wdir: gone('wdir-up'), fly: gone('map-fly-btn'),
      simspd: gone('simspd-4'), trim: gone('trim-group'), navap: gone('nav-ap-btn'),
      gs: gone('gs-btn'), hover: gone('hover-pos-btn'),
      // 항법용은 그대로 남아 있어야 한다(DOM 에 살아 있는지로 본다)
      crsAlive: !!document.getElementById('crs-up'),
      obsAlive: !!document.getElementById('obs-btn'),
      brgAlive: !!document.getElementById('brg1-tog'),
      rnpAlive: !!document.getElementById('rnp-1'),
      suspAlive: !!document.getElementById('susp-btn'),
    };
  });
  t.eq(hidden.navaid, true, '기본은 항법 보조 모드다 (body.navaid)');
  for (const [k, label] of [['spd', 'IAS'], ['vs', 'VS'], ['alt', 'ALT'],
                            ['hdg', 'HDG bug'], ['wdir', '시뮬 바람'], ['fly', 'FLY'],
                            ['simspd', '배속'], ['trim', '트림·페달'], ['navap', 'NAV 커플링'],
                            ['gs', 'G/S'], ['hover', 'HOVER']]) {
    t.eq(hidden[k], true, `${label} 조작부가 화면에 없다`);
  }
  t.eq(hidden.crsAlive && hidden.obsAlive && hidden.brgAlive && hidden.rnpAlive && hidden.suspAlive,
    true, '항법용(CRS·OBS·BRG·RNP·SUSP)은 그대로 남는다');

  // ?sim=1 로 열면 조작부가 다시 나온다(개발·회귀시험용 통로)
  const [sctx, sim] = await open(browser, url + '?sim=1', TABLET);
  const simOn = await sim.evaluate(() => ({
    navaid: document.body.classList.contains('navaid'),
    flyShown: document.getElementById('map-fly-btn').getBoundingClientRect().height > 0,
  }));
  t.eq(simOn.navaid, false, '?sim=1 이면 항법 모드 표시가 붙지 않는다');
  t.eq(simOn.flyShown, true, '그때는 FLY 등 조작부가 다시 나온다');
  await sctx.close();

  // ── ③ 태블릿은 종전대로 분할 ──────────────────────────────────
  const [tctx, tab] = await open(browser, url, TABLET);
  const tv = await tab.evaluate(() => ({
    phoneClass: document.body.classList.contains('phone-mode'),
    solo: _soloActive,
    triple: document.getElementById('app').classList.contains('triple'),
    barShown: document.getElementById('phone-bar').getBoundingClientRect().height > 0,
  }));
  t.eq(tv.phoneClass, false, '태블릿에서는 폰 모드가 아니다');
  t.eq(tv.solo, false, '한 화면으로 접지 않는다');
  t.eq(tv.triple, true, '종전대로 3분할로 뜬다');
  t.eq(tv.barShown, false, '폰 하단 탭은 나오지 않는다');
  await tctx.close();

  // ── ④ 추측항법(DR) ───────────────────────────────────────────
  // 실제 GPS 를 기다릴 수는 없으니, 05-gps.js 가 위치를 받은 직후와 같은 상태를
  // 손으로 만들어 놓고 시계만 앞으로 돌린다.
  const dr = await phone.evaluate(() => {
    const out = {};
    gpsMode = true;
    S.lat = 37.4000; S.lon = 126.6000; S.spd = 120; S.hdg = 90;
    lastGpsMs = Date.now();
    drReset();

    // 신호가 살아 있는 동안에는 손대지 않는다
    drTick();
    out.freshDr = drActive;
    out.freshLat = S.lat;

    // 9초 끊김 → DR 진입. drStep 은 시각을 인자로 받으므로 시계를 돌릴 수 있다.
    lastGpsMs = Date.now() - 9000;
    drTick();
    out.enteredDr = drActive;
    out.anchor = _drAnchor && { gs: _drAnchor.gs, trk: _drAnchor.trk };

    // 진입 직후 위치에서 정확히 1분을 더 흘린다 → 120kt 면 2NM
    const lat0 = S.lat, lon0 = S.lon;
    _drLastMs = Date.now();
    drStep(Date.now() + 60000);
    out.movedNM = distance(lat0, lon0, S.lat, S.lon);
    out.movedBrg = bearing(lat0, lon0, S.lat, S.lon);
    out.status = (document.getElementById('gps-status').innerHTML || '');

    // 5분을 넘기면 이어 그리기를 멈춘다
    lastGpsMs = Date.now() - 400000;
    drTick();
    const latLost = S.lat;
    drTick();
    out.lost = drLost;
    out.frozen = (S.lat === latLost);
    out.lostMsg = (document.getElementById('gps-status').innerHTML || '');

    // 새 측정값이 들어오면 즉시 걷힌다
    applyGPS({ coords: { latitude: 37.5, longitude: 126.7, speed: 50, heading: 180,
                         altitude: 300, accuracy: 8 }, timestamp: Date.now() });
    out.cleared = !drActive && !drLost;
    out.afterFixLat = S.lat;

    gpsMode = false; drReset();
    return out;
  });
  t.eq(dr.freshDr, false, '신호가 살아 있으면 DR 로 넘어가지 않는다');
  t.eq(dr.enteredDr, true, 'GPS 가 8초 넘게 끊기면 추측항법으로 넘어간다');
  t.eq(dr.anchor && dr.anchor.gs, 120, '끊긴 순간의 대지속도를 붙든다');
  t.eq(dr.anchor && dr.anchor.trk, 90, '끊긴 순간의 침로도 붙든다');
  t.ok(Math.abs(dr.movedNM - 2) < 0.02, `120kt 로 1분이면 2NM 나아간다 (${dr.movedNM.toFixed(3)}NM)`);
  t.ok(Math.abs(dr.movedBrg - 90) < 1, `나아간 방향이 침로와 같다 (${dr.movedBrg.toFixed(1)}°)`);
  t.ok(dr.status.includes('DR'), `화면에 추측항법임을 알린다 (${dr.status.slice(0, 40)})`);
  t.eq(dr.lost, true, '5분을 넘기면 위치 상실로 본다');
  t.eq(dr.frozen, true, '그 뒤로는 위치를 더 밀지 않는다');
  t.ok(dr.lostMsg.includes('위치 상실'), '화면에도 위치 상실을 알린다');
  t.eq(dr.cleared, true, '새 측정값이 들어오면 DR 이 걷힌다');
  t.ok(Math.abs(dr.afterFixLat - 37.5) < 1e-6, '그때 위치는 측정값을 따른다');

  // ── ⑤ 물리 키보드로도 조종되지 않는가 ─────────────────────────
  // 버튼만 내리고 키를 살려 두면 DeX·데스크톱에서 숫자 키가 계기를 움직인다.
  const keys = await phone.evaluate(() => {
    const hit = k => document.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    gpsMode = false; S.spd = 100; S.crs = 90; selAlt = 1000; obsOn = true; navSrc = 'FMS';
    hit('2');                       // IAS +1 — 조종이라 듣지 않아야 한다
    const spd = S.spd;
    hit('0');                       // ALT +10 — 마찬가지
    const alt = selAlt;
    hit('6');                       // CRS +1 — 코스 선택이라 그대로 듣는다
    const crs = S.crs;
    return { spd, alt, crs };
  });
  t.eq(keys.spd, 100, `IAS 키가 속도를 건드리지 않는다 (${keys.spd}kt)`);
  t.eq(keys.alt, 1000, `ALT 키도 마찬가지다 (${keys.alt}ft)`);
  t.eq(keys.crs, 91, `CRS 키는 항법용이라 그대로 듣는다 (${keys.crs}°)`);

  // ── ⑥ 없는 정보를 지어내지 않는가 ────────────────────────────
  // 자세 센서가 없으므로 인공수평선은 수평이어야 하고, 승강률은 실제 고도차에서
  // 나와야 한다(종전에는 속도에서 피치를 지어내 수평선을 기울였다).
  const inst = await phone.evaluate(() => {
    const fix = (altM, ms) => applyGPS({
      coords: { latitude: 37.4, longitude: 126.6, speed: 30, heading: 90,
                altitude: altM, accuracy: 5 }, timestamp: ms });
    gpsMode = true; S.vs = 0; _gpsPrev = null;
    const t0 = Date.now();
    fix(300, t0);                       // 첫 측정 — 견줄 이전 값이 없다
    const first = { pit: S.pit, bnk: S.bnk, vs: S.vs, alt: S.alt };
    fix(330, t0 + 60000);               // 1분 뒤 30m(≈98ft) 상승
    const climb = { pit: S.pit, vs: S.vs, alt: S.alt };
    gpsMode = false; drReset();
    return { first, climb };
  });
  t.eq(inst.first.pit, 0, '자세 센서가 없으므로 피치를 지어내지 않는다');
  t.eq(inst.first.bnk, 0, '뱅크도 마찬가지다');
  t.eq(inst.first.vs, 0, '첫 측정에서는 승강률을 낼 근거가 없다');
  t.ok(Math.abs(inst.first.alt - 984) < 2, `GPS 고도를 ft 로 읽는다 (${inst.first.alt}ft)`);
  t.ok(inst.climb.vs > 0, `고도가 오르면 승강률도 양수다 (${inst.climb.vs}fpm)`);
  t.ok(inst.climb.vs < 98, `한 번에 튀지 않게 눌러 읽는다 (${inst.climb.vs} < 98fpm)`);
  t.eq(inst.climb.pit, 0, '상승 중에도 인공수평선은 수평이다');

  // ── ⑥ 폰에서 계기가 눌리지 않는가 ────────────────────────────
  // PFD 는 (패널높이 − 조작부높이) 안에 그려진다. 조작부가 여러 줄로 쌓이면
  // 그만큼 계기가 작아진다 — 폰에서는 두 줄 안으로 접혀야 한다.
  // 앞에서 CDU 탭으로 옮겨 놨다. PFD 가 숨어 있으면 잰 값이 전부 0 이 되고,
  // 그러면 '두 줄 안이다' 같은 검사가 0 ≤ 2 로 공허하게 통과한다.
  await phone.evaluate(() => navGo('pfd'));
  await phone.waitForTimeout(400);
  const bar = await phone.evaluate(() => {
    const b = document.querySelector('.ctrl-bar');
    const r = b.getBoundingClientRect();
    // 눈에 보이는 줄 수 — 무리들의 세로 중심을 모아 띄엄띄엄한 덩어리를 센다.
    // 윗변으로 세면 안 된다: 가운데 정렬이라 같은 줄이어도 키가 다른 무리끼리
    // 윗변이 몇 px 씩 어긋나, 한 줄이 여러 줄로 잡힌다.
    const mids = [];
    b.querySelectorAll('.ctrl-group,.sw-group,.brg-tog-group,.nav-src-group,.susp-group')
      .forEach(e => { const q = e.getBoundingClientRect(); if (q.height > 0) mids.push(q.top + q.height / 2); });
    mids.sort((m, n) => m - n);
    const rows = mids.length
      ? 1 + mids.slice(1).filter((v, i) => v - mids[i] > 10).length
      : 0;
    const pw = document.getElementById('pfd-wrap').getBoundingClientRect();
    // 항법용 조작부는 그대로 눌러 쓸 수 있어야 한다(줄이느라 없애지 않았는가)
    const alive = ['crs-up', 'obs-btn', 'brg1-tog', 'ahrs-btn', 'rnp-1', 'susp-btn']
      .filter(id => { const e = document.getElementById(id); return e && e.getBoundingClientRect().height > 0; });
    // '두 줄' 은 버튼 줄 이야기다. 맨 윗줄(#pfd-info)은 읽기만 하는 글자판이라
    // 따로 뺀다 — 섞어 재면 글자 크기를 바꿀 때마다 이 검사가 흔들린다.
    const infoH = document.getElementById('pfd-info').getBoundingClientRect().height;
    return { h: Math.round(r.height - infoH), rows, alive: alive.length,
             usable: Math.round(pw.height - r.height), pfdH: Math.round(pw.height) };
  });
  t.ok(bar.rows >= 1 && bar.rows <= 2, `조작부가 두 줄 안으로 접힌다 (${bar.rows}줄)`);
  t.ok(bar.h > 20 && bar.h <= 90, `버튼 줄 높이가 90px 아래다 (${bar.h}px)`);
  t.eq(bar.alive, 6, '줄이면서 항법용 조작부를 잃지 않았다 (CRS·OBS·BRG1·AHRS·RNP·SUSP)');
  // 조작부 맨 윗줄(#pfd-info)이 계기 옆 글자판을 대신 짊어진다. NAV 소스 줄은
  // 비행 중 가장 자주 읽는 값이라 일부러 크게 뒀고(폰에서는 세 줄), 그만큼 자리를 쓴다.
  t.ok(bar.usable > bar.pfdH * 0.75,
    `계기가 패널의 75% 넘게 쓴다 (${bar.usable}px / ${bar.pfdH}px)`);

  // ── ⑦ 폰에서 계기 글씨가 커지는가 ────────────────────────────
  // 글꼴 지정이 예순 곳이 넘어 한자리에서 가로채 배율을 곱한다. 배율만 확인하면
  // 되는 게 아니라, 그 배율이 실제로 캔버스 문맥에 걸리는지까지 본다.
  const font = await phone.evaluate(() => {
    const before = pfdFontScale;
    const cv = document.getElementById('pfd').getContext('2d');
    setPfdFontScale(1.25);
    cv.font = 'bold 10px Helvetica Neue, Arial, sans-serif';
    const scaled = cv.font;
    setPfdFontScale(1);
    cv.font = 'bold 10px Helvetica Neue, Arial, sans-serif';
    const plain = cv.font;
    setPfdFontScale(before);
    return { before, scaled, plain };
  });
  t.ok(font.before > 1, `폰에서는 계기 글씨 배율이 걸린다 (×${font.before})`);
  t.ok(/12\.5px/.test(font.scaled), `배율이 실제 글꼴에 곱해진다 (${font.scaled})`);
  t.ok(/10px/.test(font.plain), `배율 1 이면 그대로다 (${font.plain})`);

  // ── ⑧ MAP 상단 버튼이 좌·우 라인 셀렉터로 서는가 ────────────
  // 한 줄에 열한 개를 밀어 넣으면 폰에서 버튼 하나가 30px 남짓이라 못 누른다.
  // 지도 양옆에 세로로 세우되, 지도를 덮어 끌기·확대를 먹지 않아야 한다.
  await phone.evaluate(() => navGo('map'));
  await phone.waitForTimeout(500);
  const lsk = await phone.evaluate(() => {
    const bar = document.getElementById('map-top-bar');
    const cols = {};
    let minW = 999;
    bar.querySelectorAll('button').forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.height === 0) return;                       // 폰에서 감춘 것(FULL)
      minW = Math.min(minW, r.width);
      const k = r.left < window.innerWidth / 2 ? 'L' : 'R';
      (cols[k] = cols[k] || []).push(b.id);
    });
    // 툴바가 지도를 먹지 않는가 — 컨테이너는 통과시키고 버튼만 받아야 한다
    const barPe = getComputedStyle(bar).pointerEvents;
    const btnPe = getComputedStyle(bar.querySelector('#gps-btn')).pointerEvents;
    // 두 칸 사이 가운데는 지도가 그대로 보여야 한다
    const mid = document.elementFromPoint(window.innerWidth / 2, 120);
    return { left: (cols.L || []).length, right: (cols.R || []).length,
             minW: Math.round(minW), barPe, btnPe,
             midIsMap: !!(mid && (mid.id === 'map' || mid.closest('#map'))) };
  });
  t.ok(lsk.left >= 3 && lsk.right >= 3,
    `버튼이 좌·우 두 칸으로 갈린다 (좌 ${lsk.left} · 우 ${lsk.right})`);
  t.ok(lsk.minW >= 44, `버튼 폭이 손가락으로 누를 크기다 (${lsk.minW}px)`);
  t.eq(lsk.barPe, 'none', '툴바 바탕은 지도 조작을 통과시킨다');
  t.eq(lsk.btnPe, 'auto', '버튼만 터치를 받는다');
  t.eq(lsk.midIsMap, true, '두 칸 사이 가운데는 지도가 그대로 보인다');

  // ── ⑨ 계기 글자판이 조작부로 옮겨졌는가 ──────────────────────
  await phone.evaluate(() => navGo('pfd'));
  await phone.waitForTimeout(500);
  const info = await phone.evaluate(() => {
    const air = document.getElementById('pi-air');
    const nav = document.getElementById('pi-nav');
    const px = el => parseFloat(getComputedStyle(el).fontSize);
    return { air: (air.textContent || ''), nav: (nav.textContent || ''),
             srcCount: nav.querySelectorAll('.pi-src').length,
             airPx: px(air.querySelector('b')), airLblPx: px(air.querySelector('i')),
             navPx: px(nav.querySelector('.pi-id')), brgPx: px(nav.querySelector('.pi-brg')),
             h: Math.round(document.getElementById('pfd-info').getBoundingClientRect().height) };
  });
  for (const k of ['TAS', 'GS', 'OAT', 'ISA']) {
    t.ok(info.air.includes(k), `조작부 윗줄에 ${k} 가 있다`);
  }
  t.eq(info.srcCount, 3, 'NAV 소스 세 가지(FMS·NAV1·NAV2)가 모두 있다');
  t.ok(/FMS/.test(info.nav) && /NAV1/.test(info.nav) && /NAV2/.test(info.nav),
    '세 소스의 이름이 다 보인다');
  t.ok(info.h > 10 && info.h < 170, `글자판이 지나치게 자라지 않았다 (${info.h}px)`);
  // 글자판의 값은 모두 같은 크기로 읽는다. 한 화면에 있는 값인데 하나만 작으면
  // 그것만 못 읽고 지나친다 — TAS·GS·OAT·ISA 를 NAV 줄의 방위 숫자에 맞춘다.
  t.eq(info.airPx, info.brgPx,
    `TAS·GS·OAT·ISA 가 방위 숫자와 같은 크기다 (${info.airPx}px vs ${info.brgPx}px)`);
  t.ok(info.airPx >= 18, `그 크기가 비행 중에 읽을 만하다 (${info.airPx}px)`);
  // 이름표는 값보다 작다. AHRS 버튼까지 한 줄에 세워야 해서 폭이 빠듯하다 —
  // 읽는 것은 값이므로 이름표를 먼저 줄인다.
  t.ok(info.airLblPx >= 12 && info.airLblPx < info.airPx,
    `이름표는 값보다 조금 작다 (${info.airLblPx}px vs ${info.airPx}px)`);

  // ── AHRS 버튼이 TAS 왼쪽에 있는가 ────────────────────────────
  // 자세를 잡는 버튼이라 계기를 보는 눈이 머무는 자리에 있어야 한다.
  // 조작부 구석(OBS 옆)에 있을 때는 손이 가지 않았다.
  const ahrsBtn = await phone.evaluate(() => {
    const b = document.getElementById('ahrs-btn');
    const tas = [...document.querySelectorAll('#pfd-info .pi i')].find(e => e.textContent === 'TAS');
    const a = b.getBoundingClientRect(), r = tas.getBoundingClientRect();
    const sel = document.querySelector('#pi-nav .pi-sel').getBoundingClientRect();
    // 글자판은 updatePfdInfo() 가 innerHTML 로 갈아 끼운다 — 버튼이 살아남아야 한다
    toggleAhrs(); _piLast = ''; updatePfdInfo();
    const after = document.getElementById('ahrs-btn');
    const lit = !!after && after.classList.contains('on');
    toggleAhrs();
    // 값 넉 줄이 한 줄에 서는가(줄이 넘어가면 계기가 그만큼 눌린다)
    const tops = new Set([...document.querySelectorAll('#pi-air ~ *, #pfd-info .pi:not(.pi-src)')]
      .map(e => Math.round(e.getBoundingClientRect().top)));
    return { inInfo: !!b.closest('#pfd-info'), inCtrl: !!b.closest('.ctrl-sub-row'),
             leftOfTas: a.right <= r.left + 1,
             sameRow: Math.abs((a.top + a.height / 2) - (r.top + r.height / 2)) < 12,
             w: Math.round(a.width), h: Math.round(a.height),
             biggerThanSel: a.height >= sel.height,
             alive: !!after, lit, airLines: tops.size };
  });
  t.eq(ahrsBtn.inInfo, true, 'AHRS 가 계기 글자판에 있다');
  t.eq(ahrsBtn.inCtrl, false, '조작부에서는 빠졌다');
  t.eq(ahrsBtn.leftOfTas, true, 'TAS 왼쪽에 선다');
  t.eq(ahrsBtn.sameRow, true, 'TAS 와 같은 줄이다');
  t.ok(ahrsBtn.h >= 28 && ahrsBtn.w >= 60,
    `한 손으로 누를 크기다 (${ahrsBtn.w}×${ahrsBtn.h}px)`);
  t.eq(ahrsBtn.biggerThanSel, true, 'NAV 소스 선택 버튼보다 작지 않다');
  t.eq(ahrsBtn.alive, true, '글자판을 다시 그려도 버튼이 살아남는다');
  t.eq(ahrsBtn.lit, true, '누르면 켜져 보인다');
  t.eq(ahrsBtn.airLines, 1, `AHRS 와 네 값이 한 줄에 선다 (${ahrsBtn.airLines}줄)`);

  // ── ⑩ CRHT 가 없어졌는가 · 갈색이 줄었는가 ───────────────────
  const crht = await phone.evaluate(() => {
    const dead = n => { try { return new Function('return typeof ' + n)() === 'undefined'; }
                        catch (e) { return true; } };
    // 계기 칸 나눔 — drawPFD 와 같은 셈
    const W = cvs.width, H = cvs.height;
    const usableH = H - document.querySelector('.ctrl-bar').offsetHeight;
    const tapW = Math.max(56 * pfdFontScale, Math.min(76 * pfdFontScale, W * 0.082));
    const vsiW = Math.max(28 * pfdFontScale, Math.min(38 * pfdFontScale, W * 0.046));
    const hsiR = (W - tapW * 2 - vsiW) * 0.44;
    const hsiH = Math.max(Math.round(usableH * 0.32),
                          Math.min(Math.round(usableH * 0.50), Math.round(hsiR * 2 + 56)));
    return { fn: dead('drawCrhtDisplay'), flag: dead('crhtOn'), sel: dead('selCrht'),
             toggle: dead('toggleCrht'),
             btn: !document.getElementById('crht-btn') && !document.getElementById('crht-up'),
             hsiH, aiH: usableH - hsiH, usableH };
  });
  t.eq(crht.fn, true, 'CRHT 표시를 그리는 함수가 없다');
  t.eq(crht.flag && crht.sel && crht.toggle, true, 'CRHT 상태값·토글도 남지 않았다');
  t.eq(crht.btn, true, 'CRHT 버튼도 마크업에 없다');
  t.ok(crht.hsiH < crht.aiH,
    `나침반 칸(갈색)이 자세계보다 좁다 (${crht.hsiH}px < ${crht.aiH}px)`);
  t.ok(crht.hsiH < crht.usableH * 0.42,
    `갈색이 계기의 42% 아래다 (${crht.hsiH}px / ${crht.usableH}px)`);

  // ── ⑪ 하위 창이 그 버튼에서 가지 치는가 ──────────────────────
  // 옛 가로 툴바 시절 좌표(top:44px·right:8px)에 못 박혀 있어, 라인 셀렉터로
  // 바꾼 뒤로는 창이 버튼 열을 그대로 덮었다. 이제 누른 버튼 옆에 붙는다.
  await phone.evaluate(() => navGo('map'));
  await phone.waitForTimeout(500);

  const panels = [['awy-panel', 'toggleAwyLayer'], ['fix-panel', 'toggleFixPanel'],
                  ['aspc-panel', 'toggleAspcPanel'], ['pp-menu', 'togglePpMenu'],
                  ['wx-panel', 'toggleWxPanel']];
  for (const [id, fn] of panels) {
    const r = await phone.evaluate(async ([pid, f]) => {
      new Function('return ' + f)()();                 // 버튼을 누른 것과 같다
      await new Promise(r2 => requestAnimationFrame(() => requestAnimationFrame(r2)));
      const W = document.getElementById('map-wrap').getBoundingClientRect();
      const el = document.getElementById(pid);
      const e = el.getBoundingClientRect();
      const btn = _mapPanelBtn(pid);
      const q = btn.getBoundingClientRect();
      const branch = el.dataset.branch;
      // 툴바 버튼을 하나라도 덮으면 안 된다 — 덮으면 그 버튼을 못 누른다
      const covered = [...document.querySelectorAll('#map-top-bar button')]
        .filter(x => { const b2 = x.getBoundingClientRect(); return b2.width &&
          !(b2.right <= e.left || b2.left >= e.right || b2.bottom <= e.top || b2.top >= e.bottom); })
        .map(x => x.id);
      return { open: isMapPanelOpen(pid), branch,
               gap: Math.round(branch === 'right' ? q.left - e.right : e.left - q.right),
               inside: e.left >= W.left - 1 && e.right <= W.right + 1
                    && e.top >= W.top - 1 && e.bottom <= W.bottom + 1,
               covered, lit: btn.classList.contains('branch-open'),
               // 버튼이 오른쪽 열이면 창도 오른쪽에서 왼쪽(안쪽)으로 펴야 한다
               rightCol: (q.left + q.width / 2 - W.left) > W.width / 2 };
    }, [id, fn]);
    t.eq(r.open, true, `${id} 이 열린다`);
    t.eq(r.branch, r.rightCol ? 'right' : 'left',
      `${id} 이 화면 안쪽으로 편다 (${r.branch})`);
    t.ok(Math.abs(r.gap - 14) <= 1, `${id} 이 버튼에서 줄기 하나 거리다 (${r.gap}px)`);
    t.eq(r.inside, true, `${id} 이 지도 밖으로 나가지 않는다`);
    t.eq(r.covered.length, 0,
      `${id} 이 툴바 버튼을 덮지 않는다${r.covered.length ? ' (' + r.covered.join(',') + ')' : ''}`);
    t.eq(r.lit, true, `${id} 을 연 버튼이 켜져 보인다`);
  }

  // 마지막에 연 것(wx-panel)만 남는가 — 같은 열에 둘이 겹치면 어느 버튼에서
  // 나온 창인지 알 수 없다
  const onlyOne = await phone.evaluate(() =>
    ['pp-menu','wx-panel','fix-panel','awy-panel','aspc-panel','geo-panel'].filter(isMapPanelOpen));
  t.eq(onlyOne.join(','), 'wx-panel', `한 번에 한 창만 열린다 (${onlyOne.join(',') || '없음'})`);

  // 같은 버튼을 한 번 더 누르면 닫히고, 붙였던 자리도 걷힌다
  const closed = await phone.evaluate(() => {
    toggleWxPanel();
    const el = document.getElementById('wx-panel');
    return { open: isMapPanelOpen('wx-panel'), branch: el.dataset.branch,
             left: el.style.left, lit: _mapPanelBtn('wx-panel').classList.contains('branch-open') };
  });
  t.eq(closed.open, false, '같은 버튼을 한 번 더 누르면 닫힌다');
  t.eq(closed.lit, false, '그때 버튼 불도 꺼진다');
  t.eq(closed.branch, undefined, '가지 표시도 걷힌다');
  t.eq(closed.left, '', '붙였던 자리도 되돌린다');

  // ── ⑫ 자세(AHRS) — 기기 기울기로 피치·롤을 보인다 ────────────
  // 자세 센서가 따로 없으니 기기 기울기를 쓴다. 거치 각도가 저마다 다르므로
  // "지금이 수평" 을 사용자가 정해 준다. 기준을 잡기 전에는 수평으로 둔다.
  const ahrs = await phone.evaluate(() => {
    const tilt = (beta, gamma) => _onDevOrientation({ beta, gamma, alpha: null, absolute: false });
    ahrsOn = false; ahrsRef = null; _devTilt = null; S.pit = 0; S.bnk = 0;
    tilt(20, 5);                            // 기울여도 아직 자세는 안 보인다
    const before = { pit: S.pit, bnk: S.bnk };
    toggleAhrs();                           // 이 자세가 수평이다
    const ref = ahrsRef && { p: Math.round(ahrsRef.pitch), r: Math.round(ahrsRef.roll) };
    const level = { pit: S.pit, bnk: S.bnk };
    tilt(30, 5);                            // 기준에서 10° 기수 들림
    const up = { pit: Math.round(S.pit), bnk: Math.round(S.bnk) };
    tilt(20, -10);                          // 기준에서 15° 좌 뱅크
    const left = { pit: Math.round(S.pit), bnk: Math.round(S.bnk) };
    tilt(200, 5);                           // 한계를 넘겨도 계기는 안 넘어간다
    const clamped = Math.round(S.pit);
    toggleAhrs();                           // 다시 누르면 끄고 수평으로 되돌린다
    const off = { on: ahrsOn, pit: S.pit, bnk: S.bnk };
    return { before, ref, level, up, left, clamped, off };
  });
  t.eq(ahrs.before.pit, 0, '기준을 잡기 전에는 자세를 보이지 않는다');
  t.eq(ahrs.ref && ahrs.ref.p, 20, `누른 순간의 기울기를 수평으로 삼는다 (${ahrs.ref && ahrs.ref.p}°)`);
  t.eq(ahrs.level.pit, 0, '기준을 잡은 그 자세가 수평이다');
  t.eq(ahrs.up.pit, 10, `기준보다 10° 들면 피치 10° 다 (${ahrs.up.pit}°)`);
  t.eq(ahrs.left.bnk, -15, `기준보다 15° 기울면 롤 −15° 다 (${ahrs.left.bnk}°)`);
  t.eq(ahrs.clamped, 30, `피치는 30° 에서 물린다 (${ahrs.clamped}°)`);
  t.eq(ahrs.off.on, false, '다시 누르면 꺼진다');
  t.eq(ahrs.off.pit === 0 && ahrs.off.bnk === 0, true, '끄면 계기가 수평으로 돌아간다');

  // 헤딩 기준은 20km/h — 그보다 느리면 나침반, 빠르면 항적
  const hdgRef = await phone.evaluate(() => ({ kmh: HDG_DEV_KMH, kt: HDG_DEV_KT }));
  t.eq(hdgRef.kmh, 20, `헤딩이 나침반으로 넘어가는 기준이 20km/h 다 (${hdgRef.kmh})`);
  t.ok(Math.abs(hdgRef.kt - 10.8) < 0.05, `kt 로는 약 10.8kt 다 (${hdgRef.kt.toFixed(2)})`);

  // ── ⑬ NAV 소스 — 줄 앞 버튼으로 고르고 래디얼까지 보인다 ─────
  const src = await phone.evaluate(() => {
    S.lat = 38.0; S.lon = 128.6; S.alt = 3000; S.awp = -1;
    setNavRadio('NAV1', '109.30', null);
    setNavSrc('FMS'); _piLast = ''; updatePfdInfo();
    const row = [...document.querySelectorAll('#pi-nav .pi-src')]
      .find(e => e.querySelector('.pi-sel').textContent === 'NAV1');
    const cells = [...row.children].map(e => e.className);
    const txt = [...row.children].map(e => e.textContent.trim());
    const before = navSrc;
    row.querySelector('.pi-sel').click();     // 줄 앞 버튼이 곧 소스 선택이다
    _piLast = ''; updatePfdInfo();
    const after = navSrc;
    const lit = [...document.querySelectorAll('#pi-nav .pi-sel.on')].map(e => e.textContent);
    return { cells, txt, before, after, lit,
             oldBtns: !document.getElementById('nav-fms') && !document.querySelector('.nav-src-btn') };
  });
  t.eq(src.cells.join(' '), 'pi-sel pi-id pi-brg pi-rad pi-dst',
    `이름·방위·래디얼·거리 순이다 (${src.cells.join(' ')})`);
  t.eq(src.oldBtns, true, '종전 NAV SRC 버튼은 없어졌다');
  t.eq(src.before, 'FMS', '누르기 전에는 FMS 였다');
  t.eq(src.after, 'NAV1', '줄 앞 버튼을 누르면 그 소스가 선택된다');
  t.eq(src.lit.join(','), 'NAV1', `선택된 줄만 켜져 보인다 (${src.lit.join(',')})`);
  t.ok(/^R\d{3}$/.test(src.txt[3]), `래디얼은 R 을 앞에 붙여 방위와 구분한다 (${src.txt[3]})`);
  // 래디얼은 그 지점에서 항공기를 본 방향 — 방위의 반대편이다
  const brgN = parseInt(src.txt[2], 10), radN = parseInt(src.txt[3].slice(1), 10);
  t.ok(Math.abs(((radN - brgN + 360) % 360) - 180) < 3,
    `래디얼이 방위의 반대편이다 (방위 ${brgN}° · 래디얼 ${radN}°)`);

  // ── ⑭ #1BDP·#2BDP 가 지도 버튼으로 옮겨졌는가 ────────────────
  await phone.evaluate(() => navGo('map'));
  await phone.waitForTimeout(400);
  const bdp = await phone.evaluate(() => {
    const inMap = id => !!document.querySelector('#map-top-bar #' + id);
    const cols = sel => { const L = [], R = []; document.querySelectorAll(sel + ' button').forEach(x => {
      const r = x.getBoundingClientRect(); if (!r.width) return;
      (r.left + r.width / 2 < window.innerWidth / 2 ? L : R).push(x.id); }); return [L.length, R.length]; };
    return { bdp1: inMap('brg1-bdp'), bdp2: inMap('brg2-bdp'),
             top: cols('#map-top-bar'), bottom: cols('#map-sim-bar'),
             coordPx: parseFloat(getComputedStyle(document.getElementById('center-coord')).fontSize),
             gpsPx: parseFloat(getComputedStyle(document.getElementById('gps-status')).fontSize),
             simPe: getComputedStyle(document.getElementById('map-sim-bar')).pointerEvents };
  });
  t.eq(bdp.bdp1 && bdp.bdp2, true, '#1BDP·#2BDP 가 지도 버튼으로 옮겨졌다');
  t.ok(Math.abs(bdp.top[0] - bdp.top[1]) <= 1,
    `위쪽 버튼이 좌·우로 고르게 갈린다 (${bdp.top.join(':')})`);
  t.ok(bdp.bottom[0] >= 4 && bdp.bottom[1] >= 4 && Math.abs(bdp.bottom[0] - bdp.bottom[1]) <= 1,
    `아래쪽 버튼도 좌·우로 갈린다 (${bdp.bottom.join(':')})`);

  // ── ⑮ 칸은 좌·우 둘뿐이고, 아래 버튼이 위 칸에 이어진다 ──────
  // 버튼이 하나 늘면 세 칸으로 갈리고 align-content 가 가운데 칸을 화면
  // 한복판에 세운다 — 넓은 화면에서 실제로 그랬다. 버튼 수를 세어 칸 높이를
  // 맞추므로(layoutMapLsk), 어느 폭에서든 x 자리는 딱 둘이어야 한다.
  for (const vp of [{ width: 390, height: 844 }, { width: 1180, height: 820 }]) {
    await phone.setViewportSize(vp);
    await phone.waitForTimeout(500);
    await phone.evaluate(() => { if (!_soloActive) enterSolo('map'); else setSolo('map'); });
    await phone.waitForTimeout(500);
    const r = await phone.evaluate(() => {
      const W = document.getElementById('map-wrap').getBoundingClientRect();
      const xs = new Set();
      document.querySelectorAll('#map-top-bar button, #map-sim-bar .sim-btn').forEach(x => {
        const q = x.getBoundingClientRect();
        if (q.width) xs.add(Math.round(q.left - W.left));
      });
      const top = document.getElementById('map-top-bar').getBoundingClientRect();
      const bot = document.getElementById('map-sim-bar').getBoundingClientRect();
      const h = parseFloat(getComputedStyle(document.querySelector('#map-top-bar button')).height);
      return { xs: [...xs].sort((a, b) => a - b),
               // 아래 툴바가 위 툴바 바로 밑에 이어지는가(화면 아래에 따로 떨어져 있지 않은가)
               follows: bot.top >= top.bottom - 1 && bot.top - top.bottom < 40,
               btnH: Math.round(h) };
    });
    const w = vp.width;
    t.eq(r.xs.length, 2, `${w}px 폭에서 칸이 좌·우 둘뿐이다 (x ${r.xs.join(',')})`);
    t.eq(r.follows, true, `${w}px 폭에서 아래 버튼이 위 칸에 이어진다`);
    // 세로가 모자라면 버튼을 낮춰서라도 두 칸을 지킨다(26px 아래로는 안 내린다)
    t.ok(r.btnH >= 26 && r.btnH <= 34, `${w}px 폭에서 버튼 높이가 26~34px 다 (${r.btnH}px)`);
  }
  await phone.setViewportSize(PHONE);
  await phone.waitForTimeout(500);

  await pctx.close();
}
