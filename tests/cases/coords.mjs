// 차트 PDF 좌표 토큰 파싱 — 반구문자(N/S/E/W) 소유권 오판 회귀 방지
export const name = '좌표 토큰 파싱';

export async function run(page, t) {
  const cases = [
    // [설명, 텍스트, 기대 위도, 기대 경도]
    ['연속 좌표(구분자형)', `IYAN D4.6 37°59'44"N 128°44'12"E YAG 38°03'48"N 128°48'47"E`,
      [37.9956, 38.0633], [128.7367, 128.8131]],
    ['연속 좌표(컴팩트)', `375944N1284412E 380348N1284847E`,
      [37.9956, 38.0633], [128.7367, 128.8131]],
    ['접두형(컴팩트)', `N375944 E1284412`, [37.9956], [128.7367]],
    ['접두형(구분자)', `N 37°59'44" E 128°44'12"`, [37.9956], [128.7367]],
    ['접미 공백형', `128°44'12" E RWY`, [], [128.7367]],
    ['컴팩트 공백 접미', `375944 N 1284412 E`, [37.9956], [128.7367]],
    ['도분형 연속', `N3559.44 E12844.12 N3603.48 E12848.47`, [35.9907, 36.058], [128.7353, 128.8078]],
    ['초 소수', `N37°59'44.5" E128°44'12.3"`, [37.9957], [128.7368]],
    ['S/W 반구', `35°30'00"S 070°15'30"W`, [-35.5], [-70.2583]],
    ['좌표 아님(고도·속도)', `MAX ALT 9 000 MNM ALT 6 000 MAX SPD 200 kt IAS`, [], []],
    ['좌표 아님(방위·거리)', `R 360 YAG 5.18 NM CAT D 240° 231.1°T`, [], []],
    ['좌표 아님(주파수)', `RWY 16 ELEV 16 TWR 118.625 240.4`, [], []],
  ];
  const got = await page.evaluate(cs => cs.map(([, txt]) => ({
    lat: _pdfScanCoordTokens(txt, false).map(x => +x.v.toFixed(4)),
    lon: _pdfScanCoordTokens(txt, true).map(x => +x.v.toFixed(4)),
  })), cases);

  cases.forEach(([label, , eLat, eLon], i) => {
    t.eq(JSON.stringify(got[i].lat), JSON.stringify(eLat), `${label} · 위도`);
    t.eq(JSON.stringify(got[i].lon), JSON.stringify(eLon), `${label} · 경도`);
  });

  // 추출 결과 정제: 차트 범위 밖 좌표(파싱 오류) 제외
  const prune = await page.evaluate(() => {
    const set = (key, list) => {
      _pdfChartKey = key;
      _pdfFixList = list.map(([n, la, lo]) => ({ name: n, lat: la, lon: lo, named: true, priority: 1, type: '', dme: '' }));
      _pdfPruneFixes();
      return { names: _pdfFixList.map(f => f.name), dropped: _pdfFixDropped };
    };
    return {
      badOne: set('RKNY|2-14', [['YAG', 38.0633, 38.0633], ['YAG', 37.9472, 128.8131],
        ['DUBUN', 38.0875, 128.8706], ['IYAN', 38.0144, 128.7172]]),
      allGood: set('RKNY|2-14', [['YAG', 37.9472, 128.8131], ['DUBUN', 38.0875, 128.8706],
        ['IYAN', 38.0144, 128.7172]]),
      noIcao: set('ZZZZ|1', [['A', 38.0633, 38.0633], ['B', 37.9472, 128.8131],
        ['C', 38.0875, 128.8706], ['D', 38.0144, 128.7172]]),
    };
  });
  t.eq(prune.badOne.dropped, 1, '오인식 좌표 1개 제외');
  t.ok(!prune.badOne.names.includes('YAG') || prune.badOne.names.length === 3, '오인식 항목 제거됨');
  t.eq(prune.allGood.dropped, 0, '정상 차트는 무변화');
  t.eq(prune.noIcao.dropped, 1, 'ICAO 미상이어도 중앙값 기준으로 제외');
}
