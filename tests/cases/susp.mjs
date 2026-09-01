// SUSP — 시퀀싱 보류
//
// 켜져 있으면 활성 웨이포인트를 지나도 다음으로 넘어가지 않고 그 구간의 코스를
// 계속 따라간다. 마지막 지점이어도 NAV 가 풀리지 않는다 — 홀딩·미스드어프로치를
// 계속 수행하기 위한 것이다. 홀딩이 걸리면 저절로 켜지고, 눌러서 풀면 다음
// 지점으로 넘어간다.
export const name = 'SUSP (시퀀싱 보류)';

export async function run(page, t) {
  // A → B → C. B 를 향해 날다가 B 를 지나면 보통 C 로 넘어간다.
  const setup = () => page.evaluate(() => {
    S.wps = [{ ident: 'AAA', lat: 37.0, lon: 127.0 },
             { ident: 'BBB', lat: 37.2, lon: 127.0 },
             { ident: 'CCC', lat: 37.4, lon: 127.3 }];
    S.awp = 1; S.fwp = 0; S.dtoLive = false;
    obsOn = false; navSrc = 'FMS'; holdExit();
    suspOn = false; updateSuspBtn();
    S.lat = 37.15; S.lon = 127.0; S.hdg = 360; S.spd = 120; S.bnk = 0; S.alt = 3000;
    windSpd = 0; navApOn = true; hdgSelOn = false; rollApOn = true;
    S.running = true; S.lastT = null;
  });
  // 실제 프레임 루프를 돌린다(시퀀싱은 거기서 일어난다)
  const fly = (sec) => page.evaluate((sec) => {
    const t0 = performance.now();
    for (let i = 0; i < sec / 0.3; i++) simStep(t0 + i * 300);
    return { awp: S.awp >= 0 ? S.wps[S.awp].ident : null, navApOn,
             dN: (S.lat - 37.2) * 60 };
  }, sec);

  // ── 종전 동작: 지나면 다음으로 넘어간다 ──
  await setup();
  const norm = await fly(200);
  t.eq(norm.awp, 'CCC', `SUSP 가 없으면 B 를 지나 C 로 넘어간다 (${norm.awp})`);

  // ── SUSP 를 켜면 넘어가지 않는다 ──
  await setup();
  const held = await page.evaluate(async () => {
    document.getElementById('susp-btn').click();
    const on = suspOn;
    const t0 = performance.now();
    for (let i = 0; i < 200 / 0.3; i++) simStep(t0 + i * 300);
    return { on, awp: S.wps[S.awp].ident, navApOn,
             dN: (S.lat - 37.2) * 60,
             xtk: courseXtk(activeCourseLine()),
             cls: document.getElementById('susp-btn').className };
  });
  t.eq(held.on, true, '버튼을 누르면 SUSP 가 켜진다');
  t.eq(held.awp, 'BBB', `지나가도 활성 웨이포인트가 그대로다 (${held.awp})`);
  t.ok(held.dN > 1, `실제로 그 지점을 지나쳤다 (북쪽으로 ${held.dN.toFixed(1)}NM)`);
  t.eq(held.navApOn, true, '마지막 지점이 아니어도 NAV 가 풀리지 않는다');
  t.ok(Math.abs(held.xtk) < 0.1,
    `지나온 구간의 코스를 그대로 따라간다 (편차 ${held.xtk.toFixed(2)}NM)`);
  t.ok(/\bon\b/.test(held.cls), `버튼이 켜진 모양이다 (${held.cls})`);

  // ── 이름표는 위에, 버튼에는 ON/OFF 만 ──
  const ui = await page.evaluate(async () => {
    const b = document.getElementById('susp-btn');
    const grp = b.closest('.susp-group');
    const lbl = grp && grp.querySelector('.ctrl-lbl');
    const spd = document.getElementById('simspd-1').closest('.simspd-group');
    const spdLbl = spd && spd.querySelector('.ctrl-lbl');
    const box = e => e.getBoundingClientRect();
    // 켜진 SUSP 와 켜진 NAV 의 실제 색을 나란히 잰다.
    // 색은 0.15초에 걸쳐 바뀐다 — 바꾸자마자 읽으면 옛 색이 나온다.
    const nav = document.getElementById('nav-ap-btn');
    const navWasOn = nav.classList.contains('on');
    nav.classList.add('on');
    await new Promise(r => setTimeout(r, 300));
    const cs = e => ({ border: getComputedStyle(e).borderTopColor,
                       text: getComputedStyle(e).color });
    const onCol = cs(b), navCol = cs(nav);
    if (!navWasOn) nav.classList.remove('on');
    return { lbl: lbl ? lbl.textContent.trim() : null,
             spdLbl: spdLbl ? spdLbl.textContent.trim() : null,
             txt: b.textContent.trim(), onCol, navCol,
             lblAbove: lbl ? box(lbl).bottom <= box(b).top + 1 : false,
             spdAbove: spdLbl ? box(spdLbl).bottom <= box(document.getElementById('simspd-1')).top + 1 : false,
             rightOfSpd: box(b).left > box(document.getElementById('simspd-8')).left,
             // ×1 ×2 / ×4 ×8 두 줄인가
             twoRows: box(document.getElementById('simspd-4')).top > box(document.getElementById('simspd-1')).top + 3,
             sameCol: Math.abs(box(document.getElementById('simspd-1')).left -
                               box(document.getElementById('simspd-4')).left) < 2 };
  });
  t.eq(ui.lbl, 'SUSP', `버튼 위에 SUSP 이름표가 따로 선다 (${ui.lbl})`);
  t.eq(ui.spdLbl, 'SIM SPD', `배속 이름표도 제 버튼 위에 있다 (${ui.spdLbl})`);
  t.ok(ui.lblAbove && ui.spdAbove, '두 이름표가 각각 자기 버튼 위에 있다');
  t.eq(ui.txt, 'On', `버튼 글자는 늘 On 이다 (${ui.txt})`);
  // 켜짐은 AP 의 NAV·OBS 버튼과 같은 녹색으로 보인다 — 실제로 칠해진 색을 잰다
  t.ok(/^rgb\(0, 2[0-9][0-9], /.test(ui.onCol.border) && ui.onCol.border === ui.navCol.border,
    `켜지면 NAV 버튼과 같은 녹색이다 (${ui.onCol.border} · NAV ${ui.navCol.border})`);
  t.eq(ui.onCol.text, ui.navCol.text, `글자색도 같다 (${ui.onCol.text})`);
  t.ok(ui.twoRows && ui.sameCol, '배속은 ×1 ×2 / ×4 ×8 두 줄이다');
  t.eq(ui.rightOfSpd, true, 'SUSP 는 배속 오른쪽에 있다');

  // ── 풀면 그때 다음 지점으로 넘어간다 ──
  const rel = await page.evaluate(async () => {
    document.getElementById('susp-btn').click();
    const t0 = performance.now();
    for (let i = 0; i < 120 / 0.3; i++) simStep(t0 + i * 300);
    return { on: suspOn, awp: S.wps[S.awp].ident };
  });
  t.eq(rel.on, false, '한 번 더 누르면 풀린다');
  const off = await page.evaluate(async () => {
    const b = document.getElementById('susp-btn');
    await new Promise(r => setTimeout(r, 300));   // 색 전환이 끝나기를 기다린다
    return { txt: b.textContent.trim(), cls: b.className,
             border: getComputedStyle(b).borderTopColor };
  });
  t.eq(off.txt, 'On', '꺼져도 글자는 On 그대로다 — 켜짐은 색으로 보인다');
  t.ok(!/\b(on|auto)\b/.test(off.cls) && !/rgb\(0, 2/.test(off.border),
    `꺼지면 녹색이 빠진다 (${off.border})`);
  t.eq(rel.awp, 'CCC', `풀고 나면 다음 지점으로 넘어간다 (${rel.awp})`);

  // ── 마지막 지점에서도 NAV 가 풀리지 않는다 ──
  // 종전에는 마지막 WP 를 지나면 NAV 가 꺼지고 HDG 유지로 떨어졌다.
  // 미스드어프로치를 계속 날려면 그러면 안 된다.
  const last = await page.evaluate(() => {
    S.wps = [{ ident: 'AAA', lat: 37.0, lon: 127.0 },
             { ident: 'BBB', lat: 37.2, lon: 127.0 }];
    S.awp = 1; S.fwp = 0; obsOn = false; navSrc = 'FMS'; holdExit();
    S.lat = 37.15; S.lon = 127.0; S.hdg = 360; S.spd = 120; S.bnk = 0;
    windSpd = 0; navApOn = true; hdgSelOn = false; S.running = true; S.lastT = null;
    suspOn = true; updateSuspBtn();
    const t0 = performance.now();
    for (let i = 0; i < 200 / 0.3; i++) simStep(t0 + i * 300);
    const withSusp = { navApOn, hdgSelOn, dN: (S.lat - 37.2) * 60,
                       xtk: courseXtk(activeCourseLine()) };
    // 같은 상황에서 SUSP 를 끄면 종전대로 NAV 가 풀린다
    S.awp = 1; S.fwp = 0; S.lat = 37.15; S.lon = 127.0; S.hdg = 360;
    navApOn = true; hdgSelOn = false; suspOn = false; updateSuspBtn();
    S.lastT = null;
    const t1 = performance.now();
    for (let i = 0; i < 200 / 0.3; i++) simStep(t1 + i * 300);
    return { withSusp, off: { navApOn, hdgSelOn } };
  });
  t.eq(last.withSusp.navApOn, true, 'SUSP 중에는 마지막 지점을 지나도 NAV 가 살아 있다');
  t.ok(last.withSusp.dN > 1 && Math.abs(last.withSusp.xtk) < 0.1,
    `그 코스를 연장해 계속 난다 (${last.withSusp.dN.toFixed(1)}NM 지나 편차 ` +
    `${last.withSusp.xtk.toFixed(2)}NM)`);
  t.ok(!last.off.navApOn && last.off.hdgSelOn,
    'SUSP 가 없으면 종전대로 NAV 가 풀리고 HDG 유지로 간다');

  // ── 홀딩이 걸리면 저절로 켜진다 ──
  const auto = await page.evaluate(async () => {
    S.wps = [{ ident: 'AAA', lat: 37.0, lon: 127.0 },
             { ident: 'FIX', lat: 37.2, lon: 127.0,
               hold: { dir: 'R', crs: toTrue(180), legType: 'TIME', legVal: 60 } },
             { ident: 'CCC', lat: 37.4, lon: 127.3 }];
    S.awp = 1; S.fwp = 0; obsOn = false; navSrc = 'FMS'; holdExit();
    suspOn = false; updateSuspBtn();
    S.lat = 37.1; S.lon = 127.0; S.hdg = 360; S.spd = 120; S.bnk = 0;
    windSpd = 0; navApOn = true; hdgSelOn = false; S.running = true; S.lastT = null;
    const t0 = performance.now();
    for (let i = 0; i < 300 / 0.3; i++) simStep(t0 + i * 300);
    await new Promise(r => setTimeout(r, 20));
    const inHold = { holdOn, susp: navSuspended(), manual: suspOn,
                     awp: S.wps[S.awp].ident,
                     cls: document.getElementById('susp-btn').className,
                     txt: document.getElementById('susp-btn').textContent.trim() };
    // 눌러서 풀면 홀딩을 그만두고 다음 지점으로 간다
    document.getElementById('susp-btn').click();
    const t1 = performance.now();
    for (let i = 0; i < 200 / 0.3; i++) simStep(t1 + i * 300);
    return { inHold, after: { holdOn, susp: navSuspended(),
                              awp: S.awp >= 0 ? S.wps[S.awp].ident : null } };
  });
  t.eq(auto.inHold.holdOn, true, '홀딩 지점에 닿으면 홀딩이 걸린다');
  t.ok(auto.inHold.susp && !auto.inHold.manual,
    '홀딩이면 SUSP 가 저절로 걸린다(손으로 켠 것은 아니다)');
  t.ok(/auto/.test(auto.inHold.cls), `버튼이 '자동' 으로 보인다 (${auto.inHold.cls})`);
  t.eq(auto.inHold.txt, 'On자동', `저절로 걸린 것은 On 옆에 '자동' 이 붙는다 (${auto.inHold.txt})`);
  t.eq(auto.inHold.awp, 'FIX', '홀딩 중에는 그 지점에 머문다');
  t.eq(auto.after.holdOn, false, 'SUSP 를 누르면 홀딩을 그만둔다');
  t.eq(auto.after.susp, false, '보류도 함께 풀린다');
  t.eq(auto.after.awp, 'CCC', `그러고 나서 다음 지점으로 넘어간다 (${auto.after.awp})`);

  // 뒷정리
  await page.evaluate(() => { suspOn = false; updateSuspBtn(); holdExit(); S.running = false; });
}
