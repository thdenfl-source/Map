// 차트 위치보정 — 변환 모델 정확도·거울반전·품질 게이트
export const name = '차트 위치보정';

export async function run(page, t) {
  const r = await page.evaluate(() => {
    const D = Math.PI / 180;
    // 앱과 동일한 등각(메르카토르) 좌표 + 반전 포함 페이지 변환으로 가상 차트 생성
    const mk = (lat, lon) => _pdfGeoXY(lat, lon, 38.0);
    const O = mk(38.0, 128.7);
    const mkPage = (rot, sc) => {
      const ra = sc * Math.cos(rot * D), rb = sc * Math.sin(rot * D);
      return (lat, lon) => { const q = mk(lat, lon), dx = q.x - O.x, dy = q.y - O.y;
        return { fx: 0.5 + ra * dx + rb * dy, fy: 0.5 + rb * dx - ra * dy }; };
    };
    const page = mkPage(330, 1.2);
    const P = (nm, la, lo, pla, plo) => { const p = page(pla === undefined ? la : pla, plo === undefined ? lo : plo);
      return { name: nm, lat: la, lon: lo, fx: p.fx, fy: p.fy }; };

    // ① 반전 포함 차트를 2점만으로도 정확히 재현하는가(회전만 모델링하면 뒤집힘)
    const two = [P('a', 37.95, 128.60), P('b', 38.10, 128.85)];
    const f2 = _pdfFit(two);
    const chk = [[38.05, 128.55], [37.90, 128.90], [38.00, 128.70]].map(([la, lo]) => {
      const tp = page(la, lo), e = _pdfApply(f2, la, lo);
      return Math.hypot(e.fx - tp.fx, e.fy - tp.fy);
    });

    // ② 3점 닮음변환이 보정점 밖에서도 맞는가
    const three = [P('a', 37.95, 128.60), P('b', 38.10, 128.85), P('c', 38.02, 128.95)];
    const f3 = _pdfFit(three);
    const off = (() => { const tp = page(37.88, 128.72), e = _pdfApply(f3, 37.88, 128.72);
      return Math.hypot(e.fx - tp.fx, e.fy - tp.fy); })();

    // ③ 품질 게이트: 페이지 위치는 맞고 좌표만 틀린 점을 잡아내는가
    const gate = pts => {
      const fit = _pdfFit(pts);
      const rm = _pdfCalibRmsMeters(pts, fit.rms);
      const sc = _pdfScaleCheck(pts);
      let span = 0;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
        span = Math.max(span, distance(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon) * 1852);
      const warn = (rm != null && span > 0 && rm > span * 0.08) || (rm != null && rm > 3700)
                || (sc && sc.ratio > 1.25);
      const bad = _pdfWorstPoint(fit, pts);
      return { warn: !!warn, bad: bad ? bad.label : null, kind: fit.kind };
    };
    const good3 = gate([P('a', 37.95, 128.60), P('b', 38.10, 128.85), P('c', 38.02, 128.95)]);
    const good4 = gate([P('a', 37.95, 128.60), P('b', 38.10, 128.85), P('c', 38.02, 128.95), P('d', 37.92, 128.90)]);
    // 좌표만 다른 값으로 지정(페이지 위치는 정상)
    const bad3  = gate([P('a', 37.95, 128.60), P('b', 38.10, 128.85), P('나쁨', 38.10, 128.85, 38.02, 128.95)]);
    const bad4  = gate([P('a', 37.95, 128.60), P('b', 38.10, 128.85), P('c', 38.02, 128.95),
                        P('나쁨', 38.02, 128.95, 37.92, 128.90)]);
    return { two: { mir: f2.mir, chk }, three: { kind: f3.kind, off }, good3, good4, bad3, bad4 };
  });

  t.ok(Math.max(...r.two.chk) < 1e-9,
    `2점 보정이 반전 차트를 정확히 재현 (최대 ${Math.max(...r.two.chk).toExponential(1)})`);
  t.ok(r.three.off < 1e-9, `3점 닮음변환이 보정점 밖에서도 일치 (${r.three.off.toExponential(1)})`);
  t.eq(r.good3.warn, false, '정상 3점 — 경고 없음');
  t.eq(r.good4.warn, false, '정상 4점 — 경고 없음');
  t.eq(r.bad3.warn, true, '3점 중 1점 좌표 오선택 — 경고');
  t.eq(r.bad4.warn, true, '4점 중 1점 좌표 오선택 — 경고');
  t.eq(r.bad4.bad, '나쁨', '4점이면 어긋난 점을 지목');
}
