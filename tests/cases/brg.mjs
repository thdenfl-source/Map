// BRG1 방위 지시침 — NAV SOURCE 를 무엇으로 두든 살아 있어야 한다.
//
// BRG1 은 "지금 선택된 소스의 국" 만 보고 있었다. NAV SOURCE 를 FMS 로 두면
// 그 값이 비어서, BRG1 을 켜 뒀는데도 나침반 니들과 지도 BRG1 선이 사라졌다.
// 방위 지시침은 CDI 소스와 따로 도는 계기다.
// (숫자는 우측 NAV SOURCE 3줄이 맡는다 — 좌측 BRG1 패널은 중복이라 걷어냈다)
export const name = 'BRG 지시침';

export async function run(page, t) {
  // 계기를 화면에 띄운다 — 한 번에 한 창이라, 안 띄우면 캔버스가 0×0 이다
  await page.evaluate(() => setSolo('pfd'));
  await page.waitForTimeout(250);
  // ── 어느 소스에서도 가리킬 국이 있는가 ──
  const st = await page.evaluate(() => {
    const one = () => { const s = brg1Station(); return s ? s.src + ':' + s.id : null; };
    const r = {};
    setNavSrc('FMS');  r.fms  = one();
    setNavSrc('NAV1'); r.nav1 = one();
    setNavSrc('NAV2'); r.nav2 = one();
    setNavSrc('FMS');
    return r;
  });
  t.ok(st.fms && /^NAV1:/.test(st.fms),
    `NAV SOURCE 가 FMS 여도 BRG1 이 튜닝된 VOR 를 가리킨다 (${st.fms})`);
  t.eq(st.nav1, st.fms, 'NAV1 을 골랐을 때와 같은 국을 가리킨다');
  t.ok(st.nav2 && /^NAV2:/.test(st.nav2), `NAV2 를 고르면 그 국을 가리킨다 (${st.nav2})`);

  // ── 화면에 실제로 그려지는가 ──
  // 좌표 계산이 맞아도 그려지지 않으면 조종사에게는 없는 것과 같다.
  // BRG1 색(#44aaff)의 화소를 세어 본다 — 켜면 나타나고 끄면 사라져야 한다.
  const px = await page.evaluate(() => {
    const count = () => {
      drawPFD();
      const cv = document.getElementById('pfd-canvas') ||
                 document.querySelector('#pfd-wrap canvas');
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        // #44aaff = (68,170,255) — 하늘색(ADI)과 겹치지 않게 좁게 잡는다
        if (Math.abs(d[i] - 68) < 12 && Math.abs(d[i + 1] - 170) < 12 && Math.abs(d[i + 2] - 255) < 12) n++;
      }
      return n;
    };
    setNavSrc('FMS');
    if (!brg1Visible) toggleBrg1();
    const on = count();
    toggleBrg1();
    const off = count();
    toggleBrg1();
    return { on, off, back: count() };
  });
  // 파란 화소는 우측 NAV1/NAV2 줄에도 있으므로 절대량이 아니라 "켤 때만 생기는
  // 몫" 을 본다. 그게 곧 나침반의 BRG1 니들이다.
  t.ok(px.on - px.off > 300,
    `FMS 소스에서도 BRG1 이 그려진다 (켤 때만 생기는 파란 화소 ${px.on - px.off}개)`);
  t.eq(px.back, px.on, '껐다 켜면 그대로 돌아온다');

  // ── 튜닝된 무선이 하나도 없으면 조용히 비운다 ──
  // 없는 것을 있는 척하면 그게 더 나쁘다.
  const none = await page.evaluate(() => {
    const bk = { NAV1: Object.assign({}, navRadios.NAV1), NAV2: Object.assign({}, navRadios.NAV2) };
    navRadios.NAV1.lat = navRadios.NAV1.lon = null;
    navRadios.NAV2.lat = navRadios.NAV2.lon = null;
    setNavSrc('FMS');
    const s = brg1Station();
    let threw = false;
    try { drawPFD(); } catch (e) { threw = true; }
    navRadios.NAV1 = bk.NAV1; navRadios.NAV2 = bk.NAV2;
    applyNavRadioToPfd();
    return { s, threw };
  });
  t.eq(none.s, null, '튜닝된 무선이 없으면 가리킬 국도 없다');
  t.ok(!none.threw, '그때도 예외 없이 계기를 그린다');
}
