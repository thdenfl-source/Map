// 지도 길게 누르기(1초) → 좌표·표고 창 → PLAN 에 추가
//
// 표고 자료(DEM 타일)는 바깥 서버라 부르지 않는다 — 표고를 아는 그림(PNG)을
// 만들어 fetch 대신 준다. 누르기는 실제 마우스·터치 이벤트로 한다.
export const name = '지도 길게 누르기';

// Terrarium 부호화: elev(m) = R*256 + G + B/256 - 32768
const MOCK_DEM = (elevM) => `(() => {
  const v = ${elevM} + 32768;
  const R = Math.floor(v / 256), G = Math.floor(v - R * 256), B = Math.round((v - R * 256 - G) * 256);
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d'); x.fillStyle = 'rgb(' + R + ',' + G + ',' + B + ')'; x.fillRect(0, 0, 256, 256);
  const blobP = new Promise(res => c.toBlob(res, 'image/png'));
  window.__demHits = 0;
  window.fetch = (u) => {
    if (String(u).includes('terrarium')) { window.__demHits++; return blobP.then(b => ({ ok: true, blob: async () => b })); }
    return Promise.reject(new Error('blocked'));
  };
  _ptElevTiles.clear();
})()`;

export async function run(page, t) {
  await page.evaluate(() => { setSolo('map'); S.wps = []; S.awp = -1; updateWpMarkers();
    leafMap.setView([37.5, 127.0], 11, { animate: false }); });
  await page.evaluate(m => eval(m), MOCK_DEM(500));
  await page.waitForTimeout(200);

  // 누를 자리 — 지도 한가운데보다 조금 오른쪽 아래(왼쪽 버튼 줄을 피한다)
  const P = await page.evaluate(() => {
    const r = leafMap.getContainer().getBoundingClientRect();
    const x = Math.round(r.left + r.width * 0.65), y = Math.round(r.top + r.height * 0.55);
    const ll = leafMap.containerPointToLatLng([x - r.left, y - r.top]);
    return { x, y, lat: ll.lat, lon: ll.lng };
  });
  const popText = () => page.evaluate(() => {
    const el = document.querySelector('.map-lp-pop');
    return el ? el.innerText.replace(/\s+/g, ' ') : null;
  });
  const closeAll = () => page.evaluate(() => { leafMap.closePopup(); });

  // ── ① 짧게 누르면 열리지 않는다 ─────────────────────────────────
  await page.mouse.move(P.x, P.y);
  await page.mouse.down(); await page.waitForTimeout(350); await page.mouse.up();
  await page.waitForTimeout(900);
  t.eq(await popText(), null, '짧게 누르면 아무 창도 열리지 않는다');

  // ── ② 1초 누르면 그 자리의 좌표·표고 창이 열린다 ─────────────────
  await page.evaluate(() => { window.__clicks = 0; window.__clickFn = () => window.__clicks++; leafMap.on('click', window.__clickFn); });
  await page.mouse.move(P.x, P.y);
  await page.mouse.down(); await page.waitForTimeout(1150);
  const during = await popText();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const txt = await popText();
  const at = await page.evaluate(() => {
    const p = leafMap._popup; const ll = p && p.getLatLng();
    return ll ? { lat: ll.lat, lon: ll.lng, clicks: window.__clicks,
                  mark: !!_mapLpMark, dms: decToDMS(ll.lat, true) } : null;
  });
  t.ok(during !== null, '손을 떼기 전, 1초가 지나면 창이 열린다');
  t.ok(at && Math.abs(at.lat - P.lat) < 1e-6 && Math.abs(at.lon - P.lon) < 1e-6,
    `누른 바로 그 자리다 (${at && at.lat.toFixed(5)}, ${at && at.lon.toFixed(5)})`);
  t.ok(txt && txt.includes(at.dms) && txt.includes(P.lat.toFixed(5)), '좌표를 도·분·초와 소수로 보여 준다');
  t.ok(txt && /표고 1,640 ft \(500 m\)/.test(txt), `표고를 ft·m 로 보여 준다 (${(txt || '').match(/표고[^지]*/)})`);
  t.ok(txt && /건물·장애물/.test(txt), '지형 높이일 뿐 장애물은 빠져 있다고 밝힌다');
  t.ok(txt && /현재 위치에서 \d{3}°M · [\d.]+NM/.test(txt), '현재 위치에서의 방위·거리도 보여 준다');
  t.eq(at.mark, true, '누른 자리에 점을 찍어 둔다');
  t.eq(at.clicks, 0, '손을 뗄 때 따라오는 클릭은 지도로 새지 않는다(자 재기 등이 움직이지 않게)');

  // ── ③ PLAN 에 추가 ─────────────────────────────────────────────
  await page.click('.map-lp-pop .map-lp-add');
  await page.waitForTimeout(250);
  const add = await page.evaluate(() => ({
    wps: S.wps.map(w => `${w.ident}@${w.lat.toFixed(6)},${w.lon.toFixed(6)}`),
    open: !!document.querySelector('.map-lp-pop'), mark: !!_mapLpMark,
    toast: [...document.querySelectorAll('.ui-toast')].map(e => e.textContent).join(' ') }));
  t.eq(add.wps.length, 1, '비행계획에 한 점이 들어간다');
  t.eq(add.wps[0], `WP1@${P.lat.toFixed(6)},${P.lon.toFixed(6)}`, `누른 자리가 WP1 로 들어간다 (${add.wps[0]})`);
  t.ok(!add.open && !add.mark, '넣으면 창과 표시 점을 걷는다');
  t.ok(/WP1/.test(add.toast), `넣었다고 알린다 (${add.toast})`);

  // ── ④ 끌면(지도 이동) 열리지 않는다 ────────────────────────────
  await page.mouse.move(P.x, P.y);
  await page.mouse.down();
  await page.mouse.move(P.x + 40, P.y + 25, { steps: 5 });
  await page.waitForTimeout(1150);
  await page.mouse.up();
  await page.waitForTimeout(200);
  t.eq(await popText(), null, '누른 채 끌면 열리지 않는다');

  // ── ⑤ 손가락 — 한 손가락 1초는 열리고, 두 손가락은 열리지 않는다 ────
  const touch = (pts, type) => page.evaluate(([pts, type]) => {
    const el = leafMap.getContainer();
    const ts = pts.map((p, i) => new Touch({ identifier: i + 1, target: el, clientX: p[0], clientY: p[1] }));
    el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : ts,
      targetTouches: type === 'touchend' ? [] : ts, changedTouches: ts, bubbles: true, cancelable: true }));
  }, [pts, type]);
  await closeAll();
  await touch([[P.x, P.y]], 'touchstart');
  await page.waitForTimeout(1150);
  await touch([[P.x, P.y]], 'touchend');
  await page.waitForTimeout(200);
  t.ok((await popText()) !== null, '손가락으로 1초 누르면 열린다');
  await closeAll();
  await touch([[P.x, P.y], [P.x + 60, P.y + 60]], 'touchstart');
  await page.waitForTimeout(1150);
  await touch([[P.x, P.y], [P.x + 60, P.y + 60]], 'touchend');
  await page.waitForTimeout(200);
  t.eq(await popText(), null, '두 손가락(확대·축소)이면 열리지 않는다');
  await touch([[P.x, P.y]], 'touchstart');
  await page.waitForTimeout(500);
  await touch([[P.x, P.y]], 'touchend');
  await page.waitForTimeout(800);
  t.eq(await popText(), null, '0.5초에 떼면 열리지 않는다');

  // ── ⑥ PC·DeX — 오른쪽 클릭이면 곧바로 ─────────────────────────
  await page.mouse.click(P.x, P.y, { button: 'right' });
  await page.waitForTimeout(200);
  t.ok((await popText()) !== null, '오른쪽 클릭이면 곧바로 열린다');
  await closeAll();

  // ── ⑦ HDG↑(지도가 돌아가 있을 때)에도 누른 자리를 정확히 집는다 ──────
  // 기수 090° 이면 동쪽이 화면 위다. 화면 가운데에서 오른쪽을 누르면 그 자리는
  // 가운데에서 남쪽이어야 한다.
  const rot = await page.evaluate(async () => {
    S.hdg = 90; if (!mapHdgUp) toggleMapOrient(); updateAcOnMap();
    await new Promise(r => setTimeout(r, 300));
    const el = leafMap.getContainer(), r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const c = mapClientToLatLng(cx, cy), right = mapClientToLatLng(cx + 120, cy);
    const res = { dLat: right.lat - c.lat, dLon: right.lng - c.lng,
                  center: leafMap.containerPointToLatLng([el.offsetWidth / 2, el.offsetHeight / 2]), c };
    toggleMapOrient(); S.hdg = 0; updateAcOnMap();
    return { dLat: res.dLat, dLon: res.dLon, cErr: Math.abs(res.center.lat - res.c.lat) + Math.abs(res.center.lng - res.c.lng) };
  });
  t.ok(rot.cErr < 1e-9, '화면 가운데는 돌려도 지도 가운데다');
  t.ok(rot.dLat < 0 && Math.abs(rot.dLon) < Math.abs(rot.dLat) * 0.05,
    `HDG 090° 에서 화면 오른쪽은 남쪽이다 (Δ위도 ${rot.dLat.toFixed(4)}, Δ경도 ${rot.dLon.toFixed(5)})`);

  // ── ⑧ 표고 보간 · 못 받았을 때 ────────────────────────────────
  const el2 = await page.evaluate(async () => {
    const a = await pointElevM(37.5, 127.0);
    window.fetch = () => Promise.reject(new TypeError('offline')); _ptElevTiles.clear();
    const b = await pointElevM(37.5, 127.0);
    return { a, b };
  });
  t.ok(Math.abs(el2.a - 500) < 0.01, `DEM 그림에서 표고를 읽는다 (${el2.a})`);
  t.eq(el2.b, null, '못 받으면 지어내지 않는다(null)');
  await page.evaluate(() => { mapLongPressAt(37.5, 127.0); });
  await page.waitForTimeout(300);
  t.ok(/표고를 받지 못했습니다/.test(await popText() || ''), '창에도 받지 못했다고 적는다');

  // 뒷정리
  await page.evaluate(() => { leafMap.closePopup(); delete window.fetch; _ptElevTiles.clear();
    S.wps = []; S.awp = -1; updateWpMarkers(); leafMap.off('click', window.__clickFn); });
}
