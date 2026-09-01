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
  const LAPSE = 1.98;   // °C / 1000ft

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
  const shown = await page.evaluate(() => {
    setSolo('pfd');
    const read = () => { _piLast = ''; updatePfdInfo();
      return document.getElementById('pi-air').textContent.replace(/\s+/g, ' ').trim(); };
    S.alt = 1000;
    window._oatKma = { c: 7, elevFt: 1000, lat: S.lat, lon: S.lon, at: Date.now() };
    window._oatSurfaceAt = 0;
    const withData = read();
    const b = [...document.querySelectorAll('#pi-air .pi')]
      .find(e => e.querySelector('i') && e.querySelector('i').textContent === 'OAT');
    const litColor = getComputedStyle(b.querySelector('b')).color;
    window._oatKma = null;
    const noData = read();
    const b2 = [...document.querySelectorAll('#pi-air .pi')]
      .find(e => e.querySelector('i') && e.querySelector('i').textContent === 'OAT');
    const dimColor = getComputedStyle(b2.querySelector('b')).color;
    return { withData, noData, litColor, dimColor };
  });
  t.ok(/OAT\s*7/.test(shown.withData),
    `받은 기온이 계기에 그대로 뜬다 (${shown.withData})`);
  t.ok(/OAT\s*---/.test(shown.noData),
    `자료가 없으면 '---' 다 (${shown.noData})`);
  t.ok(shown.litColor !== shown.dimColor,
    `값이 없을 때는 색으로도 구분된다 (${shown.litColor} vs ${shown.dimColor})`);

  // ── ⑥ ISA 는 내렸다 ──────────────────────────────────────────
  // 고도만 넣으면 나오는 표준대기 값이라 읽을 것이 없고, 옆의 OAT 와 비슷한
  // 숫자가 나란히 서서 어느 쪽이 실제인지 헷갈렸다.
  t.ok(!/\bISA\b/.test(shown.withData), `글자판에 ISA 가 없다 (${shown.withData})`);

  // ── ⑦ 받아 오는 곳이 기상청인가 ──────────────────────────────
  // 열쇠(API key)가 필요 없는 창구라야 앱에 심어 둘 것이 없다.
  const src = await page.evaluate(() => ({
    url: typeof KMA_OAT_URL === 'string' ? KMA_OAT_URL : null,
    tick: typeof _kmaOatTick === 'function',
  }));
  t.ok(src.url && /open-meteo\.com\/v1\/kma/.test(src.url),
    `기상청(KMA) 창구를 본다 (${src.url})`);
  t.ok(!/key=|appid=|serviceKey/i.test(src.url || ''), '열쇠를 심어 두지 않았다');
  t.eq(src.tick, true, '자리를 옮기거나 시간이 지나면 다시 받는 일꾼이 있다');

  // 뒷정리 — 다음 검사가 이 상태를 물려받지 않게 한다
  await page.evaluate(() => {
    window._oatKma = null; window._oatSurfaceC = 15; window._oatSurfaceAt = 0;
    setSolo('map');
  });
}
