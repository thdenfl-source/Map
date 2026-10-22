// 비행계획 경로 색 — 위성지도에서도 보여야 한다
// 종전의 파랑은 위성지도(바다·숲의 짙은 청록)에 묻혔다. 노랑으로 바꾸고
// 밝은 땅 위에서도 묻히지 않게 아래에 옅은 검은 테를 깐다.
export const name = '경로 색';

export async function run(page, t) {
  const r = await page.evaluate(() => {
    setSolo('map');
    S.wps = [{ ident: 'A', lat: 37.5, lon: 126.8 }, { ident: 'B', lat: 37.6, lon: 127.0 },
             { ident: 'C', lat: 37.7, lon: 127.2 }];
    S.awp = 1;
    updateWpMarkers();
    const dots = [...document.querySelectorAll('.leaflet-marker-pane div[style*="border-radius:50%"]')]
      .map(d => getComputedStyle(d).backgroundColor);
    return {
      line: routeLine.options.color, dash: routeLine.options.dashArray, w: routeLine.options.weight,
      n: routeLine.getLatLngs().length, casingN: routeCasing.getLatLngs().length,
      casing: routeCasing.options.color, casingW: routeCasing.options.weight,
      // 테가 경로 아래에 깔리는가(먼저 그려진 것이 아래다)
      under: (() => { const a = routeCasing._path, b = routeLine._path;
                      return !!(a && b && a.parentNode === b.parentNode &&
                        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); })(),
      dots,
    };
  });
  t.eq(r.line.toLowerCase(), '#ffee00', `경로는 노랑이다 (${r.line})`);
  t.ok(!/#4488ff/i.test(r.line), '종전의 파랑이 아니다');
  t.ok(r.n === 3 && r.casingN === 3, '경로와 테가 같은 점을 지난다');
  t.ok(r.casing === '#000' && r.casingW > r.w, '아래에 더 굵은 검은 테를 깐다');
  t.eq(r.under, true, '테는 경로 아래에 깔린다');
  t.ok(r.dots.filter(c => c === 'rgb(255, 238, 0)').length === 2, `웨이포인트 점도 노랑이다 (${r.dots.join(' / ')})`);
  t.ok(r.dots.includes('rgb(255, 90, 31)'), '활성 웨이포인트는 주홍으로 갈린다');
  await page.evaluate(() => { S.wps = []; S.awp = -1; updateWpMarkers(); });
}
