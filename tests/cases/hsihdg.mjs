// 나침반 모서리 — CRS 자리 · NAV 소스 테두리 버튼
//
// 세 가지가 한꺼번에 바뀐 자리다.
//   · 나침반 위 HDG 상자를 내렸다. 기수방위는 맨 윗줄(GS·HDG·ALT·VS)에서
//     읽는다 — 나침반 바로 위에 또 적으면 두 자리가 같은 값을 두고 다툰다.
//   · CRS 는 왼쪽 아래(OAT 아래)로 내려왔다. 바탕은 깔지 않는다 —
//     검은 바탕은 이제 '고른 NAV 소스' 하나만 쓰는 표시다.
//   · FMS·NAV1·NAV2 글자판이 사각 테두리를 두르고, 그 테두리가 곧 버튼이다.
//     조작부에 있던 버튼 세 개를 내린 만큼 나침반이 커졌다.
//
// 같은 자리에 있던 풍향/풍속(279°/00kt)도 내렸다. 이 앱에는 대기속도(IAS)가
// 없어 바람을 잴 방법이 없다 — 시뮬레이터 시절 조작부로만 바뀌던 값이라
// 늘 처음 값이 그대로 떠 있었다.
export const name = '모서리 CRS · 소스 테두리';

export async function run(page, t) {
  // 한 번 그리는 동안 캔버스에 찍힌 글자와 상자를 모두 받아 적는다.
  // 무엇이 어떤 글꼴로 어디에 그려졌는지는 화면을 눈으로 보지 않고 알 수 없어,
  // 이 화면은 그동안 조용히 깨지곤 했다.
  const draw = () => page.evaluate(() => {
    S.hdg = 40; selHdg = 222;          // 둘을 뚜렷이 다르게 둬야 섞이지 않는다
    const g = ctx;
    const oT = g.fillText, oF = g.fillRect, oS = g.strokeRect;
    const calls = [], fills = [], strokes = [];
    g.fillText = function (txt, x, y) {
      calls.push({ txt: String(txt), x, y, font: this.font, align: this.textAlign,
                   col: String(this.fillStyle), w: this.measureText(String(txt)).width });
      return oT.apply(this, arguments);
    };
    g.fillRect = function (x, y, w, h) {
      fills.push({ x, y, w, h, col: String(this.fillStyle) });
      return oF.apply(this, arguments);
    };
    g.strokeRect = function (x, y, w, h) {
      strokes.push({ x, y, w, h, col: String(this.strokeStyle), lw: this.lineWidth });
      return oS.apply(this, arguments);
    };
    try { resizePFD(); drawPFD(); }
    finally { g.fillText = oT; g.fillRect = oF; g.strokeRect = oS; }

    const px = f => parseFloat(String(f).match(/(\d*\.?\d+)px/)[1]);
    const last = txt => { const a = calls.filter(c => c.txt === txt); return a[a.length - 1]; };
    const span = c => c && (c.align === 'right' ? [c.x - c.w, c.x] : [c.x, c.x + c.w]);
    const hdgTxt = fmtA(toMag(S.hdg)) + '°', selTxt = fmtA(toMag(selHdg)) + '°';
    const crsTxt = fmtA(toMag(activeCrs())) + '°';
    // 나침반 칸의 위치 — drawPFD 와 같은 셈
    const ctrlEl = document.querySelector('.ctrl-bar');
    const usableH = cvs.height - (ctrlEl ? ctrlEl.offsetHeight : 80);
    const bandH = hsiBandH();
    const hsiWant = Math.round(cvs.width * 0.40 * 2 + bandH * 2 + 10);
    const hsiH = Math.max(Math.round(usableH * 0.34),
                          Math.min(Math.round(usableH * 0.50), hsiWant));
    const hsiY = usableH - hsiH;
    return {
      scale: pfdFontScale, canvasW: cvs.width,
      hsiY, hsiH, bandH, botY: hsiY + hsiH - bandH,
      crs: last('CRS'), crsVal: last(crsTxt), oat: last('OAT'),
      crsLblPx: px(last('CRS').font), crsValPx: px(last(crsTxt).font),
      crsSpan: span(last('CRS')), crsValSpan: span(last(crsTxt)),
      // 모서리 NAV 값과 같은 규격이어야 한다
      navLblPx: px(last('NAV1').font),
      navValPx: px(calls.filter(c => c.txt === 'FMS').length
        ? last(navInfoRows()[0].dst).font : last(crsTxt).font),
      // 'HDG' 는 맨 윗줄 값판에도 있다. 여기서 세는 것은 나침반 칸 안이다.
      hdgLbl: calls.filter(c => c.txt === 'HDG' && c.y > hsiY).length,
      hdgTop: calls.filter(c => c.txt === 'HDG' && c.y > 0 && c.y <= hsiY).length,
      hdgDrawn: calls.filter(c => c.txt === hdgTxt).length,
      selDrawn: calls.filter(c => c.txt === selTxt).length,
      hdgTxt, selTxt, crsTxt,
      // 풍향/풍속은 '279°/00kt' 꼴로 한 덩이로 그려졌다
      windDrawn: calls.filter(c => /^\d{3}°\/\d+kt$/.test(c.txt)).map(c => c.txt),
      fills, strokes,
      hits: hsiHitBoxes.map(b => ({ ...b })),
      navSrc,
    };
  });

  for (const [w, h, label] of [[320, 568, '작은 폰'], [360, 780, '폰'], [390, 844, '폰(큰)'],
                               [810, 1080, '패드'], [1900, 1030, '데스크톱']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => setSolo('pfd'));
    await page.waitForTimeout(250);
    const r = await draw();
    const L = `${label} ${w}px`;

    // ── 나침반 위에는 HDG 상자가 없다 ────────────────────────
    // 기수방위는 맨 윗줄에서 읽고, 어느 쪽인지는 나침반 꼭대기 삼각형이 본다.
    t.eq(r.hdgLbl, 0, `${L} — 나침반 칸에 HDG 상자가 없다 (${r.hdgLbl}곳)`);
    t.eq(r.hdgTop, 1, `${L} — 대신 맨 윗줄에 HDG 가 한 번 선다 (${r.hdgTop}곳)`);
    t.eq(r.selDrawn, 0,
      `${L} — 컴퍼스 옆 회색 헤딩(${r.selTxt})도 적지 않는다 (${r.selDrawn}번)`);

    // ── 바람은 내렸다 ────────────────────────────────────────
    // 바람은 대기속도 벡터와 대지속도 벡터의 차로 나온다. 이 앱에는
    // 대기속도가 없으니 잴 수가 없고, 값은 시뮬레이터 시절 조작부(WDIR·WSPD)
    // 로만 바뀌던 것이라 늘 처음 값(270°/0kt)이 그대로 떠 있었다.
    t.eq(r.windDrawn.length, 0,
      `${L} — 잴 수 없는 바람을 적지 않는다${r.windDrawn.length ? ' (' + r.windDrawn.join(',') + ')' : ''}`);

    // ── CRS 는 왼쪽 아래, OAT 아래 줄이다 ─────────────────────
    t.ok(r.crs && r.crsVal, `${L} — CRS 와 그 값(${r.crsTxt})이 그려진다`);
    t.ok(r.crs.x < r.canvasW * 0.25,
      `${L} — CRS 가 왼쪽 끝에 붙는다 (x=${Math.round(r.crs.x)} / ${r.canvasW}px)`);
    t.ok(r.crs.y > r.oat.y,
      `${L} — OAT 아래 줄이다 (OAT y=${Math.round(r.oat.y)} < CRS y=${Math.round(r.crs.y)})`);
    t.ok(r.crs.y > r.botY && r.crs.y <= r.hsiY + r.hsiH + 1,
      `${L} — 나침반 아래 띠 안에 있다 (${Math.round(r.crs.y)} / ${Math.round(r.botY)}~${Math.round(r.hsiY + r.hsiH)})`);
    t.ok(r.crsSpan[1] < r.crsValSpan[0],
      `${L} — 이름표와 값이 겹치지 않는다 (${r.crsSpan[1].toFixed(1)} < ${r.crsValSpan[0].toFixed(1)})`);
    t.ok(r.crsSpan[0] > 0 && r.crsValSpan[1] < r.canvasW,
      `${L} — 두 글자가 화면 안에 있다 (${r.crsSpan[0].toFixed(0)}~${r.crsValSpan[1].toFixed(0)})`);

    // ── CRS 바탕은 없다 ──────────────────────────────────────
    // 종전에는 나침반 위 검은 상자였다. 검은 바탕은 이제 '고른 소스' 표시다.
    // 계기 바탕(검은 화면 · 갈색 나침반 칸)은 세지 않는다 — 여기서 보는 것은
    // 글자 뒤에 따로 깔린 '상자' 다. 띠 높이 안에 들어오는 것만 상자로 본다.
    const crsBg = r.fills.filter(f =>
      f.h <= r.bandH * 1.2 && f.w <= r.canvasW * 0.5 &&
      f.x <= r.crsSpan[0] && f.x + f.w >= r.crsSpan[0] &&
      f.y <= r.crs.y && f.y + f.h >= r.crs.y - 4);
    t.eq(crsBg.length, 0,
      `${L} — CRS 글자 뒤에 바탕을 깔지 않는다 (${crsBg.length}겹)`);

    // ── 글씨는 모서리 규격(이름표 14 · 값 21)이다 ─────────────
    t.eq(r.crsLblPx, r.navLblPx,
      `${L} — CRS 이름표가 NAV 이름표와 같은 크기다 (${r.crsLblPx}px)`);
    t.eq(r.crsValPx, Math.round(16 * 1.3) * r.scale,
      `${L} — CRS 값이 모서리 값 크기다 (${r.crsValPx}px)`);

    // ── 소스 셋이 사각 테두리를 두른다 ────────────────────────
    const navHits = r.hits.filter(b => b.act === 'navSrc');
    t.eq(navHits.length, 3, `${L} — FMS·NAV1·NAV2 셋이 테두리를 두른다 (${navHits.length}개)`);
    for (const b of navHits) {
      const box = r.strokes.find(s2 => Math.abs(s2.x - b.x) < 0.5 && Math.abs(s2.y - b.y) < 0.5);
      t.ok(box, `${L} — ${b.src} 테두리가 실제로 그려진다`);
      t.ok(b.w > 30 && b.h >= 24,
        `${L} — ${b.src} 테두리가 손가락으로 누를 크기다 (${Math.round(b.w)}×${Math.round(b.h)}px)`);
      t.ok(b.x >= -1 && b.x + b.w <= r.canvasW + 1,
        `${L} — ${b.src} 테두리가 화면 안에 있다 (${Math.round(b.x)}~${Math.round(b.x + b.w)})`);
    }

    // ── 고른 소스만 바탕이 검다 ──────────────────────────────
    const selHit = navHits.find(b => b.src === r.navSrc);
    const black = r.fills.filter(f => f.col.toLowerCase() === '#000000' || f.col.toLowerCase() === '#000');
    const selBg = black.find(f => Math.abs(f.x - selHit.x) < 0.5 && Math.abs(f.y - selHit.y) < 0.5);
    t.ok(selBg, `${L} — 고른 소스(${r.navSrc})는 검은 바탕이다`);
    for (const b of navHits.filter(x => x.src !== r.navSrc)) {
      const bg = black.find(f => Math.abs(f.x - b.x) < 0.5 && Math.abs(f.y - b.y) < 0.5);
      t.ok(!bg, `${L} — 고르지 않은 ${b.src} 에는 바탕이 없다`);
    }
  }

  // ── 테두리를 누르면 그 소스가 선택된다 ──────────────────────
  await page.setViewportSize({ width: 412, height: 900 });
  await page.evaluate(() => setSolo('pfd'));
  await page.waitForTimeout(250);
  const tap = await page.evaluate(() => {
    setNavRadio('NAV1', '109.30', null);
    setNavSrc('FMS'); drawPFD();
    const rect = cvs.getBoundingClientRect();
    const hit = src => {
      const b = hsiHitBoxes.find(q => q.src === src);
      const x = rect.left + (b.x + b.w / 2) * (rect.width / cvs.width);
      const y = rect.top  + (b.y + b.h / 2) * (rect.height / cvs.height);
      cvs.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
      return navSrc;
    };
    const before = navSrc;
    const toNav1 = hit('NAV1');
    const back   = hit('FMS');
    // 아무것도 없는 자리를 눌러도 소스가 바뀌지 않는다
    cvs.dispatchEvent(new MouseEvent('click', {
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height * 0.2, bubbles: true }));
    return { before, toNav1, back, after: navSrc,
             oatHit: hsiHitBoxes.filter(b => b.act === 'oat').length };
  });
  t.eq(tap.before, 'FMS', '누르기 전에는 FMS 다');
  t.eq(tap.toNav1, 'NAV1', 'NAV1 테두리를 누르면 NAV1 이 선택된다');
  t.eq(tap.back, 'FMS', 'FMS 테두리를 누르면 되돌아온다');
  t.eq(tap.after, 'FMS', '빈 자리를 눌러도 소스는 그대로다');
  t.eq(tap.oatHit, 1, 'OAT 를 누를 자리도 그대로 있다');

  // 뒷정리 — 다음 검사가 이 상태를 물려받지 않게 한다
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => { setSolo('map'); });
  await page.waitForTimeout(200);
}
