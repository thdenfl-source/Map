// 헤딩 — 나침반으로 돌리고 GPS 항적으로 맞춘다(HYBRID)
//
// 종전에는 20km/h 를 경계로 둘 중 하나만 썼다. 그 위에서는 GPS 항적만 썼는데
// 위치는 3초에 한 번 들어오므로 나침반 카드가 3초마다 뚝뚝 끊겨 돌았다.
// (게다가 발열을 줄이려고 그 속도에서는 나침반 센서를 아예 놓아 버렸다)
//
// 이제 화면은 늘 기기 나침반이 돌리고, GPS 는 그 값을 항적 쪽으로 조금씩
// 맞추는 데만 쓴다. 여기서 그 두 갈래와, 나침반이 없을 때의 물러섬을 붙잡는다.
export const name = '헤딩(HYBRID)';

export async function run(page, t) {
  // 나침반 한 번 — 스로틀(0.1초)을 지나 바로 반영되게 해 둔다
  const compass = h => page.evaluate(hh => {
    _devHdgLastApply = 0;
    _onDevOrientation({ webkitCompassHeading: hh, beta: null, gamma: null,
                        alpha: null, absolute: false });
    return S.hdg;
  }, h);

  // 나침반을 여러 번 먹여 화면이 목표에 붙게 한다(_hdgGlide 가 조금씩 옮긴다)
  const settle = async (h, n = 30) => { for (let i = 0; i < n; i++) await compass(h); };

  // GPS 한 번 — spdMs 는 m/s, trk 는 항적(°)
  const fix = (trk, spdMs, lat = 37.5, lon = 127.0) => page.evaluate(([trk, spdMs, lat, lon]) => {
    applyGPS({ coords: { latitude: lat, longitude: lon, speed: spdMs, heading: trk,
                         altitude: 300, accuracy: 8 }, timestamp: Date.now() });
    return { hdg: S.hdg, bias: _hdgBias, src: _hdgSrc, spd: S.spd };
  }, [trk, spdMs, lat, lon]);

  // 검사 사이에 상태를 처음으로 되돌린다
  const reset = (dev = true) => page.evaluate(devOk => {
    gpsMode = true; ahrsOn = false; _gpsPrev = null;
    _hdgBias = 0; _hdgSrc = null;
    S.hdg = 0; S.bnk = 0;
    _devHdg = devOk ? null : null;
    _devHdgAt = 0;
    _devHdgLastApply = 0;
  }, dev);

  // ── ① 나침반이 화면을 돌린다 — GPS 와 상관없이 ────────────────
  // 종전에는 20km/h 를 넘으면 나침반을 놓았고, 그래서 GPS 가 오기 전까지
  // 카드가 멈춰 있었다. 지금은 GPS 를 한 번도 안 받아도 돈다.
  await reset();
  await settle(100);
  const onlyDev = await page.evaluate(() => ({ hdg: S.hdg, src: _hdgSrc }));
  t.ok(Math.abs(onlyDev.hdg - 100) < 0.5,
    `GPS 없이 나침반만으로도 헤딩이 돈다 (${onlyDev.hdg.toFixed(1)}°)`);
  t.eq(onlyDev.src, 'DEV', `그때 출처는 나침반이다 (${onlyDev.src})`);

  // ── ② 한 번에 확 튀지 않는다 ─────────────────────────────────
  // 나침반 값은 떨린다. 한 번에 다 옮기면 그 떨림이 그대로 카드의 떨림이 된다.
  const step = await page.evaluate(() => {
    S.hdg = 0; _devHdgLastApply = 0;
    _onDevOrientation({ webkitCompassHeading: 90, beta: null, gamma: null, alpha: null, absolute: false });
    return S.hdg;
  });
  t.ok(step > 5 && step < 85,
    `센서 한 번에 목표까지 다 가지 않는다 (0° → ${step.toFixed(1)}°, 목표 90°)`);
  await settle(90);
  const reached = await page.evaluate(() => S.hdg);
  t.ok(Math.abs(reached - 90) < 0.5, `이어서 먹이면 목표에 붙는다 (${reached.toFixed(1)}°)`);

  // ── ③ GPS 항적이 나침반을 맞춰 준다 ──────────────────────────
  // 나침반이 거치 각도·자기 간섭으로 30° 틀어져 있다고 하자. 항적이 들어올
  // 때마다 보정값이 그쪽으로 조금씩 실려, 몇 번 만에 맞춰져야 한다.
  await reset();
  await settle(100);                      // 나침반은 100° 를 가리킨다
  const one = await fix(130, 30);         // 실제 항적은 130° (약 58kt)
  t.eq(one.src, 'HYBRID', `움직이는 중에는 항적으로 맞춘다 (${one.src})`);
  t.ok(Math.abs(one.bias - 7.5) < 0.6,
    `한 번에 오차의 1/4 만 싣는다 (오차 30° → 보정 ${one.bias.toFixed(1)}°)`);
  t.ok(one.hdg > 100 && one.hdg < 130,
    `그래서 화면도 한 번에 항적까지 가지 않는다 (${one.hdg.toFixed(1)}°)`);

  // 여러 번 받으면 항적에 수렴한다
  for (let i = 0; i < 12; i++) { await fix(130, 30); await settle(100, 12); }
  const conv = await page.evaluate(() => ({ hdg: S.hdg, bias: _hdgBias }));
  t.ok(Math.abs(((conv.hdg - 130 + 540) % 360) - 180) < 2,
    `갱신이 쌓이면 항적에 붙는다 (${conv.hdg.toFixed(1)}° / 항적 130°)`);

  // ── ④ 튀는 항적 하나에 통째로 끌려가지 않는다 ────────────────
  // 저속·다중경로에서 항적은 크게 튄다. 한 걸음의 크기를 물려 둔다.
  await reset();
  await settle(0);
  const wild = await fix(180, 30);        // 오차 180° — 있을 수 없는 값은 아니다
  t.ok(Math.abs(wild.bias) <= 20.01,
    `한 번에 20° 넘게 돌리지 않는다 (보정 ${wild.bias.toFixed(1)}°)`);

  // ── ⑤ 느릴 때는 항적으로 맞추지 않는다 ───────────────────────
  // 제자리에서 도는 동안에도 항적은 한 점이라 방향을 못 잡는다.
  await reset();
  await settle(100);
  const slow = await fix(200, 3);         // 약 5.8kt — 기준(20km/h) 아래
  t.eq(slow.bias, 0, `느리면 보정하지 않는다 (보정 ${slow.bias}°)`);
  t.eq(slow.src, 'DEV', `그때 출처는 나침반이다 (${slow.src})`);
  t.ok(Math.abs(slow.hdg - 100) < 1,
    `화면도 나침반 그대로다 (${slow.hdg.toFixed(1)}° / 튀는 항적 200°)`);

  // ── ⑥ 나침반이 없으면 종전처럼 항적을 그대로 쓴다 ────────────
  // 권한을 거부했거나 센서가 없는 기기(데스크톱)다. 3초마다 끊겨 보여도
  // 아무것도 안 보이는 것보다는 낫다.
  await reset();
  const noDev = await fix(250, 30);
  t.eq(noDev.src, 'GPS', `나침반이 없으면 항적으로 그린다 (${noDev.src})`);
  t.eq(Math.round(noDev.hdg), 250, `그때는 항적을 그대로 꽂는다 (${noDev.hdg}°)`);

  // ── ⑦ 나침반이 끊기면 항적으로 물러난다 ──────────────────────
  // 값이 한 번 들어온 뒤 센서가 조용해지는 일이 있다(화면 꺼짐·권한 회수).
  // 옛 값을 붙들고 있으면 카드가 멈춘 채로 남는다.
  await reset();
  await settle(100);
  const stale = await page.evaluate(() => {
    _devHdgAt = Date.now() - 5000;        // 5초 전 값 — 이미 지났다
    applyGPS({ coords: { latitude: 37.5, longitude: 127.0, speed: 30, heading: 220,
                         altitude: 300, accuracy: 8 }, timestamp: Date.now() });
    return { hdg: S.hdg, src: _hdgSrc };
  });
  t.eq(stale.src, 'GPS', `나침반이 오래 조용하면 항적으로 물러난다 (${stale.src})`);
  t.eq(Math.round(stale.hdg), 220, `그때 헤딩은 항적이다 (${stale.hdg}°)`);

  // ── ⑧ 빨라져도 나침반을 놓지 않는다 ──────────────────────────
  // 종전에는 12kt 를 넘으면 발열을 줄이려고 센서를 떼었다. 그 속도야말로
  // 나침반이 있어야 하는 구간이다 — 놓으면 다시 3초마다 끊긴다.
  const bound = await page.evaluate(() => {
    gpsMode = true;
    _devHdgAuto();                        // 느릴 때
    const slow = _devHdgBound;
    S.spd = 120;
    _devHdgAuto();                        // 빠를 때
    return { slow, fast: _devHdgBound };
  });
  t.eq(bound.slow, true, '느릴 때 나침반을 듣는다');
  t.eq(bound.fast, true, '빨라져도 계속 듣는다');

  // 뒷정리 — 다음 검사가 이 상태를 물려받지 않게 한다
  await page.evaluate(() => {
    gpsMode = false; _gpsPrev = null; _devHdg = null; _devHdgAt = 0;
    _hdgBias = 0; _hdgSrc = null;
    try { stopDevOrientation(); } catch (e) {}
  });
}
