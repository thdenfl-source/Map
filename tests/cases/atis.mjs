// ATIS — 지도 공항 아이콘에서 문자로 읽는다
//
// 문자 ATIS 를 받는 길은 둘이다. FAA D-ATIS(미국 공항)와 atis.guru(항공기
// ACARS 요청에서 모은 원문 — 국내 공항은 이것뿐). atis.guru 는 누가 요청해야
// 들어오므로 없거나 묵은 것일 수 있다. 그럴 때 그렇다고 밝히고 주파수·METAR 로
// 받치는지, 없는 것을 있는 척하지 않는지가 이 검사의 요점이다.
//
// 바깥 서버를 실제로 부르면 검사가 남의 사정에 흔들리므로 fetch 를 가로챈다.
export const name = 'ATIS (문자)';

// 목(mock) 한 벌 — url 에 따라 답을 고른다
const MOCK = (opt) => `(() => {
  const o = ${JSON.stringify(opt)};
  _wxCache.clear();
  _atisRelayCache = null;
  window.__hits = { faa: 0, guru: 0, vatsim: 0, relay: 0 };
  window.fetch = (u) => {
    u = String(u);
    if (u.includes('vatsim.net%2Fv3') || u.includes('vatsim.net/v3')) window.__hits.vatsim++;
    if (u.includes('datis.clowd.io')) {
      window.__hits.faa++;
      return o.faa ? Promise.resolve({ ok: true, text: async () => o.faa })
                   : Promise.resolve({ ok: true, text: async () => '{"error":"not found"}' });
    }
    if (u.includes('raw.githubusercontent.com') && u.includes('atis-data')) {
      window.__hits.relay++;
      return o.relay ? Promise.resolve({ ok: true, text: async () => o.relay })
                     : Promise.resolve({ ok: false, status: 404, text: async () => '404: Not Found' });
    }
    if (u.includes('atis.guru')) {
      window.__hits.guru++;
      return o.guru ? Promise.resolve({ ok: true, text: async () => o.guru })
                    : Promise.resolve({ ok: false, status: 404, text: async () => '' });
    }
    if (u.includes('metar'))
      return o.metar ? Promise.resolve({ ok: true, text: async () => o.metar })
                     : Promise.reject(new Error('no metar'));
    return Promise.reject(new Error('blocked'));
  };
})()`;

// 지금(UTC)에서 min 분 전의 'YYYY-MM-DD HH:MM UTC'(atis.guru 표기)와 ISO
const stampAgo = (min) => new Date(Date.now() - min * 6e4).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const isoAgo = (min) => new Date(Date.now() - min * 6e4).toISOString();
// 지금(UTC)에서 min 분 전의 HHMM
const hhmmAgo = (min) => {
  const d = new Date(Date.now() - min * 6e4);
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
};

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

  // ── ③ 국내 공항, 수집된 원문이 없을 때 — 없다고 밝히고 주파수·METAR 로 ──
  // 여기서 "조회 실패" 로 얼버무리면 사용자는 앱이 고장 난 줄 안다.
  const kr = await open('RKSS', '김포', {
    guru: '<html><body><h1>RKSS (GMP)</h1><p>No D-ATIS has been received for this airport yet.</p></body></html>',
    metar: 'RKSS 291200Z 32008KT 9999 FEW030 SCT100 24/14 Q1015 NOSIG',
  });
  t.ok(kr.txt.includes('문자 ATIS(D-ATIS)가 없습니다'), '받을 원문이 없다는 사실을 그대로 알린다');
  t.ok(kr.txt.includes('126.4'), `대신 들을 주파수를 준다 (${kr.txt.includes('126.4') ? '126.4' : '없음'})`);
  t.ok(kr.txt.includes('32008KT') && kr.txt.includes('Q1015'),
    '같은 관측을 담은 METAR 를 함께 보여 준다');
  t.eq(kr.n, 1, '공항을 옮겨 눌러도 창이 쌓이지 않는다(앞 창을 닫는다)');
  const hits = await page.evaluate(() => window.__hits);
  t.eq(hits.faa, 0, '국내 공항에는 미국 전용 FAA 를 부르지 않는다');
  t.ok(hits.guru > 0, '국내 공항은 atis.guru 에서 찾는다');
  t.eq(hits.vatsim, 0, 'VATSIM(시뮬레이션) ATIS 는 더 이상 찾지 않는다');
  t.ok(hits.relay > 0, '서버에서 모아 둔 ATIS(JSON)도 찾아본다');
  t.ok(kr.txt.includes('첫 수집 전'), `왜 없는지 적는다 — 수집 자료가 아직 없을 때 (${(kr.txt.match(/수집 서버[^\n]*/) || ['없음'])[0].slice(0, 40)})`);

  // 수집기는 돌았는데 그 공항 원문이 없었을 때 / 수집기가 막혔을 때
  const why1 = await open('RKSS', '김포', {
    relay: JSON.stringify({ generated: isoAgo(4), airports: {}, status: { RKSS: 'none' } }),
    metar: 'RKSS 291200Z 32008KT 9999 FEW030 24/14 Q1015 NOSIG',
  });
  t.ok(why1.txt.includes('최근 원문 없음') && why1.txt.includes('4분 전'),
    `수집기가 확인했지만 원문이 없었다고 적는다 (${(why1.txt.match(/수집 서버.*?전/) || ['없음'])[0]})`);
  const why2 = await open('RKSS', '김포', {
    relay: JSON.stringify({ generated: isoAgo(4), airports: {}, status: { RKSS: 'http 403' } }),
  });
  t.ok(why2.txt.includes('조회 실패 (http 403)'), '수집기가 막혔으면 그렇게 적는다');

  // ── ③-2 서버에서 모아 둔 ATIS — 프록시가 모두 막혀도 나온다 ──────────
  // 브라우저가 atis.guru 를 직접 못 받는 것이 인천·김포가 안 나온 까닭이었다.
  const rl = await open('RKSS', '김포', {
    relay: JSON.stringify({ generated: isoAgo(3), airports: { RKSS: [
      { type: 'ARR', code: 'P', time: hhmmAgo(20) + 'Z', collected: isoAgo(20),
        text: `RKSS ARR ATIS P ${hhmmAgo(20)}Z EXPECT ILS APPROACH RWY 32L IN USE QNH 1013 YOU HAVE INFORMATION P` }] } }),
    metar: 'RKSS 291200Z 32008KT 9999 FEW030 24/14 Q1015 NOSIG',
  });
  t.ok(rl.txt.includes('RWY 32L IN USE') && rl.txt.includes('INFO P'),
    `프록시가 막혀도 모아 둔 원문을 보여 준다 (${rl.txt.slice(0, 90)})`);
  t.ok(rl.txt.includes('20분 전'), '모은 시각에서 경과 시간을 셈한다');
  t.ok(!rl.txt.includes('METAR'), '최신이면 METAR 를 덧붙이지 않는다');

  // ── ③-3 실제 atis.guru 페이지 모양(div.atis + card-subtitle) ─────────
  // 같은 칸 모양에 METAR·TAF 도 들어 있다. 시각은 카드 머리(UTC 표기)에 있다.
  const card = (stamp, body) => `<div class="card"><div class="card-body">
      <h6 class="card-subtitle mb-2 text-muted">${stamp}</h6><div class="atis">${body}</div></div></div>`;
  const real = await open('RKSI', '인천', {
    guru: `<html><body><h1>RKSI (ICN) - Live digital ATIS</h1>` +
      card(stampAgo(8), `RKSI ARR ATIS L ${hhmmAgo(8)}Z\r\nEXPECT ILS APPROACH RWY 33R\r\nQNH 1016\r\nYOU HAVE INFORMATION L`) +
      card(stampAgo(8), `RKSI DEP ATIS L ${hhmmAgo(8)}Z\r\nDEPARTURE RWY 34L\r\nQNH 1016`) +
      card(stampAgo(30), `METAR RKSI 291130Z 33008KT 9999 FEW030 24/14 Q1016 NOSIG`) +
      card(stampAgo(68), `RKSI ARR ATIS K ${hhmmAgo(68)}Z EXPECT ILS APPROACH RWY 15L QNH 1015 YOU HAVE INFORMATION K`) +
      `</body></html>`,
  });
  t.ok(real.txt.includes('RWY 33R') && real.txt.includes('RWY 34L'), '실제 페이지 모양에서 도착·출발 원문을 읽는다');
  t.ok(!real.txt.includes('RWY 15L'), '지나간 ATIS 는 건너뛴다');
  t.ok(!real.txt.includes('33008KT'), 'METAR 칸을 ATIS 로 읽지 않는다');
  // 카드 머리는 분까지만 적으므로 검사 도중 분이 넘어가면 9분이 된다
  t.ok(/\b[89]분 전/.test(real.txt), `카드 머리의 수집 시각으로 경과 시간을 셈한다 (${(real.txt.match(/\d+분 전/) || ['없음'])[0]})`);

  // ── ③-4 둘 다 있으면 더 새것 ─────────────────────────────────────
  const both = await open('RKPC', '제주', {
    relay: JSON.stringify({ airports: { RKPC: [
      { type: '', code: 'B', collected: isoAgo(240),
        text: 'RKPC ATIS INFORMATION B RWY 25 IN USE QNH 1010 YOU HAVE INFORMATION B' }] } }),
    guru: card(stampAgo(15), `RKPC ATIS INFORMATION C ${hhmmAgo(15)}Z RWY 07 IN USE QNH 1011 YOU HAVE INFORMATION C`),
    metar: 'RKPC 291200Z 09012KT 9999 FEW020 26/20 Q1011 NOSIG',
  });
  t.ok(both.txt.includes('INFO C') && !both.txt.includes('INFO B'),
    `모아 둔 것이 묵었으면 새로 받은 쪽을 쓴다 (${(both.txt.match(/INFO [A-Z]/) || ['없음'])[0]})`);

  // ── ④ 국내 공항, 방금 수집된 원문 — 페이지에서 원문만 골라 보여 준다 ──
  // 페이지에는 머리말·스크립트·METAR·지나간 ATIS 가 함께 있다. 최신 도착·출발
  // 원문만 골라야 하고, 수집 시각("12 minutes ago")을 밝혀야 한다.
  const t0 = hhmmAgo(12), tOld = hhmmAgo(75);
  const guruFresh = `<!doctype html><html><head><title>RKSI ATIS</title>
    <script>window.x = "SCRIPTFAKE ATIS INFO Z RWY 99 IN USE QNH 1013 WIND CALM";</script></head>
    <body><nav>Home · Airports · Live digital ATIS</nav>
    <div class="metar">RKSI 291200Z 33008KT 9999 FEW030 24/14 Q1015 NOSIG</div>
    <div class="card"><div class="hd"><b>ARR</b> <span>12 minutes ago</span></div>
      <pre>RKSI ARR ATIS K ${t0}Z<br>EXPECT ILS APPROACH RWY 33L IN USE<br>QNH 1015 HPA<br>ADVISE YOU HAVE INFORMATION K</pre></div>
    <div class="card"><div class="hd"><b>DEP</b> <span>12 minutes ago</span></div>
      <pre>RKSI DEP ATIS K ${t0}Z DEPARTURE RWY 34R IN USE QNH 1015 HPA ADVISE YOU HAVE INFORMATION K</pre></div>
    <h3>Previous</h3>
    <div class="card"><div class="hd"><b>ARR</b> <span>75 minutes ago</span></div>
      <pre>RKSI ARR ATIS J ${tOld}Z EXPECT ILS APPROACH RWY 15R IN USE QNH 1014 HPA ADVISE YOU HAVE INFORMATION J</pre></div>
    </body></html>`;
  const gf = await open('RKSI', '인천', {
    guru: guruFresh,
    metar: 'RKSI 291200Z 33008KT 9999 FEW030 24/14 Q1015 NOSIG',
  });
  t.ok(gf.txt.includes('RWY 33L IN USE'), `atis.guru 원문을 읽어 온다 (${gf.txt.slice(0, 120)})`);
  t.ok(gf.txt.includes('RWY 34R'), '도착·출발 원문을 둘 다 보여 준다');
  t.ok(gf.txt.includes('INFO K') && gf.txt.includes(`${t0}Z`), '정보 부호와 발표 시각을 밝힌다');
  t.ok(!gf.txt.includes('RWY 15R') && !gf.txt.includes('INFO J'), '지나간 ATIS(J)는 보여 주지 않는다');
  t.ok(!gf.txt.includes('SCRIPTFAKE') && !gf.txt.includes('Airports'), '페이지 머리말·스크립트를 끌어오지 않는다');
  t.ok(!gf.txt.includes('USEQNH'), '줄바꿈 자리의 글자가 붙지 않는다');
  t.ok(gf.txt.includes('12분 전'), '수집된 지 얼마나 됐는지 밝힌다');
  t.ok(gf.txt.includes('atis.guru') && gf.txt.includes('ACARS'), '어디서 온 원문인지 밝힌다');
  t.ok(!gf.txt.includes('지난 ATIS'), '방금 것에는 "지났을 수 있다" 경고를 붙이지 않는다');
  t.ok(!gf.txt.includes('METAR'), '최신 원문이 있으면 METAR 를 덧붙이지 않는다');
  t.ok(gf.txt.includes('128.65'), '국내 공항이면 확인용 주파수도 함께 준다');

  // ── ④-2 묵은 원문 — 시각은 원문 속 HHMMZ 뿐 — 지났을 수 있다고 알리고 METAR 로 받친다 ──
  const old5 = hhmmAgo(300);
  const gs = await open('RKPC', '제주', {
    guru: `<html><body><div><p>RKPC ATIS INFORMATION D ${old5}Z RWY 07 IN USE WIND 090 DEG 12 KT QNH 1012 ADVISE YOU HAVE INFORMATION D</p></div></body></html>`,
    metar: 'RKPC 291200Z 09012KT 9999 FEW020 26/20 Q1012 NOSIG',
  });
  t.ok(gs.txt.includes('RWY 07 IN USE'), '묵은 원문도 보여는 준다');
  t.ok(gs.txt.includes('5시간 전'), `발표 시각에서 경과 시간을 셈한다 (${(gs.txt.match(/\d+시간[^전]*전/) || ['없음'])[0]})`);
  t.ok(gs.txt.includes('지난 ATIS 일 수 있습니다'), '지났을 수 있다고 알린다');
  t.ok(gs.txt.includes('09012KT'), '대신 지금 METAR 를 함께 보여 준다');

  // ── ④-3 하루 넘게 묵은 원문은 숨기고 나이만 알린다 ─────────────────
  // 실제 수집분에는 몇 달 묵은 것도 섞여 온다(울산 DEP 2025-11 등).
  const ancient = await open('RKPU', '울산', {
    relay: JSON.stringify({ generated: isoAgo(2), airports: { RKPU: [
      { type: 'DEP', code: 'O', time: '1100Z', collected: isoAgo(60 * 24 * 40),
        text: 'RKPU DEP ATIS O 1100Z RWY 36 IN USE QNH 1014 HPA ADZ YOU HAVE INFO O' }] },
      status: { RKPU: 'ok 1' } }),
    metar: 'RKPU 291200Z 18004KT 9999 FEW050 27/14 Q1007 NOSIG',
  });
  t.ok(!ancient.txt.includes('RWY 36 IN USE'), '하루 넘게 묵은 원문은 보여 주지 않는다');
  t.ok(ancient.txt.includes('40일 전 것이라 표시하지 않습니다'),
    `대신 마지막 원문이 언제 것인지 알린다 (${(ancient.txt.match(/atis\.guru 마지막[^\n]*?니다/) || ['없음'])[0]})`);
  t.ok(ancient.txt.includes('18004KT'), '그때는 METAR 로 받친다');

  // 도착/출발은 원문 머리로 가린다 — 본문에 DEP 가 섞여도 도착 ATIS 다(실제 광주 원문)
  const kind = await page.evaluate(() =>
    _atisMeta('RKJJ ARR ATIS K 0220Z RWY 4 IN USE EXP GWANG JU 5 DEP EXP ALL DEP TO JEJU QNH 1010').type);
  t.eq(kind, 'ARR', '본문에 DEP 가 섞여도 머리가 ARR 이면 도착 ATIS 다');

  // JSON 으로 오는 경우(공개 API 가 생길 때)도 읽는다
  const js = await page.evaluate(() => _parseAtisGuru(JSON.stringify(
    { atis: [{ text: 'RKSS ARR ATIS A 0300Z RWY 32R IN USE QNH 1013 YOU HAVE INFORMATION A' }] }), 'RKSS'));
  t.ok(js.length === 1 && js[0].code === 'A' && js[0].type === 'ARR' && js[0].time === '0300Z',
    `JSON 응답도 읽는다 (${JSON.stringify(js[0] || null)})`);

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
