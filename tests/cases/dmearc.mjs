// DME 아크 구간(Y 절차) 추종.
//
// 접근절차의 Y 는 대개 "기준국에서 몇 NM 을 유지하며 도는" 아크 구간을 갖는다.
// 지도에는 원호가 그려져 있었는데 NAV 는 두 픽스를 잇는 직선으로 날아 원호
// 안쪽을 가로질렀다. 그 차이는 원호의 새그(sagitta)만큼이다 — 계산으로 미리
// 알 수 있는 값이므로, 여기서 그 값과 대조해 "직선으로 가로질렀는지" 를 잡는다.
// (Z 절차는 픽스를 잇는 직선이 맞다 — 아크 표시가 없는 구간은 종전대로 둔다)
export const name = 'DME 아크 추종';

// 김해 RNP-B RWY 18R — 11NM 아크 (AIP 좌표)
const C = [35.0045, 128.8833];
const NOORI = [35.0764, 128.6687], WAYBI = [35.1430, 128.7300];

export async function run(page, t) {
  const setup = () => page.evaluate(([C, N, W]) => {
    S.wps = [
      { ident: 'OVTUS', lat: 35.0306, lon: 128.6525 },
      { ident: 'NOORI', lat: N[0], lon: N[1], arc: { clat: C[0], clon: C[1], dir: 'R' } },
      { ident: 'WAYBI', lat: W[0], lon: W[1], arc: { clat: C[0], clon: C[1], dir: 'R' } },
      { ident: 'ZIKKO', lat: 35.1960, lon: 128.7790 },
    ];
    obsOn = false; navSrc = 'FMS'; holdExit();
    S.fwp = 1; S.awp = 2;                       // NOORI → WAYBI (아크 구간)
  }, [C, NOORI, WAYBI]);
  await setup();

  // ── 코스선이 원호로 잡히는가 ──
  const line = await page.evaluate(([C, N, W]) => {
    const L = activeCourseLine();
    const rN = distance(C[0], C[1], N[0], N[1]);
    const rW = distance(C[0], C[1], W[0], W[1]);
    S.fwp = 2; S.awp = 3;                       // WAYBI → ZIKKO (아크 표시 없음)
    const straight = activeCourseLine();
    S.fwp = 1; S.awp = 2;
    return { hasArc: !!L.arc, r: L.arc ? L.arc.r : 0, dir: L.arc ? L.arc.dir : '',
             rN, rW, nextHasArc: !!straight.arc };
  }, [C, NOORI, WAYBI]);
  t.eq(line.hasArc, true, '아크 구간에서는 코스선이 원호가 된다');
  t.ok(Math.abs(line.r - (line.rN + line.rW) / 2) < 0.01 && line.r > 10 && line.r < 12,
    `반지름이 기준국까지의 거리다 (${line.r.toFixed(2)}NM — 픽스 ${line.rN.toFixed(2)}·${line.rW.toFixed(2)})`);
  t.eq(line.dir, 'R', '선회 방향을 그대로 쓴다');
  t.eq(line.nextHasArc, false, '아크 표시가 없는 구간(Z 절차 등)은 종전대로 직선이다');

  // ── 편차는 "기준국까지의 거리 − 반지름" 이다 ──
  const dev = await page.evaluate(([C]) => {
    const L = activeCourseLine();
    const th = (bearing(C[0], C[1], S.wps[1].lat, S.wps[1].lon) +
                bearing(C[0], C[1], S.wps[2].lat, S.wps[2].lon)) / 2;
    const put = rr => { const p = destPoint(C[0], C[1], th, rr); S.lat = p[0]; S.lon = p[1]; };
    put(L.arc.r);
    const on = { xtk: courseXtk(L), crs: courseCrsHere(L),
                 tangent: normA(bearing(C[0], C[1], S.lat, S.lon) + 90) };
    put(L.arc.r + 1); const outside = courseXtk(L);
    put(L.arc.r - 1); const inside = courseXtk(L);
    put(L.arc.r);
    return { on, outside, inside };
  }, [C]);
  t.ok(Math.abs(dev.on.xtk) < 0.01, `아크 위에서는 편차가 0 이다 (${dev.on.xtk.toFixed(3)}NM)`);
  t.ok(Math.abs(dev.on.crs - dev.on.tangent) < 0.6,
    `그 자리의 접선이 코스가 된다 (${Math.round(dev.on.crs)}° · 접선 ${Math.round(dev.on.tangent)}°)`);
  t.ok(Math.abs(dev.outside + 1) < 0.02 && Math.abs(dev.inside - 1) < 0.02,
    `바깥으로 1NM 벗어나면 −1, 안쪽이면 +1 (우선회는 기준국이 오른쪽 — ${dev.outside.toFixed(2)} / ${dev.inside.toFixed(2)})`);

  // ── 실제로 날려 본다 ──
  // 직선으로 가로지르면 원호의 새그(sagitta)만큼 안쪽으로 파고든다.
  // r − √(r² − (현/2)²) — 코드와 무관하게 기하로 미리 계산되는 값이다.
  const fly = await page.evaluate(([C, N, W]) => {
    const run = (useArc) => {
      S.wps = [
        { ident: 'OVTUS', lat: 35.0306, lon: 128.6525 },
        { ident: 'NOORI', lat: N[0], lon: N[1], arc: { clat: C[0], clon: C[1], dir: 'R' } },
        { ident: 'WAYBI', lat: W[0], lon: W[1], arc: { clat: C[0], clon: C[1], dir: 'R' } },
      ];
      if (!useArc) S.wps.forEach(w => delete w.arc);      // 옛 동작(직선)으로
      obsOn = false; navSrc = 'FMS'; holdExit();
      S.fwp = 1; S.awp = 2;
      const r = (distance(C[0], C[1], N[0], N[1]) + distance(C[0], C[1], W[0], W[1])) / 2;
      S.lat = N[0]; S.lon = N[1];
      S.hdg = normA(bearing(C[0], C[1], S.lat, S.lon) + 90);   // 접선 방향으로 출발
      S.spd = 150; S.bnk = 0; S.alt = 3000;
      windSpd = 0; navApOn = true; hdgSelOn = false; gspdOn = false;
      const dt = 0.5;
      let worst = 0;
      for (let i = 0; i < 1600; i++) {
        updateNav();
        bankTarget = navApBankTarget();
        S.bnk += Math.max(-3, Math.min(3, bankTarget - S.bnk));
        const V = Math.max(10, S.spd) * 0.5144;
        S.hdg = normA(S.hdg + 9.81 * Math.tan(S.bnk * D2R) / V / D2R * dt);
        const sc = 1852 / 3600 * dt / 111320;
        S.lat += S.spd * Math.cos(S.hdg * D2R) * sc;
        S.lon += S.spd * Math.sin(S.hdg * D2R) * sc / Math.cos(S.lat * D2R);
        if (i > 20) worst = Math.max(worst, Math.abs(distance(S.lat, S.lon, C[0], C[1]) - r));
        if (distance(S.lat, S.lon, W[0], W[1]) < 0.3) break;
      }
      return { worst, reached: distance(S.lat, S.lon, W[0], W[1]) < 0.35 };
    };
    const chord = distance(N[0], N[1], W[0], W[1]);
    const r = (distance(C[0], C[1], N[0], N[1]) + distance(C[0], C[1], W[0], W[1])) / 2;
    return { arc: run(true), straight: run(false),
             sagitta: r - Math.sqrt(r * r - (chord / 2) * (chord / 2)) };
  }, [C, NOORI, WAYBI]);
  t.ok(fly.arc.worst < 0.06,
    `아크를 날면 기준국 거리를 유지한다 (최대 어긋남 ${(fly.arc.worst * 1852).toFixed(0)}m)`);
  t.eq(fly.arc.reached, true, '아크를 돌아 다음 픽스에 도착한다');
  t.ok(Math.abs(fly.straight.worst - fly.sagitta) < 0.05,
    `옛 방식(직선)은 원호의 새그만큼 안쪽을 가로지른다 ` +
    `(${fly.straight.worst.toFixed(2)}NM · 기하값 ${fly.sagitta.toFixed(2)}NM)`);
  t.ok(fly.arc.worst < fly.straight.worst / 4,
    `아크 추종이 직선보다 ${(fly.straight.worst / Math.max(1e-6, fly.arc.worst)).toFixed(0)}배 정확하다`);

  // ── 그려지는 코스선도 원호인가 ──
  // 나는 길과 그려진 길이 다르면 둘 중 하나는 거짓말이다.
  await setup();   // 앞의 '직선' 비교가 arc 를 지운 채로 끝났다 — 다시 세운다
  const drawn = await page.evaluate(([C]) => {
    S.lat = 35.10; S.lon = 128.70;
    updateNav(); updateCrsLine();
    const pts = crsLine.getLatLngs();
    const L = activeCourseLine();
    let worst = 0;
    pts.forEach(p => { worst = Math.max(worst, Math.abs(distance(p.lat, p.lng, C[0], C[1]) - L.arc.r)); });
    return { n: pts.length, worst };
  }, [C]);
  t.ok(drawn.n > 20 && drawn.worst < 0.02,
    `지도의 코스선도 같은 원호로 그려진다 (점 ${drawn.n}개 · 반지름 오차 ${(drawn.worst * 1852).toFixed(0)}m)`);
}
