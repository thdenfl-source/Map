// PFD 의 CRS 라벨을 눌러 코스를 '지금 자리' 로 다시 잡기.
//
// 코스선은 '그 지점을 지나고, 그 지점에서의 방위가 CRS 인 대권' 이다.
// 그래서 항공기에서 본 지점 방위를 그대로 CRS 에 넣으면 어긋난다 — 대권의
// 방위는 양 끝에서 다르기 때문이다(수렴각). 82NM 에서 1° 는 1.4NM 이고,
// 지도에서는 코스선이 항공기를 비켜 가는 것으로 그대로 보인다.
// 여기서는 '눌렀을 때 정말로 코스선이 항공기를 지나는가' 를 편차로 잰다.
export const name = 'CRS 현 위치 동기';

// 부산(김해) — 화면에서 재현된 것과 같은 먼 거리(약 82NM)
const RKPK = [35.1796, 128.9382];
const AC   = [36.2992, 127.9542];

export async function run(page, t) {
  const fms = await page.evaluate(([W, A]) => {
    S.wps = [{ ident: 'RKPK', lat: W[0], lon: W[1] }];
    S.awp = 0; S.fwp = -1; navSrc = 'FMS'; holdExit(); obsOn = true;
    S.lat = A[0]; S.lon = A[1]; S.hdg = 198;
    S.crs = toTrue(300);                       // 엉뚱한 코스로 틀어 두고
    updateNav();
    const beforeXtk = courseXtk(activeCourseLine());
    document.getElementById('crs-lbl-btn').click();
    const L = activeCourseLine();
    // 지도에 그려지는 선에서도 같은지 — 그림과 숫자가 따로 놀면 안 된다
    updateCrsLine();
    const pts = crsLine.getLatLngs();
    let near = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const seg = Math.abs(crossTrack(a.lat, a.lng, b.lat, b.lng, S.lat, S.lon));
      near = Math.min(near, seg);
    }
    return { beforeXtk, xtk: courseXtk(L), near,
             dist: distance(S.lat, S.lon, W[0], W[1]),
             crsM: Math.round(toMag(S.crs)),
             brgM: Math.round(toMag(bearing(S.lat, S.lon, W[0], W[1]))),
             hereM: Math.round(toMag(courseCrsHere(L))),
             fwp: S.fwp };
  }, [RKPK, AC]);

  t.ok(Math.abs(fms.beforeXtk) > 5,
    `누르기 전에는 코스에서 ${Math.abs(fms.beforeXtk).toFixed(0)}NM 벗어나 있다`);
  t.ok(Math.abs(fms.xtk) < 0.02,
    `누르면 코스선이 지금 자리를 지난다 (편차 ${(fms.xtk * 1852).toFixed(0)}m · ` +
    `${fms.dist.toFixed(0)}NM 거리 — 종전에는 수렴각 때문에 1.4NM 벌어졌다)`);
  t.ok(fms.near < 0.05,
    `지도에 그려지는 코스선도 항공기를 지난다 (${(fms.near * 1852).toFixed(0)}m)`);
  t.eq(fms.fwp, -1, '앞 구간 대신 그 지점을 지나는 코스선을 쓴다');
  t.ok(Math.abs(fms.hereM - fms.brgM) <= 1,
    `지금 자리에서 본 코스는 그 지점 방위와 같다 (${fms.hereM}°M · 방위 ${fms.brgM}°M)`);

  // 지점에서 잰 코스와 항공기에서 잰 코스는 이 거리에서 1° 다르다.
  // CRS 창에 그 지점 기준 값이 뜨는 것이 코스선의 정의와 맞다.
  t.ok(Math.abs(((fms.crsM - fms.brgM + 540) % 360) - 180) <= 2,
    `CRS 창 값도 그와 1° 안에서 같다 (CRS ${fms.crsM}°M)`);

  // ── 가까운 거리에서는 종전과 다를 바 없다 ──
  const near = await page.evaluate(([W]) => {
    const p = destPoint(W[0], W[1], 40, 5);
    S.lat = p[0]; S.lon = p[1]; S.crs = toTrue(200); updateNav();
    document.getElementById('crs-lbl-btn').click();
    return { xtk: courseXtk(activeCourseLine()),
             crsM: Math.round(toMag(S.crs)),
             brgM: Math.round(toMag(bearing(S.lat, S.lon, W[0], W[1]))) };
  }, [RKPK]);
  t.ok(Math.abs(near.xtk) < 0.01, `가까이서도 편차 0 (${(near.xtk * 1852).toFixed(0)}m)`);
  t.eq(near.crsM, near.brgM, `5NM 에서는 두 값이 같다 (${near.crsM}°M)`);

  // ── VOR(OBS) 도 같은 방식이다 ──
  const vor = await page.evaluate(([A]) => {
    setNavRadio('NAV1', '115.5', 'SEL');        // 안양 VORTAC
    setNavSrc('NAV1'); obsOn = false;
    S.lat = A[0]; S.lon = A[1];
    vorObsCrs = toTrue(10);
    updateNav();
    const before = courseXtk(activeCourseLine());
    document.getElementById('crs-lbl-btn').click();
    const L = activeCourseLine();
    return { before, xtk: courseXtk(L),
             dist: distance(S.lat, S.lon, navLat, navLon),
             crsM: Math.round(toMag(vorObsCrs)) };
  }, [AC]);
  t.ok(Math.abs(vor.before) > 5, `VOR 도 누르기 전에는 ${Math.abs(vor.before).toFixed(0)}NM 벗어나 있다`);
  t.ok(Math.abs(vor.xtk) < 0.02,
    `VOR 래디얼도 지금 자리를 지난다 (편차 ${(vor.xtk * 1852).toFixed(0)}m · ${vor.dist.toFixed(0)}NM)`);
  t.ok(vor.crsM >= 1 && vor.crsM <= 360, `OBS 코스가 잡힌다 (${vor.crsM}°M)`);

  // 뒷정리 — 다음 검사가 VOR 소스를 물려받지 않도록
  await page.evaluate(() => { setNavSrc('FMS'); obsOn = false; });
}
