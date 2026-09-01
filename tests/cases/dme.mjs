// DME 경사거리(slant range)
//
// DME 는 항공기와 지상국 사이의 직선거리를 잰다. 수평거리가 아니다.
// 6,000ft 로 송신소 상공을 지나면 0 이 아니라 6,000ft(=0.99NM)에서 멈춘다.
// 종전에는 수평거리만 시현해 상공에서 0.0 이 됐다.
// 기준값은 코드와 무관하게 피타고라스로 미리 계산한다.
export const name = 'DME 경사거리';

const SEL = [37.41361, 126.92833];   // 안양 VORTAC 115.5

export async function run(page, t) {
  const setup = (altFt, distNM) => page.evaluate(([SEL, altFt, distNM]) => {
    setNavRadio('NAV1', '115.5', 'SEL');
    navSrc = 'NAV1'; applyNavRadioToPfd(); obsOn = false;
    S.alt = altFt;
    const p = distNM === 0 ? SEL : destPoint(SEL[0], SEL[1], 45, distNM);
    S.lat = p[0]; S.lon = p[1];
    const st = brg1Station();
    return { horiz: distance(S.lat, S.lon, SEL[0], SEL[1]),
             dme: dmeDist(SEL[0], SEL[1], 0),
             viaStation: st ? dmeDist(st.lat, st.lon, st.elev) : null };
  }, [SEL, altFt, distNM]);

  const FT_NM = 6076.115;
  const want = (alt, d) => Math.sqrt(d * d + (alt / FT_NM) * (alt / FT_NM));

  // ── 상공 통과 — 0 이 아니라 고도만큼 남는다 ──
  const over = await setup(6000, 0);
  t.ok(over.horiz < 0.001, `수평거리는 상공에서 0 이다 (${over.horiz.toFixed(4)}NM)`);
  t.ok(Math.abs(over.dme - 0.988) < 0.002,
    `6,000ft 상공의 DME 는 0.99NM 이다 (${over.dme.toFixed(3)}NM — 6000/6076.1 = ${want(6000, 0).toFixed(3)})`);
  t.ok(Math.abs(over.viaStation - over.dme) < 1e-9,
    'BRG1/PFD 가 쓰는 국 정보로 계산해도 같다');

  // ── 거리별로 피타고라스와 맞는가 ──
  for (const [alt, d] of [[6000, 0], [6000, 1], [10000, 5], [3000, 20], [0, 12]]) {
    const r = await setup(alt, d);
    const w = want(alt, r.horiz);
    t.ok(Math.abs(r.dme - w) < 0.002,
      `${alt}ft · ${d}NM → DME ${r.dme.toFixed(3)}NM (기하값 ${w.toFixed(3)})`);
  }

  // ── 멀어지면 수평거리에 수렴한다 ──
  const far = await setup(6000, 40);
  t.ok(far.dme - far.horiz < 0.02 && far.dme > far.horiz,
    `멀리서는 수평거리와 사실상 같다 (차이 ${((far.dme - far.horiz) * 1852).toFixed(0)}m)`);

  // ── PFD 우측 NAV1 줄에 실제로 그 값이 찍히는가 ──
  // 캔버스라 글자를 읽을 수 없으니 fillText 를 잠깐 엿본다.
  const drawn = await page.evaluate(([SEL]) => {
    setNavRadio('NAV1', '115.5', 'SEL');
    navSrc = 'NAV1'; applyNavRadioToPfd();
    S.alt = 6000; S.lat = SEL[0]; S.lon = SEL[1];
    S.awp = -1;                                  // FMS 줄은 '----'
    const proto = CanvasRenderingContext2D.prototype;
    const orig = proto.fillText;
    const seen = [];
    proto.fillText = function (txt, ...a) { seen.push(String(txt)); return orig.call(this, txt, ...a); };
    try { drawPFD(); } finally { proto.fillText = orig; }
    return seen;
  }, [SEL]);
  const nmTxt = drawn.filter(s => /NM$/.test(s.trim())).map(s => s.trim());
  t.ok(nmTxt.includes('1.0 NM'),
    `PFD NAV1 줄이 1.0 NM 을 보여 준다 (${nmTxt.join(' / ') || '없음'})`);
  t.ok(!nmTxt.includes('0.0 NM'),
    '종전처럼 0.0 NM 으로 떨어지지 않는다');

  // ── 지도 BRG1 이름표도 같은 값이다 ──
  // 계기와 지도가 다른 거리를 말하면 둘 중 하나는 거짓말이다.
  const lbl = await page.evaluate(() => {
    brg1Visible = true; brg1LblOn = true; updateNav();
    const el = _brg1Ref.mk && _brg1Ref.mk.getElement();
    return el ? el.firstChild.textContent : '';
  });
  t.ok(/1\.0NM$/.test(lbl), `지도 BRG1 이름표도 경사거리다 (${lbl})`);

  // ── FMS(GPS) 거리는 수평거리 그대로다 ──
  const fms = await page.evaluate(([SEL]) => {
    S.alt = 6000; S.lat = SEL[0]; S.lon = SEL[1];
    S.wps = [{ ident: 'OVER', lat: SEL[0], lon: SEL[1] }];
    S.awp = 0; navSrc = 'FMS'; applyNavRadioToPfd(); updateNav();
    return { dtw: S.dtw, brg2: (() => {
      brg2Visible = true; brg2LblOn = true; updateBrgLines();
      const el = _brg2Ref.mk && _brg2Ref.mk.getElement();
      return el ? el.firstChild.textContent : '';
    })() };
  }, [SEL]);
  t.ok(fms.dtw < 0.001, `FMS 거리는 수평거리다 — 상공에서 0 (${fms.dtw.toFixed(4)}NM)`);
  t.ok(/0\.0NM$/.test(fms.brg2), `BRG2(FMS)도 수평거리다 (${fms.brg2})`);
}
