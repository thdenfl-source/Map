// ATIS — 지도 공항 아이콘에서 문자로 읽는다
//
// 방송을 글자로 받는 공개 통로는 둘뿐이다. FAA D-ATIS(미국 공항)와
// VATSIM(관제사가 접속해 있을 때, 그리고 시뮬레이션). 국내 공항은 어느
// 쪽에도 해당하지 않으므로 '없음' 이 정상이고, 그때는 주파수와 METAR 로
// 갈음한다 — 없는 것을 있는 척하지 않는지가 이 검사의 요점이다.
//
// 바깥 서버를 실제로 부르면 검사가 남의 사정에 흔들리므로 fetch 를 가로챈다.
export const name = 'ATIS (문자)';

// 목(mock) 한 벌 — url 에 따라 답을 고른다
const MOCK = (opt) => `(() => {
  const o = ${JSON.stringify(opt)};
  _wxCache.clear();
  window.fetch = (u) => {
    u = String(u);
    if (u.includes('datis.clowd.io'))
      return o.faa ? Promise.resolve({ ok: true, text: async () => o.faa })
                   : Promise.resolve({ ok: true, text: async () => '{"error":"not found"}' });
    if (u.includes('vatsim.net/v3/atis'))
      return o.vatsim ? Promise.resolve({ ok: true, text: async () => o.vatsim })
                      : Promise.resolve({ ok: true, text: async () => '[]' });
    if (u.includes('metar'))
      return o.metar ? Promise.resolve({ ok: true, text: async () => o.metar })
                     : Promise.reject(new Error('no metar'));
    return Promise.reject(new Error('blocked'));
  };
})()`;

export async function run(page, t) {
  await page.evaluate(() => setSolo('map'));
  await page.waitForTimeout(250);

  // ── ① AIP 자료에서 ATIS 주파수를 읽어 내는가 ──────────────────
  // 'VOR/ATIS' 칸의 괄호에는 ATIS 주파수 말고도 VOR 식별부호(KIP)와
  // TACAN 채널(CH 102X)이 섞여 들어온다. 통신 대역인 수만 골라야 한다.
  const fr = await page.evaluate(() => ({
    gimpo: atisFreqOf('RKSS'), jeju: atisFreqOf('RKPC'),
    daegu: atisFreqOf('RKTN'), incheon: atisFreqOf('RKSI'),
    sokcho: atisFreqOf('RKND'), icheon: atisFreqOf('RKUC'),
  }));
  t.ok(fr.gimpo.includes('126.4'), `김포 ATIS 126.4 를 찾는다 (${fr.gimpo.join(',') || '없음'})`);
  t.ok(fr.jeju.includes('126.8'), `제주 ATIS 126.8 을 찾는다 (${fr.jeju.join(',') || '없음'})`);
  t.ok(fr.daegu.includes('127.65'), `대구 ATIS 127.65 를 찾는다 (${fr.daegu.join(',') || '없음'})`);
  t.ok(fr.incheon.includes('128.65'), `인천 ATIS 128.65 를 찾는다 (${fr.incheon.join(',') || '없음'})`);
  // VOR 주파수(108~117)나 TACAN 채널을 ATIS 로 잘못 읽으면 엉뚱한 곳을 듣게 된다
  t.eq(fr.sokcho.length, 0, `ATIS 가 없는 곳(속초)에서는 아무것도 내놓지 않는다 (${fr.sokcho.join(',')})`);
  t.eq(fr.icheon.length, 0, `VOR 식별부호만 있는 곳(이천)도 마찬가지다 (${fr.icheon.join(',')})`);

  // 창을 열고 그 안의 글을 읽어 온다
  const open = async (icao, name, mockOpt) => {
    await page.evaluate(m => eval(m), MOCK(mockOpt));
    await page.evaluate(([i, n]) => showAptAtis(i, n, [37.5, 127.0]), [icao, name]);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const all = [...document.querySelectorAll('.apt-wx-popup .leaflet-popup-content')];
      const el = all[all.length - 1];
      return { n: all.length,
               txt: el ? el.innerText.replace(/\s+/g, ' ').trim() : '',
               imgs: el ? el.querySelectorAll('img').length : -1 };
    });
  };

  // ── ② 문자 D-ATIS 가 있는 공항 — 원문 그대로 보여 준다 ────────
  const faa = await open('KLAX', 'Los Angeles', {
    faa: JSON.stringify([
      { airport: 'KLAX', type: 'arr', code: 'Q',
        datis: 'LOS ANGELES INTL ARR ATIS INFO Q 1853Z. 25008KT 10SM FEW015. ILS APCH RWY 24R IN USE. ADVS YOU HAVE INFO Q.' },
      { airport: 'KLAX', type: 'dep', code: 'Q',
        datis: 'LOS ANGELES INTL DEP ATIS INFO Q 1853Z. DEPTG RWY 25R AND 24L. ADVS YOU HAVE INFO Q.' },
    ]),
  });
  t.ok(faa.txt.includes('ILS APCH RWY 24R IN USE'), 'D-ATIS 원문이 그대로 나온다');
  t.ok(faa.txt.includes('DEPTG RWY 25R'), '도착·출발이 따로 오면 둘 다 나온다');
  t.ok(faa.txt.includes('INFO Q'), `정보 부호(INFO Q)를 밝힌다`);
  t.ok(!faa.txt.includes('공개되지 않는 공항'),
    '원문이 있으면 "없음" 안내를 띄우지 않는다');

  // ── ③ 국내 공항 — 문자 ATIS 가 없다고 밝히고 주파수·METAR 로 갈음 ──
  // 여기서 "조회 실패" 로 얼버무리면 사용자는 앱이 고장 난 줄 안다.
  const kr = await open('RKSS', '김포', {
    metar: 'RKSS 291200Z 32008KT 9999 FEW030 SCT100 24/14 Q1015 NOSIG',
  });
  t.ok(kr.txt.includes('공개되지 않는 공항'), '문자 ATIS 가 없다는 사실을 그대로 알린다');
  t.ok(kr.txt.includes('126.4'), `대신 들을 주파수를 준다 (${kr.txt.includes('126.4') ? '126.4' : '없음'})`);
  t.ok(kr.txt.includes('32008KT') && kr.txt.includes('Q1015'),
    '같은 관측을 담은 METAR 를 함께 보여 준다');
  t.eq(kr.n, 1, '공항을 옮겨 눌러도 창이 쌓이지 않는다(앞 창을 닫는다)');

  // ── ④ VATSIM 은 시뮬레이션임을 반드시 밝힌다 ──────────────────
  // 실제 운항 정보로 오해하면 없는 활주로로 들어가는 일이 생긴다.
  const vat = await open('RKSI', '인천', {
    vatsim: JSON.stringify([
      { callsign: 'RKSI_ATIS', atis_code: 'B',
        text_atis: ['INCHEON INTL ATIS INFO B', 'RWY 33L IN USE', 'QNH 1013'] },
    ]),
  });
  t.ok(vat.txt.includes('RWY 33L IN USE'), 'VATSIM ATIS 원문도 읽어 온다');
  t.ok(vat.txt.includes('시뮬레이션'), 'VATSIM 이라는 것과 시뮬레이션이라는 것을 밝힌다');
  t.ok(vat.txt.includes('실제 운항 정보가 아닙니다'), '실제 운항 정보가 아니라고 못 박는다');

  // ── ⑤ 남이 준 글을 그대로 그리지 않는다 ──────────────────────
  // ATIS 원문은 바깥 서버가 준 글이다. 태그가 섞여 와도 글자로만 보여야 한다.
  const esc = await open('KSFO', 'San Francisco', {
    faa: JSON.stringify([{ airport: 'KSFO', type: 'combined', code: 'A',
      datis: 'SAN FRANCISCO ATIS INFO A <img src=x onerror=alert(1)> RWY 28R IN USE.' }]),
  });
  t.eq(esc.imgs, 0, '원문에 든 태그를 그대로 그리지 않는다');
  t.ok(esc.txt.includes('<img'), '글자로만 보여 준다');

  // ── ⑥ 읽는 동안에는 왼쪽 버튼 줄이 창을 가리지 않는다 ──────────
  // 창 폭이 버튼 줄을 뺀 자리보다 넓어, 가려지면 글자 왼쪽이 잘린다.
  const rail = await page.evaluate(() => {
    const v = getComputedStyle(document.getElementById('map-lsk')).visibility;
    leafMap.closePopup();
    return v;
  });
  await page.waitForTimeout(200);
  const railBack = await page.evaluate(() =>
    getComputedStyle(document.getElementById('map-lsk')).visibility);
  t.eq(rail, 'hidden', '창이 떠 있는 동안에는 버튼 줄을 비켜 둔다');
  t.eq(railBack, 'visible', '창을 닫으면 버튼 줄이 돌아온다');

  // ── ⑦ 지도 공항 팝업에 ATIS 버튼이 있는가 ────────────────────
  // 실제로 그 아이콘의 팝업을 열어 본다 — 만들어지는 내용이 곧 사용자가 볼 것이다
  const btn = await page.evaluate(() => {
    let apt = null;
    leafMap.eachLayer(l => {
      if (!apt && l instanceof L.Marker && l.getPopup && l.getPopup()) {
        const ll = l.getLatLng();
        if (Math.abs(ll.lat - APT_LATLNG.RKSS[0]) < 1e-6 &&
            Math.abs(ll.lng - APT_LATLNG.RKSS[1]) < 1e-6) apt = l;
      }
    });
    if (!apt) return { found: false };
    apt.openPopup();
    const el = document.querySelector('.leaflet-popup-content');
    const s = el ? el.innerHTML : '';
    return { found: true, hasAtis: /ATIS/.test(el ? el.innerText : ''),
             calls: /mapAptAtis\('RKSS'/.test(s) };
  });
  t.eq(btn.found, true, '지도에 공항 아이콘이 있다');
  t.eq(btn.hasAtis, true, '공항 팝업에 ATIS 버튼이 있다');
  t.eq(btn.calls, true, '그 버튼이 그 공항의 ATIS 창을 연다');

  // 뒷정리 — 가로챈 fetch 와 캐시를 되돌린다
  await page.evaluate(() => { delete window.fetch; _wxCache.clear(); leafMap.closePopup(); });
  await page.waitForTimeout(150);
}
