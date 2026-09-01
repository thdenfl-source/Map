// HDG↑ 지도 회전 — 모서리를 덮되 축척은 건드리지 않는다.
//
// 종전에는 회전한 지도를 scale(1.42) 로 키워 모서리를 덮었다. 그건 축척을
// 바꾸는 일이라 모드를 바꾸는 순간 지도가 확대돼 버렸고, √2 배는 정사각형에서만
// 충분해서 세로로 긴 화면에서는 여전히 모서리에 검은 삼각형이 남았다.
// 이제 '보이는 영역의 대각선' 을 한 변으로 하는 정사각형으로 키워 덮는다.
export const name = 'HDG↑ 지도 회전';

export async function run(page, t) {
  // 두 지점의 화면상 거리를 재면 "지도가 확대됐는지" 가 그대로 나온다.
  // (마커는 회전·확대가 걸린 지도 안에 있으므로 화면 좌표가 실제를 반영한다)
  const span = () => page.evaluate(() => {
    const r = i => wpMarkers[i].getElement().getBoundingClientRect();
    const a = r(0), b = r(1);
    return Math.hypot((a.left + a.right) / 2 - (b.left + b.right) / 2,
                      (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
  });

  await page.evaluate(() => {
    S.lat = 37.4602; S.lon = 126.4407; S.hdg = 40;
    S.wps = []; S.awp = -1;
    pushWP({ ident: 'A', lat: 37.40, lon: 126.40 });
    pushWP({ ident: 'B', lat: 37.52, lon: 126.48 });
    updateWpMarkers();
    if (mapHdgUp) toggleMapOrient();
    leafMap.setView([S.lat, S.lon], 12, { animate: false });
    updateAcOnMap();
  });
  await page.waitForTimeout(150);
  const northUp = await span();

  const geom = await page.evaluate(() => {
    toggleMapOrient();
    updateAcOnMap();
    const el = document.getElementById('map');
    const cs = getComputedStyle(el).transform;              // matrix(a,b,c,d,e,f)
    const m = cs.match(/matrix\(([^)]+)\)/);
    const n = m ? m[1].split(',').map(Number) : null;
    return {
      on: mapHdgUp,
      w: _hdgBox.w, h: _hdgBox.h,
      size: [el.clientWidth, el.clientHeight],
      left: parseFloat(el.style.left), top: parseFloat(el.style.top),
      zoom: leafMap.getZoom(),
      // 회전행렬의 스케일 = √(a²+b²). 확대가 없으면 1 이다.
      scale: n ? Math.hypot(n[0], n[1]) : null,
    };
  });
  await page.waitForTimeout(150);
  const hdgUp = await span();

  t.eq(geom.on, true, 'HDG↑ 로 바뀐다');
  t.ok(geom.scale !== null && Math.abs(geom.scale - 1) < 0.001,
    `지도를 확대하지 않는다 (CSS 스케일 ${geom.scale && geom.scale.toFixed(3)} — 종전 1.42)`);
  t.ok(Math.abs(hdgUp - northUp) / northUp < 0.01,
    `두 지점의 화면 거리가 그대로다 (N↑ ${northUp.toFixed(1)}px → HDG↑ ${hdgUp.toFixed(1)}px)`);

  // 정사각형이고, 한 변이 보이는 영역의 대각선 이상이며, 중심이 겹친다.
  // 이 세 가지면 어느 각도로 돌려도 모서리가 덮인다(내접원 ⊇ 보이는 사각형).
  const diag = Math.ceil(Math.hypot(geom.w, geom.h));
  t.ok(geom.size[0] === geom.size[1] && geom.size[0] >= diag,
    `지도를 대각선 크기의 정사각형으로 키운다 (${geom.size[0]}×${geom.size[1]}, 대각선 ${diag})`);
  t.ok(Math.abs(geom.left - (geom.w / 2 - geom.size[0] / 2)) <= 1 &&
       Math.abs(geom.top - (geom.h / 2 - geom.size[1] / 2)) <= 1,
    '보이는 영역과 중심이 겹친다');

  // ── 실제로 모서리가 덮이는가 ──
  // 계산이 맞아도 레이아웃이 어긋나면 소용없다. 화면 네 모서리에서 무엇이
  // 잡히는지 브라우저에게 직접 물어본다.
  const corners = await page.evaluate(async () => {
    const wrap = document.getElementById('map-wrap');
    const map = document.getElementById('map');
    const bad = [];
    for (const hdg of [0, 25, 40, 90, 135, 200, 315, 359]) {
      S.hdg = hdg; updateAcOnMap();
      await new Promise(r => requestAnimationFrame(r));
      const r = wrap.getBoundingClientRect();
      const pts = [[r.left + 3, r.top + 3], [r.right - 3, r.top + 3],
                   [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
      pts.forEach(([x, y], i) => {
        // 그 자리에 겹친 것을 전부 본다 — 하단 버튼바 같은 UI 가 위에 있어도
        // 그 아래에 지도가 깔려 있으면 검은 곳이 아니다.
        const stack = document.elementsFromPoint(x, y);
        if (!stack.some(el => map.contains(el))) bad.push(`${hdg}° 모서리${i + 1}`);
      });
    }
    return bad;
  });
  t.eq(corners.length, 0,
    `어느 기수에서도 네 모서리가 지도로 덮인다${corners.length ? ' — 빈 곳: ' + corners.slice(0, 6).join(', ') : ''}`);

  // ── N↑ 로 되돌리면 원래 크기 ──
  const back = await page.evaluate(() => {
    toggleMapOrient();
    const el = document.getElementById('map');
    const wrap = document.getElementById('map-wrap');
    return { on: mapHdgUp, w: el.clientWidth, h: el.clientHeight,
             wrapW: wrap.clientWidth, css: el.style.transform,
             left: el.style.left, cls: el.classList.contains('hdg-rot') };
  });
  t.ok(!back.on && !back.cls && !back.left && !back.css,
    'N↑ 로 되돌리면 회전·크기 지정이 모두 풀린다');
  t.eq(back.w, back.wrapW, `지도 폭이 원래대로 돌아온다 (${back.w}px)`);

  // ── T-CUT 을 켜면 지도 높이가 80% 로 줄어든다 ──
  // 감싸는 상자는 그대로라 ResizeObserver 가 울지 않는다. 다시 재지 않으면
  // 정사각형이 옛 높이 기준으로 남아 아래쪽 모서리가 빈다.
  const tcut = await page.evaluate(async () => {
    if (!mapHdgUp) toggleMapOrient();
    const before = { ..._hdgBox };
    toggleTcut();                                  // 지형 단면 켜기(지도 80%)
    await new Promise(r => setTimeout(r, 120));
    const after = { ..._hdgBox };
    const el = document.getElementById('map');
    const map = el, wrap = document.getElementById('map-wrap');
    S.hdg = 40; updateAcOnMap();
    await new Promise(r => requestAnimationFrame(r));
    // 지도의 '보이는 사각형' 네 모서리(하단 지형단면 위쪽까지)
    const wr = wrap.getBoundingClientRect();
    const pts = [[wr.left + 3, wr.top + 3], [wr.right - 3, wr.top + 3],
                 [wr.left + 3, wr.top + after.h - 3], [wr.right - 3, wr.top + after.h - 3]];
    const bad = pts.filter(([x, y]) =>
      !document.elementsFromPoint(x, y).some(e => map.contains(e))).length;
    const size = [el.clientWidth, el.clientHeight];
    toggleTcut();                                  // 되돌리기
    await new Promise(r => setTimeout(r, 120));
    return { before, after, size, bad, restored: { ..._hdgBox } };
  });
  t.ok(tcut.after.h < tcut.before.h,
    `T-CUT 을 켜면 보이는 높이가 줄어든 것을 다시 잰다 (${tcut.before.h} → ${tcut.after.h}px)`);
  t.ok(tcut.size[0] === tcut.size[1] &&
       tcut.size[0] >= Math.ceil(Math.hypot(tcut.after.w, tcut.after.h)),
    `줄어든 크기에 맞춰 정사각형을 다시 잡는다 (${tcut.size[0]}px)`);
  t.eq(tcut.bad, 0, 'T-CUT 을 켠 상태에서도 지도 모서리가 덮인다');
  t.ok(tcut.restored.h === tcut.before.h,
    `T-CUT 을 끄면 원래 높이로 돌아온다 (${tcut.restored.h}px)`);
  await page.evaluate(() => { if (mapHdgUp) toggleMapOrient(); });

  // ── HDG↑ 를 거쳐 N↑ 로 돌아와도 1인칭(추종)이 제자리인가 ──
  // HDG↑ 는 #map 을 키운다. 되돌리면서 Leaflet 에 크기 변경을 알리지 않으면
  // 커진 크기(1068)를 그대로 기억한 채 계산해서, 추종이 항공기를 화면 밖으로
  // 밀어낸다. 화면만 봐서는 "1인칭이 이상해졌다" 로만 보이는 고장이다.
  const foll = await page.evaluate(async () => {
    const wait = () => new Promise(r => setTimeout(r, 60));
    const at = () => {
      const wrap = document.getElementById('map-wrap').getBoundingClientRect();
      const r = acMarker.getElement().getBoundingClientRect();
      return { x: Math.round((r.left + r.right) / 2 - wrap.left),
               y: Math.round((r.top + r.bottom) / 2 - wrap.top),
               w: wrap.width, h: wrap.height };
    };
    const sizes = () => ({ leaf: [leafMap.getSize().x, leafMap.getSize().y],
                           dom: [document.getElementById('map').clientWidth,
                                 document.getElementById('map').clientHeight] });
    S.lat = 37.4602; S.lon = 126.4407; S.hdg = 40;
    if (mapHdgUp) toggleMapOrient();
    leafMap.setView([S.lat, S.lon], 12, { animate: false });
    if (!followMode) toggleFollow();
    updateAcOnMap(); await wait();
    const a = at(), sa = sizes();
    toggleMapOrient(); updateAcOnMap(); await wait();          // HDG↑
    const b = at(), sb = sizes();
    toggleMapOrient(); updateAcOnMap(); await wait();          // 다시 N↑
    const c = at(), sc = sizes();
    if (followMode) toggleFollow();
    return { a, b, c, sa, sb, sc };
  });
  // 있어야 할 자리를 앞뒤 비교가 아니라 절대값으로 잡는다 — 앞 검사들이 남긴
  // 상태 때문에 '전' 도 이미 틀어져 있으면 비교만으로는 못 잡는다.
  // 1인칭은 항공기를 가로 한가운데, 세로로는 아래에서 25% 되는 곳에 둔다.
  const want = (p, mapH) => Math.abs(p.x - p.w / 2) <= 2 &&
                            Math.abs(p.y - mapH * (1 - 0.25)) <= 3;
  t.ok(want(foll.c, foll.sc.dom[1]),
    `HDG↑ 를 거쳐 N↑ 로 돌아와도 항공기가 제자리다 ` +
    `(${foll.c.x},${foll.c.y} — 가운데 ${Math.round(foll.c.w / 2)}, ` +
    `아래에서 25% 지점 ${Math.round(foll.sc.dom[1] * 0.75)})`);
  t.ok(foll.c.x >= 0 && foll.c.x <= foll.c.w && foll.c.y >= 0 && foll.c.y <= foll.c.h,
    '항공기가 화면 안에 있다');
  t.eq(foll.sc.leaf.join('×'), foll.sc.dom.join('×'),
    `Leaflet 이 기억하는 크기가 실제와 같다 (${foll.sc.leaf.join('×')} vs ${foll.sc.dom.join('×')})`);
  t.eq(foll.sb.leaf.join('×'), foll.sb.dom.join('×'),
    `HDG↑ 중에도 마찬가지 (${foll.sb.leaf.join('×')})`);

  // ── 좌하단 좌표칸이 무엇을 가리키는가 ──
  // 한 칸으로, 1인칭이면 항공기(✈)·아니면 십자마크(＋) 좌표다.
  // 1인칭을 끄면 지도는 항공기 자리에 그대로 남으므로, 그 직후에는 두 값의
  // 경도가 같게 나온다 — 잘못된 값이 아니라 지도 중심이 정말 그 자리에 있다.
  const coord = await page.evaluate(async () => {
    const wait = () => new Promise(r => setTimeout(r, 150));
    if (followMode) toggleFollow();
    if (mapHdgUp) toggleMapOrient();
    S.lat = 38.2475; S.lon = 129.29;
    leafMap.setView([38.35, 129.20], 11, { animate: false });
    updateAcOnMap(); updateCenterCoord(); await wait();
    const box = () => document.getElementById('center-coord').textContent.trim();
    const north = box();
    toggleFollow(); updateAcOnMap(); updateCenterCoord(); await wait();
    const foll = box();
    toggleFollow(); updateAcOnMap(); updateCenterCoord(); await wait();
    return { north, foll, after: box() };
  });
  t.ok(/^＋/.test(coord.north) && /38°21′00″N 129°12′00″E/.test(coord.north),
    `1인칭이 아니면 십자마크(지도 중심) 좌표다 (${coord.north})`);
  t.ok(/^✈/.test(coord.foll) && /38°14′51″N 129°17′2[45]″E/.test(coord.foll),
    `1인칭이면 항공기 좌표다 (${coord.foll})`);
  t.ok(/^＋/.test(coord.after) && coord.after !== coord.foll,
    `1인칭을 끄면 다시 십자마크 좌표로 돌아온다 (${coord.after})`);
}
