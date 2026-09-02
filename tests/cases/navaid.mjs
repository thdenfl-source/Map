// 보조 항법장치 모드 — 이 앱의 성격이 실제로 화면에 나오는가
//
// 세 가지를 본다.
//   ① 열면 한 화면(MAP) + 상단 탭이 뜬다. 분할은 없다 — 어느 폭에서든 한 창이다.
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
  await p.waitForFunction(() => typeof S === 'object' && typeof navGo === 'function',
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
      // 탭바가 맨 위에 있고, 본문이 그 바로 아래에서 화면 끝까지 차는가.
      // 어긋나면 사이에 검은 띠가 남거나 아래가 잘린다 — 기기 세로 길이마다
      // 다르게 보이던 문제가 여기였다.
      barTop: Math.round(document.getElementById('phone-bar').getBoundingClientRect().top),
      appTop: Math.round(document.getElementById('app').getBoundingClientRect().top),
      barBottom: Math.round(document.getElementById('phone-bar').getBoundingClientRect().bottom),
      appBottom: Math.round(document.getElementById('app').getBoundingClientRect().bottom),
      winH: Math.round(window.innerHeight),
      reload: !!document.getElementById('phone-reload-btn'),
    };
  });
  t.eq(ph.phoneClass, true, '폰 크기에서는 body.phone-mode 가 붙는다');
  t.eq(ph.solo, true, '한 화면으로 뜬다');
  t.eq(ph.cur, 'map', `첫 화면은 MAP 이다 (${ph.cur})`);
  t.eq(ph.barShown, true, '탭바가 보인다');
  t.eq(ph.activeTab, 'map', `MAP 탭이 눌린 상태로 표시된다 (${ph.activeTab})`);
  t.ok(ph.tabH >= 44, `탭 하나가 손가락으로 누를 크기다 (${ph.tabH}px ≥ 44)`);
  t.ok(ph.mapW > ph.full * 0.95, `지도가 화면을 가득 채운다 (${ph.mapW}px / ${ph.full}px)`);
  t.eq(ph.barTop, 0, `탭바가 화면 맨 위에 있다 (top ${ph.barTop}px)`);
  t.ok(Math.abs(ph.appTop - ph.barBottom) <= 1,
    `본문이 탭바 바로 아래에서 시작한다 (탭 아래 ${ph.barBottom}px · 본문 위 ${ph.appTop}px)`);
  t.ok(Math.abs(ph.appBottom - ph.winH) <= 1,
    `본문이 화면 아래 끝까지 찬다 (본문 ${ph.appBottom}px · 화면 ${ph.winH}px)`);
  t.eq(ph.reload, true, '탭바에 새로고침 버튼이 있다');

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

  // ── ③ 넓게 열어도 한 화면이다 ────────────────────────────────
  // 이 앱은 폰·패드를 세로로 들고 쓰는 물건이다. PC 에서 열어도 분할하지 않는다 —
  // 창을 나누면 계기가 그만큼 작아지고, 작아진 계기는 읽히지 않는다.
  const [tctx, tab] = await open(browser, url, TABLET);
  const tv = await tab.evaluate(() => ({
    solo: _soloActive,
    cur: _soloCurrent,
    barShown: document.getElementById('phone-bar').getBoundingClientRect().height > 0,
    // 분할에 쓰던 것들이 남아 있지 않은가
    gone: !document.getElementById('mid-panel') && !document.getElementById('panel-divider')
       && !document.getElementById('split-toggle') && !document.getElementById('solo-bar')
       && !document.getElementById('map-full-btn')
       // 패널마다 붙어 있던 창 전환 탭바도 분할의 물건이다 — 상단 탭 하나로 갈음한다
       && !document.getElementById('left-tabs') && !document.getElementById('page-tabs')
       && !document.querySelector('.page-tab'),
    noFn: ['toggleTriple', 'exitSolo', 'enterSolo', 'panelSolo', 'navToggleSplit']
      .filter(n => { try { return new Function('return typeof ' + n)() !== 'undefined'; }
                     catch (e) { return false; } }),
    // 한 번에 한 창만 보인다
    shown: ['pfd-wrap', 'map-wrap', 'cdu-wrap']
      .filter(id => { const e = document.getElementById(id);
                      return e && e.getBoundingClientRect().width > 0; }),
  }));
  t.eq(tv.solo, true, '넓은 화면에서도 한 창이다');
  t.eq(tv.barShown, true, '상단 탭바로 창을 고른다');
  t.eq(tv.gone, true, '분할에 쓰던 요소(가운데 창·경계선·분할 버튼)가 없다');
  t.eq(tv.noFn.length, 0,
    `분할 함수도 남지 않았다${tv.noFn.length ? ' (' + tv.noFn.join(',') + ')' : ''}`);
  t.eq(tv.shown.length, 1, `한 번에 한 창만 보인다 (${tv.shown.join(',') || '없음'})`);
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
    // (AHRS 는 맨 위 탭바로 옮겼다 — #phone-ahrs-btn)
    const alive = ['crs-up', 'obs-btn', 'brg1-tog', 'phone-ahrs-btn', 'rnp-1', 'susp-btn']
      .filter(id => { const e = document.getElementById(id); return e && e.getBoundingClientRect().height > 0; });
    return { h: Math.round(r.height), rows, alive: alive.length,
             usable: Math.round(pw.height - r.height), pfdH: Math.round(pw.height) };
  });
  t.ok(bar.rows >= 1 && bar.rows <= 2, `조작부가 두 줄 안으로 접힌다 (${bar.rows}줄)`);
  t.ok(bar.h > 20 && bar.h <= 90, `버튼 줄 높이가 90px 아래다 (${bar.h}px)`);
  t.eq(bar.alive, 6, '줄이면서 항법용 조작부를 잃지 않았다 (CRS·OBS·BRG1·AHRS·RNP·SUSP)');
  // 조작부는 두 줄만 남았다 — NAV 소스 버튼 줄까지 나침반 모서리로 갔다.
  // 그만큼 계기가 넓게 쓴다.
  t.ok(bar.usable > bar.pfdH * 0.80,
    `계기가 패널의 80% 넘게 쓴다 (${bar.usable}px / ${bar.pfdH}px)`);

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

  // ── ⑦-2 기기 세로 길이가 달라도 화면이 꽉 차는가 ────────────
  // html·body 를 height:100% 로 두면 모바일 브라우저의 주소창이 접혔다 펴질
  // 때마다 기준이 흔들려, 처음 켤 때 화면이 다 차지 않았다. 실제로 보이는
  // 높이를 재서 넣는다(fitAppViewport) — 그러니 어느 세로 길이에서도 맞아야 한다.
  for (const vp of [{ width: 360, height: 640 }, { width: 414, height: 896 },
                    { width: 375, height: 667 }, { width: 390, height: 844 }]) {
    await phone.setViewportSize(vp);
    await phone.waitForTimeout(450);
    const f = await phone.evaluate(() => {
      const bar = document.getElementById('phone-bar').getBoundingClientRect();
      const app = document.getElementById('app').getBoundingClientRect();
      const pw  = document.getElementById('pfd-wrap').getBoundingClientRect();
      const cv  = document.getElementById('pfd');
      return { gap: Math.round(app.top - bar.bottom),
               tail: Math.round(window.innerHeight - app.bottom),
               canvasFits: pw.height > 0 ? cv.height === Math.round(pw.height) : true };
    });
    const L = vp.width + '×' + vp.height;
    t.ok(Math.abs(f.gap) <= 1, `${L} — 탭바와 본문 사이에 빈틈이 없다 (${f.gap}px)`);
    t.ok(Math.abs(f.tail) <= 1, `${L} — 아래에 남는 띠가 없다 (${f.tail}px)`);
    t.eq(f.canvasFits, true, `${L} — 계기 캔버스가 자기 창 크기와 맞는다`);
  }

  // ── ⑦-3 태블릿도 한 화면으로 ─────────────────────────────────
  // 아이패드를 세로로 들면 폭이 768~834px 다. 여기에 창을 둘·셋 세우면 계기가
  // 손바닥만 해진다. 이 앱은 세로로 들고 쓰는 물건이라 분할 자체를 두지 않는다 —
  // 가로로 눕혀도, PC 로 열어도 한 화면이다.
  for (const [label, vp, exactRows] of [
        ['아이패드 세로', { width: 810, height: 1080 }, 2],
        ['아이패드 가로', { width: 1080, height: 810 }, 0]]) {
    await phone.setViewportSize(vp);
    await phone.waitForTimeout(500);
    const r = await phone.evaluate(() => {
      // 조작부가 몇 줄인가 — 무리들의 세로 중심을 모아 띄엄띄엄한 덩어리를 센다
      const mids = [];
      document.querySelectorAll('.ctrl-bar .ctrl-group,.ctrl-bar .sw-group,' +
        '.ctrl-bar .brg-tog-group,.ctrl-bar .nav-src-group,.ctrl-bar .susp-group')
        .forEach(e => { const q = e.getBoundingClientRect(); if (q.height > 0) mids.push(q.top + q.height / 2); });
      mids.sort((a, b) => a - b);
      const rows = mids.length ? 1 + mids.slice(1).filter((v, i) => v - mids[i] > 10).length : 0;
      const labels = [...document.querySelectorAll('.ctrl-bar .ctrl-lbl')]
        .filter(e => e.getBoundingClientRect().height > 0).map(e => e.textContent.trim());
      return { phone: document.body.classList.contains('phone-mode'), solo: _soloActive,
               bar: document.getElementById('phone-bar').getBoundingClientRect().height > 0,
               rows, labels, susp: document.getElementById('susp-btn').textContent.trim() };
    });
    t.eq(r.phone, true, `${label} — 한 화면으로 본다`);
    t.eq(r.solo, true, `${label} — solo true`);
    t.eq(r.bar, true, `${label} — 상단 탭바가 뜬다`);
    // 앞줄(CRS·OBS·BRG·SUSP)과 뒷줄(시계·RNP). 한 번 맞춰 두고 잘 안 건드리는
    // 것을 뒷줄로 내렸다. 가로로 눕히면 폭이 남아 한 줄로 붙을 수도 있다.
    if (exactRows) t.eq(r.rows, exactRows, `${label} — 조작부가 ${exactRows}줄이다 (${r.rows}줄)`);
    else t.ok(r.rows >= 1 && r.rows <= 2, `${label} — 조작부가 두 줄을 넘지 않는다 (${r.rows}줄)`);
    // 이름표는 내렸다. RNP 만 남는다 — 버튼이 '4 2 1 0.3' 이라 없으면 못 읽는다.
    t.eq(r.labels.filter(x => ['AP', 'BRG', 'SUSP', 'NAV SRC'].includes(x)).length, 0,
      `${label} — 겹치는 이름표를 내렸다 (${r.labels.join(',')})`);
    t.ok(r.labels.includes('RNP'), `${label} — RNP 이름표는 남는다`);
    t.eq(r.susp, 'SUSP', `${label} — SUSP 버튼 글자가 'SUSP' 다 (${r.susp})`);
  }
  await phone.setViewportSize(PHONE);
  await phone.waitForTimeout(500);

  // ── ⑦-4 PFD 아래가 왼쪽 선에 맞고, 시계·RNP 가 맨 아랫줄인가 ──
  // 가운데 정렬이면 줄마다 시작점이 달라 눈이 매번 그 줄의 왼쪽 끝을 찾아야
  // 한다. 그리고 자주 만지는 것(CRS·OBS·BRG·SUSP)이 앞줄, 한 번 맞춰 두는
  // 것(시계·RNP)이 뒷줄이어야 손이 덜 간다.
  for (const vp of [{ width: 810, height: 1080 }, { width: 390, height: 844 }]) {
    await phone.setViewportSize(vp);
    await phone.waitForTimeout(500);
    const a = await phone.evaluate(() => {
      const bar = document.querySelector('.ctrl-bar').getBoundingClientRect();
      const box = sel => { const e = document.querySelector(sel); if (!e) return null;
        const q = e.getBoundingClientRect(); return { l: q.left - bar.left, t: q.top - bar.top, h: q.height }; };
      const px = sel => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
      return { crs: box('.ctrl-group'), sw: box('.sw-group'), rnp: box('.nav-src-group'),
               brg: box('.brg-tog-group'), susp: box('.susp-group'),
               // 기준은 OBS 버튼이다 — 조작부에서 가장 오래 규격이 안 바뀐 버튼.
               // (종전 기준이던 NAV 소스 버튼은 나침반 모서리로 갔다)
               selH: Math.round(document.getElementById('obs-btn').getBoundingClientRect().height),
               obsH: Math.round(document.getElementById('obs-btn').getBoundingClientRect().height),
               selFs: px('#obs-btn'), obsFs: px('#obs-btn'),
               suspFs: px('#susp-btn'), rnpFs: px('#rnp-1'),
               // 한 줄에 나란히 서는 것들의 높이 — 하나라도 다르면 줄이 들쭉날쭉해진다.
               // SUSP 는 '자동' 이 붙은 모습으로도 재 본다(홀딩·미스드어프로치에서 그렇게 뜬다).
               btnHs: (() => {
                 const b = document.getElementById('susp-btn');
                 const was = b.innerHTML;
                 b.innerHTML = 'SUSP<span class="susp-auto">자동</span>';
                 const suspAuto = Math.round(b.getBoundingClientRect().height);
                 b.innerHTML = was;
                 const one = sel => Math.round(document.querySelector(sel).getBoundingClientRect().height);
                 return { crsLbl: one('#crs-lbl-btn'), crsUp: one('#crs-up'),
                          obs: one('#obs-btn'), brg: one('#brg1-tog'),
                          susp: one('#susp-btn'), suspAuto, rnp: one('#rnp-1') };
               })(),
               // 글꼴·크기·굵기도 하나로 — 기준은 OBS 버튼이다.
               // (AHRS 는 맨 위 탭바, NAV 소스는 나침반 모서리로 갔다)
               fonts: (() => {
                 const f = e => { const c = getComputedStyle(e);
                   return [c.fontFamily, c.fontSize, c.fontWeight].join(' / '); };
                 const out = { 기준: f(document.getElementById('obs-btn')) };
                 for (const [k, sel] of [
                       ['CRS', '#crs-lbl-btn'], ['◄', '#crs-dn'],
                       ['OBS', '#obs-btn'], ['BRG1', '#brg1-tog'], ['SUSP', '#susp-btn'],
                       ['시계', '#sw-display'], ['STOP WATCH', '#sw-btns-clock .sw-btn'],
                       ['RNP', '#rnp-1']]) {
                   const e = document.querySelector(sel);
                   if (e) out[k] = f(e);
                 }
                 return out;
               })() };
    });
    const L = vp.width + '×' + vp.height;
    // 왼쪽 선 — 조작부 첫 무리가 왼쪽 끝에서 시작한다
    t.ok(a.crs.l <= 12, `${L} — 조작부가 왼쪽에 붙는다 (${Math.round(a.crs.l)}px)`);
    // 크기 — 기준(OBS)과 같은 규격
    t.eq(a.suspFs, a.selFs, `${L} — SUSP 도 같다 (${a.suspFs})`);
    t.eq(a.rnpFs, a.selFs, `${L} — RNP 도 같다 (${a.rnpFs})`);
    // 높이도 하나로 — CRS 의 ◄► 는 이웃보다 솟았고 CRS 이름표는 주저앉았으며,
    // SUSP 는 '자동' 이 붙으면 두 줄이 되어 혼자 커졌다. 전부 한 규격에 맞춘다.
    const hs = Object.entries(a.btnHs).filter(([, h]) => h !== a.selH);
    t.eq(hs.length, 0,
      `${L} — 조작부 버튼 높이가 모두 ${a.selH}px 로 같다` +
      (hs.length ? ' (' + hs.map(([k, h]) => `${k}=${h}`).join(', ') + ')' : ''));
    // 글꼴·크기·굵기도 하나여야 한다. 저마다이면 어느 것이 눌린 버튼인지
    // 색보다 굵기로 먼저 읽히는 착시가 생긴다 — CRS 만 13px 보통 글씨였고,
    // BRG·RNP·STOP WATCH 도 보통 글씨, 시계는 글꼴마저 달랐다.
    const ref = a.fonts['기준'];
    const odd = Object.entries(a.fonts).filter(([k, v]) => k !== '기준' && v !== ref);
    t.eq(odd.length, 0,
      `${L} — 조작부 글씨가 하나로 맞아 있다 (${ref})` +
      (odd.length ? ' — 다른 것: ' + odd.map(([k, v]) => `${k}=${v}`).join(' · ') : ''));
    t.ok(/(^|[^\d])(700|bold)([^\d]|$)/.test(ref), `${L} — 그 글씨가 볼드체다 (${ref})`);
    // 시계·RNP 는 맨 아래 — 앞줄(CRS·BRG·SUSP)보다 아래에 있어야 한다
    const front = Math.max(a.crs.t, a.brg.t, a.susp.t);
    t.ok(a.sw.t > front, `${L} — 시계가 앞줄보다 아래다 (시계 ${Math.round(a.sw.t)} > 앞줄 ${Math.round(front)})`);
    t.ok(a.rnp.t > front, `${L} — RNP 도 앞줄보다 아래다 (${Math.round(a.rnp.t)})`);
  }
  await phone.setViewportSize(PHONE);
  await phone.waitForTimeout(500);

  // ── ⑧ MAP 버튼이 왼쪽 한 줄로 서는가 ────────────────────────
  // 한 줄에 열한 개를 가로로 밀어 넣던 것을 좌·우 두 칸으로 갈랐다가, 이제
  // 왼쪽 한 줄로 모았다. 두 칸은 눈이 좌우를 오가야 했고 오른쪽 칸은 지도를
  // 끌 때 손에 걸렸다. 세로가 모자라면 버튼을 낮추는 대신 줄을 굴려 본다.
  await phone.evaluate(() => navGo('map'));
  await phone.waitForTimeout(500);
  const lsk = await phone.evaluate(() => {
    const rail = document.getElementById('map-lsk');
    const R = rail.getBoundingClientRect();
    const W = document.getElementById('map-wrap').getBoundingClientRect();
    const xs = new Set();
    let minW = 999, minH = 999, minFs = 999, n = 0, overflow = false;
    rail.querySelectorAll('button').forEach(b => {
      const q = b.getBoundingClientRect();
      if (!q.width) return;                        // 감춘 것(시뮬 전용 FLY 등)
      n++; minW = Math.min(minW, q.width); minH = Math.min(minH, q.height);
      minFs = Math.min(minFs, parseFloat(getComputedStyle(b).fontSize));
      if (b.scrollWidth > b.clientWidth + 0.5) overflow = true;
      xs.add(Math.round(q.left - W.left));
    });
    // 줄 오른쪽은 지도가 그대로 보이고 만져진다
    const mid = document.elementFromPoint(W.left + W.width / 2, W.top + 120);
    const st = getComputedStyle(rail);
    return { xs: [...xs], n, minW: Math.round(minW), minH: Math.round(minH),
             minFs, overflow,
             railW: Math.round(R.width), wrapW: Math.round(W.width),
             overflowY: st.overflowY, overscroll: st.overscrollBehaviorY,
             inside: R.top >= W.top - 1 && R.bottom <= W.bottom + 1,
             midIsMap: !!(mid && (mid.id === 'map' || mid.closest('#map'))) };
  });
  t.eq(lsk.xs.length, 1, `버튼이 한 줄로 선다 (x ${lsk.xs.join(',')})`);
  t.ok(lsk.xs[0] <= 12, `그 줄이 왼쪽 끝에 붙는다 (${lsk.xs[0]}px)`);
  t.ok(lsk.n >= 14, `버튼을 줄이지 않았다 (${lsk.n}개)`);
  // 종전 54×34px·글씨 10px 에서 1.5 배로 키웠다 — 흔들리는 기내에서 장갑 낀
  // 손으로도 누를 크기다. (두 배도 해 봤는데 지도를 너무 가렸다)
  // 그만큼 지도를 가리므로 접기·펼치기를 함께 두었다.
  t.ok(lsk.minW >= 81 && lsk.minH >= 51,
    `버튼이 종전의 1.5 배다 (${lsk.minW}×${lsk.minH}px)`);
  t.ok(lsk.minFs >= 15, `글씨도 1.5 배다 (${lsk.minFs}px)`);
  t.eq(lsk.overflow, false, '키운 글씨가 버튼을 넘치지 않는다');
  t.ok(lsk.railW <= lsk.wrapW * 0.25,
    `줄이 지도의 한 귀퉁이만 쓴다 (${lsk.railW}px / ${lsk.wrapW}px)`);
  t.eq(lsk.midIsMap, true, '줄 오른쪽은 지도가 그대로 보인다');
  t.eq(lsk.inside, true, '줄이 지도 밖으로 나가지 않는다');
  t.eq(lsk.overflowY, 'auto', '넘치면 굴려 볼 수 있다');
  t.eq(lsk.overscroll, 'contain',
    '줄 끝까지 굴려도 그 힘이 지도로 넘어가지 않는다');

  // 세로가 모자란 화면에서 실제로 굴러가는가 — 버튼을 감추거나 낮추지 않는다
  await phone.setViewportSize({ width: 412, height: 620 });
  await phone.waitForTimeout(500);
  const roll = await phone.evaluate(() => {
    const rail = document.getElementById('map-lsk');
    const before = [...rail.querySelectorAll('button')]
      .filter(b => b.getBoundingClientRect().width).length;
    const h = Math.round(rail.querySelector('button').getBoundingClientRect().height);
    rail.scrollTop = 9999;
    const last = rail.querySelector('#rec-btn').getBoundingClientRect();
    const R = rail.getBoundingClientRect();
    const tg = rail.querySelector('#map-lsk-toggle').getBoundingClientRect();
    return { over: rail.scrollHeight > rail.clientHeight + 1,
             moved: rail.scrollTop > 0, n: before, btnH: h,
             toggleSeen: tg.top >= R.top - 1 && tg.bottom <= R.bottom + 1,
             lastSeen: last.bottom <= R.bottom + 1 && last.top >= R.top - 1 };
  });
  t.eq(roll.over, true, '세로가 모자라면 줄이 화면을 넘는다');
  t.eq(roll.moved, true, '그때 줄이 굴러간다');
  t.eq(roll.lastSeen, true, '굴리면 맨 아래 버튼(REC)까지 보인다');
  t.eq(roll.btnH, 51, `버튼 높이는 어느 화면에서나 같다 (${roll.btnH}px)`);
  t.ok(roll.n >= 14, `굴리는 대신 버튼을 감추지 않는다 (${roll.n}개)`);
  // 접기 버튼은 줄을 굴려 내려도 맨 위에 붙어 있는다(sticky) —
  // 굴린 채로는 접을 수 없다면 있으나 마나다.
  t.eq(roll.toggleSeen, true, '줄을 끝까지 굴려도 접기 버튼이 맨 위에 남는다');

  // ── ⑧-2 접기·펼치기 ─────────────────────────────────────────
  // 버튼을 두 배로 키운 뒤로 줄이 지도 왼쪽을 넉넉히 가린다. 지형을 볼
  // 때는 걷어내고, 만질 때만 편다.
  const fold = await phone.evaluate(async () => {
    const rail = document.getElementById('map-lsk');
    const btn  = document.getElementById('map-lsk-toggle');
    const W = document.getElementById('map-wrap').getBoundingClientRect();
    const vis = () => [...rail.querySelectorAll('button')]
      .filter(b => b.getBoundingClientRect().width > 0).map(b => b.textContent.trim());
    const openTxt = btn.textContent.trim(), openN = vis().length;
    // 하위 창을 하나 열어 둔다 — 접으면 함께 닫혀야 한다(가지 뻗을 버튼이 사라진다)
    toggleFixPanel();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const panelWasOpen = isMapPanelOpen('fix-panel');
    btn.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const R = rail.getBoundingClientRect();
    const mid = document.elementFromPoint(W.left + 30, W.top + W.height / 2);
    const shut = { txt: btn.textContent.trim(), vis: vis(),
                   railH: Math.round(R.height),
                   panelOpen: isMapPanelOpen('fix-panel'),
                   leftIsMap: !!(mid && (mid.id === 'map' || mid.closest('#map'))) };
    // 다시 펴면 그대로 돌아온다
    btn.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const back = { txt: btn.textContent.trim(), n: vis().length };
    return { openTxt, openN, panelWasOpen, shut, back };
  });
  t.eq(fold.openTxt, '접기', `펴 있을 때는 '접기' 라 적힌다 (${fold.openTxt})`);
  t.eq(fold.panelWasOpen, true, '접기 전에 하위 창(FIX)이 열려 있었다');
  t.eq(fold.shut.txt, '펼치기', `접으면 '펼치기' 로 바뀐다 (${fold.shut.txt})`);
  t.eq(fold.shut.vis.join(','), '펼치기',
    `접으면 그 버튼만 남는다 (${fold.shut.vis.join(',') || '없음'})`);
  t.ok(fold.shut.railH <= 60,
    `통도 그 버튼만큼만 자리를 차지한다 (${fold.shut.railH}px)`);
  t.eq(fold.shut.leftIsMap, true, '접으면 그 아래는 지도가 그대로 만져진다');
  t.eq(fold.shut.panelOpen, false, '접을 때 열려 있던 하위 창도 함께 닫힌다');
  t.eq(fold.back.txt, '접기', '다시 누르면 펴진다');
  t.eq(fold.back.n, fold.openN, `펴면 버튼이 그대로 돌아온다 (${fold.back.n}개)`);

  // 접힌 채로 지도의 공항을 눌러 WX 를 열면 — 버튼을 거치지 않는 길이다 —
  // 붙을 자리가 없으므로 줄을 먼저 편다.
  const viaMap = await phone.evaluate(async () => {
    toggleMapRail(false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const wasShut = !mapRailOpen;
    openWxPanel();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = { wasShut, opened: mapRailOpen, wx: isMapPanelOpen('wx-panel') };
    closeWxPanel();
    return out;
  });
  t.eq(viaMap.wasShut, true, '접은 상태에서 시작한다');
  t.eq(viaMap.opened, true, '버튼을 거치지 않고 창이 열리면 줄이 저절로 펴진다');
  t.eq(viaMap.wx, true, '그 창은 정상으로 열린다');

  await phone.setViewportSize(PHONE);
  await phone.waitForTimeout(500);

  // ── ⑨ 값도 고르는 것도 나침반 모서리에서 ──────────────────────
  // 값이 놓인 자리가 세 번 옮겨 다녔다. 나침반 좌·우 여백(캔버스) → 조작부
  // 맨 윗줄(HTML) → 다시 나침반 네 모서리(캔버스). 마지막 자리가 이유가 있다:
  // 좌우 기둥(속도·고도 테이프·승강계)을 걷어내 화면 폭이 통째로 남았고,
  // 나침반을 보는 눈이 그대로 값을 읽을 수 있다. 이제 그 모서리 테두리가 곧
  // 소스를 고르는 버튼이라, 조작부에는 두 줄만 남는다.
  await phone.evaluate(() => navGo('pfd'));
  await phone.waitForTimeout(500);

  const info = await phone.evaluate(() => {
    // 화면(캔버스)에 실제로 찍히는 글자
    resizePFD();
    const g = ctx, orig = g.fillText, seen = [];
    g.fillText = function (tx, x, y) {
      seen.push({ t: String(tx), x, y });
      return orig.apply(this, arguments);
    };
    try { drawPFD(); } finally { g.fillText = orig; }
    const W = cvs.width;
    const ctrlH = document.querySelector('.ctrl-bar').offsetHeight;
    const usableH = cvs.height - ctrlH;
    const bandH = hsiBandH();
    const hsiWant = Math.round(W * 0.40 * 2 + bandH * 2 + 10);
    const hsiH = Math.max(Math.round(usableH * 0.34),
                          Math.min(Math.round(usableH * 0.50), hsiWant));
    const hsiY = usableH - hsiH;
    // 화면 좌표로 들어온 것만(translate 로 그리는 눈금·장미는 0 이하다).
    // 같은 글자가 맨 윗줄(GS·HDG·ALT·VS)에도 있으므로 나침반 칸 안에서 찾는다.
    // 위/아래 판정은 칸의 세로 가운데를 기준으로 나눈다 — NAV 상자(넉 줄)와
    // OAT·CRS 상자(두 줄)가 높이가 서로 달라, 한 값(bandH)으로는 못 가른다.
    const corner = t => {
      const e = seen.find(q => q.t === t && q.y > hsiY && q.y <= hsiY + hsiH);
      if (!e) return null;
      return { top: e.y < hsiY + hsiH / 2, bot: e.y > hsiY + hsiH / 2,
               left: e.x < W / 2, right: e.x > W / 2 }; };
    return { ctrlRows: (() => {
               // 조작부에 남은 줄 수 — 눈에 보이는 것들의 윗변이 몇 가지인가
               const bar = document.querySelector('.ctrl-bar');
               const tops = new Set([...bar.querySelectorAll('button, .ctrl-lbl-btn, .cbtn, .sw-display')]
                 .filter(e => e.getBoundingClientRect().width > 0)
                 .map(e => Math.round(e.getBoundingClientRect().top / 6)));
               return tops.size; })(),
             fms: corner('FMS'), nav1: corner('NAV1'), nav2: corner('NAV2'),
             oat: corner('OAT'), tas: corner('TAS'), crs: corner('CRS'),
             all: seen.map(e => e.t) };
  });
  t.ok(info.ctrlRows <= 2, `조작부가 두 줄로 줄었다 (${info.ctrlRows}줄)`);

  // 네 모서리 — 왼쪽 위 FMS · 오른쪽 위 NAV1 · 오른쪽 아래 NAV2 · 왼쪽 아래 OAT
  const where = [['FMS', info.fms, 'top', 'left'], ['NAV1', info.nav1, 'top', 'right'],
                 ['NAV2', info.nav2, 'bot', 'right'], ['OAT', info.oat, 'bot', 'left'],
                 ['CRS', info.crs, 'bot', 'left']];
  for (const [name, c, vert, horz] of where) {
    t.ok(c, `${name} 가 계기에 그려진다`);
    if (!c) continue;
    t.eq(c[vert], true, `${name} 가 ${vert === 'top' ? '위' : '아래'} 띠에 있다`);
    t.eq(c[horz], true, `${name} 가 ${horz === 'left' ? '왼' : '오른'}쪽이다`);
  }
  // ISA 는 내렸다 — 고도만 넣으면 나오는 표준대기 값이라 읽을 것이 없다
  t.ok(!info.all.includes('ISA'), '계기에 ISA 가 없다');
  // TAS 도 내렸다 — 대기속도계가 없는 이 앱에서는 대지속도에 고도 보정을
  // 먹인 값이라, 맨 윗줄의 GS 와 거의 같은 숫자가 나란히 떴다.
  t.eq(info.tas, null, '나침반 모서리에 TAS 가 없다');

  // OAT·CRS 는 두 줄(이름표+값을 나란히 적는다) 규격 그대로 1.3 배다.
  // NAV 소스(FMS·NAV1·NAV2)는 넉 줄로 쌓으면서 그보다 작게 줄였다 — 한 줄에
  // 하나씩이라 서로 다투지 않고, 그만큼 나침반이 커진다(hsiRadius).
  // 자세계 한가운데 녹색 원(비행경로 벡터)은 내렸다 — 편류는 지금 나침반을
  // GPS 항적으로 맞춰 쓰는 탓에 센서 보정 잔차에 가깝고, 경로각도 대기속도가
  // 없어 대지속도로 대신 낸 값이다. 자세를 보는 자리 한복판에서 그런 값이
  // 떠다니면 읽기만 방해한다.
  const corners = await phone.evaluate(() => {
    S.spd = 90; S.vs = 500; S.hdg = 40;
    const g = ctx, orig = g.fillText, seen = [];
    g.fillText = function (txt, x, y) {
      seen.push({ t: String(txt), y, f: this.font }); return orig.apply(this, arguments); };
    // 자세계 한가운데의 원은 stroke 로 그렸다 — 그 색이 나오는지 본다
    const os = ctx.stroke, cols = [];
    ctx.stroke = function () { cols.push(String(this.strokeStyle).toLowerCase()); return os.apply(this, arguments); };
    try { resizePFD(); drawPFD(); } finally { g.fillText = orig; ctx.stroke = os; }
    const px = f => parseFloat(String(f).match(/(\d*\.?\d+)px/)[1]);
    const top = 2 + fmaStripH();
    const at = t => { const a2 = seen.filter(q => q.t === t && q.y > top); return a2.length ? px(a2[0].f) : null; };
    return { oat: at('OAT'), crs: at('CRS'), fms: at('FMS'), nav1: at('NAV1'), nav2: at('NAV2'),
             scale: pfdFontScale, fpv: cols.includes('#00ff88') };
  });
  t.eq(corners.oat, corners.crs, `OAT 이름표가 CRS 와 같은 크기다 (${corners.oat}px)`);
  t.eq(corners.oat, Math.round(11 * 1.3) * corners.scale,
    `OAT·CRS 는 종전 규격(1.3배) 그대로다 (${corners.oat}px)`);
  t.eq(corners.fms, corners.nav1, 'FMS·NAV1 이름표 크기가 같다');
  t.eq(corners.nav1, corners.nav2, 'NAV1·NAV2 도 같은 크기다');
  t.ok(corners.fms < corners.oat,
    `NAV 소스 이름표는 OAT·CRS 보다 작다 — 넉 줄을 쌓은 만큼 줄였다 (${corners.fms}px < ${corners.oat}px)`);
  t.eq(corners.fpv, false, '자세계 한가운데 녹색 원(비행경로 벡터)이 없다');

  // ── AHRS·GPS 는 맨 위 탭바에 있다 ───────────────────────────
  // AHRS 는 조작부 구석에 있었다. 계기를 보다가 자세를 잡으려면 창을 옮겨야
  // 했다. GPS 는 지도 툴바에만 있어 계기를 보는 동안에는 손이 닿지 않았다.
  const sw = await phone.evaluate(() => {
    const bar = document.getElementById('phone-bar');
    const a = document.getElementById('phone-ahrs-btn');
    const g = document.getElementById('phone-gps-btn');
    const rl = document.getElementById('phone-reload-btn');
    const cdu = document.querySelector('#phone-bar [data-nav="cdu"]');
    const box = e => e.getBoundingClientRect();
    // 눌러 보고 상태가 따라오는가
    const ahrsWas = ahrsOn; toggleAhrs();
    const ahrsLit = a.classList.contains('on');
    if (ahrsOn !== ahrsWas) toggleAhrs();
    const gpsWas = gpsMode; gpsMode = true; updateGpsBtn();
    const gpsLit = g.classList.contains('active');
    gpsMode = gpsWas; updateGpsBtn();
    return {
      inBar: !!a.closest('#phone-bar') && !!g.closest('#phone-bar'),
      inCtrl: !!document.getElementById('ahrs-btn'),
      order: box(cdu).left < box(a).left && box(a).left < box(g).left
             && box(g).left < box(rl).left,
      tall: Math.round(box(a).height), wide: Math.round(box(a).width),
      ahrsLit, gpsLit,
      // 지도 툴바의 GPS 는 내렸다 — 이제 이 하나가 그 스위치다
      sameAct: a.dataset.act === 'toggleAhrs' && g.dataset.act === 'toggleGPS',
      mapGpsGone: !document.getElementById('gps-btn'),
    };
  });
  t.eq(sw.inBar, true, 'AHRS·GPS 가 맨 위 탭바에 있다');
  t.eq(sw.inCtrl, false, '조작부에서는 AHRS 가 빠졌다');
  t.eq(sw.order, true, 'CDU · AHRS · GPS · ⟳ 순으로 선다');

  // 맨 위 탭바 — 순서와 폭
  // 손가락은 자리를 외워서 간다. 폭이 제각각이면 눌러야 할 자리를 눈으로
  // 찾게 되고, 흔들리는 기내에서 그 한 번이 길다.
  const bar7 = await phone.evaluate(() => {
    const bs = [...document.querySelectorAll('#phone-bar button')];
    return { txt: bs.map(b => b.textContent.trim()),
             widths: bs.map(b => Math.round(b.getBoundingClientRect().width)) };
  });
  t.eq(bar7.txt.join(' '), 'PFD MAP PLAN CDU AHRS GPS ⟳',
    `PFD · MAP · PLAN · CDU · AHRS · GPS · ⟳ 순이다 (${bar7.txt.join(' ')})`);
  const spreadW = Math.max(...bar7.widths) - Math.min(...bar7.widths);
  t.ok(spreadW <= 1, `일곱 칸의 폭이 같다 (편차 ${spreadW}px · ${bar7.widths.join('/')})`);

  // ── 창을 고르는 네 버튼(PFD·MAP·PLAN·CDU)의 글씨 크기 ────────
  // 가장 좁은 폰(320px)에서도 칸을 벗어나지 않는 한 최대로 키운다.
  // 넷 중 'PLAN'(넉 자)이 가장 빡빡해 그 값이 나머지 셋의 크기도 정한다.
  await phone.setViewportSize({ width: 320, height: 900 });
  await phone.waitForTimeout(300);
  const navFs = await phone.evaluate(() => {
    const navBtns = [...document.querySelectorAll('#phone-bar [data-nav]')];
    return {
      sizes: navBtns.map(b => parseFloat(getComputedStyle(b).fontSize)),
      overflow: navBtns.some(b => b.scrollWidth > b.clientWidth + 0.5
                                || b.scrollHeight > b.clientHeight + 0.5),
    };
  });
  t.eq(navFs.overflow, false, '320px 폭에서도 글씨가 칸을 벗어나지 않는다');
  t.ok(navFs.sizes.every(v => v === navFs.sizes[0]),
    `네 버튼의 글씨 크기가 같다 (${navFs.sizes.join(',')}px)`);
  t.ok(navFs.sizes[0] >= 15, `종전(11px)보다 뚜렷이 커졌다 (${navFs.sizes[0]}px)`);
  // 한 칸이라도 더 키우면(=16px) 넘친다는 것도 확인한다 — '최대' 라는 주장의 근거
  const oneUp = await phone.evaluate(() => {
    const b = document.querySelector('#phone-bar [data-nav="plan"]');
    const was = b.style.fontSize;
    b.style.fontSize = (parseFloat(getComputedStyle(b).fontSize) + 1) + 'px';
    const overflow = b.scrollWidth > b.clientWidth + 0.5;
    b.style.fontSize = was;
    return overflow;
  });
  t.eq(oneUp, true, '한 단계만 더 키우면 PLAN 이 320px 폭에서 넘친다(더는 못 키운다)');
  await phone.setViewportSize(PHONE);
  await phone.waitForTimeout(300);

  // ── 지도에서 내린 것들 ────────────────────────────────────────
  // 늘 떠 있어야 하는 것(좌표·GPS 상태)에 귀퉁이를 내주고, 손이 잘 가지 않던
  // 스위치는 걷었다. 확대·축소는 손가락 두 개로 한다.
  await phone.evaluate(() => navGo('map'));
  await phone.waitForTimeout(400);
  const mapGone = await phone.evaluate(() => {
    const byId = id => !!document.getElementById(id);
    const byAct = a2 => !!document.querySelector(`#map-wrap [data-act="${a2}"]`);
    return {
      zoom: !document.querySelector('#map-wrap .leaflet-control-zoom'),
      scale: !document.querySelector('#map-wrap .vfr-scale'),
      gps: !byId('gps-btn'), rain: !byId('rain-btn'), fdr: !byId('fdr-btn'),
      lock: !byId('lock-btn'), ship: !byId('map-ship-btn'), reset: !byAct('resetSim'),
      // 남아 있어야 하는 것 — 좌표와 GPS 상태는 그대로다
      coord: byId('center-coord'), status: byId('gps-status'),
    };
  });
  t.eq(mapGone.zoom, true, '지도에 확대·축소 버튼이 없다');
  t.eq(mapGone.scale, true, '축척 막대도 없다');
  for (const [k, name] of [['gps', 'GPS'], ['rain', 'RAIN'], ['fdr', 'FDR'],
                           ['lock', '지도잠금'], ['ship', 'SHIP'], ['reset', 'RESET']]) {
    t.eq(mapGone[k], true, `지도 버튼에서 ${name} 를 내렸다`);
  }
  t.eq(mapGone.coord && mapGone.status, true, '좌표와 GPS 상태는 그대로 남는다');
  await phone.evaluate(() => navGo('pfd'));
  await phone.waitForTimeout(300);
  t.ok(sw.tall >= 44 && sw.wide >= 40, `손가락으로 누를 크기다 (${sw.wide}×${sw.tall}px)`);
  t.eq(sw.ahrsLit, true, 'AHRS 를 누르면 켜져 보인다');
  t.eq(sw.gpsLit, true, 'GPS 가 붙으면 켜져 보인다');
  t.eq(sw.sameAct, true, 'GPS 를 켜고 끄는 스위치다');
  t.eq(sw.mapGpsGone, true, '지도 툴바에는 GPS 버튼이 없다 — 한 자리로 모았다');

  // ── ⑩ CRHT 가 없어졌는가 · 좌우 기둥도 없어졌는가 ────────────
  const crht = await phone.evaluate(() => {
    const dead = n => { try { return new Function('return typeof ' + n)() === 'undefined'; }
                        catch (e) { return true; } };
    // 계기 칸 나눔 — drawPFD 와 같은 셈
    const W = cvs.width, H = cvs.height;
    const usableH = H - document.querySelector('.ctrl-bar').offsetHeight;
    const bandH = hsiBandH();
    const hsiWant = Math.round(W * 0.40 * 2 + bandH * 2 + 10);
    const hsiH = Math.max(Math.round(usableH * 0.34),
                          Math.min(Math.round(usableH * 0.50), hsiWant));
    return { fn: dead('drawCrhtDisplay'), flag: dead('crhtOn'), sel: dead('selCrht'),
             toggle: dead('toggleCrht'),
             btn: !document.getElementById('crht-btn') && !document.getElementById('crht-up'),
             // 좌우 기둥(속도·고도 테이프·승강계)도 걷어냈다 — 폭이 가로의
             // 8.2% 로 묶여 있어 숫자를 키울 수가 없었고, 값은 맨 윗줄
             // 상자(GS·ALT·VS)에서 읽는다.
             tapes: dead('drawSpeedTape') && dead('drawAltTape') && dead('drawVSI'),
             // 그 대신 자세계·나침반이 화면 폭을 통째로 쓴다
             fullWidth: (() => {
               const g = ctx, orig = g.strokeRect, seen = [];
               g.strokeRect = function (x, y, w2) { seen.push({ x, w: w2 }); return orig.apply(this, arguments); };
               try { drawPFD(); } finally { g.strokeRect = orig; }
               // 맨 윗줄 세 상자가 화면 양끝까지 벌어져 있는가
               const wide = seen.filter(q => q.w > W * 0.2);
               return wide.length >= 3 && Math.min(...wide.map(q => q.x)) < 6
                      && Math.max(...wide.map(q => q.x + q.w)) > W - 6;
             })(),
             hsiH, aiH: usableH - hsiH, usableH };
  });
  t.eq(crht.fn, true, 'CRHT 표시를 그리는 함수가 없다');
  t.eq(crht.flag && crht.sel && crht.toggle, true, 'CRHT 상태값·토글도 남지 않았다');
  t.eq(crht.btn, true, 'CRHT 버튼도 마크업에 없다');
  t.eq(crht.tapes, true, '좌우 기둥(속도·고도 테이프·승강계)을 그리던 함수도 없다');
  t.eq(crht.fullWidth, true, '계기가 화면 폭을 통째로 쓴다');
  // 나침반 칸은 이제 위·아래 띠에 글자판 넷(FMS·NAV1·NAV2·TAS/GS/OAT)을
  // 이고 있다. 종전에는 그 칸이 통째로 빈 갈색이라 "너무 넓다" 는 말이 나왔고,
  // 그래서 '자세계보다 좁아야 한다' 로 못 박아 두었다. 지금은 값이 들어차
  // 있으므로 기준을 '절반을 넘지 않는다' 로 옮긴다 — 자세계도 그만큼은
  // 남아야 하기 때문이다.
  t.ok(crht.hsiH <= crht.aiH + 2,
    `나침반 칸이 자세계보다 크지 않다 (${crht.hsiH}px ≤ ${crht.aiH}px)`);
  // 그 '절반' 을 코드에서도 못 박아 둔다(drawPFD 의 0.50 상한).
  t.ok(crht.hsiH <= crht.usableH * 0.51,
    `나침반 칸이 계기의 절반을 넘지 않는다 (${crht.hsiH}px / ${crht.usableH}px = ${(100 * crht.hsiH / crht.usableH).toFixed(1)}%)`);

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

  // ── ⑬ NAV 소스 — 모서리 글자판이 곧 버튼이다 ────────────────
  // 조작부에 있던 FMS·NAV1·NAV2 버튼 세 개를 내렸다. 바로 위 나침반 모서리에
  // 같은 이름이 이미 서 있어서 한 화면에 같은 글자가 두 번 뜨는 자리였고,
  // 그 한 줄만큼 나침반이 눌렸다. 이제 모서리 테두리를 누르면 소스가 바뀐다.
  await phone.evaluate(() => navGo('pfd'));
  await phone.waitForTimeout(400);
  const src = await phone.evaluate(() => {
    S.lat = 38.0; S.lon = 128.6; S.alt = 3000; S.awp = -1;
    setNavRadio('NAV1', '109.30', null);
    setNavSrc('FMS');
    resizePFD(); drawPFD();
    const before = navSrc;
    // 모서리 테두리를 누르면 그 소스가 선택된다
    const rect = cvs.getBoundingClientRect();
    const b = hsiHitBoxes.find(q => q.src === 'NAV1');
    cvs.dispatchEvent(new MouseEvent('click', { bubbles: true,
      clientX: rect.left + (b.x + b.w / 2) * (rect.width / cvs.width),
      clientY: rect.top  + (b.y + b.h / 2) * (rect.height / cvs.height) }));
    const after = navSrc;
    // 값은 계산부(navInfoRows)가 내고 나침반 모서리에 그려진다
    const row = navInfoRows().find(r => r.src === 'NAV1');
    const g = ctx, orig = g.fillText, seen = [];
    g.fillText = function (tx) { seen.push(String(tx)); return orig.apply(this, arguments); };
    try { drawPFD(); } finally { g.fillText = orig; }
    return { before, after,
             brg: row.brg, rad: row.rad, dst: row.dst, ident: row.ident,
             drawn: [row.ident, row.brg, row.dst].every(v => seen.includes(v)),
             radDrawn: seen.includes(row.rad),
             boxes: hsiHitBoxes.filter(q => q.act === 'navSrc').map(q => q.src),
             oldBtns: !document.getElementById('nav-fms') && !document.querySelector('.nav-src-btn')
                      && !document.querySelector('.pi-sel')
                      && !document.getElementById('pfd-info') };
  });
  t.eq(src.boxes.join(','), 'FMS,NAV1,NAV2', `모서리 셋이 누를 자리다 (${src.boxes.join(',')})`);
  t.eq(src.oldBtns, true, '조작부의 NAV SRC 버튼은 없어졌다');
  t.eq(src.before, 'FMS', '누르기 전에는 FMS 였다');
  t.eq(src.after, 'NAV1', '모서리 테두리를 누르면 그 소스가 선택된다');
  t.eq(src.drawn, true, '이름·방위·거리가 나침반 모서리에 그려진다');
  // 래디얼은 계산에는 남기고 화면에서는 뺐다 — 방위의 반대편이라 한쪽만
  // 읽으면 나머지는 머릿속에서 나오고, 글씨를 키운 지금은 모서리를 넘는다.
  t.eq(src.radDrawn, false, '래디얼은 화면에 적지 않는다');
  t.ok(/^R\d{3}$/.test(src.rad), `계산에는 남아 있다 (${src.rad})`);
  // 래디얼은 그 지점에서 항공기를 본 방향 — 방위의 반대편이다
  const brgN = parseInt(src.brg, 10), radN = parseInt(src.rad.slice(1), 10);
  t.ok(Math.abs(((radN - brgN + 360) % 360) - 180) < 3,
    `래디얼이 방위의 반대편이다 (방위 ${brgN}° · 래디얼 ${radN}°)`);

  // ── ⑭ 지도 버튼에서 내린 것들 ──────────────────────────────────
  // #1BDP·#2BDP(지도 BRG 시현)와 CLR(비행계획 지우기)을 내렸다.
  //   · BRG 선·글자는 기본이 꺼짐이라 대개 아무것도 없는 채로 두 칸만 먹었고,
  //     같은 값(방위·거리)은 나침반 모서리 글자판이 늘 보여 준다.
  //   · CLR 은 비행계획을 통째로 지우는 버튼이라 지도를 보다 스칠 자리가
  //     아니다. 지우는 자리는 PLAN 창 아래 Clr 하나로 둔다.
  await phone.evaluate(() => navGo('map'));
  await phone.waitForTimeout(400);
  const gone = await phone.evaluate(() => ({
    bdp: !document.getElementById('brg1-bdp') && !document.getElementById('brg2-bdp'),
    bdpAct: !document.querySelector('[data-act="toggleBrg1Lbl"],[data-act="toggleBrg2Lbl"]'),
    bdpFn: typeof toggleBrg1Lbl === 'undefined' && typeof toggleBrg2Lbl === 'undefined',
    mapLines: typeof brg1Line === 'undefined' && typeof brg2Line === 'undefined',
    clrOnMap: !document.querySelector('#map-lsk [data-act="clearFP"]'),
    // 비행계획을 지우는 자리는 PLAN 창에 그대로 남는다
    clrOnPlan: (() => { fpGo('LIST'); return /Clr/.test(document.getElementById('fp-wrap').textContent); })(),
    coordPx: parseFloat(getComputedStyle(document.getElementById('center-coord')).fontSize),
    gpsPx: parseFloat(getComputedStyle(document.getElementById('gps-status')).fontSize),
  }));
  t.eq(gone.bdp, true, '#1BDP·#2BDP 버튼이 없다');
  t.eq(gone.bdpAct, true, '그 버튼을 부르던 data-act 도 없다');
  t.eq(gone.bdpFn, true, '토글 함수도 남지 않았다');
  t.eq(gone.mapLines, true, '지도에 BRG 선을 그리던 코드도 없다');
  t.eq(gone.clrOnMap, true, '지도 버튼에 CLR 이 없다');
  t.eq(gone.clrOnPlan, true, '비행계획을 지우는 자리는 PLAN 창에 남는다');
  t.ok(gone.coordPx >= 11 && gone.gpsPx >= 11,
    `좌표·GPS 글씨는 그대로 읽힌다 (${gone.coordPx}px · ${gone.gpsPx}px)`);
  await phone.evaluate(() => navGo('map'));
  await phone.waitForTimeout(300);

  // ── ⑮ 좌표·GPS 창은 오른쪽 아래에 선다 ────────────────────────
  // 종전에는 좌·우 폭을 다 쓰고(left:6px right:6px) 글자를 왼쪽에 붙였다.
  // 그 자리가 곧 왼쪽 버튼 줄 아래라, 줄 맨 끝 버튼과 좌표가 같은 세로선에서
  // 맞물려 보였다. 이제 상자째 오른쪽으로 붙이고 글자도 오른쪽으로 몬다.
  const coord = await phone.evaluate(() => {
    const st = document.getElementById('gps-status');
    st.style.display = 'block';
    // 가장 긴 모습 — 좌표에 속도·고도·방위·오차까지 붙는다
    st.innerHTML = `${_gsPart('● 37°23′23″N 126°39′17″E')} · ${_gsPart('120kt')} · ` +
                   `${_gsPart('12500ft')} · ${_gsPart('049°')} · ${_gsPart('±5m')}`;
    const cc = document.getElementById('center-coord');
    const W = document.getElementById('map-wrap').getBoundingClientRect();
    const rail = document.getElementById('map-lsk').getBoundingClientRect();
    const box = el => { const q = el.getBoundingClientRect();
      return { l: q.left - W.left, r: q.right - W.left,
               align: getComputedStyle(el).textAlign }; };
    return { wrapW: W.width, railR: rail.right - W.left,
             coord: box(cc), gps: box(st),
             // 접으면 왼쪽 띠가 비므로 폭을 다 쓴다
             wide: (() => { toggleMapRail(false);
               const q = st.getBoundingClientRect();
               const w = q.width; toggleMapRail(true); return w; })() };
  });
  for (const [k, name] of [['coord', '좌표창(＋)'], ['gps', 'GPS 좌표창']]) {
    t.eq(coord[k].align, 'right', `${name} 글자가 오른쪽으로 붙는다 (${coord[k].align})`);
    t.ok(coord[k].r >= coord.wrapW - 8,
      `${name} 이 오른쪽 끝에 선다 (오른변 ${Math.round(coord[k].r)} / ${Math.round(coord.wrapW)}px)`);
    // 왼쪽 버튼 줄과 겹치지 않는다 — 이것이 옮긴 까닭이다
    t.ok(coord[k].l >= coord.railR - 1,
      `${name} 이 버튼 줄 아래로 들어가지 않는다 ` +
      `(왼변 ${Math.round(coord[k].l)} ≥ 줄 오른변 ${Math.round(coord.railR)}px)`);
  }
  t.ok(coord.wide > coord.gps.r - coord.gps.l,
    `줄을 접으면 좌표창이 폭을 다 쓴다 (${Math.round(coord.wide)}px)`);
  await phone.evaluate(() => {
    document.getElementById('gps-status').style.display = '';
    document.getElementById('gps-status').innerHTML = '';
  });

  await phone.setViewportSize(PHONE);
  await phone.waitForTimeout(500);

  await pctx.close();
}
