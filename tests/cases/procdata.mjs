// IFR 절차 자료 무결성 — SID·STAR·접근절차와 픽스 DB 가 서로 어긋나지 않는가.
//
// 자료는 사람이 AIP 를 보고 옮겨 적는다. 그래서 같은 픽스가 파일마다 다른
// 좌표를 갖거나(NIMAL 이 284m 어긋나 있었다), 경유점 좌표가 통째로 빠지거나,
// 엉뚱한 곳(한반도 밖)을 가리키는 일이 생긴다. 화면에는 그럴듯하게 그려지므로
// 눈으로는 잡히지 않는다. 여기서 숫자로 잡는다.
export const name = 'IFR 절차 자료';

const KOREA = { lat: [32.5, 39.5], lon: [124.0, 132.5] };   // 국내 AIP 가 다루는 범위

// 좌표를 아직 못 채운 SID 경유점. 절차 이름만 등록해 두고 지점은 비워 둔 자리다.
// (앱은 이런 경유점을 건너뛰므로 그 절차를 고르면 경로가 짧게 들어간다)
// AIP 를 받아 채우면 여기서 지운다 — 그 전까지 새로 생기는 구멍만 걸러 낸다.
const KNOWN_GAPS = new Set([
  'RKPU/PU801', 'RKPU/PU802', 'RKPU/PU803', 'RKPU/PU851', 'RKPU/PU852', 'RKPU/PU853',
  'RKTH/DORTI', 'RKTH/MARMI',
  'RKTH/TH801', 'RKTH/TH802', 'RKTH/TH803', 'RKTH/TH804', 'RKTH/TH805', 'RKTH/TH806',
  'RKTH/TH901', 'RKTH/TH902', 'RKTH/TH903', 'RKTH/TH904', 'RKTH/TH905', 'RKTH/TH906',
  'RKTL/TL024', 'RKTL/TL025', 'RKTL/TL026', 'RKTL/TL034', 'RKTL/TL035',
  'RKTL/TL121', 'RKTL/TL131', 'RKTL/TL222', 'RKTL/TL223', 'RKTL/TL232', 'RKTL/TL233',
]);

export async function run(page, t) {
  const r = await page.evaluate(() => {
    const db = typeof IFR_DB !== 'undefined' ? IFR_DB : null;
    if (!db) return { err: 'IFR_DB 없음' };

    const fixes = {};
    const add = (id, lat, lon, src) => (fixes[id] = fixes[id] || []).push({ lat, lon, src });
    if (typeof IFR_FIXES !== 'undefined')
      Object.entries(IFR_FIXES).forEach(([k, v]) => add(k, v.lat, v.lon, 'ENR'));
    if (typeof TERMINAL_FIXES !== 'undefined')
      Object.entries(TERMINAL_FIXES).forEach(([k, v]) => add(k, v[0], v[1], 'TERM'));

    const procs = [];
    for (const [icao, a] of Object.entries(db))
      for (const kind of ['sids', 'stars', 'approaches'])
        (a[kind] || []).forEach(p => procs.push({ icao, kind, name: p.name, rwy: p.rwy || '', wps: p.wps || [] }));

    procs.forEach(p => p.wps.forEach(w => {
      if (Number.isFinite(w.lat) && Number.isFinite(w.lon))
        add(w.ident, w.lat, w.lon, `${p.icao}/${p.name}`);
    }));
    // 절차는 좌표를 생략하고 이름만 적어도 된다 — 앱이 픽스 DB 에서 찾아 쓴다
    // (_resolveWp). 그러니 "좌표 없음"은 그 조회까지 실패했을 때만 문제다.
    procs.forEach(p => p.wps.forEach(w => {
      const r = typeof _resolveWp === 'function' ? _resolveWp(w) : w;
      w.rlat = r.lat; w.rlon = r.lon;
    }));
    return { procs, fixes };
  });
  if (r.err) { t.ok(false, r.err); return; }

  // ── 경유점 좌표가 온전한가 ──
  const bad = [];
  const gaps = new Set();
  let nwp = 0;
  for (const p of r.procs) {
    if (!p.wps.length) { bad.push(`${p.icao} ${p.name}: 경유점 없음`); continue; }
    for (const w of p.wps) {
      nwp++;
      if (!w.ident) bad.push(`${p.icao} ${p.name}: 이름 없는 경유점`);
      else if (!Number.isFinite(w.rlat) || !Number.isFinite(w.rlon)) {
        if (!KNOWN_GAPS.has(`${p.icao}/${w.ident}`))
          bad.push(`${p.icao} ${p.name} ${w.ident}: 좌표를 찾을 수 없음(픽스 DB 에도 없음)`);
        else gaps.add(`${p.icao}/${w.ident}`);
      }
      else if (w.rlat < KOREA.lat[0] || w.rlat > KOREA.lat[1] ||
               w.rlon < KOREA.lon[0] || w.rlon > KOREA.lon[1])
        bad.push(`${p.icao} ${p.name} ${w.ident}: 범위 밖 (${w.rlat}, ${w.rlon})`);
    }
  }
  t.eq(bad.length, 0,
    `절차 ${r.procs.length}개 · 경유점 ${nwp}개 좌표 온전${bad.length ? ' — ' + bad.slice(0, 4).join(' / ') : ''}`
    + (gaps.size ? ` (미채움 ${gaps.size}종은 알려진 자리)` : ''));

  // 채워졌는데 목록에 남아 있으면 목록이 낡은 것이다 — 그것도 알려 준다
  const stale = [...KNOWN_GAPS].filter(k => !gaps.has(k));
  t.eq(stale.length, 0,
    `미채움 목록이 실제와 맞는다${stale.length ? ' — 이미 채워짐: ' + stale.slice(0, 5).join(', ') : ''}`);

  // ── 같은 이름의 픽스가 파일마다 다른 좌표를 갖지 않는가 ──
  // 코스는 좌표로 그린다. 한 픽스가 두 값을 가지면 절차마다 다른 선이 그려진다.
  const NM = (a, b, c, d) => {
    const R = 3440.065, r = Math.PI / 180;
    return R * Math.acos(Math.min(1, Math.sin(a * r) * Math.sin(c * r) +
      Math.cos(a * r) * Math.cos(c * r) * Math.cos((d - b) * r)));
  };
  const split = [];
  for (const [id, list] of Object.entries(r.fixes)) {
    if (list.length < 2) continue;
    let worst = 0, pair = null;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = NM(list[i].lat, list[i].lon, list[j].lat, list[j].lon);
      if (d > worst) { worst = d; pair = [list[i], list[j]]; }
    }
    if (worst > 0.05)   // 90m — 반올림 차이는 넘어가고 실제 어긋남만 잡는다
      split.push(`${id}: ${(worst * 1852).toFixed(0)}m (${pair[0].src} vs ${pair[1].src})`);
  }
  t.eq(split.length, 0,
    `같은 픽스가 한 좌표만 갖는다 (${Object.keys(r.fixes).length}종)${split.length ? ' — ' + split.slice(0, 4).join(' / ') : ''}`);

  // ── 한 공항 안에서 절차 이름이 겹치지 않는가 ──
  const dup = [];
  const seen = new Set();
  for (const p of r.procs) {
    const k = `${p.icao}|${p.kind}|${p.name}|${p.rwy}`;
    if (seen.has(k)) dup.push(k); else seen.add(k);
  }
  t.eq(dup.length, 0, `절차 이름 중복 없음${dup.length ? ' — ' + dup.slice(0, 4).join(' / ') : ''}`);

  // ── 경유점 사이가 지나치게 멀지 않은가(좌표를 잘못 옮기면 대개 여기서 튄다) ──
  const jump = [];
  for (const p of r.procs) {
    for (let i = 1; i < p.wps.length; i++) {
      const a = p.wps[i - 1], b = p.wps[i];
      if (!Number.isFinite(a.rlat) || !Number.isFinite(b.rlat)) continue;
      const d = NM(a.rlat, a.rlon, b.rlat, b.rlon);
      if (d > 120) jump.push(`${p.icao} ${p.name}: ${a.ident}→${b.ident} ${d.toFixed(0)}NM`);
    }
  }
  t.eq(jump.length, 0, `구간 거리가 상식 범위${jump.length ? ' — ' + jump.slice(0, 3).join(' / ') : ''}`);

  // ── STAR 을 넣은 공항이 실제로 갖고 있는가 ──
  const want = ['RKJB', 'RKJJ', 'RKJY', 'RKNW', 'RKNY',
                'RKPC', 'RKPD', 'RKPK', 'RKPS', 'RKPU',
                'RKSI', 'RKSS', 'RKTH', 'RKTL', 'RKTN', 'RKTU'];
  const got = await page.evaluate(w => w.map(i => [i, (IFR_DB[i]?.stars || []).length]), want);
  const empty = got.filter(([, n]) => !n).map(([i]) => i);
  t.eq(empty.length, 0,
    `STAR 반영 확인 — ${got.map(([i, n]) => i + ':' + n).join(' ')}${empty.length ? ' (빈 곳: ' + empty + ')' : ''}`);

  // ── ILS Z 는 직선 진입이다 ──
  // 같은 활주로에 절차가 둘일 때 아크(호) 전이는 Y 쪽에 붙고 Z 는 직선으로 들어간다.
  // RNP 절차의 앞 구간을 그대로 옮겨 오면 Z 에 아크가 섞여 든다 — 그것을 막는다.
  const zArc = await page.evaluate(() => {
    const bad = [];
    for (const icao in IFR_DB) {
      for (const a of (IFR_DB[icao].approaches || [])) {
        if (!/^ILS\s+Z\b/.test(a.name)) continue;
        (a.wps || []).forEach(w => { if (w.arc) bad.push(`${icao} ${a.name} ${w.ident}`); });
      }
    }
    return bad;
  });
  t.eq(zArc.length, 0, `ILS Z 에는 아크 구간이 없다${zArc.length ? ' — ' + zArc.join(' / ') : ''}`);

  // 양양 ILS Z RWY 33 — 마지막 구간이 로컬라이저 접근 코스와 맞는가.
  // 아크를 걷어냈으니 남은 구간은 실제 진입 방향이어야 한다.
  const zCrs = await page.evaluate(() => {
    const a = IFR_DB.RKNY.approaches.find(x => x.name === 'ILS Z RWY 33');
    const w = a.wps, n = w.length;
    const brg = (p, q) => toMag(bearing(p.lat, p.lon, q.lat, q.lon));
    const L = LOC_STATIONS.find(x => x.id === 'IYAN');
    return { idents: w.map(x => x.ident), fin: brg(w[n - 2], w[n - 1]), loc: L.crs };
  });
  t.eq(zCrs.idents.join('→'), 'DUBUN→NY015→NY010→IYAN D4.6→IYAN D3.1→IYAN D1.0→RW33',
    `ILS Z RWY 33 은 AIP 표대로 직선 구간이다 (${zCrs.idents.join('→')})`);
  t.ok(Math.abs(((zCrs.fin - zCrs.loc + 540) % 360) - 180) <= 10,
    `마지막 구간이 IYAN 접근 코스와 같은 방향이다 (${Math.round(zCrs.fin)}°M · LOC ${zCrs.loc}°M)`);

  // AIP 표에 함께 적힌 방위·거리로 좌표를 되짚어 본다.
  // (옮겨 적다 한 자리 틀리면 여기서 바로 튄다 — 자릿수는 표의 표기 정밀도에 맞춘다)
  //   D4.6 IYAN : BRG 329.92° / 4.55 NM IYAN   D3.1 : 3.10 NM   D1.0 : 1.00 NM
  //   DUBUN     : R 091 YAG / 10.00 NM YAG
  const zGeo = await page.evaluate(() => {
    const A = IFR_DB.RKNY.approaches.find(x => x.name === 'ILS Z RWY 33');
    const w = {}; A.wps.forEach(x => { w[x.ident] = x; });
    const IYAN = [38 + 3 / 60 + 13.8 / 3600, 128 + 40 / 60 + 30.0 / 3600];   // 표의 IYAN DME
    const YAG = ENR_VORS.find(v => v.id === 'YAG');
    const at = (p) => ({ d: distance(IYAN[0], IYAN[1], p.lat, p.lon),
                         b: toMag(bearing(p.lat, p.lon, IYAN[0], IYAN[1])) });
    return { f46: at(w['IYAN D4.6']), f31: at(w['IYAN D3.1']), f10: at(w['IYAN D1.0']),
             dubD: distance(YAG.lat, YAG.lon, w.DUBUN.lat, w.DUBUN.lon),
             dubR: toMag(bearing(YAG.lat, YAG.lon, w.DUBUN.lat, w.DUBUN.lon)) };
  });
  [['f46', 4.55], ['f31', 3.10], ['f10', 1.00]].forEach(([k, nm]) => {
    t.ok(Math.abs(zGeo[k].d - nm) < 0.06,
      `${k === 'f46' ? 'D4.6' : k === 'f31' ? 'D3.1' : 'D1.0'} 가 IYAN 에서 ${nm}NM 이다 (${zGeo[k].d.toFixed(2)}NM)`);
  });
  t.ok(Math.abs(zGeo.f46.b - 329.92) < 1.0,
    `FAF 가 IYAN 기준 게재 방위와 같다 (${zGeo.f46.b.toFixed(1)}° · 표 329.92°)`);
  t.ok(Math.abs(zGeo.dubD - 10.0) < 0.15,
    `DUBUN 이 YAG 에서 10.00NM 이다 (${zGeo.dubD.toFixed(2)}NM)`);
  t.ok(Math.abs(((zGeo.dubR - 91 + 540) % 360) - 180) <= 1.0,
    `DUBUN 이 YAG R-091 위에 있다 (${zGeo.dubR.toFixed(1)}°M)`);

  // ── CDU 에서 골라 비행계획에 실제로 들어가는가 ──
  const added = await page.evaluate(() => {
    S.wps = [];
    fpIfrPhase = 'app';
    fpGo('IFR');
    document.getElementById('app-icao').value = 'RKJB';
    loadStars();
    const sel = document.getElementById('app-star');
    const i = [...sel.options].findIndex(o => o.textContent.startsWith('KAMIT 1D'));
    sel.value = String(i);
    addStarWps();
    return S.wps.map(w => w.ident);
  });
  t.eq(added.join('→'), 'KAMIT→JB751→JB752→JB753→JB754→AYEON',
    `STAR 을 고르면 비행계획에 순서대로 들어간다 (${added.join('→')})`);
}
