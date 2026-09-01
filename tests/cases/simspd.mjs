// 배속 — 시뮬 시간만 빨리 흐르고, 계산 결과는 실시간과 같아야 한다.
//
// 배속은 "프레임을 건너뛰는" 방식이 아니라 "한 프레임에 흐를 시간을 늘리는"
// 방식이다. 그래서 잘못 만들면 두 가지가 깨진다.
//   ① 흐른 시간이 배수와 안 맞는다(×8 인데 6배만 간다든지)
//   ② 큰 dt 로 한 번에 적분해 선회 중 항적이 실시간과 어긋난다
// 둘 다 화면만 봐서는 "좀 이상한데" 로 끝나므로 숫자로 잡는다.
export const name = '시뮬 배속';

export async function run(page, t) {
  // ── 흐른 시간이 배수만큼인가 ──
  // 같은 실제 시간(1초) 동안 직선비행 이동거리를 잰다.
  const dist = await page.evaluate(() => {
    const run = (mult, frames, spanMs) => {
      S.lat = 37; S.lon = 127; S.hdg = 90; S.spd = 120; S.bnk = 0; S.alt = 500;
      S.wps = []; S.awp = -1; navApOn = false; hdgSelOn = false;
      gspdOn = false; gspdCoasting = false; windSpd = 0;
      S.running = true; setSimSpeed(mult);
      let ts = 1000; S.lastT = ts;
      for (let i = 0; i < frames; i++) { ts += spanMs / frames; simStep(ts); }
      S.running = false; setSimSpeed(1);
      return distance(37, 127, S.lat, S.lon);
    };
    const d1 = run(1, 60, 1000);
    return { d1, r2: run(2, 60, 1000) / d1, r4: run(4, 60, 1000) / d1,
             r8: run(8, 60, 1000) / d1,
             // 프레임이 튀어도(0.4초짜리 한 프레임 = ×8 이면 시뮬 3.2초) 배수는 같아야 한다.
             // 이때 dt 가 0.2초를 넘지 않게 16번으로 쪼개 돈다.
             // (0.5초를 넘는 프레임은 종전부터 통째로 버린다 — 탭 전환 뒤 순간이동 방지)
             rSlow: run(8, 1, 400) / run(1, 1, 400) };
  });
  t.ok(Math.abs(dist.d1 - 120 / 3600) < 1e-3,
    `실시간 1초에 120kt 로 ${(dist.d1 * 3600).toFixed(1)}kt 만큼 간다`);
  [['r2', 2], ['r4', 4], ['r8', 8]].forEach(([k, n]) => {
    t.ok(Math.abs(dist[k] - n) < 0.02, `×${n} 는 실시간의 ${dist[k].toFixed(3)}배를 간다`);
  });
  t.ok(Math.abs(dist.rSlow - 8) < 0.02,
    `프레임이 0.4초로 튀어도 ×8 만큼 흐른다 (${dist.rSlow.toFixed(3)}배)`);

  // ── 선회 중에도 실시간과 같은 항적인가 ──
  // 큰 dt 로 한 번에 적분하면 선회에서 어긋난다. 쪼개 도는지 여기서 본다.
  const turn = await page.evaluate(() => {
    const fly = (mult, frames, spanMs) => {
      S.lat = 37; S.lon = 127; S.hdg = 360; S.spd = 120; S.bnk = 0; S.alt = 500;
      S.wps = []; S.awp = -1; navApOn = false; gspdOn = false; gspdCoasting = false;
      windSpd = 0; hdgSelOn = true; selHdg = 90; _rollRate = 0; bankTarget = 0;
      S.running = true; setSimSpeed(mult);
      let ts = 1000; S.lastT = ts;
      for (let i = 0; i < frames; i++) { ts += spanMs / frames; simStep(ts); }
      S.running = false; setSimSpeed(1);
      return { hdg: S.hdg, lat: S.lat, lon: S.lon };
    };
    // 시뮬 시간 40초를 실시간 40초(×1)로 / 실시간 5초(×8)로 각각 난다
    const a = fly(1, 2400, 40000);
    const b = fly(8, 300, 5000);
    return { dHdg: Math.abs(normAS(a.hdg - b.hdg)),
             dPos: distance(a.lat, a.lon, b.lat, b.lon), hdg: a.hdg };
  });
  t.ok(turn.dHdg < 1.5,
    `90° 선회 뒤 기수가 실시간과 같다 (차이 ${turn.dHdg.toFixed(2)}°)`);
  t.ok(turn.dPos < 0.05,
    `40초 선회 뒤 위치가 실시간과 같다 (차이 ${(turn.dPos * 1852).toFixed(0)}m)`);

  // ── 버튼 ──
  const ui = await page.evaluate(() => {
    setSimSpeed(4);
    const on = v => document.getElementById('simspd-' + v).classList.contains('active');
    const r = { speed: simSpeed, act4: on(4), act1: on(1) };
    resetSim();                       // 리셋하면 실시간으로 돌아온다
    r.afterReset = simSpeed; r.resetAct1 = on(1);
    setSimSpeed(99);                  // 없는 배속은 실시간으로 떨어진다
    r.bogus = simSpeed;
    // RNP 는 NAV SRC 아래로 옮겼다 — 옮기다 끊어지면 조용히 죽는다
    r.rnpUnderNavSrc = !!document.querySelector('.nav-src-group .rnp-btns');
    setRnp(0.3);
    r.rnp = rnp;
    r.rnpActive = document.getElementById('rnp-03').classList.contains('active');
    setRnp(1);
    return r;
  });
  t.ok(ui.speed === 4 && ui.act4 && !ui.act1, '×4 를 누르면 그 버튼만 켜진다');
  t.ok(ui.afterReset === 1 && ui.resetAct1, 'RESET 하면 실시간(×1)으로 돌아온다');
  t.eq(ui.bogus, 1, '없는 배속 값은 실시간으로 떨어진다');
  t.eq(ui.rnpUnderNavSrc, true, 'RNP 버튼이 NAV SRC 아래에 있다');
  t.ok(ui.rnp === 0.3 && ui.rnpActive, `RNP 는 자리를 옮겨도 그대로 동작한다 (${ui.rnp})`);

  // ── 배속이 비행 전체에 걸리는가(직선 이동만이 아니라) ──
  // 홀딩 진입을 rAF 루프와 같은 방식으로 돌려, 같은 프레임 수에서 ×8 이
  // 실제로 더 멀리 진행하는지 본다.
  const e2e = await page.evaluate(() => {
    const fly = (mult, frames) => {
      const FIX = [37.0, 127.5];
      const A = destPoint(FIX[0], FIX[1], 270, 2);   // 픽스 서쪽 2NM(120kt 로 1분)
      S.wps = [{ ident: 'A', lat: A[0], lon: A[1] },
               { ident: 'FIX', lat: FIX[0], lon: FIX[1],
                 hold: { dir: 'R', crs: 90, legType: 'TIME', legVal: 60 } }];
      S.fwp = 0; S.awp = 1; S.crs = 90; obsOn = false; navSrc = 'FMS';
      S.lat = A[0]; S.lon = A[1]; S.hdg = 90; S.spd = 120; S.bnk = 0;
      windSpd = 0; navApOn = true; hdgSelOn = false; gspdOn = false;
      holdExit(); S.running = true; setSimSpeed(mult);
      let ts = 1000; S.lastT = ts, flown = 0, prev = [S.lat, S.lon];
      for (let i = 0; i < frames; i++) {
        ts += 1000 / 60; simStep(ts);
        flown += distance(prev[0], prev[1], S.lat, S.lon); prev = [S.lat, S.lon];
      }
      S.running = false; setSimSpeed(1);
      return { flown, phase: _holdPhase };
    };
    const a = fly(1, 600), b = fly(8, 600);   // 실제 10초씩
    return { r: b.flown / a.flown, p1: a.phase, p8: b.phase };
  });
  t.ok(Math.abs(e2e.r - 8) < 0.3,
    `홀딩까지 포함한 비행 전체가 ×8 로 흐른다 (${e2e.r.toFixed(2)}배)`);
  t.ok(e2e.p1 === 'TOFIX' && e2e.p8 !== 'TOFIX',
    `같은 실제 시간에 ×8 은 진입까지 갔고 ×1 은 아직 픽스로 가는 중 (${e2e.p1} vs ${e2e.p8})`);

  // ── 스톱워치가 기체와 같은 시간을 재는가 ──
  // 계기비행에서 아웃바운드 1분·선회 시점을 이걸로 잰다. 배속을 걸었을 때
  // 시계만 실시간으로 가면 "1분 뒤 선회" 가 실제 레그와 어긋난다.
  const sw = await page.evaluate(() => {
    const spin = (mult, { running = true, gps = false } = {}) => {
      S.lat = 37; S.lon = 127; S.hdg = 90; S.spd = 120; S.bnk = 0;
      S.wps = []; S.awp = -1; navApOn = false; hdgSelOn = false;
      gspdOn = false; gspdCoasting = false; windSpd = 0;
      swReset(); SW.running = true;
      S.running = running; gpsMode = gps; setSimSpeed(mult);
      let ts = 1000; S.lastT = ts; _swPrevTs = ts;
      for (let i = 0; i < 60; i++) { ts += 1000 / 60; simStep(ts); }   // 실제 1초
      S.running = false; gpsMode = false; setSimSpeed(1);
      const ms = swElapsedMs();
      swReset();
      return ms;
    };
    return { x1: spin(1), x2: spin(2), x8: spin(8),
             paused: spin(8, { running: false }),
             gps: spin(8, { gps: true }) };
  });
  t.ok(Math.abs(sw.x1 - 1000) < 40, `실시간 1초에 스톱워치도 1초 (${(sw.x1 / 1000).toFixed(2)}s)`);
  t.ok(Math.abs(sw.x2 - 2000) < 60, `×2 에서는 2초 (${(sw.x2 / 1000).toFixed(2)}s)`);
  t.ok(Math.abs(sw.x8 - 8000) < 200, `×8 에서는 8초 (${(sw.x8 / 1000).toFixed(2)}s)`);
  t.eq(sw.paused, 0, '시뮬이 멈춰 있으면 스톱워치도 멈춘다');
  t.ok(Math.abs(sw.gps - 1000) < 40,
    `GPS 모드(실제 비행)에서는 배속과 무관하게 실시간 (${(sw.gps / 1000).toFixed(2)}s)`);

  // 홀딩 레그 타이머와 같은 시간축인가 — 이게 어긋나면 눈금이 서로 안 맞는다.
  // 평행 진입의 아웃바운드 구간(PAR_OUT)은 _holdT 로 1분을 재는 자리다.
  // 조종사가 스톱워치로 재는 것과 같은 1분이어야 한다.
  const legs = await page.evaluate(() => {
    const FIX = [37.0, 127.5], APPR = 330;       // 우선회 90° 홀딩에서 평행 진입
    const A = destPoint(FIX[0], FIX[1], normA(APPR + 180), 3);
    S.wps = [{ ident: 'A', lat: A[0], lon: A[1] },
             { ident: 'FIX', lat: FIX[0], lon: FIX[1],
               hold: { dir: 'R', crs: 90, legType: 'TIME', legVal: 60 } }];
    S.fwp = 0; S.awp = 1; S.crs = 90; obsOn = false; navSrc = 'FMS';
    S.lat = A[0]; S.lon = A[1]; S.hdg = APPR; S.bnk = 0; S.spd = 120;
    windSpd = 0; navApOn = true; hdgSelOn = false; gspdOn = false;
    holdExit(); swReset(); SW.running = true;
    S.running = true; setSimSpeed(8);
    let ts = 1000; S.lastT = ts; _swPrevTs = ts;
    let sw0 = null, last = null, entry = '';
    for (let i = 0; i < 2400; i++) {             // 실제 40초 = 시뮬 5분 20초
      ts += 1000 / 60; simStep(ts);
      if (_holdPhase === 'PAR_OUT') {
        if (sw0 === null) sw0 = swElapsedMs();
        last = { sw: (swElapsedMs() - sw0) / 1000, leg: _holdT };
        entry = _holdEntry;
      }
    }
    S.running = false; setSimSpeed(1); swReset();
    return { last, entry };
  });
  if (!legs.last) t.ok(false, '홀딩 아웃바운드 구간에 들어가지 못했다');
  else {
    t.eq(legs.entry, 'PARALLEL', '평행 진입으로 들어갔다');
    t.ok(Math.abs(legs.last.sw - legs.last.leg) < 0.5,
      `스톱워치와 홀딩 레그 타이머가 같은 시간축 ` +
      `(아웃바운드 ${legs.last.sw.toFixed(1)}s vs ${legs.last.leg.toFixed(1)}s)`);
  }
}
