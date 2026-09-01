// 3D 지도에서의 1인칭(추종)과 N↑/HDG↑.
//
// 세 가지가 어긋나 있었다.
//   ① 카메라 조작을 _ml3d.loaded() 뒤로 미뤘다. 그건 "타일까지 전부 준비됨"
//      이라 비행 중 새 타일을 받는 동안 계속 false 가 된다 — 그 사이 추종이
//      멈춘다. 네트워크가 느릴수록 "3D 에서 1인칭이 안 된다" 가 된다.
//   ② N↑/HDG↑ 버튼이 3D 카메라에 닿지 않았다. 추종 중에는 N↑ 를 골라 놔도
//      늘 기수 위로 돌았고, 추종을 끄면 기수가 바뀌어도 아무 일도 없었다.
// 카메라 상태는 눈으로 보기 어려우니 각도·중심 숫자로 잡는다.
export const name = '3D 지도 카메라';

const T = 37.4602, G = 126.4407;

export async function run(page, t) {
  // 3D 를 켜고, 카메라를 만질 수 있게 되기까지 기다린다
  const open = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    S.lat = 37.4602; S.lon = 126.4407; S.hdg = 40; S.alt = 2000;
    if (mapHdgUp) toggleMapOrient();
    if (followMode) toggleFollow();
    if (!_view3dOn) toggle3dMap();
    let n = 0;
    while (!_ml3dReady && n < 40) { await wait(50); n++; }
    return { on: _view3dOn, ready: _ml3dReady, waitedMs: n * 50,
             tilesDone: _ml3d ? _ml3d.loaded() : null,
             bearing: _ml3d ? Math.round(_ml3d.getBearing()) : null };
  });
  if (!open.on || !open.ready) { t.ok(false, `3D 지도를 열지 못했다 (${JSON.stringify(open)})`); return; }
  t.ok(open.waitedMs === 0,
    `타일을 기다리지 않고 곧바로 카메라를 잡는다 (대기 ${open.waitedMs}ms · 타일완료 ${open.tilesDone})`);

  const cam = () => page.evaluate(() => ({
    b: Math.round(normA(_ml3d.getBearing())),
    lat: +_ml3d.getCenter().lat.toFixed(3), lon: +_ml3d.getCenter().lng.toFixed(3),
    zoom: +_ml3d.getZoom().toFixed(2), pitch: Math.round(_ml3d.getPitch()),
  }));
  const step = fn => page.evaluate(async f => {
    // eslint-disable-next-line no-new-func
    new Function(f)();
    updateAcOnMap();
    await new Promise(r => setTimeout(r, 150));
  }, fn);

  // ── N↑ + 1인칭 ── 항공기를 따라가되 북쪽 위를 지킨다
  await step('if (!followMode) toggleFollow();');
  const fN = await cam();
  t.eq(fN.b, 0, `N↑ 에서는 추종 중에도 북쪽 위다 (방위 ${fN.b}°)`);
  t.ok(Math.abs(fN.lon - G) < 0.01 && fN.lat > T,
    `항공기를 중심에 놓고 진행 방향(북)을 더 보여 준다 (${fN.lat}, ${fN.lon})`);
  t.ok(fN.pitch > 0 && fN.zoom > 0, `고도에 맞춘 줌·틸트가 걸린다 (zoom ${fN.zoom} · pitch ${fN.pitch}°)`);

  // ── HDG↑ + 1인칭 ── 기수 위로 돈다
  await step('if (!mapHdgUp) toggleMapOrient();');
  const fH = await cam();
  t.eq(fH.b, 40, `HDG↑ 를 누르면 3D 도 기수 위로 돈다 (방위 ${fH.b}° · 기수 40°)`);
  t.ok(fH.lat !== fN.lat || fH.lon !== fN.lon,
    '시야도 기수 방향으로 옮겨간다');

  // ── 1인칭을 꺼도 HDG↑ 는 살아 있다 ──
  // 2D 는 그렇게 동작한다. 3D 만 아무 반응이 없었다.
  const off = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (followMode) toggleFollow();
    await wait(100);
    const before = { lat: _ml3d.getCenter().lat, lon: _ml3d.getCenter().lng };
    S.hdg = 200; updateAcOnMap();
    await wait(150);
    return { b: Math.round(normA(_ml3d.getBearing())),
             moved: Math.hypot(_ml3d.getCenter().lat - before.lat,
                               _ml3d.getCenter().lng - before.lon) };
  });
  t.eq(off.b, 200, `1인칭을 꺼도 기수를 따라 돈다 (방위 ${off.b}° · 기수 200°)`);
  t.ok(off.moved < 1e-6,
    '중심은 건드리지 않는다 — 손으로 옮겨 둔 자리를 지킨다');

  // ── N↑ 로 되돌리면 북쪽으로 ── (그 순간 한 번만, 이후 손 조작은 그대로)
  const back = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    toggleMapOrient();                       // N↑
    for (let i = 0; i < 40 && Math.abs(normAS(_ml3d.getBearing())) > 0.5; i++) await wait(50);
    const north = Math.round(normA(_ml3d.getBearing()));
    _ml3d.jumpTo({ bearing: 75 });           // 손으로 돌려 본다
    S.hdg = 10; updateAcOnMap();
    await wait(200);
    return { north, kept: Math.round(normA(_ml3d.getBearing())) };
  });
  t.eq(back.north, 0, `N↑ 로 되돌리면 북쪽으로 맞춘다 (방위 ${back.north}°)`);
  t.eq(back.kept, 75,
    `N↑ 에서는 손으로 돌려 둔 각도를 매 프레임 되돌리지 않는다 (${back.kept}° 유지)`);

  // ── 타일이 아직 안 왔어도 카메라는 움직인다 ──
  // ①의 핵심. loaded() 가 false 인 상황을 만들어 추종이 계속되는지 본다.
  const slow = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const real = _ml3d.loaded.bind(_ml3d);
    _ml3d.loaded = () => false;              // 타일 로딩 중인 척
    if (!mapHdgUp) toggleMapOrient();
    if (!followMode) toggleFollow();
    S.lat = 37.60; S.lon = 126.60; S.hdg = 300;
    updateAcOnMap(); await wait(200);
    const c = { b: Math.round(normA(_ml3d.getBearing())),
                lat: _ml3d.getCenter().lat, lon: _ml3d.getCenter().lng };
    _ml3d.loaded = real;
    if (followMode) toggleFollow();
    if (mapHdgUp) toggleMapOrient();
    return c;
  });
  t.eq(slow.b, 300, `타일을 받는 중에도 방위가 따라온다 (${slow.b}°)`);
  t.ok(Math.abs(slow.lat - 37.60) < 0.2 && Math.abs(slow.lon - 126.60) < 0.2,
    `타일을 받는 중에도 추종이 계속된다 (${slow.lat.toFixed(3)}, ${slow.lon.toFixed(3)})`);

  await page.evaluate(async () => {
    if (_view3dOn) toggle3dMap();
    await new Promise(r => setTimeout(r, 100));
  });
}
