// 주소 검색 — 지번(산 번지)·우편번호를 정확히 찍는가
//
// 바깥 서버(VWorld·OpenStreetMap)는 부르지 않는다. fetch 와 스크립트(JSONP)를
// 가로채 우리가 만든 응답을 준다. 확인할 것은 "무엇을 찾는 말인지 가려,
// 어느 곳에 어떻게 묻고, 받은 것을 어떻게 읽는가" 다.
export const name = '주소 검색(지번·우편번호)';

// url 에 따라 답을 고르는 가짜 fetch. 부른 주소는 window.__seen 에 남는다.
const MOCK = (o) => `(() => {
  const o = ${JSON.stringify(o)};
  window.__seen = [];
  _geoCache.clear(); _vwMode = 'fetch';
  window.fetch = (u) => {
    u = String(u); window.__seen.push(u);
    const ok = body => Promise.resolve({ ok: true, json: async () => JSON.parse(JSON.stringify(body)) });
    if (u.includes('api.vworld.kr')) {
      if (o.vwCors === false) return Promise.reject(new TypeError('Failed to fetch'));   // CORS 로 막힘
      if (u.includes('/req/address')) return ok(o.vwAddr || { response: { status: 'NOT_FOUND' } });
      if (u.includes('/req/search'))  return ok(o.vwSearch || { response: { status: 'NOT_FOUND' } });
    }
    if (u.includes('nominatim')) {
      const q = new URL(u).searchParams.get('q') || '';
      const list = (o.nom && (o.nom[q] || o.nom['*'])) || [];
      return ok(list);
    }
    return Promise.reject(new Error('blocked'));
  };
})()`;

export async function run(page, t) {
  await page.evaluate(() => { setSolo('map'); localStorage.removeItem('vworldKey'); });

  // ── ① 무엇을 찾는 말인가 ──────────────────────────────────────────
  const pq = await page.evaluate(() => [
    '경기도 양평군 용문면 덕촌리 산 12-3', '덕촌리산12-3번지', '양평군 산 5',
    '역삼동 123-4', '해운대구 우동 1408', '테헤란로 152', '06236', '우편번호 06236',
    '부산 해운대', '서울 남산 1', '남산타워',
  ].map(q => geoParseQuery(q)));
  t.ok(pq[0].kind === 'parcel' && pq[0].mountain && pq[0].lot === '산12-3' &&
       pq[0].base === '경기도 양평군 용문면 덕촌리',
    `'산 12-3' 을 산 번지로 읽는다 (${pq[0].text})`);
  t.ok(pq[1].kind === 'parcel' && pq[1].mountain && pq[1].base === '덕촌리' && pq[1].lot === '산12-3',
    `붙여 쓰고 '번지' 를 달아도 읽는다 (${pq[1].text})`);
  t.ok(pq[2].kind === 'parcel' && pq[2].mountain && pq[2].lot === '산5', `본번만 있어도 된다 (${pq[2].text})`);
  t.ok(pq[3].kind === 'parcel' && !pq[3].mountain && pq[3].lot === '123-4', `일반 지번 (${pq[3].text})`);
  t.ok(pq[4].kind === 'parcel' && pq[4].base === '해운대구 우동', `'우동 1408' 도 지번이다 (${pq[4].text})`);
  t.ok(pq[5].kind === 'road' && pq[5].lot === '152', `도로명 주소 (${pq[5].text})`);
  t.ok(pq[6].kind === 'zip' && pq[6].zip === '06236' && pq[7].kind === 'zip', '5자리 우편번호');
  t.ok(['text', 'text', 'text'].every((k, i) => pq[8 + i].kind === k),
    `'부산'·'남산' 같은 지명을 산 번지로 오인하지 않는다 (${pq.slice(8).map(p => p.kind).join(',')})`);

  // ── ② VWorld — 산 번지를 필지 자리로 ──────────────────────────────
  await page.evaluate(() => localStorage.setItem('vworldKey', 'TESTKEY'));
  await page.evaluate(m => eval(m), MOCK({
    vwAddr: { response: { status: 'OK', refined: { text: '경기도 양평군 용문면 덕촌리 산12-3' },
              result: { crs: 'EPSG:4326', point: { x: '127.56781', y: '37.51234' } } } },
    vwSearch: { response: { status: 'OK', result: { items: [
      { address: { parcel: '경기도 양평군 용문면 덕촌리 산12-4', road: '' }, point: { x: '127.5680', y: '37.5125' } } ] } } },
  }));
  const vp = await page.evaluate(async () => {
    const r = await geoSearch('경기도 양평군 용문면 덕촌리 산 12-3');
    const addr = new URL(window.__seen.find(u => u.includes('/req/address')));
    return { first: r[0], n: r.length, notice: r.notice || '',
             p: Object.fromEntries(addr.searchParams), nom: window.__seen.some(u => u.includes('nominatim')) };
  });
  t.ok(vp.first.lat === 37.51234 && vp.first.lon === 127.56781,
    `필지 좌표를 그대로 쓴다 (y→위도 ${vp.first.lat}, x→경도 ${vp.first.lon})`);
  t.eq(vp.first.name, '경기도 양평군 용문면 덕촌리 산12-3', '다듬어진 주소를 이름으로 쓴다');
  t.ok(vp.p.type === 'PARCEL' && vp.p.address.includes('산12-3') && vp.p.request === 'getcoord',
    `지번(PARCEL) 지오코더에 '산12-3' 으로 묻는다 (${vp.p.address})`);
  t.ok(vp.p.crs === 'EPSG:4326' && vp.p.key === 'TESTKEY', '위경도(EPSG:4326)로, 넣은 키로 묻는다');
  t.eq(vp.n, 2, '가까운 다른 필지 후보도 함께 보여 준다');
  t.eq(vp.nom, false, 'VWorld 가 찾으면 OpenStreetMap 은 부르지 않는다');

  // ── ③ VWorld — 우편번호는 그 우편번호 주소들의 가운데 ───────────────
  await page.evaluate(m => eval(m), MOCK({
    vwSearch: { response: { status: 'OK', result: { items: [
      { address: { road: '서울 강남구 테헤란로 152', zipcode: '06236' }, point: { x: '127.036', y: '37.500' } },
      { address: { road: '서울 강남구 테헤란로 146', zipcode: '06236' }, point: { x: '127.034', y: '37.502' } },
      { address: { road: '서울 강남구 역삼로 1',     zipcode: '06237' }, point: { x: '127.100', y: '37.600' } },
    ] } } },
  }));
  const vz = await page.evaluate(async () => {
    const r = await geoSearch('06236');
    const s = new URL(window.__seen.find(u => u.includes('/req/search')));
    return { first: r[0], names: r.map(x => x.name), q: s.searchParams.get('query'), cat: s.searchParams.get('category') };
  });
  t.eq(vz.first.name, '우편번호 06236', '첫 결과는 그 우편번호 자리다');
  t.ok(Math.abs(vz.first.lat - 37.501) < 1e-9 && Math.abs(vz.first.lon - 127.035) < 1e-9,
    `우편번호가 맞는 주소들만의 가운데다 (${vz.first.lat.toFixed(3)}, ${vz.first.lon.toFixed(3)})`);
  t.ok(!vz.names.some(n => n.includes('역삼로 1')), '다른 우편번호(06237) 주소는 섞지 않는다');
  t.eq(vz.q, '06236', '우편번호로 주소를 찾는다');

  // ── ④ 키가 틀리면 숨기지 않고 알리고, OpenStreetMap 으로 받친다 ───────
  await page.evaluate(m => eval(m), MOCK({
    vwAddr: { response: { status: 'ERROR', error: { code: 'INCORRECT_KEY', text: '등록되지 않은 인증키' } } },
    nom: { '*': [{ name: '덕촌리', display_name: '덕촌리, 용문면, 양평군, 경기도', lat: '37.51', lon: '127.56' }] },
  }));
  const ve = await page.evaluate(async () => {
    const r = await geoSearch('덕촌리 산 12-3');
    return { n: r.length, notice: r.notice || '', nom: window.__seen.some(u => u.includes('nominatim')) };
  });
  t.ok(/INCORRECT_KEY/.test(ve.notice), `키 오류를 그대로 알린다 (${ve.notice.slice(0, 40)}…)`);
  t.ok(ve.nom && ve.n >= 1, '그래도 OpenStreetMap 으로 찾아 준다');

  // ── ⑤ 브라우저에서 바로 못 부르면(CORS) JSONP 로 받는다 ─────────────
  await page.route('https://api.vworld.kr/**', route => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get('callback');
    const body = { response: { status: 'OK', refined: { text: '서울특별시 강남구 역삼동 737' },
                   result: { point: { x: '127.0363', y: '37.5004' } } } };
    route.fulfill({ status: 200, contentType: 'application/javascript',
                    body: `${cb}(${JSON.stringify(body)});` });
  });
  await page.evaluate(m => eval(m), MOCK({ vwCors: false }));
  const vj = await page.evaluate(async () => {
    const r = await geoSearch('역삼동 737');
    return { first: r[0], mode: _vwMode, left: [...document.scripts].filter(s => s.src.includes('vworld')).length };
  });
  await page.unroute('https://api.vworld.kr/**');
  t.ok(vj.first && vj.first.lat === 37.5004 && vj.first.lon === 127.0363,
    `CORS 로 막혀도 JSONP 로 받아 찍는다 (${vj.first && vj.first.name})`);
  t.eq(vj.mode, 'jsonp', '통한 길(JSONP)을 기억한다');
  t.eq(vj.left, 0, '받은 뒤 스크립트 태그를 치운다');

  // ── ⑤-2 따로 넣은 키가 없으면 기본 키로 정밀 검색한다 ──────────────
  // (저장소의 기본 키 값과 상관없이 보도록 검사용 기본 키를 잠시 넣는다)
  const realDefault = await page.evaluate(() => VW_DEFAULT_KEY);
  await page.evaluate(() => { VW_DEFAULT_KEY = 'TESTDEFAULT'; localStorage.removeItem('vworldKey'); });
  await page.evaluate(m => eval(m), MOCK({
    vwAddr: { response: { status: 'OK', refined: { text: '서울특별시 강남구 역삼동 737' },
              result: { point: { x: '127.0363', y: '37.5004' } } } },
  }));
  const dk = await page.evaluate(async () => {
    await geoSearch('역삼동 737');
    const u = window.__seen.find(x => x.includes('/req/address'));
    _geoKeyStatus();
    return { key: u ? new URL(u).searchParams.get('key') : null, def: VW_DEFAULT_KEY,
             label: document.querySelector('#geo-panel .geo-key-btn').textContent };
  });
  t.ok(dk.key === 'TESTDEFAULT' && dk.key === dk.def, '따로 넣은 키가 없으면 기본 키로 VWorld 에 묻는다');
  t.ok(/기본 키/.test(dk.label), `버튼에 기본 키로 켜져 있다고 보인다 (${dk.label})`);

  // ── ⑥ 정밀 검색을 끄면 — 번지를 못 찾으면 리·동 중심을 '대략' 으로 ─────
  await page.evaluate(() => localStorage.setItem('vworldKey', 'off'));
  await page.evaluate(m => eval(m), MOCK({
    nom: { '경기도 양평군 용문면 덕촌리': [{ name: '덕촌리', display_name: '덕촌리, 용문면, 양평군, 경기도, 대한민국',
                                          lat: '37.5100', lon: '127.5600' }] },
  }));
  const na = await page.evaluate(async () => {
    document.getElementById('geo-q').value = '경기도 양평군 용문면 덕촌리 산 12-3';
    await runGeoSearch();
    const r = _geoResults;
    const qs = window.__seen.filter(u => u.includes('nominatim')).map(u => new URL(u).searchParams.get('q'));
    return { approx: r[0] && r[0].approx, detail: r[0] && r[0].detail, notice: r.notice || '', qs,
             vw: window.__seen.some(u => u.includes('vworld')),
             html: document.getElementById('geo-list').innerText };
  });
  t.eq(na.vw, false, "정밀 검색을 끄면('off') VWorld 를 부르지 않는다");
  t.ok(na.qs[0].includes('산12-3') && na.qs[1] === '경기도 양평군 용문면 덕촌리',
    `번지로 먼저 찾고, 없으면 리까지만으로 찾는다 (${na.qs.join(' → ')})`);
  t.eq(na.approx, true, '그 결과는 대략이라고 표시한다');
  t.ok(/대략/.test(na.html) && /VWorld/.test(na.html), '목록에 "대략" 과 정밀 검색을 켜라는 안내가 보인다');

  // 우편번호 — 키가 없으면 OpenStreetMap 의 우편번호 검색으로
  await page.evaluate(m => eval(m), MOCK({ nom: { '*': [] } }));
  const nz = await page.evaluate(async () => {
    try { await geoSearch('06236'); } catch (e) { /* 빈 결과 */ }
    const u = new URL(window.__seen.find(x => x.includes('nominatim')));
    return { pc: u.searchParams.get('postalcode'), cc: u.searchParams.get('countrycodes'), q: u.searchParams.get('q') };
  });
  t.ok(nz.pc === '06236' && nz.cc === 'kr' && !nz.q, `우편번호 검색으로 묻는다 (postalcode=${nz.pc}, kr)`);

  // ── ⑦ 키 넣기 — 이 기기에만 둔다 ───────────────────────────────
  await page.evaluate(() => openGeoSearch());
  await page.click('#geo-panel .geo-key-btn');
  await page.waitForSelector('.ui-dlg-back input');
  await page.fill('.ui-dlg-back input', 'MYKEY123');
  await page.click('.ui-dlg-back .ui-dlg-ok');
  await page.waitForTimeout(150);
  const key = await page.evaluate(() => ({ k: localStorage.getItem('vworldKey'),
    btn: document.querySelector('#geo-panel .geo-key-btn').textContent }));
  t.eq(key.k, 'MYKEY123', '넣은 키를 이 기기에 저장한다');
  t.ok(/켜짐/.test(key.btn) && /넣은 키/.test(key.btn), `버튼에 넣은 키로 켜져 있다고 보인다 (${key.btn})`);

  // 비우면 기본 키로 돌아간다
  await page.click('#geo-panel .geo-key-btn');
  await page.waitForSelector('.ui-dlg-back input');
  await page.fill('.ui-dlg-back input', '');
  await page.click('.ui-dlg-back .ui-dlg-ok');
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => ({ k: localStorage.getItem('vworldKey'), eff: vworldKey() === VW_DEFAULT_KEY }));
  t.ok(back.k === null && back.eff, '비우면 기본 키로 돌아간다');

  // 기본 키가 비어 있으면(저장소에 키를 넣지 않은 배포) 따로 넣기 전까지 정밀 검색은 꺼져 있다
  const empty = await page.evaluate(() => { VW_DEFAULT_KEY = ''; _geoKeyStatus();
    return { eff: vworldKey(), label: document.querySelector('#geo-panel .geo-key-btn').textContent }; });
  t.ok(empty.eff === '' && /꺼짐/.test(empty.label), `기본 키가 비어 있으면 꺼짐으로 보인다 (${empty.label})`);
  await page.evaluate(v => { VW_DEFAULT_KEY = v; }, realDefault);

  // 뒷정리
  await page.evaluate(() => { localStorage.removeItem('vworldKey'); delete window.fetch; _geoCache.clear(); closeGeoSearch(); });
}
