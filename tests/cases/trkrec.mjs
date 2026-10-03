// 항적 녹화 — 다른 화면에 갔다 와서 앱이 새로 열려도 녹화가 이어지는가
//
// 휴대폰 브라우저는 화면 밖으로 나간 웹앱을 멈추거나 내렸다가, 돌아오면 새로
// 연다. 웹앱은 백그라운드에서 돌 수 없으므로 '새로 열려도 끊기지 않는 것' 이
// 곧 요구다. 실제로 새로고침(page.reload)해서 본다.
export const name = '항적 녹화 이어가기';

const ready = (page) => page.waitForFunction(
  () => typeof S === 'object' && S !== null && typeof leafMap === 'object' && typeof _trkRec !== 'undefined',
  null, { timeout: 20000 });

// GPS 가 막 새 위치를 준 것처럼 꾸민다(검사 환경에는 위치 권한이 없다)
const FIX = `(lat, lon) => { gpsMode = true; S.lat = lat; S.lon = lon; S.alt = 1500;
  _gpsPrev = { lat, lon, ms: Date.now(), alt: S.alt }; }`;

export async function run(page, t) {
  await page.evaluate(() => { setSolo('map'); localStorage.removeItem('trkRecBackup'); });

  // ── ① 녹화 중에는 찍을 때마다 백업하고, 지도에도 그린다 ──────────────
  const rec = await page.evaluate((fixSrc) => {
    const fix = eval(fixSrc);
    fix(37.50, 126.80);
    toggleTrackRec();
    for (let i = 1; i <= 5; i++) { fix(37.50 + i * 0.01, 126.80 + i * 0.01); _trkCapture(); }
    S.trail = [[37.50, 126.80], [37.52, 126.82], [37.55, 126.85]];
    saveSession();
    const bak = JSON.parse(localStorage.getItem('trkRecBackup'));
    return { n: _trkPts.length, bakOn: bak.on, bakN: bak.pts.length,
             line: _trkLine ? _trkLine.getLatLngs().flat().length : 0,
             active: document.getElementById('rec-btn').classList.contains('active') };
  }, FIX);
  t.eq(rec.n, 6, '녹화가 점을 찍는다');
  t.eq(rec.bakN, 6, `찍을 때마다 백업한다(내려가는 순간을 놓쳐도 잃지 않게) (${rec.bakN}점)`);
  t.eq(rec.bakOn, true, '백업에 "녹화 중" 을 남긴다');
  t.eq(rec.line, 6, `녹화분을 지도에 그린다 (${rec.line}점)`);

  // ── ② 앱이 새로 열려도 묻지 않고 녹화를 이어 간다 ─────────────────────
  await page.reload();
  await ready(page);
  await page.waitForTimeout(2000);   // 종전에는 1.5초 뒤 확인 창이 떴다 — 그 뒤까지 본다
  const back = await page.evaluate(() => ({
    rec: _trkRec, n: _trkPts.length,
    btns: [...document.querySelectorAll('.rec-btn')].map(b => b.classList.contains('active')),
    dlg: !!document.querySelector('.ui-dlg-back'),
    toast: [...document.querySelectorAll('.ui-toast')].map(e => e.textContent).join(' '),
    line: _trkLine ? _trkLine.getLatLngs().flat().length : 0,
    trail: S.trail.length,
  }));
  t.eq(back.rec, true, '다시 열린 뒤에도 녹화 중이다');
  t.eq(back.n, 6, `그때까지 찍은 점이 그대로다 (${back.n}점)`);
  t.ok(back.btns.length >= 2 && back.btns.every(Boolean), 'REC 버튼(지도·PFD)이 켜진 채다');
  t.eq(back.dlg, false, '이어 갈지 묻는 창을 띄우지 않는다');
  t.ok(/이어갑니다/.test(back.toast), `이어 간다는 것만 짧게 알린다 (${back.toast})`);
  t.eq(back.line, 6, '지도에 그때까지의 녹화 항적이 다시 그려진다');
  t.eq(back.trail, 3, `지도의 지나온 자리(초록 선)도 남는다 (${back.trail}점)`);

  // ── ③ 새 위치가 오기 전에는 찍지 않는다 ─────────────────────────────
  // 되살린 '마지막 위치' 를 지금 시각으로 찍으면 가짜 점이 된다
  const stale = await page.evaluate((fixSrc) => {
    const before = _trkPts.length;
    gpsMode = true; _gpsPrev = { lat: S.lat, lon: S.lon, ms: Date.now() - 5 * 60 * 1000 };
    S.lat += 0.05;
    _trkCapture();
    const afterStale = _trkPts.length;
    eval(fixSrc)(S.lat, S.lon);
    _trkCapture();
    return { before, afterStale, afterFresh: _trkPts.length };
  }, FIX);
  t.eq(stale.afterStale, stale.before, '새 GPS 위치가 오기 전에는 점을 찍지 않는다');
  t.eq(stale.afterFresh, stale.before + 1, '새 위치가 오면 다시 찍는다');

  // ── ④ 화면 밖에 있던 구간은 직선으로 잇지 않는다 ──────────────────────
  const gap = await page.evaluate(() => {
    const segs = _trkSegments();
    const t0 = _trkPts[_trkPts.length - 1].t;
    const pts = _trkPts.concat([
      { lat: 37.70, lon: 127.00, altM: 450, t: t0 + 12 * 60 * 1000 },
      { lat: 37.71, lon: 127.01, altM: 450, t: t0 + 12 * 60 * 1000 + 2000 },
    ]);
    const gpx = _trkToGpx(pts);
    return { before: segs.length, after: _trkSegments(pts).length,
             trkseg: (gpx.match(/<trkseg>/g) || []).length,
             trkpt: (gpx.match(/<trkpt /g) || []).length, total: pts.length };
  });
  t.eq(gap.before, 1, '끊김이 없으면 한 구간이다');
  t.eq(gap.after, 2, '12분 끊긴 곳에서 구간을 나눈다');
  t.eq(gap.trkseg, 2, 'GPX 에도 구간(trkseg)을 나눠 담는다');
  t.eq(gap.trkpt, gap.total, `점은 하나도 빠지지 않는다 (${gap.trkpt}/${gap.total})`);

  // ── ⑤ 오래된 백업은 종전처럼 물어본다 ────────────────────────────────
  // 몇 시간 지난 녹화를 말없이 이어 붙이면 다른 비행이 한 항적으로 섞인다
  // (녹화를 먼저 멈춘다 — 녹화 중이면 떠나는 순간 pagehide 가 지금 녹화로 백업을 덮어쓴다)
  const halt = () => { clearInterval(_trkTimer); _trkTimer = null; _trkRec = false; };
  await page.evaluate(`(${halt})()`);
  await page.evaluate(() => {
    const old = Date.now() - 5 * 3600 * 1000;
    localStorage.setItem('trkRecBackup', JSON.stringify({ v: 2, on: true,
      pts: [[37.5, 126.8, 100, old], [37.6, 126.9, 200, old + 2000]] }));
  });
  await page.reload();
  await ready(page);
  await page.waitForTimeout(2200);
  const oldBak = await page.evaluate(() => ({
    rec: _trkRec, dlg: document.querySelector('.ui-dlg-back')?.innerText || '' }));
  t.eq(oldBak.rec, false, '오래된 녹화는 저절로 이어 붙이지 않는다');
  t.ok(/이어서 녹화/.test(oldBak.dlg), '이어 갈지 저장할지 묻는다');

  // 옛 형식(점 배열만)도 읽는다 — 녹화 중이었는지 모르므로 묻는다
  await page.evaluate(`(${halt})()`);
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('trkRecBackup', JSON.stringify([[37.5, 126.8, 100, now - 4000], [37.6, 126.9, 200, now - 2000]]));
  });
  await page.reload();
  await ready(page);
  await page.waitForTimeout(2200);
  const legacy = await page.evaluate(() => ({
    rec: _trkRec, dlg: document.querySelector('.ui-dlg-back')?.innerText || '' }));
  t.ok(!legacy.rec && /2점이 복구/.test(legacy.dlg), '옛 형식 백업도 읽어 묻는다');

  // ── ⑥ 녹화를 끝내면 지도 위 녹화선과 백업을 걷는다 ──────────────────
  const stop = await page.evaluate(async (fixSrc) => {
    document.querySelectorAll('.ui-dlg-back').forEach(e => e.remove());
    localStorage.removeItem('trkRecBackup');
    _trkRec = false; _trkPts = [];
    eval(fixSrc)(37.5, 126.8);
    toggleTrackRec();
    eval(fixSrc)(37.51, 126.81); _trkCapture();
    const had = !!_trkLine;
    toggleTrackRec();                        // 끝 — 저장할지 묻는 창이 뜬다
    await new Promise(r => setTimeout(r, 100));
    const r = { had, line: !!_trkLine, bak: localStorage.getItem('trkRecBackup'), rec: _trkRec };
    document.querySelectorAll('.ui-dlg-back').forEach(e => e.remove());
    gpsMode = false;
    return r;
  }, FIX);
  t.ok(stop.had && !stop.line, '녹화를 끝내면 지도 위 녹화선을 걷는다');
  t.ok(stop.bak === null && stop.rec === false, '정상 종료하면 백업을 지운다');
}
