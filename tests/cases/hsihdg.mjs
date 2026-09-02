// HSI 위의 HDG · CRS 두 상자
//
// 비행 중 가장 자주 읽는 두 숫자인데 나침반 눈금 글자보다도 작았다. 두 배로
// 키우면서 두 가지를 함께 정리했다.
//   · 컴퍼스 왼쪽 위에 회색으로 적던 선택 헤딩 숫자를 내렸다 — 바로 위 HDG
//     상자와 같은 자리를 두고 다투는 숫자라, 둘이 나란히 뜨면 어느 쪽이 지금
//     기수방위인지 한눈에 안 잡혔다.
//   · 상자 폭을 글자를 재서 정한다 — px 로 못 박아 두면 글씨를 키운 순간
//     라벨(HDG)과 값(009°)이 겹친다.
//
// 같은 자리에 있던 풍향/풍속(279°/00kt)도 내렸다. 이 앱에는 대기속도(IAS)가
// 없어 바람을 잴 방법이 없다 — 시뮬레이터 시절 조작부로만 바뀌던 값이라
// 늘 처음 값이 그대로 떠 있었다.
export const name = 'HDG · CRS 상자';

// 이 자리의 종전 크기. 여기서부터 두 배(22 · 26)로 키웠고, 좁은 화면이라도
// 이 아래로는 내려가지 않아야 한다 — 키우려다 되레 작아지면 고친 뜻이 없다.
const OLD_LBL = 11, OLD_VAL = 13;

export async function run(page, t) {
  // 한 번 그리는 동안 캔버스에 찍힌 글자를 모두 받아 적는다.
  // 무엇이 어떤 글꼴로 어디에 그려졌는지는 화면을 눈으로 보지 않고 알 수 없어,
  // 이 화면은 그동안 조용히 깨지곤 했다.
  const draw = () => page.evaluate(() => {
    S.hdg = 40; selHdg = 222;          // 둘을 뚜렷이 다르게 둬야 섞이지 않는다
    const g = ctx, orig = g.fillText;
    const calls = [];
    g.fillText = function (txt, x) {
      calls.push({ txt: String(txt), x, font: this.font, align: this.textAlign,
                   w: this.measureText(String(txt)).width });
      return orig.apply(this, arguments);
    };
    try { resizePFD(); drawPFD(); } finally { g.fillText = orig; }

    const px = f => parseFloat(String(f).match(/(\d*\.?\d+)px/)[1]);
    // 'HDG' 는 맨 위 FMA(모드 표시줄)에도 있다 — 나중에 그려지는 상자 쪽을 쓴다
    const last = txt => { const a = calls.filter(c => c.txt === txt); return a[a.length - 1]; };
    // 글자가 실제로 차지한 좌우 범위(오른쪽 정렬이면 x 가 오른쪽 끝이다)
    const span = c => c && (c.align === 'right' ? [c.x - c.w, c.x] : [c.x, c.x + c.w]);
    const hdgTxt = fmtA(toMag(S.hdg)) + '°', selTxt = fmtA(toMag(selHdg)) + '°';
    return {
      scale: pfdFontScale, canvasW: cvs.width,
      lblPx: px(last('HDG').font), valPx: px(last(hdgTxt).font),
      crsLblPx: px(last('CRS').font), crsValPx: px(last(fmtA(toMag(activeCrs())) + '°').font),
      lbl: span(last('HDG')), val: span(last(hdgTxt)),
      hdgDrawn: calls.filter(c => c.txt === hdgTxt).length,
      selDrawn: calls.filter(c => c.txt === selTxt).length,
      hdgTxt, selTxt,
      // 풍향/풍속은 '279°/00kt' 꼴로 한 덩이로 그려졌다
      windDrawn: calls.filter(c => /^\d{3}°\/\d+kt$/.test(c.txt)).map(c => c.txt),
    };
  });

  for (const [w, h, label] of [[320, 568, '작은 폰'], [360, 780, '폰'], [390, 844, '폰(큰)'],
                               [810, 1080, '패드'], [1900, 1030, '데스크톱']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => setSolo('pfd'));
    await page.waitForTimeout(250);
    const r = await draw();
    const L = `${label} ${w}px`;

    // ── 회색 선택 헤딩은 내렸다 ────────────────────────────────
    t.eq(r.selDrawn, 0,
      `${L} — 컴퍼스 옆 회색 헤딩(${r.selTxt})을 더는 적지 않는다 (${r.selDrawn}번)`);
    // 그렇다고 기수방위가 사라지면 안 된다 — HDG 상자에 그대로 있어야 한다
    t.eq(r.hdgDrawn, 1, `${L} — 기수방위(${r.hdgTxt})는 HDG 상자에 한 번 뜬다 (${r.hdgDrawn}번)`);

    // ── 바람은 내렸다 ────────────────────────────────────────
    // 바람은 대기속도 벡터와 대지속도 벡터의 차로 나온다. 이 앱에는
    // 대기속도가 없으니 잴 수가 없고, 값은 시뮬레이터 시절 조작부(WDIR·WSPD)
    // 로만 바뀌던 것이라 늘 처음 값(270°/0kt)이 그대로 떠 있었다.
    t.eq(r.windDrawn.length, 0,
      `${L} — 잴 수 없는 바람을 적지 않는다${r.windDrawn.length ? ' (' + r.windDrawn.join(',') + ')' : ''}`);

    // ── 종전보다 작아지지 않는다 ──────────────────────────────
    // 좁은 화면에서는 두 배가 HSI 폭에 안 들어가 줄여야 하는데, 줄이다 종전
    // 크기 아래로 내려간 적이 있다(320px 에서 16.25 → 13.75).
    t.ok(r.lblPx >= OLD_LBL * r.scale - 0.01,
      `${L} — 라벨이 종전보다 작지 않다 (${r.lblPx}px ≥ ${OLD_LBL * r.scale}px)`);
    t.ok(r.valPx >= OLD_VAL * r.scale - 0.01,
      `${L} — 값도 종전보다 작지 않다 (${r.valPx}px ≥ ${OLD_VAL * r.scale}px)`);

    // ── 라벨과 값이 겹치지 않는다 ─────────────────────────────
    // 상자를 px 로 못 박아 두면 글씨를 키운 순간 'HDG' 와 '009°' 가 맞닿는다.
    t.ok(r.lbl[1] < r.val[0],
      `${L} — 라벨과 값 사이가 벌어져 있다 (라벨 끝 ${r.lbl[1].toFixed(1)} < 값 시작 ${r.val[0].toFixed(1)})`);
    // 화면 밖으로 나가지도 않는다
    t.ok(r.lbl[0] > 0 && r.val[1] < r.canvasW,
      `${L} — 두 글자가 화면 안에 있다 (${r.lbl[0].toFixed(0)}~${r.val[1].toFixed(0)} / ${r.canvasW}px)`);

    // ── CRS 도 같은 규격이다 ──────────────────────────────────
    t.eq(r.crsLblPx, r.lblPx, `${L} — CRS 라벨이 HDG 라벨과 같은 크기다 (${r.crsLblPx}px)`);
    t.eq(r.crsValPx, r.valPx, `${L} — CRS 값도 같은 크기다 (${r.crsValPx}px)`);

    // ── 자리가 넉넉하면 정확히 두 배다 ────────────────────────
    // HSI 폭이 넉넉한 화면(패드·데스크톱)에서는 줄일 이유가 없다.
    if (w >= 810) {
      t.eq(r.lblPx, 2 * OLD_LBL * r.scale,
        `${L} — 라벨이 종전의 두 배다 (${r.lblPx}px)`);
      t.eq(r.valPx, 2 * OLD_VAL * r.scale,
        `${L} — 값도 두 배다 (${r.valPx}px)`);
    }
  }

  // 뒷정리 — 다음 검사가 이 상태를 물려받지 않게 한다
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.evaluate(() => { setSolo('map'); });
  await page.waitForTimeout(200);
}
