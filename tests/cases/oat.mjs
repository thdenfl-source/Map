// 외기온도(OAT) — 어디서 온 값인가
//
// 종전에는 가장 가까운 공항의 METAR 하나로만 채웠고, 60NM 안에 공항이 없으면
// 값이 갱신되지 않았다. 그런데 기본값이 표준대기 15°C 라, 아무 자료도 못 받은
// 상태에서도 OAT 자리에 그럴듯한 숫자가 떴다 — 재지 않은 것이 잰 것처럼 보였다.
//
// 이제 기상청(KMA) 격자 예보로 '지금 이 자리' 의 기온을 받고, 그것이 없으면
// METAR 로 물러나며, 둘 다 없으면 비운다. 여기서 그 순서와 계산을 붙잡는다.
export const name = '외기온도(OAT)';

export async function run(page, t) {
  const LAPSE = 2;   // °C / 1000ft — 조종석 어림값(ISA 정확값 1.98 을 반올림)

  // 검사 중에는 바깥 망을 쓰지 않는다. 앱은 켜지고 1.5초 뒤 스스로 기온을
  // 받으러 나가는데, 그 요청이 검사 도중에 끝나면 여기서 세워 둔 상태를
  // 덮어쓴다. 기본은 전부 막아 두고, ⑨ 에서 창구별로 다시 연다.
  await page.route('**://api.open-meteo.com/**', r => r.abort());

  // 셋을 원하는 상태로 놓고 oatNow() 를 읽는다
  const ask = (kma, metarAt, alt) => page.evaluate(([kma, metarAt, alt]) => {
    S.alt = alt;
    window._oatKma = kma;
    window._oatSurfaceC = 20;
    window._oatSurfaceAt = metarAt;
    const o = oatNow();
    return { c: o.c === null ? null : +o.c.toFixed(2), src: o.src };
  }, [kma, metarAt, alt]);

  const now = Date.now();

  // ── ① 기상청 격자 기온이 먼저다 ──────────────────────────────
  // METAR 는 실측이지만 최대 60NM 떨어진 자리의 값이다. '지금 이 자리' 를
  // 묻는 계기이므로 격자 쪽을 먼저 쓴다.
  const both = await ask({ c: 12, elevFt: 1000, lat: 37.5, lon: 127, at: now }, now, 5000);
  t.eq(both.src, 'KMA', `둘 다 있으면 기상청 값을 쓴다 (${both.src})`);
  // 격자 표고(1000ft)에서 잰 값이므로 거기서부터 4000ft 만큼만 감률을 먹인다
  t.eq(both.c, +(12 - LAPSE * 4).toFixed(2),
    `격자 표고에서부터 감률을 먹인다 (표고 1000ft 12°C → 5000ft ${both.c}°C)`);

  // 감률의 방향 — 올라가면 내려가고, 내려가면 올라간다
  const hi = await ask({ c: 12, elevFt: 1000, lat: 37.5, lon: 127, at: now }, now, 11000);
  const lo = await ask({ c: 12, elevFt: 1000, lat: 37.5, lon: 127, at: now }, now, 1000);
  t.eq(lo.c, 12, `격자 표고에서는 격자 기온 그대로다 (${lo.c}°C)`);
  t.ok(hi.c < both.c && both.c < lo.c,
    `높이 오를수록 차갑다 (11000ft ${hi.c} < 5000ft ${both.c} < 1000ft ${lo.c})`);

  // ── ② 기상청 값이 없으면 METAR ───────────────────────────────
  const met = await ask(null, now, 5000);
  t.eq(met.src, 'METAR', `기상청 값이 없으면 METAR 로 물러난다 (${met.src})`);
  t.eq(met.c, +(20 - LAPSE * 5).toFixed(2),
    `지면 온도에 감률을 먹인다 (지면 20°C → 5000ft ${met.c}°C)`);

  // ── ③ 둘 다 없으면 비운다 ────────────────────────────────────
  // 여기가 이 검사의 핵심이다. 표준대기 15°C 로 채우면 조종사는 그것을
  // 잰 값으로 읽는다.
  const none = await ask(null, 0, 5000);
  t.eq(none.c, null, `아무 자료도 없으면 값이 없다 (${none.c})`);
  t.eq(none.src, null, '출처도 없다');

  // ── ④ 오래된 값은 지금 날씨가 아니다 ─────────────────────────
  const old = now - 4 * 60 * 60 * 1000;   // 4시간 전
  const staleK = await ask({ c: 12, elevFt: 0, lat: 37.5, lon: 127, at: old }, now, 0);
  t.eq(staleK.src, 'METAR', `오래된 기상청 값은 버리고 METAR 로 간다 (${staleK.src})`);
  const staleAll = await ask({ c: 12, elevFt: 0, lat: 37.5, lon: 127, at: old }, old, 0);
  t.eq(staleAll.c, null, `둘 다 오래됐으면 비운다 (${staleAll.c})`);

  // ── ⑤ 계기에 그대로 나오는가 ─────────────────────────────────
  // OAT 는 나침반 왼쪽 아래 모서리에 캔버스로 그린다(drawHsiCorners).
  // 무엇이 어떤 색으로 찍히는지는 fillText 를 엿봐야 알 수 있다.
  const shown = await page.evaluate(() => {
    setSolo('pfd'); resizePFD();
    const read = () => {
      const g = ctx, orig = g.fillText, seen = [];
      g.fillText = function (tx, x, y) {
        seen.push({ t: String(tx), c: String(this.fillStyle) });
        return orig.apply(this, arguments);
      };
      try { drawPFD(); } finally { g.fillText = orig; }
      const i = seen.findIndex(e => e.t === 'OAT');
      return { all: seen.map(e => e.t), val: i >= 0 ? seen[i + 1] : null };
    };
    S.alt = 1000;
    window._oatKma = { c: 7, elevFt: 1000, lat: S.lat, lon: S.lon, at: Date.now() };
    window._oatSurfaceAt = 0;
    const lit = read();
    window._oatKma = null;
    const dim = read();
    return { litTxt: lit.val && lit.val.t, litColor: lit.val && lit.val.c,
             dimTxt: dim.val && dim.val.t, dimColor: dim.val && dim.val.c,
             all: lit.all };
  });
  t.ok(/^7/.test(shown.litTxt || ''),
    `받은 기온이 계기에 그대로 뜬다 (OAT ${shown.litTxt})`);
  t.ok(/^---/.test(shown.dimTxt || ''),
    `자료가 없으면 '---' 다 (OAT ${shown.dimTxt})`);
  t.ok(shown.litColor !== shown.dimColor,
    `값이 없을 때는 색으로도 구분된다 (${shown.litColor} vs ${shown.dimColor})`);

  // ── ⑥ ISA 는 내렸다 ──────────────────────────────────────────
  // 고도만 넣으면 나오는 표준대기 값이라 읽을 것이 없고, 옆의 OAT 와 비슷한
  // 숫자가 나란히 서서 어느 쪽이 실제인지 헷갈렸다.
  t.ok(!shown.all.includes('ISA'), `계기에 ISA 가 없다 (${shown.all.slice(0, 12).join(' ')})`);

  // ── ⑦ 받아 오는 곳 ───────────────────────────────────────────
  // 한 곳만 두면 그 창구가 막히는 순간 기온이 통째로 사라진다(실제로 그랬다).
  // 기상청을 앞에 두되, 막히면 다른 모델에서라도 기온을 받아 온다.
  // 어느 창구든 열쇠(API key)가 필요 없어야 앱에 심어 둘 것이 없다.
  const src = await page.evaluate(() => ({
    list: (typeof OAT_SOURCES !== 'undefined' ? OAT_SOURCES : []).map(x => ({ src: x.src, url: x.url })),
    tick: typeof _oatTick === 'function',
    info: typeof oatInfo === 'function' && typeof APP_ACT.oatInfo === 'function',
  }));
  t.ok(src.list.length >= 2, `창구를 여럿 둔다 (${src.list.length}곳)`);
  t.eq(src.list[0].src, 'KMA', `기상청을 먼저 두드린다 (${src.list[0].src})`);
  t.ok(/open-meteo\.com\/v1\/kma/.test(src.list[0].url), `기상청 창구다 (${src.list[0].url})`);
  t.ok(src.list.some(x => /models=kma_seamless/.test(x.url)),
    '기상청 자료를 일반 창구로도 한 번 더 시도한다');
  t.ok(src.list.some(x => x.src !== 'KMA'),
    '기상청이 막히면 다른 모델에서라도 기온을 받는다');
  t.ok(src.list.every(x => /latitude=%LL%|%LL%/.test(x.url)), '모두 현재 위치를 넣어 묻는다');
  t.eq(src.list.filter(x => /key=|appid=|serviceKey/i.test(x.url)).length, 0,
    '어느 창구에도 열쇠를 심어 두지 않았다');
  t.eq(src.tick, true, '자리를 옮기거나 시간이 지나면 다시 받는 일꾼이 있다');

  // ── ⑧ 왜 안 뜨는지 볼 수 있는가 ──────────────────────────────
  // 빈 칸을 보고도 까닭을 알 길이 없으면 고칠 수도, 믿을 수도 없다.
  // OAT 가 캔버스로 옮겨 간 뒤로는 그 자리(나침반 왼쪽 아래 띠)를 누르면
  // 열린다 — 09-cdu.js 의 onPfdTap.
  t.eq(src.info, true, 'OAT 를 누르면 출처를 알려 주는 자리가 등록돼 있다');
  const tap = await page.evaluate(async () => {
    setSolo('pfd'); resizePFD(); drawPFD();
    const r = document.getElementById('pfd').getBoundingClientRect();
    const ctrlH = document.querySelector('.ctrl-bar').offsetHeight;
    const usableH = cvs.height - ctrlH;
    const bandH = hsiBandH();
    const hsiWant = Math.round(cvs.width * 0.34 * 2 + bandH * 2 + 10);
    const hsiH = Math.max(Math.round(usableH * 0.34),
                          Math.min(Math.round(usableH * 0.50), hsiWant));
    const sc = r.height / cvs.height;
    // 그 띠의 왼쪽 절반 한가운데를 누른다
    const px = r.left + r.width * 0.25;
    const py = r.top + (usableH - bandH / 2) * sc;
    document.getElementById('pfd').dispatchEvent(
      new MouseEvent('click', { clientX: px, clientY: py, bubbles: true }));
    await new Promise(res => setTimeout(res, 250));
    const dlg = document.querySelector('.ui-dlg-msg');
    const txt = dlg ? dlg.textContent : '';
    const btn = document.querySelector('.ui-dlg-btns button, .ui-dlg-ok');
    if (btn) btn.click();
    return txt;
  });
  t.ok(/OAT/.test(tap), `그 자리를 누르면 출처 창이 열린다 (${tap.split('\n')[0]})`);

  // ── ⑨ 창구가 막혀도 기온이 뜨는가 ────────────────────────────
  // 실제로 겪은 일이다: 창구 한 곳만 두었더니 그것이 답하지 않는 동안
  // OAT 가 통째로 비었다. 앞의 창구를 하나씩 막아 가며, 뒤의 것이 받아
  // 오는지 그물망을 직접 두드려 본다.
  const reply = (temp, elev) => ({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ latitude: 37.5, longitude: 127, elevation: elev,
                           current: { time: 0, temperature_2m: temp } }),
  });
  // openWhich: 이 조각이 들어간 주소만 응답하고 나머지는 막는다(null = 전부 막기)
  const tryChain = async openWhich => {
    await page.unroute('**://api.open-meteo.com/**').catch(() => {});
    await page.route('**://api.open-meteo.com/**', route => {
      const u = route.request().url();
      if (openWhich && u.includes(openWhich)) route.fulfill(reply(8, 300));
      else route.abort();
    });
    // 켜질 때 나간 요청이 아직 돌아오지 않았으면 기다린다 — 한 번에 하나만
    // 나가도록 막아 두었으므로(_oatBusy), 그 사이에 부르면 그냥 되돌아온다.
    await page.waitForFunction(() => !_oatBusy, null, { timeout: 20000 });
    return page.evaluate(async () => {
      window._oatKma = null; window._oatSurfaceAt = 0; window._oatErr = '';
      _oatLast = 0;
      await _oatTick();
      S.alt = 300 / 0.3048;                       // 격자 표고에 세워 감률을 뺀다
      const o = oatNow();
      return { c: o.c === null ? null : Math.round(o.c), src: o.src,
               name: window._oatKma ? window._oatKma.name : null,
               err: window._oatErr };
    });
  };

  const viaKma = await tryChain('/v1/kma');
  t.eq(viaKma.src, 'KMA', `기상청 창구가 답하면 그 값을 쓴다 (${viaKma.src})`);
  t.eq(viaKma.c, 8, `받은 기온이 그대로 들어온다 (${viaKma.c}°C)`);

  const viaSeamless = await tryChain('models=kma_seamless');
  t.eq(viaSeamless.src, 'KMA',
    `기상청 전용 창구가 막혀도 일반 창구로 기상청 값을 받는다 (${viaSeamless.src})`);
  t.eq(viaSeamless.c, 8, `그때도 기온이 뜬다 (${viaSeamless.c}°C)`);

  const viaAny = await tryChain('current=temperature_2m');
  t.eq(viaAny.c, 8, `기상청이 둘 다 막혀도 기온은 뜬다 (${viaAny.c}°C)`);
  t.ok(viaAny.name, `어디서 온 값인지 함께 적어 둔다 (${viaAny.name})`);

  const allDown = await tryChain(null);
  t.eq(allDown.c, null, `아무 데도 답하지 않으면 지어내지 않는다 (${allDown.c})`);
  t.ok(allDown.err && allDown.err.split('\n').length >= 3,
    `왜 못 받았는지 창구별로 남는다 (${(allDown.err || '').split('\n')[0]})`);

  // 뒷정리 — 다음 검사가 이 상태를 물려받지 않게 한다
  await page.evaluate(() => {
    window._oatKma = null; window._oatSurfaceC = 15; window._oatSurfaceAt = 0;
    window._oatErr = ''; _oatLast = Date.now();
    setSolo('map');
  });
}
