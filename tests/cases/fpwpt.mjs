// 웨이포인트 상세 화면 — 목록에서 항목을 누르면 열리는 카드.
//
// 종전에는 항목을 누르면 곧바로 활성 웨이포인트가 됐다(되돌릴 방법 없음).
// 이제 카드가 열리고, 활성 지정(Direct To)·이름·좌표·VNAV·HOLD 를 거기서 고른다.
// VNAV 는 숫자만 저장하면 반쪽이다 — 실제 강하 계산이 그 값을 쓰는지까지 본다.
export const name = '웨이포인트 상세';

export async function run(page, t) {
  const setup = () => page.evaluate(() => {
    S.wps = []; S.awp = -1; S.fwp = -1;
    pushWP({ ident: 'WP1', lat: 37.5, lon: 127.0 });
    pushWP({ ident: 'WP2', lat: 37.8, lon: 127.6 });
    S.awp = 0; fpWptIdx = -1; fpEditIdx = -1;
    fpGo('LIST');
  });
  await setup();

  // ── 니들 정보 바가 없어졌는가 ──
  // PFD 와 CDU 양쪽에 같은 BRG/CRS/DTW 를 적고 있었다.
  const gone = await page.evaluate(() => ({
    box: !!document.querySelector('.fp-nav-box'),
    cell: !!document.getElementById('nav-brg1'),
    fn: typeof renderNavBox,
  }));
  t.ok(!gone.box && !gone.cell, 'CDU 하단 니들 정보 바가 없다');
  t.eq(gone.fn, 'undefined', '그리던 함수도 남아 있지 않다');

  // ── 항목을 누르면 상세가 열린다(곧바로 활성이 되지 않는다) ──
  const open = await page.evaluate(() => {
    const before = S.awp;
    document.querySelectorAll('.fp-wp-row')[1].click();
    return { before, after: S.awp, mode: fpMode, idx: fpWptIdx,
             title: document.getElementById('fp-mode-title').textContent,
             body: document.getElementById('fp-content-area').textContent };
  });
  t.eq(open.mode, 'WPT', '목록의 항목을 누르면 상세 화면이 열린다');
  t.eq(open.after, open.before, '누르는 것만으로 활성 웨이포인트가 바뀌지는 않는다');
  t.ok(/WP2/.test(open.title) && /Direct To WP2/.test(open.body),
    `그 지점의 카드가 열린다 (${open.title})`);
  t.ok(/VNAV 고도/.test(open.body) && /레그 코스/.test(open.body) && /HOLD/.test(open.body),
    '이름·좌표·VNAV·레그 코스·HOLD 가 한 화면에 있다');

  // ── Direct To ──
  const direct = await page.evaluate(() => {
    document.querySelector('[data-act="fpWptDirect"]').click();
    const awp = S.awp, mode = fpMode;
    fpWptOpen(1);
    return { awp, mode, body: document.getElementById('fp-content-area').textContent };
  });
  t.eq(direct.awp, 1, 'Direct To 를 누르면 그 지점이 활성이 된다');
  t.eq(direct.mode, 'LIST', '누르고 나면 목록으로 돌아온다');
  t.ok(/활성 — WP2/.test(direct.body), '이미 활성이면 버튼이 그렇게 알려 준다');

  // ── VNAV 고도·오프셋 ──
  const vnav = await page.evaluate(() => {
    const type = (act, txt) => {
      document.querySelector(`[data-act="fpWptNum"][data-arg='["${act}"]']`).click();
      // 다른 화면으로 넘어가지 않고, 카드 안에 숫자판이 펴진다
      const r = { mode: fpMode, pad: !!document.querySelector('.fp-pad5') };
      String(txt).split('').forEach(c => fpType(c));
      document.querySelector('[data-act="fpConfirmWptNum"]').click();
      return r;
    };
    const m1 = type('VALT', 2500);
    const m2 = type('VOFS', 3);
    return { m1, m2, alt: S.wps[1].vnavAlt, ofs: S.wps[1].vnavOfs, active: vnavActive,
             padGone: !document.querySelector('.fp-pad5'),
             shown: document.getElementById('fp-content-area').textContent };
  });
  t.ok(vnav.m1.mode === 'WPT' && vnav.m1.pad && vnav.m2.pad,
    'VNAV 칸을 누르면 화면을 옮기지 않고 카드 안에 숫자판이 펴진다');
  t.eq(vnav.padGone, true, '값을 넣고 나면 숫자판이 접히고 동작 버튼이 돌아온다');
  t.ok(vnav.alt === 2500 && vnav.ofs === 3, `VNAV 고도·오프셋이 들어간다 (${vnav.alt}ft / ${vnav.ofs}NM)`);
  t.eq(vnav.active, true, 'VNAV 고도를 넣으면 VNAV 가 걸린다');
  t.ok(/2,500 FT/.test(vnav.shown) && /3\.0 NM/.test(vnav.shown), '넣은 값이 카드에 보인다');

  // 강하 계산이 이 값을 실제로 쓰는가 — 저장만 하고 안 쓰면 숫자 장식이다
  const calc = await page.evaluate(() => {
    S.lat = 37.8; S.lon = 126.0; S.alt = 6000; S.spd = 120; windSpd = 0;
    // WP1 → WP2 레그를 나는 중으로 놓는다(fwp 가 awp 와 같으면 코스선이 한 점이 된다)
    S.fwp = 0; S.awp = 1; obsOn = false; navSrc = 'FMS';
    updateNav(); vnavAngle = -3; vnavActive = true;
    const d0 = distance(S.lat, S.lon, S.wps[1].lat, S.wps[1].lon);
    const withOfs = vnavCalc();
    delete S.wps[1].vnavOfs;
    const noOfs = vnavCalc();
    delete S.wps[1].vnavAlt;
    const noAlt = vnavCalc();
    S.wps[1].vnavAlt = 2500; S.wps[1].vnavOfs = 3;
    return { d0, withOfs, noOfs, noAlt, globalTgt: vnavTgtAlt };
  });
  t.eq(calc.withOfs.tgtAlt, 2500, '웨이포인트 VNAV 고도가 강하 타깃이 된다');
  t.ok(Math.abs((calc.noOfs.d - calc.withOfs.d) - 3) < 0.05,
    `오프셋만큼 목표 지점이 앞당겨진다 (${(calc.noOfs.d - calc.withOfs.d).toFixed(2)}NM)`);
  t.eq(calc.noAlt.tgtAlt, calc.globalTgt,
    '웨이포인트 고도를 지우면 UTIL 의 전역 VNAV 값으로 돌아간다');

  // 비우고 ENTER = 해제. 0 으로 남기면 "해면으로 강하" 가 되어 위험하다.
  const clear = await page.evaluate(() => {
    fpWptOpen(1);
    fpWptNum('VALT'); fpInputBuf = ''; fpConfirmWptNum();
    return { has: 'vnavAlt' in S.wps[1], txt: document.getElementById('fp-content-area').textContent };
  });
  t.eq(clear.has, false, '비우고 ENTER 하면 VNAV 고도가 해제된다(0 으로 남지 않는다)');

  // ── 이름·좌표 고치기 ──
  const edit = await page.evaluate(() => {
    fpWptOpen(1);
    document.querySelector('[data-act="fpWptRename"]').click();
    const m1 = fpMode;
    fpInputBuf = 'ALPHA'; fpConfirmIdent();
    const named = S.wps[1].ident, back1 = fpMode;
    document.querySelector('[data-act="fpWptCoord"]').click();
    const m2 = fpMode;
    fpInputBuf = '38.0'; fpConfirmCoord('LAT');
    fpInputBuf = '128.0'; fpConfirmCoord('LON');
    return { m1, m2, named, back1, lat: S.wps[1].lat, lon: S.wps[1].lon, back2: fpMode,
             n: S.wps.length };
  });
  t.ok(edit.m1 === 'IDENT' && edit.named === 'ALPHA' && edit.back1 === 'WPT',
    `이름을 고치면 그 지점의 이름만 바뀐다 (${edit.named})`);
  t.ok(edit.m2 === 'LAT' && edit.lat === 38 && edit.lon === 128 && edit.back2 === 'WPT',
    `좌표를 고치면 그 지점이 옮겨간다 (${edit.lat}, ${edit.lon})`);
  t.eq(edit.n, 2, '고치기가 새 웨이포인트를 만들지 않는다');

  // ── 삭제 ──
  // B2(BRG2 지정)는 걷어냈다 — 지시침이 그 값을 쓰지 않아 표시만 남던 기능이다.
  const rest = await page.evaluate(async () => {
    fpWptOpen(1);
    const b2 = !document.querySelector('[data-act="fpWptBrg2"]') &&
               !document.querySelector('.fp-wp-b2');
    const p = fpWptDel();                       // 확인 다이얼로그가 뜬다
    await new Promise(r => setTimeout(r, 60));
    const asked = !!document.querySelector('.ui-dlg');
    [...document.querySelectorAll('.ui-dlg-btns button, .ui-dlg-btns .ui-dlg-ok')]
      .find(b => b.textContent.trim() === '삭제')?.click();
    await p;
    return { b2, asked, n: S.wps.length, mode: fpMode };
  });
  t.eq(rest.b2, true, 'B2 버튼은 카드에도 목록에도 없다');
  t.eq(rest.asked, true, '삭제는 되묻고 나서 지운다');
  t.ok(rest.n === 1 && rest.mode === 'LIST', `지우면 목록으로 돌아온다 (남은 ${rest.n}개)`);

  // ── 입력 방법을 먼저 고른다 ──
  // 값을 넣는 화면으로 곧장 들어가는 대신, 네 가지 방법을 먼저 보여 준다.
  const add = await page.evaluate(() => {
    S.wps = []; S.awp = -1;
    fpGo('ADD');
    const txt = document.getElementById('fp-content-area').textContent;
    const go = sel => { fpGo('ADD'); document.querySelector(sel).click(); return fpMode; };
    const r = {
      shown: ['LAT/LON', 'RAD/DIS', 'RAD/RAD', 'P.POS'].filter(m => txt.includes(m)),
      latlon: go(`[data-act="fpGo"][data-arg='["LAT"]']`),
      raddis: go(`[data-act="fpRefOpen"][data-arg='["RB"]']`),
      radrad: go(`[data-act="fpRefOpen"][data-arg='["RR"]']`),
    };
    S.lat = 37.1; S.lon = 127.2;
    r.ppos = go(`[data-act="fpAddPP"]`);
    r.wp = S.wps[0] && { id: S.wps[0].ident, lat: +S.wps[0].lat.toFixed(4), lon: +S.wps[0].lon.toFixed(4) };
    r.idx = fpWptIdx;
    fpGo('ADD');
    document.querySelector('[data-act="fpAddPreset"]').click();
    r.preset = S.wps[S.wps.length - 1].ident;
    return r;
  });
  t.eq(add.shown.join(','), 'LAT/LON,RAD/DIS,RAD/RAD,P.POS', '네 가지 입력 방법이 먼저 보인다');
  t.eq(add.latlon, 'LAT', 'LAT/LON → 좌표 입력');
  t.eq(add.raddis, 'RB', 'RAD/DIS → 기준점·방위·거리');
  t.eq(add.radrad, 'RR', 'RAD/RAD → 두 방위의 교점');
  t.ok(add.wp && add.wp.id === 'PP1' && add.wp.lat === 37.1 && add.wp.lon === 127.2,
    `P.POS 는 지금 있는 자리로 만든다 (${add.wp && add.wp.id})`);
  t.ok(add.ppos === 'WPT' && add.idx === 0,
    'P.POS 로 만들면 바로 그 지점의 상세 카드가 열린다(이름을 다듬으라고)');
  t.eq(add.preset, 'RKSI', '공항 프리셋도 그대로 동작한다');

  // ── 방위·거리도 좌표와 같은 입력창으로 ──
  // 종전에는 ≪ ◄ ► ≫ 로 한 칸씩 밀어야 했다. 117° 를 넣으려면 열 번 넘게
  // 눌러야 하고, 좌표는 숫자판인데 방위는 화살표라 손이 헷갈렸다.
  const ref = await page.evaluate(() => {
    S.wps = []; S.awp = -1; S.lat = 37.0; S.lon = 127.0;
    fpRefOpen('RB');
    fpRefChoose('APT', 'RKSI');
    const type = (fld, txt) => {
      document.querySelector(`[data-act="fpRefNum"][data-arg='["${fld}"]']`).click();
      const m = { mode: fpMode, pad: !!document.querySelector('.fp-pad5') };
      String(txt).split('').forEach(c => fpType(c));
      document.querySelector('[data-act="fpConfirmRefNum"]').click();
      return m;
    };
    const r = { spinner: document.getElementById('fp-content-area').textContent.includes('≪'),
                adjFn: typeof fpRefAdj,
                padOnOpen: !!document.querySelector('.fp-pad5') };
    r.mBrg = type('b1', 117);
    r.b1 = fpRef.b1; r.back = fpMode; r.nextFld = fpRefNumFld;
    r.mDis = type('d1', '8.8');
    r.d1 = fpRef.d1; r.padStays = !!document.querySelector('.fp-pad5');
    const s = fpRefSolve();
    r.solved = s.err ? s.err : { id: s.ident, lat: +s.lat.toFixed(4), lon: +s.lon.toFixed(4) };
    return r;
  });
  t.ok(!ref.spinner && ref.adjFn === 'undefined', '화살표 스피너가 없어졌다');
  t.eq(ref.padOnOpen, true, '화면을 열면 숫자판이 값 칸과 함께 펴져 있다');
  t.ok(ref.mBrg.mode === 'RB' && ref.mDis.mode === 'RB' && ref.mBrg.pad && ref.mDis.pad,
    '값을 넣는 동안 화면이 바뀌지 않는다(숫자판만 있는 화면으로 넘어가지 않는다)');
  t.ok(ref.b1 === 117 && ref.d1 === 8.8, `친 값이 그대로 들어간다 (${ref.b1}° / ${ref.d1}NM)`);
  t.eq(ref.nextFld, 'd1', '방위를 넣으면 다음 칸(거리)으로 저절로 옮겨 간다');
  t.eq(ref.padStays, true, '넣고 나서도 숫자판은 그대로 펴져 있다');
  t.ok(ref.solved.id === 'RKSI117/8.8' && Math.abs(ref.solved.lat - 37.4149) < 0.001,
    `넣은 값으로 좌표가 나온다 (${ref.solved.id} → ${ref.solved.lat}, ${ref.solved.lon})`);

  // 범위 밖은 되묻고 값을 바꾸지 않는다 — 잘못 친 값을 조용히 받아들이면 안 된다
  const bad = await page.evaluate(async () => {
    const before = fpRef.b1;
    fpRefNum('b1');
    '500'.split('').forEach(c => fpType(c));
    fpConfirmRefNum();
    await new Promise(r => setTimeout(r, 60));
    const asked = !!document.querySelector('.ui-dlg');
    document.querySelector('.ui-dlg-btns .ui-dlg-ok')?.click();
    await new Promise(r => setTimeout(r, 60));
    return { before, after: fpRef.b1, asked, mode: fpMode };
  });
  t.ok(bad.asked && bad.after === bad.before,
    `범위 밖(500°)은 알리고 값을 바꾸지 않는다 (${bad.after}° 유지)`);

  // RAD/RAD 의 두 번째 방위도 같은 방식
  const rr = await page.evaluate(() => {
    fpRefOpen('RR');
    fpRefSlot = 1; fpRefChoose('APT', 'RKSI');
    fpRefSlot = 2; fpRefChoose('APT', 'RKSS');
    document.querySelector(`[data-act="fpRefNum"][data-arg='["b2"]']`).click();
    const m = fpMode;
    '249'.split('').forEach(c => fpType(c));
    document.querySelector('[data-act="fpConfirmRefNum"]').click();
    return { m, b2: fpRef.b2, back: fpMode };
  });
  t.ok(rr.m === 'RR' && rr.b2 === 249 && rr.back === 'RR',
    `RAD/RAD 의 방위 #2 도 같은 자리에서 넣는다 (${rr.b2}°)`);

  // ── 지도에서 웨이포인트를 누르면 설명창 ──
  // 공항·VOR 은 팝업으로 좌표를 확인하고 상세로 갈 수 있는데, 웨이포인트만
  // 누르는 즉시 활성이 되고 갈 데가 없었다.
  const mapPop = await page.evaluate(() => {
    S.wps = []; S.awp = -1; S.brg2wp = -1;
    pushWP({ ident: 'WP1', lat: 37.40, lon: 126.66 });
    pushWP({ ident: 'WP2', lat: 37.45, lon: 126.80,
             hold: { dir: 'R', crs: 90, legType: 'TIME', legVal: 60 }, vnavAlt: 2500 });
    S.awp = 0; updateWpMarkers();
    const before = S.awp;
    wpMarkers[1].fire('click');
    const html = document.querySelector('.leaflet-popup-content')?.innerHTML || '';
    return { awp: S.awp, before, html };
  });
  t.eq(mapPop.awp, mapPop.before, '지도의 웨이포인트를 눌러도 곧바로 활성이 되지 않는다');
  t.ok(/WP2/.test(mapPop.html) && /37°27′00″N/.test(mapPop.html) && /126°48′00″E/.test(mapPop.html),
    '이름과 좌표(도분초)가 설명창에 나온다');
  t.ok(/비행계획 2번째/.test(mapPop.html) && /HOLD/.test(mapPop.html) && /VNAV 2,500ft/.test(mapPop.html),
    '몇 번째인지와 HOLD·VNAV 가 걸려 있는지도 함께 보여 준다');
  t.ok(/정보/.test(mapPop.html) && !/플랜 추가/.test(mapPop.html),
    '「정보」 버튼이 있고, 이미 플랜에 있으므로 「플랜 추가」는 주지 않는다');

  // 「정보」 → 그 지점의 카드
  const jump = await page.evaluate(() => {
    _mapOpenWpt(1);
    return { mode: fpMode, idx: fpWptIdx,
             title: document.getElementById('fp-mode-title').textContent,
             cduShown: leftSel === 'cdu' || rightSel === 'cdu' || rightSel === 'plan' };
  });
  t.ok(jump.mode === 'WPT' && jump.idx === 1,
    '「정보」를 누르면 비행계획의 그 웨이포인트 카드로 간다');
  t.ok(/WP2/.test(jump.title) && jump.cduShown,
    `CDU 패널까지 함께 띄운다 (${jump.title})`);

  // 초 반올림이 60 이 되면 분으로 올린다 — 126.8 이 126°47′60″ 로 나오던 자리
  const dms = await page.evaluate(() => [
    decToDMS(126.80, false), decToDMS(-37.99999, true), decToDMS(129.99999, false),
  ]);
  t.eq(dms.join(' '), '126°48′00″E 38°00′00″S 130°00′00″E',
    `도분초 올림이 맞는다 (${dms.join(' ')})`);

  // ── 홀딩 설정도 같은 숫자판으로 ──
  // 종전에는 코스가 ≪ ◄ ► ≫, 시간이 ▼ ▲ 였고 시간은 정해진 여섯 값
  // (30·60·90·120·150·180초)만 고를 수 있었다. 45초짜리 레그는 못 넣었다.
  const hold = await page.evaluate(() => {
    S.wps = []; S.awp = -1;
    pushWP({ ident: 'DUBUN', lat: 37.5, lon: 127.0 });
    fpHoldOpen(0);
    const r = { fld: fpHoldNumFld, pad: !!document.querySelector('.fp-pad5'),
                spinner: /≪|▼/.test(document.getElementById('fp-content-area').textContent),
                crsAdj: typeof fpHoldCrsAdj, legAdj: typeof fpHoldLegAdj };
    const ent = () => document.querySelector('[data-act="fpConfirmHoldNum"]').click();
    '288'.split('').forEach(c => fpType(c)); ent();
    r.crs = fpHoldDraft.crsM; r.next = fpHoldNumFld; r.mode = fpMode;
    '45'.split('').forEach(c => fpType(c)); ent();     // 정해진 값이 아닌 45초
    r.leg = fpHoldDraft.legVal;
    fpHoldSet('legType', 'DIST');
    fpHoldNum('leg'); '2.5'.split('').forEach(c => fpType(c)); ent();
    r.dist = fpHoldDraft.legVal;
    fpHoldSet('legType', 'TIME');
    fpHoldNum('leg'); '45'.split('').forEach(c => fpType(c)); ent();
    fpHoldApply();
    r.saved = S.wps[0].hold;
    r.savedCrsM = r.saved ? Math.round(toMag(r.saved.crs)) : null;
    return r;
  });
  t.ok(!hold.spinner && hold.crsAdj === 'undefined' && hold.legAdj === 'undefined',
    '화살표 스텝 버튼이 없어졌다');
  t.ok(hold.pad && hold.fld === 'crs' && hold.mode === 'HOLD',
    '홀딩 화면을 열면 코스 칸이 잡히고 숫자판이 함께 펴져 있다');
  t.ok(hold.crs === 288 && hold.next === 'leg',
    `코스를 치면 그대로 들어가고 레그 칸으로 넘어간다 (${hold.crs}°M)`);
  t.eq(hold.leg, 45, `정해진 값이 아닌 시간도 넣을 수 있다 (${hold.leg}초 — 종전에는 30·60·90… 만)`);
  t.eq(hold.dist, 2.5, `거리도 소수로 넣을 수 있다 (${hold.dist}NM)`);
  t.ok(hold.saved && hold.saved.legVal === 45 && hold.savedCrsM === 288,
    `ENTER 하면 그 값이 웨이포인트에 저장된다 (${hold.saved && hold.saved.legVal}초 · ${hold.savedCrsM}°M)`);

  // 범위 밖은 되묻고 값을 지킨다
  const hbad = await page.evaluate(async () => {
    fpHoldOpen(0);
    const before = fpHoldDraft.crsM;
    '999'.split('').forEach(c => fpType(c));
    document.querySelector('[data-act="fpConfirmHoldNum"]').click();
    await new Promise(r => setTimeout(r, 60));
    const asked = !!document.querySelector('.ui-dlg');
    document.querySelector('.ui-dlg-btns .ui-dlg-ok')?.click();
    await new Promise(r => setTimeout(r, 60));
    return { before, after: fpHoldDraft.crsM, asked };
  });
  t.ok(hbad.asked && hbad.after === hbad.before,
    `홀딩도 범위 밖(999°)은 알리고 값을 지킨다 (${hbad.after}°M 유지)`);

  // ── ORIGIN 을 넣으면 항공기가 그 자리로 ──
  // 시작 위치는 앱을 켤 때 한 번 잡히고 그만이라, 다른 공항에서 출발해 보려면
  // 지도를 끌어다 항공기를 손으로 옮겨야 했다. 출발지는 비행계획 첫 줄에
  // 이미 적는 것이니 그걸 적으면 거기 서 있게 한다.
  const org = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const r = {};
    S.running = false; gpsMode = false;
    S.lat = 37.3895; S.lon = 126.6550; S.wps = []; S.awp = -1;
    S.trail = [[S.lat, S.lon], [37.4, 126.7]];
    fpAddPreset('RKPK');                       // 공항 명칭으로 출발지 지정
    await wait(100);
    const apt = AIRPORTS.find(x => x.ident === 'RKPK');
    r.toApt = distance(S.lat, S.lon, apt.lat, apt.lon);
    r.trail = S.trail.length;
    // 두 번째부터는 옮기지 않는다 — 출발지만 자리를 정한다
    const at = [S.lat, S.lon];
    fpAddPreset('RKSI');
    await wait(100);
    r.secondMoved = distance(at[0], at[1], S.lat, S.lon) > 0.05;
    // 좌표로 넣어도, 나중에 고쳐도 따라간다
    S.wps = []; S.awp = -1; S.lat = 37.0; S.lon = 127.0;
    pushWP({ ident: 'ORG', lat: 35.0, lon: 128.0 });
    await wait(100);
    r.byCoord = distance(S.lat, S.lon, 35.0, 128.0);
    fpWptOpen(0); fpWptCoord();
    fpInputBuf = '36.5'; fpConfirmCoord('LAT');
    fpInputBuf = '127.5'; fpConfirmCoord('LON');
    await wait(120);
    r.afterEdit = distance(S.lat, S.lon, 36.5, 127.5);
    // GPS 모드(실제 비행)에서는 손대지 않는다 — 위치는 수신기가 정한다
    S.wps = []; S.awp = -1; S.lat = 37.0; S.lon = 127.0; gpsMode = true;
    pushWP({ ident: 'X', lat: 34.0, lon: 129.0 });
    await wait(100);
    r.gpsHeld = distance(S.lat, S.lon, 37.0, 127.0) < 0.05;
    gpsMode = false;
    return r;
  });
  t.ok(org.toApt < 0.05, `공항 명칭으로 출발지를 넣으면 그 공항에 선다 (RKPK 에서 ${org.toApt.toFixed(2)}NM)`);
  t.eq(org.trail, 0, '옮기면서 옛 항적을 지운다 — 남기면 순간이동 선이 하나 그어진다');
  t.eq(org.secondMoved, false, '두 번째 웨이포인트부터는 항공기를 옮기지 않는다');
  t.ok(org.byCoord < 0.05 && org.afterEdit < 0.05,
    `좌표로 넣어도, 나중에 고쳐도 따라간다 (${org.byCoord.toFixed(2)}NM · ${org.afterEdit.toFixed(2)}NM)`);
  t.eq(org.gpsHeld, true, 'GPS 모드에서는 옮기지 않는다(위치는 수신기가 정한다)');

  // 비행 중이면 되묻는다 — 날고 있는 기체를 말없이 순간이동시키지 않는다
  const fly = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const btn = lbl => [...document.querySelectorAll('.ui-dlg-btns button, .ui-dlg-btns .ui-dlg-ok')]
      .find(b => b.textContent.trim() === lbl);
    const r = {};
    S.lat = 37.0; S.lon = 127.0; S.running = true; gpsMode = false;
    S.wps = []; S.awp = -1;
    pushWP({ ident: 'A', lat: 35.0, lon: 128.0 });
    await wait(120);
    r.asked = !!document.querySelector('.ui-dlg');
    r.msg = document.querySelector('.ui-dlg-msg')?.textContent || '';
    btn('그대로')?.click(); await wait(120);
    r.stayed = distance(S.lat, S.lon, 37.0, 127.0) < 0.05;
    S.wps = []; S.awp = -1;
    pushWP({ ident: 'B', lat: 35.0, lon: 128.0 });
    await wait(120);
    btn('옮기기')?.click(); await wait(150);
    r.moved = distance(S.lat, S.lon, 35.0, 128.0) < 0.05;
    S.running = false;
    return r;
  });
  t.eq(fly.asked, true, '비행 중에 출발지를 넣으면 옮길지 되묻는다');
  t.ok(/비행 중/.test(fly.msg) && /NM/.test(fly.msg),
    '얼마나 떨어진 자리인지 알려 준다');
  t.eq(fly.stayed, true, '「그대로」 를 고르면 항공기는 제자리다');
  t.eq(fly.moved, true, '「옮기기」 를 고르면 그 자리로 간다');
}
