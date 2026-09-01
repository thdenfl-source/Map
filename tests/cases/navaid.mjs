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
      spd: gone('spd-up'), vs: gone('vs-up'), alt: gone('alt-up'), crht: gone('crht-up'),
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
  for (const [k, label] of [['spd', 'IAS'], ['vs', 'VS'], ['alt', 'ALT'], ['crht', 'CRHT'],
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
    const alive = ['crs-up', 'obs-btn', 'brg1-tog', 'nav-fms', 'rnp-1', 'susp-btn']
      .filter(id => { const e = document.getElementById(id); return e && e.getBoundingClientRect().height > 0; });
    return { h: Math.round(r.height), rows, alive: alive.length,
             usable: Math.round(pw.height - r.height), pfdH: Math.round(pw.height) };
  });
  t.ok(bar.rows >= 1 && bar.rows <= 2, `조작부가 두 줄 안으로 접힌다 (${bar.rows}줄)`);
  t.ok(bar.h > 20 && bar.h <= 90, `조작부 높이가 90px 아래다 (${bar.h}px)`);
  t.eq(bar.alive, 6, '줄이면서 항법용 조작부를 잃지 않았다 (CRS·OBS·BRG1·FMS·RNP·SUSP)');
  t.ok(bar.usable > bar.pfdH * 0.9,
    `계기가 패널의 90% 넘게 쓴다 (${bar.usable}px / ${bar.pfdH}px)`);

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

  await pctx.close();
}
