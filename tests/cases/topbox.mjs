// 자세계 맨 윗줄 — 지금 값 네 가지 (GS · HDG · ALT · VS)
//
// 종전에는 이 줄이 FMA(오토파일럿 모드 표시줄)였다. ALT | HDG | IAS 세 칸에
// 어느 축을 자동조종이 잡고 있는지 적었는데, 이 앱에는 자동조종이 없어
// 조작부를 내린 뒤로는 늘 같은 글자가 떠 있는 자리였다.
//
// 좌우 테이프는 폭이 좁아(56~76px) 숫자를 더 키울 수 없다. 테이프는 흐름을
// 보는 것이고, 정확한 숫자는 이 줄에서 읽는다.
export const name = '맨 윗줄 값판';

export async function run(page, t) {
  // 한 번 그리는 동안 윗줄에 찍힌 글자를 받아 적는다
  const strip = (spd, alt, vs) => page.evaluate(([spd, alt, vs]) => {
    S.spd = spd; S.alt = alt; S.vs = vs;
    // 기수는 못 박아 둔다 — 값끼리 같은 숫자가 되면 어느 칸의 것인지 못 가린다
    S.hdg = 40;
    const g = ctx, orig = g.fillText;
    const calls = [];
    g.fillText = function (txt, x, y) {
      calls.push({ txt: String(txt), x, y, font: this.font, col: String(this.fillStyle),
                   w: this.measureText(String(txt)).width, align: this.textAlign });
      return orig.apply(this, arguments);
    };
    try { resizePFD(); drawPFD(); } finally { g.fillText = orig; }
    // 윗줄이 차지하는 높이 — drawAI 가 쓰는 것과 같은 셈.
    // 좌우 기둥(속도·고도 테이프·승강계)을 걷어낸 뒤로 자세계가 화면 폭을
    // 통째로 쓰므로, 가로로 자를 것이 없다.
    const top = 2 + fmaStripH();
    const W = cvs.width;
    const px = f => parseFloat(String(f).match(/(\d*\.?\d+)px/)[1]);
    // 캔버스를 옮겨(translate) 그리는 것들 — 자세계 피치 눈금과 나침반 장미 —
    // 은 좌표가 0 이하로 들어온다. 화면 좌표가 아니므로 걸러낸다.
    const inStrip = calls.filter(c => c.y > 0 && c.y <= top + 2 && c.x > 0);
    const find = txt => inStrip.find(c => c.txt === txt);
    // 가운데 정렬은 x 가 글자의 중심이다 — 절반씩 좌우로 벌려야 실제 범위가 된다
    const span = c => !c ? null
      : c.align === 'right'  ? [c.x - c.w, c.x]
      : c.align === 'center' ? [c.x - c.w / 2, c.x + c.w / 2]
      : [c.x, c.x + c.w];
    return {
      top, canvasW: cvs.width,
      txts: inStrip.map(c => c.txt),
      gs: find('GS'), hdg: find('HDG'), alt: find('ALT'), vs: find('VS'),
      units: inStrip.filter(c => ['KT', 'KM/H', '°M', 'FT', 'M', 'FPM', 'M/S'].includes(c.txt)).map(c => c.txt),
      vals: inStrip.filter(c => /^[-+]?\d/.test(c.txt))
                   .map(c => ({ txt: c.txt, x: c.x, col: c.col, px: px(c.font), span: span(c) })),
      lblPx: find('GS') ? px(find('GS').font) : null,
    };
  }, [spd, alt, vs]);

  await page.setViewportSize({ width: 412, height: 900 });
  await page.evaluate(() => setSolo('pfd'));
  await page.waitForTimeout(300);

  // ── ① 네 이름표가 GS · HDG · ALT · VS 순으로 선다 ────────────
  const r = await strip(78, 1450, -420);
  for (const k of ['GS', 'HDG', 'ALT', 'VS']) {
    t.ok(r[k.toLowerCase()], `윗줄에 ${k} 가 있다 (${r.txts.join(' ')})`);
  }
  t.ok(r.gs.x < r.hdg.x && r.hdg.x < r.alt.x && r.alt.x < r.vs.x,
    `왼쪽부터 GS · HDG · ALT · VS 순이다 (${[r.gs, r.hdg, r.alt, r.vs].map(c => Math.round(c.x)).join(' < ')})`);
  t.eq(r.units.join(','), 'KT,°M,FT,FPM', `단위도 함께 적는다 (${r.units.join(',')})`);

  // ── ② 옛 FMA 는 없다 ────────────────────────────────────────
  // 이 줄은 종전에 오토파일럿 모드 표시줄이었다. 지금은 지금 값을 읽는
  // 자리다 — HDG 도 '어느 축을 잡고 있나' 가 아니라 지금 기수방위다.
  t.ok(!r.txts.includes('IAS'),
    `IAS 라 적지 않는다 — 이 앱에는 대기속도계가 없다 (${r.txts.join(' ')})`);
  const gone = await page.evaluate(() => typeof drawFMA === 'undefined');
  t.eq(gone, true, '모드 표시줄을 그리던 함수도 남지 않았다');

  // ── ③ 값이 그대로 뜬다 ──────────────────────────────────────
  const val = txt => r.vals.find(v => v.txt === txt);
  t.ok(val('78'), `대지속도가 그대로 뜬다 (${r.vals.map(v => v.txt).join(' ')})`);
  t.ok(val('1450'), '고도가 그대로 뜬다');
  t.ok(val('-420'), '강하율이 부호까지 뜬다');
  // 기수방위는 자북(°M)으로, 세 자리로 적는다 — 나침반 눈금과 같은 값이다
  const hdgTxt = await page.evaluate(() => fmtA(toMag(S.hdg)));
  t.ok(val(hdgTxt), `기수방위가 자북으로 뜬다 (${hdgTxt})`);
  t.ok(/^\d{3}$/.test(hdgTxt), `세 자리로 적는다 (${hdgTxt})`);
  // 값 넷이 왼쪽부터 순서대로, 서로 겹치지 않는다
  const four = ['78', hdgTxt, '1450', '-420'].map(val);
  t.ok(four.every(Boolean) && four[0].span[1] < four[1].span[0]
       && four[1].span[1] < four[2].span[0] && four[2].span[1] < four[3].span[0],
    '값 넷이 서로 겹치지 않는다');
  t.ok(four[0].span[0] > 0 && four[3].span[1] < r.canvasW, '넷 다 화면 안에 있다');
  // 값은 이름표보다 크다 — 읽는 것은 값이다
  t.ok(four[0].px > r.lblPx,
    `값이 이름표보다 크다 (${four[0].px}px vs ${r.lblPx}px)`);

  // ③-2 목표 크기(이름표 22 · 값 26)로 읽는다 ─────────────────
  // 나침반 위에 있던 HDG·CRS 상자를 내린 뒤로, 이 줄이 계기에서 가장 크게
  // 읽는 자리다. 자리가 넉넉한 화면에서는 목표 크기 그대로여야 한다 —
  // 모서리 글자판(이름표 14 · 값 21)보다 한 단계 크다.
  const vs2 = await page.evaluate(() => {
    const g = ctx, orig = g.fillText, seen = [];
    g.fillText = function (txt, x, y) {
      seen.push({ t: String(txt), y, f: this.font }); return orig.apply(this, arguments); };
    try { drawPFD(); } finally { g.fillText = orig; }
    const px = f => parseFloat(String(f).match(/(\d*\.?\d+)px/)[1]);
    const top = 2 + fmaStripH();
    const upper = t => { const e = seen.find(q => q.t === t && q.y > 0 && q.y <= top + 2); return e ? px(e.f) : null; };
    const lower = t => { const a2 = seen.filter(q => q.t === t && q.y > top); return a2.length ? px(a2[a2.length - 1].f) : null; };
    return { scale: pfdFontScale,
             gsLbl: upper('GS'), altVal: upper(String(Math.round(S.alt * A_CV()))),
             cornerLbl: lower('OAT'), cornerVal: lower('CRS') };
  });
  // 칸이 셋에서 넷으로 늘어 폭이 3/4 로 줄었다. 좁은 폰에서는 목표보다
  // 작아지는 것이 맞다 — 넘치게 두면 옆 칸을 침범한다. 다만 나침반 모서리
  // 글자판(이름표 14 · 값 21)보다는 커야 한다. 여기가 더 자주 읽는 자리다.
  t.ok(vs2.gsLbl <= 22 * vs2.scale + 0.01,
    `이름표가 목표(22px)를 넘지 않는다 (${vs2.gsLbl}px)`);
  t.ok(vs2.altVal <= 26 * vs2.scale + 0.01,
    `값도 목표(26px)를 넘지 않는다 (${vs2.altVal}px)`);
  t.ok(vs2.altVal > vs2.gsLbl, `값이 이름표보다 크다 (${vs2.altVal}px vs ${vs2.gsLbl}px)`);
  t.ok(vs2.gsLbl > vs2.cornerLbl,
    `모서리 이름표보다 크다 (${vs2.gsLbl}px vs ${vs2.cornerLbl}px)`);

  // 자리가 넉넉한 화면에서는 목표 크기 그대로다
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(250);
  const wide = await page.evaluate(() => {
    const g = ctx, orig = g.fillText, seen = [];
    g.fillText = function (txt, x, y) {
      seen.push({ t: String(txt), y, f: this.font }); return orig.apply(this, arguments); };
    try { resizePFD(); drawPFD(); } finally { g.fillText = orig; }
    const px = f => parseFloat(String(f).match(/(\d*\.?\d+)px/)[1]);
    const top = 2 + fmaStripH();
    const up = t2 => { const e = seen.find(q => q.t === t2 && q.y > 0 && q.y <= top + 2); return e ? px(e.f) : null; };
    return { scale: pfdFontScale, lbl: up('GS'),
             val: up(String(Math.round(S.alt * A_CV()))) };
  });
  t.eq(wide.lbl, 22 * wide.scale, `넓은 화면에서는 이름표가 22px 다 (${wide.lbl}px)`);
  t.eq(wide.val, 26 * wide.scale, `값도 26px 다 (${wide.val}px)`);
  await page.setViewportSize({ width: 412, height: 900 });
  await page.waitForTimeout(250);

  // ── ④ 오름·내림을 색으로 가른다 ─────────────────────────────
  // 승강계 바늘과 같은 규칙 — 오르면 초록, 내리면 빨강, 그 사이는 회색.
  const down = val('-420').col.toLowerCase();
  const up = await strip(78, 1450, 600);
  const level = await strip(78, 1450, 0);
  const upCol = up.vals.find(v => v.txt === '+600').col.toLowerCase();
  const lvCol = level.vals.find(v => v.txt === '0').col.toLowerCase();
  t.eq(upCol, '#00cc44', `오르는 중이면 초록이다 (${upCol})`);
  t.eq(down, '#ff6644', `내리는 중이면 빨강이다 (${down})`);
  t.eq(lvCol, '#bbbbbb', `수평이면 회색이다 (${lvCol})`);
  t.ok(up.vals.some(v => v.txt === '+600'), '오를 때는 + 를 붙인다');

  // ── ⑤ 고도가 두 곳에서 다투지 않는다 ────────────────────────
  // 고도계 머리글(자동조종 목표 고도)은 시뮬 모드에서만 그린다. 항법 보조
  // 모드에서 함께 띄우면 '지금 고도'와 '목표 고도'가 나란히 서서, 실제로
  // 500 / 500 이 붙어 뜨는 화면이 나왔다.
  const dup = await page.evaluate(() => {
    const g = ctx, orig = g.fillText;
    const seen = [];
    g.fillText = function (txt, x, y) {
      if (y <= 60) seen.push(String(txt));
      return orig.apply(this, arguments);
    };
    try { drawPFD(); } finally { g.fillText = orig; }
    return { alts: seen.filter(x => x === 'ALT' || x === 'ALT FT').length,
             sim: simPanelOn, seen };
  });
  t.eq(dup.sim, false, '항법 보조 모드다(시뮬 아님)');
  t.eq(dup.alts, 1, `윗쪽에 ALT 라 적힌 자리가 하나뿐이다 (${dup.alts}곳)`);

  // ── ⑥ 좁은 화면에서도 값이 상자를 넘지 않는다 ───────────────
  // 글씨는 배율(pfdFontScale)을 따라 커진다. 줄 높이를 px 로 못 박아 두면
  // 커진 글씨가 상자를 넘는다 — 종전 FMA 가 그랬다.
  for (const [w, h] of [[320, 568], [360, 780], [412, 900], [810, 1080]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    const q = await strip(120, 12500, -1250);
    // 네 값만 골라 본다. 자세계 피치 눈금(10·20)도 이 높이에 들어오는데,
    // 그것은 자세계의 글자라 이 줄과 겹쳐도 상관이 없다.
    const v = ['120', hdgTxt, '12500', '-1250']
      .map(x => (q.vals.find(e => e.txt === x) || {}).span)
      .filter(Boolean).sort((a, b) => a[0] - b[0]);
    t.ok(v.length === 4 && v.every((a, i) => i === 0 || v[i - 1][1] < a[0]),
      `${w}px — 값 넷이 겹치지 않는다 (${v.map(a => a.map(Math.round).join('~')).join(' ')})`);
    t.ok(v[0][0] > 0 && v[v.length - 1][1] < q.canvasW,
      `${w}px — 값이 화면 안에 있다 (${v[0][0].toFixed(0)}~${v[v.length - 1][1].toFixed(0)} / ${q.canvasW}px)`);
  }

  // 뒷정리
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => { S.vs = 0; setSolo('map'); });
  await page.waitForTimeout(200);
}
