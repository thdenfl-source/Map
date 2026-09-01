// 주소 · 지명 검색 — 지도 ＋ 메뉴에서 찾은 자리를 웨이포인트로 넣는다.
//
// 실제 검색 서버를 부르면 검사가 바깥 사정에 흔들리고 남의 서버도 부담이므로,
// fetch 를 가로채 우리가 만든 응답을 준다. 확인할 것은 "응답을 어떻게 읽고,
// 고른 결과가 비행계획에 어떻게 들어가는가" 다.
export const name = '주소 검색';

const R = (name, display, lat, lon) => ({ name, display_name: display, lat: String(lat), lon: String(lon) });

export async function run(page, t) {
  // ── ＋ 메뉴에 들어 있고, 누르면 패널이 열린다 ──
  const open = await page.evaluate(() => {
    const menu = document.getElementById('pp-menu');
    const btns = [...menu.querySelectorAll('button')].map(b => b.textContent.trim());
    openGeoSearch();
    const p = document.getElementById('geo-panel');
    const on = p.classList.contains('open');
    closeGeoSearch();
    return { btns, on, off: p.classList.contains('open') };
  });
  t.eq(open.btns.length, 3, `＋ 메뉴에 세 가지가 있다 (${open.btns.join(' / ')})`);
  t.ok(open.btns.some(b => b.includes('주소 검색')), '주소 검색이 그중 하나다');
  t.eq(open.on, true, '누르면 검색창이 열린다');
  t.eq(open.off, false, '닫으면 사라진다');

  // ── 검색 결과를 읽어 목록으로 그린다 ──
  const list = await page.evaluate(async () => {
    const seen = [];
    const orig = window.fetch;
    window.fetch = (url) => {
      seen.push(String(url));
      return Promise.resolve({ ok: true, json: () => Promise.resolve([
        { name: '서울특별시청', display_name: '서울특별시청, 세종대로, 중구, 서울특별시, 대한민국',
          lat: '37.5665', lon: '126.9780' },
        { name: '', display_name: '양양군, 강원특별자치도, 대한민국', lat: '38.0754', lon: '128.6190' },
        { name: '나쁜 값', display_name: '좌표 없음', lat: 'x', lon: 'y' },
      ]) });
    };
    document.getElementById('geo-q').value = '서울시청';
    await runGeoSearch();
    window.fetch = orig;
    const items = [...document.querySelectorAll('#geo-list .geo-item')];
    return { url: seen[0], n: items.length, first: items[0].innerText,
             names: _geoResults.map(r => r.name), lat: _geoResults[0].lat };
  });
  t.ok(list.url.includes('nominatim') && list.url.includes(encodeURIComponent('서울시청')),
    '찾는 말을 그대로 실어 보낸다');
  t.ok(list.url.includes('accept-language=ko'), '한국어로 달라고 한다');
  t.eq(list.n, 2, `좌표가 없는 항목은 버린다 (${list.n}개)`);
  t.eq(list.lat, 37.5665, '좌표를 숫자로 읽는다');
  t.eq(list.names[1], '양양군', '이름이 비어 있으면 전체 주소의 앞머리를 쓴다');
  t.ok(list.first.includes('서울특별시청') && list.first.includes('37.5665'),
    `목록에 이름과 좌표가 함께 나온다 (${list.first.split('\n').join(' · ')})`);

  // ── 고르면 웨이포인트가 들어가고 지도가 그리로 간다 ──
  const pick = await page.evaluate(() => {
    S.wps = []; S.awp = -1; S.fwp = -1;
    leafMap.setView([33, 126], 7);
    document.querySelector('#geo-list .geo-item').click();
    const w = S.wps[S.wps.length - 1];
    const c = leafMap.getCenter();
    return { n: S.wps.length, ident: w.ident, name: w.name,
             lat: +w.lat.toFixed(4), lon: +w.lon.toFixed(4),
             cLat: +c.lat.toFixed(2), zoom: leafMap.getZoom(),
             open: document.getElementById('geo-panel').classList.contains('open') };
  });
  t.eq(pick.n, 1, '고른 곳이 비행계획에 들어간다');
  t.eq(pick.ident, 'AD1', `이름은 AD1 로 붙는다 (${pick.ident})`);
  t.eq(pick.name, '서울특별시청', '찾은 이름도 함께 담는다');
  t.eq(pick.lat, 37.5665, '좌표가 그대로다');
  t.eq(pick.lon, 126.978, '경도도 그대로다');
  t.eq(pick.cLat, 37.57, `지도가 그 자리로 움직인다 (${pick.cLat})`);
  t.ok(pick.zoom >= 12, `너무 멀리서 보지 않는다 (zoom ${pick.zoom})`);
  t.eq(pick.open, false, '고르면 검색창이 닫힌다');

  // 두 번째로 고른 곳은 AD2 — 번호가 이어진다
  const second = await page.evaluate(() => {
    document.querySelectorAll('#geo-list .geo-item')[1].click();
    return S.wps.map(w => w.ident).join('→');
  });
  t.eq(second, 'AD1→AD2', `여러 곳을 넣으면 번호가 이어진다 (${second})`);

  // ── 좌표를 그대로 넣으면 검색하지 않는다 ──
  const coord = await page.evaluate(async () => {
    let called = false;
    const orig = window.fetch;
    window.fetch = () => { called = true; return Promise.reject(new Error('부르면 안 된다')); };
    const r = await geoSearch('37.5665, 126.978');
    const bad = geoParseLatLon('91, 200');
    const nope = geoParseLatLon('서울시청');
    window.fetch = orig;
    return { called, n: r.length, lat: r[0].lat, lon: r[0].lon, detail: r[0].detail,
             bad: bad === null, nope: nope === null };
  });
  t.eq(coord.called, false, '좌표를 넣으면 검색 서버를 부르지 않는다');
  t.eq(coord.n, 1, '그 좌표 하나가 결과다');
  t.eq(coord.lat, 37.5665, '위도를 그대로 읽는다');
  t.eq(coord.lon, 126.978, '경도도 그대로다');
  t.eq(coord.detail, '좌표 입력', '좌표로 넣은 것임을 밝힌다');
  t.eq(coord.bad, true, '범위를 벗어난 값은 좌표로 보지 않는다 (91, 200)');
  t.eq(coord.nope, true, '보통 말은 좌표로 보지 않는다');

  // ── 같은 말은 다시 묻지 않는다(남의 서버를 함부로 부르지 않게) ──
  const cache = await page.evaluate(async () => {
    let n = 0;
    const orig = window.fetch;
    window.fetch = () => { n++; return Promise.resolve({ ok: true,
      json: () => Promise.resolve([R('가', '가, 대한민국', 37, 127)]) }); };
    function R(name, display, lat, lon) { return { name, display_name: display, lat, lon }; }
    await geoSearch('같은 말 검사');
    await geoSearch('같은 말 검사');
    window.fetch = orig;
    return n;
  });
  t.eq(cache, 1, '같은 말을 두 번 찾아도 서버는 한 번만 부른다');

  // ── 연결이 안 되면 그렇게 알려 준다(조용히 죽지 않는다) ──
  const fail = await page.evaluate(async () => {
    const orig = window.fetch;
    window.fetch = () => Promise.reject(new Error('offline'));
    document.getElementById('geo-q').value = '연결 안 되는 검사';
    await runGeoSearch();
    window.fetch = orig;
    const msg = document.getElementById('geo-list').innerText;
    return { msg, n: _geoResults.length };
  });
  t.ok(fail.msg.includes('오프라인') || fail.msg.includes('연결'),
    `찾지 못하면 이유를 적어 준다 (${fail.msg})`);
  t.eq(fail.n, 0, '실패하면 앞의 결과가 남지 않는다');

  // ── 남이 준 글자를 그대로 그리지 않는다(따옴표·꺾쇠 섞인 지명) ──
  const esc = await page.evaluate(async () => {
    const orig = window.fetch;
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([
      { name: '<img src=x onerror=alert(1)>', display_name: "a'b\"c, 대한민국", lat: '37', lon: '127' },
    ]) });
    document.getElementById('geo-q').value = '따옴표 검사';
    await runGeoSearch();
    window.fetch = orig;
    const el = document.querySelector('#geo-list .geo-item');
    return { imgs: document.querySelectorAll('#geo-list img').length,
             txt: el.innerText, items: document.querySelectorAll('#geo-list .geo-item').length };
  });
  t.eq(esc.imgs, 0, '지명에 든 태그를 그대로 그리지 않는다');
  t.ok(esc.txt.includes('<img'), '글자로만 보여 준다');
  t.eq(esc.items, 1, "따옴표가 든 주소여도 목록이 깨지지 않는다");

  // 뒷정리
  await page.evaluate(() => {
    S.wps = []; S.awp = -1; S.fwp = -1;
    _geoResults = []; _geoCache.clear();
    document.getElementById('geo-q').value = '';
    document.getElementById('geo-list').innerHTML = '';
    closeGeoSearch();
    try { updateWpMarkers(); fpRender(); updateNav(); } catch (e) {}
  });
}
