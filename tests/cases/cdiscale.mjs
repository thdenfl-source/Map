// CDI 편차 축척 — 2점(풀스케일)이 곧 RNP
//
// 아래 조작부의 RNP 버튼(4 · 2 · 1 · 0.3)이 정하는 것은 "니들이 끝까지 가는
// 거리" 다. 종전에는 그것이 FMS 소스에만 걸려 있었다. NAV1·NAV2 를 고른 채
// RNP 를 눌러도 니들이 꿈쩍하지 않았다 — 버튼은 켜지는데 계기는 그대로라
// 고장으로 보인다. NAV 소스는 각도 15° 로 못 박혀 있었기 때문이다.
//
// 이 앱의 VOR·LOC 편차는 수신기가 준 값이 아니라 국의 좌표와 GPS 위치로
// 계산한 값이다 — 재는 자가 애초에 거리(NM)다. 세 소스가 같은 자를 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/env.mjs';

export const name = 'CDI 축척(RNP)';

export async function run(page, t) {
  await page.evaluate(() => setSolo('pfd'));
  await page.waitForTimeout(300);

  // 그려진 니들의 x — 세로 막대(위아래 대칭)를 stroke 경로에서 찾아낸다.
  // 캔버스는 눈으로 보지 않으면 알 수 없어, 실제로 그려진 것을 잰다.
  const NEEDLE = `() => {
    const g = ctx, om = g.moveTo, ol = g.lineTo;
    let last = null, n = null;
    g.moveTo = function (x, y) { last = { x, y }; return om.apply(this, arguments); };
    g.lineTo = function (x, y) {
      if (last && Math.abs(x - last.x) < 0.01 && Math.abs(y + last.y) < 0.01 && Math.abs(y) > 1) n = x;
      return ol.apply(this, arguments); };
    try { resizePFD(); drawPFD(); } finally { g.moveTo = om; g.lineTo = ol; }
    return n;
  }`;

  // 한 점(dot) 의 폭. 반지름은 hsiRadius() 를 그대로 부른다 — 여기서 다시
  // 계산하면 계기 쪽 셈이 바뀔 때마다 이 검사가 뒤처진다(종전에 실제로 그랬다).
  const dot = await page.evaluate(() => {
    const ctrlH = document.querySelector('.ctrl-bar').offsetHeight;
    const usableH = cvs.height - ctrlH;
    const bandH = hsiBandH();
    const hsiWant = Math.round(cvs.width * 0.40 * 2 + bandH * 2 + 10);
    const hsiH = Math.max(Math.round(usableH * 0.34),
                          Math.min(Math.round(usableH * 0.50), hsiWant));
    return hsiRadius(cvs.width, hsiH) * 0.248;
  });

  // 코스 오른쪽으로 xtkNM 만큼 벗어난 자리에서, RNP 별 니들 자리를 잰다.
  const sweep = (setup, xtkNM) => page.evaluate(([setupSrc, xtkNM, needleSrc]) => {
    const needleX = new Function('return ' + needleSrc)();
    new Function('xtk', 'return (' + setupSrc + ')(xtk)')(xtkNM);
    const out = {};
    for (const v of [4, 2, 1, 0.3]) {
      setRnp(v); updateNav();
      out[v] = { x: needleX(), xtk: S.xtk };
    }
    setRnp(1);
    return out;
  }, [setup.toString(), xtkNM, NEEDLE]);

  // 잰 값이 '2점 = RNP' 를 지키는가. 벗어난 거리가 RNP 를 넘으면 끝까지 간다.
  const check = (label, res, xtkNM) => {
    for (const v of [4, 2, 1, 0.3]) {
      const want = Math.max(-1, Math.min(1, -xtkNM / v)) * 2 * dot;
      const got = res[v].x;
      t.ok(got !== null && Math.abs(got - want) < 1.0,
        `${label} — RNP ${v} 에서 니들이 ${(Math.abs(want) / dot).toFixed(2)}점 간다 ` +
        `(${got === null ? '없음' : got.toFixed(1)}px / 기대 ${want.toFixed(1)}px)`);
    }
    // RNP 를 좁힐수록 니들은 더 많이 간다 — 이것이 '연동' 이다
    t.ok(Math.abs(res[4].x) < Math.abs(res[2].x)
      && Math.abs(res[2].x) < Math.abs(res[1].x)
      && Math.abs(res[1].x) <= Math.abs(res[0.3].x),
      `${label} — RNP 를 좁힐수록 니들이 더 간다 ` +
      `(${[4, 2, 1, 0.3].map(v => Math.abs(res[v].x).toFixed(0)).join(' → ')}px)`);
    // 코스 오른쪽으로 벗어났으면 니들은 왼쪽 — 니들이 코스를 가리킨다
    t.ok(res[4].x < 0, `${label} — 코스 오른쪽에 있으면 니들이 왼쪽을 가리킨다`);
  };

  const off = (lat, lon, d) => [lat, lon + d / 60 / Math.cos(lat * Math.PI / 180)];

  // ── ① FMS — 활성 웨이포인트로 가는 코스 ──────────────────────
  const fms = await sweep(xtk => {
    S.wps = [{ ident: 'A', lat: 37.0, lon: 127.0 }, { ident: 'B', lat: 37.5, lon: 127.0 }];
    S.fwp = 0; S.awp = 1; obsOn = false; holdExit();
    setNavSrc('FMS');
    S.lat = 37.2;
    S.lon = 127.0 + xtk / 60 / Math.cos(37.2 * Math.PI / 180);
    S.alt = 3000; updateNav();
  }, 0.5);
  check('FMS', fms, 0.5);
  t.ok(Math.abs(fms[1].xtk - 0.5) < 0.01,
    `FMS — 코스에서 0.5NM 벗어난 것으로 잡힌다 (${fms[1].xtk.toFixed(3)}NM)`);

  // ── ② NAV1(VOR) — 종전에는 여기가 RNP 를 따르지 않았다 ────────
  const vor = await sweep(xtk => {
    const v = ENR_VORS[0];
    setNavRadio('NAV1', String(v.freq), v.id);
    setNavSrc('NAV1');
    vorObsCrs = 360;                       // 국으로 정북 인바운드
    S.lat = v.lat - 20 / 60;
    S.lon = v.lon + xtk / 60 / Math.cos(v.lat * Math.PI / 180);
    S.alt = 5000; updateNav();
  }, 0.5);
  check('NAV1(VOR)', vor, 0.5);

  // ── ③ NAV1(LOC) — 로컬라이저도 같은 자를 쓴다 ─────────────────
  const loc = await sweep(xtk => {
    const L = LOC_STATIONS[0];
    setNavRadio('NAV1', String(L.freq), L.id);
    setNavSrc('NAV1');
    // 활주로 코스의 정반대편(진입 쪽) 10NM 밖에서, 코스 오른쪽으로 비켜난다
    const back = destPoint(L.lat, L.lon, normA(toTrue(L.crs) + 180), 10);
    const p = destPoint(back[0], back[1], normA(toTrue(L.crs) + 90), xtk);
    S.lat = p[0]; S.lon = p[1]; S.alt = 3000;
    updateNav();
  }, 0.5);
  check('NAV1(LOC)', loc, 0.5);

  // ── ④ 코스 위에 있으면 어느 RNP 에서도 가운데다 ───────────────
  const on = await sweep(() => {
    S.wps = [{ ident: 'A', lat: 37.0, lon: 127.0 }, { ident: 'B', lat: 37.5, lon: 127.0 }];
    S.fwp = 0; S.awp = 1; obsOn = false; setNavSrc('FMS');
    S.lat = 37.2; S.lon = 127.0; S.alt = 3000; updateNav();
  }, 0);
  for (const v of [4, 1, 0.3]) {
    t.ok(Math.abs(on[v].x) < 0.5,
      `코스 위에서는 RNP ${v} 라도 니들이 가운데다 (${on[v].x.toFixed(2)}px)`);
  }

  // ── ⑤ 각도로 고정하던 자리는 남지 않았다 ─────────────────────
  // 15° 못박기가 남아 있으면 NAV 소스만 다시 RNP 를 놓친다.
  const src = fs.readFileSync(path.join(ROOT, 'js', '03-pfd.js'), 'utf8');
  t.ok(!/fullScale\s*=\s*15/.test(src),
    'NAV 소스를 각도 15° 로 못 박던 자리가 없다');

  await page.evaluate(() => { setRnp(1); setNavSrc('FMS'); setSolo('map'); });
  await page.waitForTimeout(200);
}
