// ILS 글라이드 패스 — 편차 계산 · 승강계 지시 · 고도 자동 추종
//
// 기준값은 코드와 무관하게 삼각비로 미리 낸다. 3° 강하선이면 GP 안테나에서
// 6NM 떨어진 자리의 강하선 고도는 비행장 표고 + 6×6076.1×tan3° 이다.
export const name = 'ILS 글라이드 패스';

// 김포 14L (ISEL) — GP 안테나 37.56775 / 126.780056, 비행장 표고 59ft, 강하각 3°
const GP = [37.56775, 126.780056], ELEV = 59, ANG = 3, CRS = 143;
const FT_NM = 6076.115;

export async function run(page, t) {
  // 계기를 화면에 띄운다 — 한 번에 한 창이라, 안 띄우면 캔버스가 0×0 이다
  await page.evaluate(() => setSolo('pfd'));
  await page.waitForTimeout(250);
  // 코스 위(접근 쪽) 지정 거리에, 강하선 대비 지정 높이차로 놓는다
  const put = (d, offFt) => page.evaluate(([GP, CRS, d, offFt, ELEV, ANG, FT_NM]) => {
    const p = destPoint(GP[0], GP[1], toTrue(normA(CRS + 180)), d);
    S.lat = p[0]; S.lon = p[1];
    S.alt = ELEV + d * FT_NM * Math.tan(ANG * Math.PI / 180) + offFt;
    S.spd = 120; windSpd = 0;
    return gsDeviation();
  }, [GP, CRS, d, offFt, ELEV, ANG, FT_NM]);

  await page.evaluate(() => {
    setNavRadio('NAV1', '109.90', 'ISEL');   // 김포 14L
    setNavSrc('NAV1');
    gsArmed = false; gsOn = false; altHoldOn = false;
    updateGsBtn();
  });

  // ── 강하선 위에 정확히 있으면 편차 0 ──
  const on = await put(6, 0);
  t.ok(on && Math.abs(on.dev) < 0.01, `강하선 위에서는 편차 0 (${on ? on.dev.toFixed(3) : '없음'}°)`);
  t.ok(Math.abs(on.path - (ELEV + 6 * FT_NM * Math.tan(ANG * Math.PI / 180))) < 1,
    `그 자리 강하선 고도가 삼각비와 같다 (${Math.round(on.path)}ft)`);
  t.ok(Math.abs(on.d - 6) < 0.05, `거리도 맞는다 (${on.d.toFixed(2)}NM)`);
  t.eq(on.angle, 3, '강하각 3°');

  // ── 높으면 +, 낮으면 − · 각도는 삼각비와 같다 ──
  const hi = await put(6, 300);
  const lo = await put(6, -300);
  const want = Math.atan2(300, 6 * FT_NM) * 180 / Math.PI;
  t.ok(Math.abs(hi.dev - want) < 0.01,
    `300ft 높으면 +${want.toFixed(2)}° (${hi.dev.toFixed(2)}°)`);
  t.ok(Math.abs(lo.dev + want) < 0.01, `300ft 낮으면 그 반대 (${lo.dev.toFixed(2)}°)`);
  t.ok(hi.dots > 0 && lo.dots < 0, '점(dot) 부호도 위·아래로 갈린다');
  // 최대편위 0.7° = 2점
  t.ok(Math.abs(hi.dots - hi.dev / 0.35) < 1e-9, `한 점은 0.35° 다 (${hi.dots.toFixed(2)}점)`);

  // ── 안테나 뒤(활주로 너머)에서는 잡히지 않는다 ──
  const behind = await page.evaluate(([GP, CRS]) => {
    const p = destPoint(GP[0], GP[1], toTrue(CRS), 3);   // 접근 방향 너머
    S.lat = p[0]; S.lon = p[1]; S.alt = 1500;
    return gsDeviation();
  }, [GP, CRS]);
  t.eq(behind, null, '안테나 뒤에서는 신호가 없다');

  // ── 너무 멀어도 잡히지 않는다 ──
  const far = await put(30, 0);
  t.eq(far, null, '30NM 밖에서는 신호가 없다');

  // ── GP 가 없는 로컬라이저는 글라이드 패스도 없다 ──
  const noGp = await page.evaluate(() => {
    setNavRadio('NAV1', '111.90', 'IDAG');   // 대구 31R — GP 없음
    S.lat = 35.95; S.lon = 128.60; S.alt = 3000;
    const r = gsDeviation();
    setNavRadio('NAV1', '109.90', 'ISEL');
    return r;
  });
  t.eq(noGp, null, 'GP 가 없는 국에서는 글라이드 패스가 없다');

  // ── 승강계에 마름모가 그려지는가 ──
  // 캔버스라 글자를 읽을 수 없으니 fillText 로 머리글을, 화소로 마름모를 확인한다.
  const drawn = await page.evaluate(async ([GP, CRS, ELEV, ANG, FT_NM]) => {
    const place = (d, off) => {
      const p = destPoint(GP[0], GP[1], toTrue(normA(CRS + 180)), d);
      S.lat = p[0]; S.lon = p[1];
      S.alt = ELEV + d * FT_NM * Math.tan(ANG * Math.PI / 180) + off;
    };
    const shot = () => {
      const proto = CanvasRenderingContext2D.prototype, orig = proto.fillText, seen = [];
      proto.fillText = function (x, ...a) { seen.push(String(x)); return orig.call(this, x, ...a); };
      try { drawPFD(); } finally { proto.fillText = orig; }
      // 승강계 왼쪽 띠에서 자홍색 화소의 세로 무게중심을 찾는다
      const cv = document.getElementById('pfd');
      const g = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const img = g.getImageData(0, 0, W, H).data;
      let sum = 0, n = 0;
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const i = (py * W + px) * 4;
          // 자홍색 — 파랑·빨강이 세고 초록이 확실히 낮은 화소
          if (img[i] > 150 && img[i + 2] > 200 && img[i + 2] - img[i + 1] > 60) { sum += py; n++; }
        }
      }
      return { hasGs: seen.includes('G/S'), n, cy: n ? sum / n : null };
    };
    place(6, 0);   const mid = shot();
    place(6, 400); const high = shot();
    place(6, -400); const low = shot();
    return { mid, high, low };
  }, [GP, CRS, ELEV, ANG, FT_NM]);
  t.eq(drawn.mid.hasGs, true, '승강계에 G/S 머리글이 뜬다');
  t.ok(drawn.mid.n > 20, `마름모가 실제로 그려진다 (자홍색 화소 ${drawn.mid.n}개)`);
  t.ok(drawn.high.cy < drawn.mid.cy - 5 && drawn.low.cy > drawn.mid.cy + 5,
    `높으면 위로, 낮으면 아래로 움직인다 (${Math.round(drawn.high.cy)} · ` +
    `${Math.round(drawn.mid.cy)} · ${Math.round(drawn.low.cy)}px)`);

  // ── 무장하면 강하선에 닿을 때 잡는다 ──
  const cap = await page.evaluate(([GP, CRS, ELEV, ANG, FT_NM]) => {
    // 강하선 아래에서 수평비행으로 다가가다 만나는 흔한 모양 대신,
    // 여기서는 위에서 접근한다(편차가 0 으로 줄어드는지가 요점).
    const place = (d, off) => {
      const p = destPoint(GP[0], GP[1], toTrue(normA(CRS + 180)), d);
      S.lat = p[0]; S.lon = p[1];
      S.alt = ELEV + d * FT_NM * Math.tan(ANG * Math.PI / 180) + off;
    };
    place(8, 600);
    gsArmed = false; gsOn = false; updateGsBtn();
    document.getElementById('gs-btn').click();      // 무장
    const armed = { gsArmed, gsOn, cls: document.getElementById('gs-btn').className };
    gsCaptureCheck();
    const stillArmed = gsOn;                        // 아직 멀리 있으니 잡히면 안 된다
    place(8, 0);                                    // 강하선에 닿았다
    gsCaptureCheck();
    return { armed, stillArmed, capt: gsOn, armedAfter: gsArmed,
             cls: document.getElementById('gs-btn').className };
  }, [GP, CRS, ELEV, ANG, FT_NM]);
  t.ok(cap.armed.gsArmed && !cap.armed.gsOn, '누르면 먼저 무장(ARM)된다');
  t.ok(/armed/.test(cap.armed.cls), `버튼이 무장 모양이다 (${cap.armed.cls})`);
  t.eq(cap.stillArmed, false, '강하선에서 멀면 잡지 않는다');
  t.ok(cap.capt && !cap.armedAfter, '강하선에 닿으면 붙잡는다(CAPT)');

  // ── 붙잡으면 강하선을 따라 내려간다 ──
  // 실제 접근처럼 '강하선 아래에서 수평비행으로 다가가다' 만나게 한다.
  // 위에서 수평으로 다가가면 강하선은 더 내려가므로 영영 만나지 않는다.
  const fly = await page.evaluate(([GP, CRS, ELEV, ANG, FT_NM]) => {
    const p = destPoint(GP[0], GP[1], toTrue(normA(CRS + 180)), 10);
    S.lat = p[0]; S.lon = p[1];
    S.alt = ELEV + 10 * FT_NM * Math.tan(ANG * Math.PI / 180) - 250;   // 250ft 낮게
    S.hdg = toTrue(CRS); S.spd = 120; S.bnk = 0; windSpd = 0;
    altHoldOn = false; navApOn = false; hdgSelOn = false;
    gsArmed = true; gsOn = false; updateGsBtn();
    S.running = true; S.lastT = null;
    const t0 = performance.now(), out = [];
    for (let i = 0; i < 150 / 0.3; i++) {
      simStep(t0 + i * 300);
      if (i % 80 === 0) {
        const g = gsDeviation();
        out.push(`${(i * 0.3) | 0}s ${g ? g.dev.toFixed(2) : '-'}° ${Math.round(S.alt)}ft vs${Math.round(S.vs)}`);
      }
    }
    const g = gsDeviation();
    return { dev: g ? g.dev : null, d: g ? g.d : null, alt: S.alt, vs: S.vs,
             path: g ? g.path : null, capt: gsOn, out };
  }, [GP, CRS, ELEV, ANG, FT_NM]);
  t.eq(fly.capt, true, '날아가는 동안 강하선을 잡는다');
  t.ok(fly.dev !== null && Math.abs(fly.dev) < 0.15,
    `250ft 낮게 다가가도 강하선에 붙는다 (편차 ${fly.dev === null ? '신호없음' : fly.dev.toFixed(2) + '°'} · ` +
    `${fly.d === null ? '-' : fly.d.toFixed(1) + 'NM'})`);
  t.ok(fly.path !== null && Math.abs(fly.alt - fly.path) < 60,
    `고도가 강하선 고도와 같아진다 (${Math.round(fly.alt)}ft · 강하선 ${Math.round(fly.path)}ft)`);
  // 3°·120kt 면 이론 강하율은 약 640fpm
  const wantVs = -120 * Math.tan(3 * Math.PI / 180) * FT_NM / 60;
  t.ok(Math.abs(fly.vs - wantVs) < 150,
    `강하율이 이론값에 가깝다 (${Math.round(fly.vs)}fpm · 이론 ${Math.round(wantVs)}fpm)`);

  // ── 무장·붙잡음이 화면에 뜨는가 ──────────────────────────────
  // 종전에는 자세계 맨 윗줄(FMA)에 'G/S' 라고 적었다. 그 줄은 오토파일럿
  // 모드 표시줄이었는데, 지금 그 자리는 지금 값(GS·HDG·ALT·VS)을 읽는 자리가
  // 됐다. G/S 는 조작부가 시뮬 전용(sim-only)이라 항법 보조 모드에서는
  // 켤 수도 없으니, 남은 두 자리로 상태를 본다.
  //   · G/S 버튼 자체 — ARM / CAPT 를 글자와 색으로 보인다
  //   · 승강계 옆 마름모 — 강하선 대비 어디에 있는지(이쪽은 항법 표시라 그대로다)
  const gsUi = await page.evaluate(([GP, CRS, ELEV, ANG, FT_NM]) => {
    const p = destPoint(GP[0], GP[1], toTrue(normA(CRS + 180)), 6);
    S.lat = p[0]; S.lon = p[1];
    S.alt = ELEV + 6 * FT_NM * Math.tan(ANG * Math.PI / 180);
    S.spd = 120; gspdOn = false; altHoldOn = true;
    const btn = () => {
      const b = document.getElementById('gs-btn');
      return { txt: b.textContent.replace(/\s+/g, ''), cls: b.className };
    };
    // 승강계 마름모 — 자홍색으로 칠해지는 도형이 있는지 본다
    const diamond = () => {
      const proto = CanvasRenderingContext2D.prototype, orig = proto.fill;
      let seen = false;
      proto.fill = function (...a) {
        const c = String(this.fillStyle).toLowerCase();
        if (c === '#ff66ff' || c === '#ff44ff') seen = true;
        return orig.apply(this, a);
      };
      try { drawPFD(); } finally { proto.fill = orig; }
      return seen;
    };
    gsArmed = false; gsOn = false; updateGsBtn();
    const off = { ...btn(), dia: diamond() };
    gsArmed = true;  gsOn = false; updateGsBtn();
    const arm = { ...btn(), dia: diamond() };
    gsArmed = false; gsOn = true;  updateGsBtn();
    const cap = { ...btn(), dia: diamond() };
    gsArmed = false; gsOn = false; updateGsBtn();
    return { off, arm, cap };
  }, [GP, CRS, ELEV, ANG, FT_NM]);
  t.eq(gsUi.off.txt, 'G/S', `평소에는 버튼에 G/S 만 적힌다 (${gsUi.off.txt})`);
  t.ok(!/\barmed\b|\bon\b/.test(gsUi.off.cls), `그때는 불도 꺼져 있다 (${gsUi.off.cls})`);
  t.ok(/ARM$/.test(gsUi.arm.txt), `무장하면 ARM 이 붙는다 (${gsUi.arm.txt})`);
  t.ok(/\barmed\b/.test(gsUi.arm.cls), `무장 색으로 바뀐다 (${gsUi.arm.cls})`);
  t.ok(/CAPT$/.test(gsUi.cap.txt), `붙잡으면 CAPT 로 바뀐다 (${gsUi.cap.txt})`);
  t.ok(/\bon\b/.test(gsUi.cap.cls), `붙잡음 색으로 바뀐다 (${gsUi.cap.cls})`);
  // 강하선 지시(마름모)는 계기 쪽 일이라 무장·붙잡음과 상관없이 떠 있어야 한다 —
  // ILS 를 맞춰 두면 자동조종을 안 쓰더라도 강하선 대비 위치는 보여야 한다.
  t.eq(gsUi.off.dia, true, 'ILS 를 맞춰 두면 강하선 마름모는 늘 떠 있다');
  t.eq(gsUi.cap.dia, true, '붙잡은 뒤에도 그대로다');

  // 뒷정리
  await page.evaluate(() => {
    gsArmed = false; gsOn = false; updateGsBtn();
    altHoldOn = false; S.running = false; setNavSrc('FMS');
  });
}
