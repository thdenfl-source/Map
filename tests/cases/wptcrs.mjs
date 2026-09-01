// 웨이포인트 카드의 '진입 코스' — 이 지점을 어느 방위로 향해 들어갈지.
//
// Direct To 는 '지금 자리에서 곧장' 이라 접근 방향을 고를 수 없었다. OBS 처럼
// 코스를 정해 들어가려면 NAV 소스를 VOR 로 바꾸는 수밖에 없었다.
// 넣은 값이 CDI·지도 코스선·NAV 오토파일럿 세 곳에서 같은 선을 뜻해야 한다 —
// 하나라도 다른 선을 쓰면 "ON COURSE 인데 지도에서는 어긋나 보이는" 일이 난다.
export const name = '웨이포인트 진입 코스';

export async function run(page, t) {
  const setup = () => page.evaluate(() => {
    S.wps = [{ ident: 'AAA', lat: 37.0, lon: 127.0 },
             { ident: 'BBB', lat: 37.5, lon: 127.5 }];
    S.awp = 0; S.fwp = -1;                  // BBB 는 아직 활성이 아니다
    obsOn = false; navSrc = 'FMS'; holdExit();
    S.lat = 37.2; S.lon = 127.9; S.alt = 3000; S.hdg = 270; S.spd = 120;
    selectPanel('right', 'plan', true);
    fpWptIdx = 1; fpNumFld = null; fpInputBuf = '';
    fpGo('WPT');
  });

  // ── 반으로 나뉜 버튼이 둘 다 있는가 ──
  await setup();
  const ui = await page.evaluate(() => {
    const left  = document.querySelector('[data-act="fpWptNum"][data-arg=\'["ICRS"]\']');
    const right = document.querySelector('[data-act="fpWptDirect"]');
    const box = e => e ? e.getBoundingClientRect() : null;
    const L = box(left), R = box(right);
    return { has: !!left && !!right,
             sameRow: L && R ? Math.abs(L.top - R.top) < 2 : false,
             leftFirst: L && R ? L.left < R.left : false,
             sameWidth: L && R ? Math.abs(L.width - R.width) < 2 : false,
             leftTxt: left ? left.textContent.replace(/\s+/g, ' ').trim() : '',
             rightTxt: right ? right.textContent.replace(/\s+/g, ' ').trim() : '',
             padBefore: !!document.querySelector('.fp-pad5') };
  });
  t.eq(ui.has, true, '진입 코스 · Direct To 두 칸이 있다');
  t.ok(ui.sameRow && ui.leftFirst && ui.sameWidth,
    `한 줄을 반으로 나눠 왼쪽이 진입 코스다 (${ui.leftTxt} | ${ui.rightTxt})`);
  t.ok(/진입 코스/.test(ui.leftTxt) && /— — —/.test(ui.leftTxt),
    `아직 지정 전이면 비어 있다 (${ui.leftTxt})`);
  t.ok(/Direct To/.test(ui.rightTxt), `오른쪽은 종전 기능 그대로다 (${ui.rightTxt})`);
  t.eq(ui.padBefore, false, '누르기 전에는 숫자판이 없다');

  // ── 누르면 아래 빈 자리에 숫자판이 펴진다(값 칸은 그대로 보인다) ──
  const pad = await page.evaluate(async () => {
    document.querySelector('[data-act="fpWptNum"][data-arg=\'["ICRS"]\']').click();
    await new Promise(r => setTimeout(r, 30));
    const p = document.querySelector('.fp-pad5');
    const left = document.querySelector('[data-act="fpWptNum"][data-arg=\'["ICRS"]\']');
    return { pad: !!p, keys: p ? p.querySelectorAll('.fp-pad-key').length : 0,
             below: p && left ? p.getBoundingClientRect().top > left.getBoundingClientRect().bottom : false,
             leftStillThere: !!left };
  });
  t.eq(pad.pad, true, '값 칸을 누르면 숫자판이 나온다');
  t.eq(pad.keys, 14, `숫자 10 + . ⬅ CLR ENT (${pad.keys}개)`);
  t.ok(pad.below && pad.leftStillThere, '숫자판은 값 칸 아래 빈 자리에 펴진다');

  // ── 값을 넣으면 그 코스로 들어가는 선이 된다 ──
  const set = await page.evaluate(async () => {
    ['0', '9', '0'].forEach(n => fpType(n));
    fpConfirmWptNum();
    await new Promise(r => setTimeout(r, 30));
    const L = activeCourseLine();
    return { inCrs: S.wps[1].inCrs, awp: S.awp,
             crsT: L ? L.crs : null, wantT: toTrue(90),
             crsMag: Math.round(toMag(L.crs)),
             toB: L ? (Math.abs(L.to[0] - 37.5) < 1e-9 && Math.abs(L.to[1] - 127.5) < 1e-9) : false,
             sCrs: Math.round(toMag(S.crs)),
             padGone: !document.querySelector('.fp-pad5') };
  });
  t.eq(set.inCrs, 90, '넣은 값이 그 지점에 저장된다 (090°M)');
  t.eq(set.crsMag, 90, `코스선이 090°M 가 된다 (${set.crsMag}°M)`);
  t.eq(set.toB, true, '그 코스로 향하는 끝점은 그 웨이포인트다');
  t.eq(set.sCrs, 90, `PFD CRS 도 같은 값이다 (${set.sCrs}°M — 계기와 선이 달라선 안 된다)`);
  t.eq(set.padGone, true, 'ENT 하면 숫자판이 접힌다');

  // ── 편차·오토파일럿이 같은 선을 쓰는가 ──
  const track = await page.evaluate(() => {
    // 코스선(090°M 로 BBB 에 접근) 북쪽 1NM 지점에 놓는다
    const cT = toTrue(90);
    const back = destPoint(37.5, 127.5, normA(cT + 180), 10);
    const off  = destPoint(back[0], back[1], normA(cT - 90), 1);
    S.lat = off[0]; S.lon = off[1]; S.hdg = toTrue(90);
    updateNav();
    const L = activeCourseLine();
    const xtk = courseXtk(L);
    windSpd = 0; navApOn = true; hdgSelOn = false; gspdOn = false;
    const bank = navApBankTarget();
    return { xtk, bank, dev: S.xtk };
  });
  t.ok(Math.abs(track.xtk + 1) < 0.05,
    `코스 왼쪽 1NM 이 편차 −1 로 잡힌다 (${track.xtk.toFixed(2)}NM)`);
  t.ok(Math.abs(track.dev - track.xtk) < 1e-9, 'CDI 가 쓰는 편차도 같은 값이다');
  t.ok(track.bank > 3, `NAV 오토파일럿이 코스 쪽(우선회)으로 잡는다 (${track.bank.toFixed(1)}°)`);

  // ── 실제로 날려서 그 코스로 들어오는가 ──
  const fly = await page.evaluate(() => {
    const cT = toTrue(90);
    const back = destPoint(37.5, 127.5, normA(cT + 180), 12);
    const off  = destPoint(back[0], back[1], normA(cT - 90), 2);
    S.lat = off[0]; S.lon = off[1]; S.hdg = toTrue(90); S.spd = 120; S.bnk = 0;
    windSpd = 0; navApOn = true; hdgSelOn = false; rollApOn = true;
    const dt = 0.5;
    for (let i = 0; i < 700; i++) {
      updateNav();
      bankTarget = navApBankTarget();
      S.bnk += Math.max(-3, Math.min(3, bankTarget - S.bnk));
      const V = Math.max(10, S.spd) * 0.5144;
      S.hdg = normA(S.hdg + 9.81 * Math.tan(S.bnk * D2R) / V / D2R * dt);
      const sc = 1852 / 3600 * dt / 111320;
      S.lat += S.spd * Math.cos(S.hdg * D2R) * sc;
      S.lon += S.spd * Math.sin(S.hdg * D2R) * sc / Math.cos(S.lat * D2R);
      if (distance(S.lat, S.lon, 37.5, 127.5) < 1) break;
    }
    return { xtk: courseXtk(activeCourseLine()), hdgM: Math.round(toMag(S.hdg)),
             d: distance(S.lat, S.lon, 37.5, 127.5) };
  });
  t.ok(Math.abs(fly.xtk) < 0.1,
    `코스에 붙어서 들어온다 (편차 ${fly.xtk.toFixed(2)}NM · 픽스까지 ${fly.d.toFixed(1)}NM)`);
  t.ok(Math.abs(((fly.hdgM - 90 + 540) % 360) - 180) < 8,
    `기수가 지정 코스와 같아진다 (${fly.hdgM}°M — 지정 090°M)`);

  // ── 비우고 ENT 하면 해제되어 레그로 돌아간다 ──
  const clr = await page.evaluate(async () => {
    fpWptIdx = 1; fpGo('WPT');
    document.querySelector('[data-act="fpWptNum"][data-arg=\'["ICRS"]\']').click();
    fpConfirmWptNum();                       // 빈 채로 ENT
    await new Promise(r => setTimeout(r, 30));
    S.fwp = 0;
    const L = activeCourseLine();
    return { has: 'inCrs' in S.wps[1],
             legM: Math.round(toMag(L.crs)),
             wantM: Math.round(toMag(bearing(37.0, 127.0, 37.5, 127.5))) };
  });
  t.eq(clr.has, false, '비우고 ENT 하면 해제된다');
  t.eq(clr.legM, clr.wantM,
    `앞 지점에서 이어지는 레그 코스로 돌아간다 (${clr.legM}°M)`);

  // ── 범위 밖은 받지 않는다 ──
  const bad = await page.evaluate(async () => {
    fpWptIdx = 1; fpGo('WPT');
    document.querySelector('[data-act="fpWptNum"][data-arg=\'["ICRS"]\']').click();
    ['4', '0', '0'].forEach(n => fpType(n));
    fpConfirmWptNum();
    await new Promise(r => setTimeout(r, 60));
    const still = fpNumFld === 'ICRS';
    fpInputBuf = ''; fpNumFld = null; fpRender();
    return { set: 'inCrs' in S.wps[1], still };
  });
  t.eq(bad.set, false, '400°M 같은 값은 저장하지 않는다');
  t.eq(bad.still, true, '틀린 값이면 입력 상태가 그대로 남는다');
}
