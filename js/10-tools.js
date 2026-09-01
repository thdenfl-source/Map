// ─────────────────────────────────────────────────────────────
// 10-tools.js — 항적 기록 · 공역 경보 · 로그북 · FDR 재생
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  TRACK RECORDER — 비행 항적 기록 → GPX/KML 저장
// ═══════════════════════════════════════════════════════════════
let _trkRec = false;
let _trkPts = [];        // {lat, lon, altM, t(ms)}
let _trkTimer = null;
const TRK_BAK_KEY = 'trkRecBackup';   // 새로고침/크래시 대비 진행분 백업

// 진행 중 항적을 localStorage에 백업(간이 배열 포맷으로 용량 절약)
function _trkSaveBackup() {
  try {
    localStorage.setItem(TRK_BAK_KEY, JSON.stringify(
      _trkPts.map(p => [ +p.lat.toFixed(6), +p.lon.toFixed(6), Math.round(p.altM), p.t ])
    ));
  } catch(e) { _swallow(e); }
}
function _trkClearBackup() { try { localStorage.removeItem(TRK_BAK_KEY); } catch(e) { _swallow(e); } }
function _trkStartTimer() {
  if (_trkTimer) { clearInterval(_trkTimer); _trkTimer = null; }   // 이중 기동 방지
  document.getElementById('rec-btn').classList.add('active');
  document.getElementById('rec-btn').textContent = '● REC';
  _trkCapture();
  _trkTimer = setInterval(_trkCapture, 2000);   // 2초 간격 기록
}

function toggleTrackRec() {
  if (_trkRec) { _trkStop(); return; }
  _trkRec = true;
  _trkPts = [];
  _trkStartTimer();
}
function _trkCapture() {
  if (typeof S === 'undefined' || S.lat == null) return;
  const last = _trkPts[_trkPts.length - 1];
  // 정지 상태 중복 기록 방지(약 5m 미만 이동 시 60초에 1점만)
  if (last && distance(last.lat, last.lon, S.lat, S.lon) < 0.0027 && Date.now() - last.t < 60000) return;
  _trkPts.push({ lat: S.lat, lon: S.lon, altM: (S.alt || 0) * 0.3048, t: Date.now() });
  // 10초(5점)마다 백업 → 새로고침·크래시에도 진행분 보존
  if (_trkPts.length % 5 === 0) _trkSaveBackup();
}
// 화면 이탈/새로고침 직전 마지막 상태 백업
window.addEventListener('pagehide', () => { if (_trkRec) _trkSaveBackup(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && _trkRec) _trkSaveBackup();
});
async function _trkStop() {
  _trkRec = false;
  if (_trkTimer) { clearInterval(_trkTimer); _trkTimer = null; }
  const btn = document.getElementById('rec-btn');
  btn.classList.remove('active'); btn.textContent = 'REC';
  _trkClearBackup();   // 정상 종료 → 백업 불필요
  if (_trkPts.length < 2) { uiAlert('기록된 항적이 없습니다 (2점 미만).'); return; }
  // 로그북(IndexedDB)에 자동 저장 → 나중에 FDR 패널에서 내보내기/삭제 가능
  const rec = {
    id: Date.now(), t0: _trkPts[0].t, t1: _trkPts[_trkPts.length-1].t,
    n: _trkPts.length, distNM: _logTrackDist(_trkPts), pts: _trkPts
  };
  _logPut(rec).catch(e => console.warn('로그북 저장 실패:', e.message));
  const asGpx = await uiConfirm(
    `항적 ${_trkPts.length}점 · 로그북 저장 완료.\n\n` +
    `나중에 FDR 패널 → 로그북에서 GPX/KML로 다시 내보낼 수 있습니다.`,
    { okText: '지금 GPX 저장', cancelText: '나중에' });
  if (asGpx) {
    const d = new Date(_trkPts[0].t);
    const p2 = n => String(n).padStart(2, '0');
    const fname = `track_${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
    _trkDownload(fname + '.gpx', _trkToGpx(_trkPts), 'application/gpx+xml');
  }
}
function _trkToGpx(trkPts = _trkPts) {
  const pts = trkPts.map(p =>
    `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.altM.toFixed(1)}</ele><time>${new Date(p.t).toISOString()}</time></trkpt>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FlightSimulator" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>Flight Track</name><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>`;
}
function _trkToKml(trkPts = _trkPts) {
  // gx:Track(시간 포함) — 앱 FDR로 그대로 리플레이 가능
  const whens  = trkPts.map(p => `<when>${new Date(p.t).toISOString()}</when>`).join('\n');
  const coords = trkPts.map(p => `<gx:coord>${p.lon.toFixed(6)} ${p.lat.toFixed(6)} ${p.altM.toFixed(1)}</gx:coord>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">\n<Document><Placemark><name>Flight Track</name>\n<gx:Track>\n${whens}\n${coords}\n</gx:Track>\n</Placemark></Document>\n</kml>`;
}
// 시작 시 미종료 백업이 있으면 복구 제안(새로고침·크래시로 끊긴 녹화)
setTimeout(async () => {
  let bak = null;
  try { bak = JSON.parse(localStorage.getItem(TRK_BAK_KEY) || 'null'); } catch(e) { _swallow(e); }
  if (!Array.isArray(bak) || bak.length < 2) return;
  const pts = bak.map(a => ({ lat: a[0], lon: a[1], altM: a[2], t: a[3] }));
  const from = new Date(pts[0].t), p2 = n => String(n).padStart(2, '0');
  const resume = await uiConfirm(
    `이전 세션에서 녹화 중이던 항적 ${pts.length}점이 복구되었습니다.\n` +
    `(시작: ${p2(from.getHours())}:${p2(from.getMinutes())})`,
    { okText: '이어서 녹화', cancelText: '저장하고 종료' }
  );
  _trkPts = pts;
  if (resume) {
    _trkRec = true;
    _trkStartTimer();
  } else {
    _trkRec = false;
    _trkStop();   // 저장 다이얼로그(GPX/KML) → 백업 정리
  }
}, 1500);

function _trkDownload(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ═══════════════════════════════════════════════════════════════
//  화면 꺼짐 방지 (Wake Lock) — GPS/비행/녹화 중 자동 유지
// ═══════════════════════════════════════════════════════════════
let _wakeLock = null;
async function _wakeAcquire() {
  try {
    if (!_wakeLock && 'wakeLock' in navigator) {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    }
  } catch(e) { _swallow(e); }
}
function _wakeRelease() {
  try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch(e) { _swallow(e); }
}
function _wakeWanted() { return gpsMode || S.running || _trkRec; }
setInterval(() => { _wakeWanted() ? _wakeAcquire() : _wakeRelease(); }, 5000);
// 백그라운드 복귀 시 OS가 해제한 락 재획득
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _wakeWanted()) _wakeAcquire();
});

// ═══════════════════════════════════════════════════════════════
//  공역 접근/진입 경보 — 패널에서 켠(aspcOn) 구역 대상
// ═══════════════════════════════════════════════════════════════
const ASPC_WARN_NM = 3;          // 접근 경보 거리
let _aspcAlertState = {};        // id → 'in' | 'near' | undefined

// ── 경보 INHIBIT (공역경보 / HTAWS) ──
let inhibAspc = false, inhibTaws = false;
try {
  inhibAspc = localStorage.getItem('inhibAspc') === '1';
  inhibTaws = localStorage.getItem('inhibTaws') === '1';
} catch(e) { _swallow(e); }
function toggleInhibMenu(force) {
  const m = document.getElementById('inhib-menu');
  if (force === false) m.classList.remove('open');
  else m.classList.toggle('open');
  _inhibRender();
}
function toggleInhib(which) {
  if (which === 'aspc') {
    inhibAspc = !inhibAspc;
    try { localStorage.setItem('inhibAspc', inhibAspc ? '1' : '0'); } catch(e) { _swallow(e); }
    if (inhibAspc) { const el = document.getElementById('aspc-alert'); if (el) el.className = ''; _aspcAlertState = {}; }
  } else {
    inhibTaws = !inhibTaws;
    try { localStorage.setItem('inhibTaws', inhibTaws ? '1' : '0'); } catch(e) { _swallow(e); }
    if (inhibTaws) { const ta = document.getElementById('terrain-alert'); if (ta) ta.classList.remove('on'); }
  }
  _inhibRender();
}
function _inhibRender() {
  const a = document.getElementById('inhib-aspc-btn');
  const t = document.getElementById('inhib-taws-btn');
  if (a) { a.classList.toggle('inhibited', inhibAspc); a.querySelector('span').textContent = inhibAspc ? 'INHIBIT' : 'ON'; }
  if (t) { t.classList.toggle('inhibited', inhibTaws); t.querySelector('span').textContent = inhibTaws ? 'INHIBIT' : 'ON'; }
  const b = document.getElementById('inhib-btn');
  if (b) b.classList.toggle('inhib-active', inhibAspc || inhibTaws);
}
setTimeout(_inhibRender, 100);   // 초기 상태 반영

function _aspcPointIn(a, lat, lon) {
  if (a.circle) return distance(lat, lon, a.circle.c[0], a.circle.c[1]) <= a.circle.r;
  // ray casting
  const p = a.poly; let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const yi = p[i][0], xi = p[i][1], yj = p[j][0], xj = p[j][1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function _aspcDistNM(a, lat, lon) {
  if (a.circle) return Math.max(0, distance(lat, lon, a.circle.c[0], a.circle.c[1]) - a.circle.r);
  if (_aspcPointIn(a, lat, lon)) return 0;
  // 등장방형 근사 평면에서 점-선분 최소거리(NM)
  const k = Math.cos(lat * D2R);
  const px = lon * k * 60, py = lat * 60;
  let best = Infinity;
  const p = a.poly;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ax = p[j][1] * k * 60, ay = p[j][0] * 60;
    const bx = p[i][1] * k * 60, by = p[i][0] * 60;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    best = Math.min(best, Math.hypot(px - qx, py - qy));
  }
  return best;
}
function _aspcAlertCheck() {
  const el = document.getElementById('aspc-alert');
  if (!el) return;
  if (inhibAspc || !(gpsMode || S.running)) { el.className = ''; _aspcAlertState = {}; return; }
  let insideA = null, nearA = null, nearD = ASPC_WARN_NM;
  AIRSPACE_DB.forEach(a => {
    if (!aspcOn[a.id]) return;
    if (a.grp === 'FIR' || a.grp === 'KADIZ') return;   // 광역 경계는 진입 경보 제외
    const d = _aspcDistNM(a, S.lat, S.lon);
    if (d <= 0.001) { if (!insideA) insideA = a; }
    else if (d < nearD) { nearD = d; nearA = a; }
  });
  // 상태 전이 시에만 진동(반복 경보 방지)
  if (insideA) {
    if (_aspcAlertState[insideA.id] !== 'in') {
      _aspcAlertState = { [insideA.id]: 'in' };
      try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch(e) { _swallow(e); }
    }
    el.textContent = `⚠ ${insideA.name} 진입`;
    el.className = 'inside';
  } else if (nearA) {
    if (_aspcAlertState[nearA.id] !== 'near') {
      _aspcAlertState = { [nearA.id]: 'near' };
      try { navigator.vibrate && navigator.vibrate(150); } catch(e) { _swallow(e); }
    }
    el.textContent = `${nearA.name} 접근 ${uDist(nearD)}`;
    el.className = 'near';
  } else {
    _aspcAlertState = {};
    el.className = '';
  }
}
setInterval(() => { try { _aspcAlertCheck(); } catch(e) { _swallow(e); } }, 5000);

// ═══════════════════════════════════════════════════════════════
//  항적 로그북 — REC 종료 시 IndexedDB 자동 저장, FDR 패널에서 관리
// ═══════════════════════════════════════════════════════════════
function _logDB() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('TrackLog', 1);
    q.onupgradeneeded = e => e.target.result.createObjectStore('tracks', { keyPath: 'id' });
    q.onsuccess = e => res(e.target.result);
    q.onerror = e => rej(e.target.error);
  });
}
async function _logPut(rec) {
  const db = await _logDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').put(rec);
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  });
}
async function _logAll() {
  const db = await _logDB();
  return new Promise((res, rej) => {
    const q = db.transaction('tracks', 'readonly').objectStore('tracks').getAll();
    q.onsuccess = e => res(e.target.result || []);
    q.onerror = e => rej(e.target.error);
  });
}
async function _logDel(id) {
  const db = await _logDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').delete(id);
    tx.oncomplete = res; tx.onerror = e => rej(e.target.error);
  });
}
function _logTrackDist(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distance(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
  return d;
}
async function renderLogbook() {
  const box = document.getElementById('logbook-list');
  if (!box) return;
  let recs = [];
  try { recs = await _logAll(); } catch(e) { _swallow(e); }
  recs.sort((a, b) => b.id - a.id);
  if (!recs.length) { box.innerHTML = '<div style="color:#556;font-size:9px;padding:3px 0;">저장된 항적 없음</div>'; return; }
  const p2 = n => String(n).padStart(2, '0');
  box.innerHTML = recs.map(r => {
    const d = new Date(r.id);
    const mins = Math.round((r.t1 - r.t0) / 60000);
    return `<div style="display:flex;align-items:center;gap:5px;padding:3px 0;border-bottom:1px solid #1a2436;font-size:9px;color:#aab;">
      <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${d.getMonth()+1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())} · ${mins}분 · ${r.distNM.toFixed(1)}NM</div>
      <span onclick="logExport(${r.id},'gpx')" style="cursor:pointer;color:#7ab8f5;border:1px solid #2a4a6a;border-radius:3px;padding:1px 5px;">GPX</span>
      <span onclick="logExport(${r.id},'kml')" style="cursor:pointer;color:#8bc34a;border:1px solid #3a5a2a;border-radius:3px;padding:1px 5px;">KML</span>
      <span onclick="logDelete(${r.id})" style="cursor:pointer;color:#f44336;border:1px solid #5a2222;border-radius:3px;padding:1px 5px;">✕</span>
    </div>`;
  }).join('');
}
async function logExport(id, fmt) {
  const recs = await _logAll();
  const r = recs.find(x => x.id === id);
  if (!r) return;
  const d = new Date(r.t0), p2 = n => String(n).padStart(2, '0');
  const fname = `track_${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
  if (fmt === 'gpx') _trkDownload(fname + '.gpx', _trkToGpx(r.pts), 'application/gpx+xml');
  else               _trkDownload(fname + '.kml', _trkToKml(r.pts), 'application/vnd.google-earth.kml+xml');
}
async function logDelete(id) {
  if (!await uiConfirm('이 항적을 로그북에서 삭제할까요?',
        { okText: '삭제', cancelText: '취소' })) return;
  await _logDel(id);
  renderLogbook();
}

// ═══════════════════════════════════════════════════════════════
//  FDR (GPX REPLAY)
// ═══════════════════════════════════════════════════════════════
let _fdrTrack      = [];     // interpolated track for playback
let _fdrRawTrack   = [];     // original GPX points — used for route preview line only
let _fdrIdx        = 0;      // current playback index
let _fdrSpeed      = 1;      // playback speed multiplier
let _fdrRafId      = null;   // requestAnimationFrame handle
let _fdrWallStart  = 0;      // wall-clock ms when play/resume began
let _fdrTrackStart = 0;      // track timeMs at start of current play segment
let _fdrLayer2d    = null;   // Leaflet polyline
let _fdrMarker2d   = null;   // Leaflet marker for current position
let _fdrLayer3d    = null;   // maplibre source id flag

function toggleFdrPanel() {
  const panel = document.getElementById('fdr-panel');
  const btn   = document.getElementById('fdr-btn');
  const open  = panel.classList.toggle('open');
  btn.classList.toggle('active', open);
  if (open) { try { renderLogbook(); } catch(e) { _swallow(e); } }
}

// ── NOTAM / KML / GPX overlay ──────────────────────────
// ── ENR 항로 픽스 오버레이 (AIP ENR 픽스 좌표표에서 전사) ──
// 형식: 이름 위도(DDMMSS) 경도(DDDMMSS). 교차검증: SAKTI/BIGOB/ATASO/NONOS = ENR 3.6과 일치
const ENR_FIX_RAW =
  'AGAVO 371000 1240000,AGSUS 364521 1304044,AKPON 334650 1271953,ANDOL 373958 1330000,' +
  'ANKUS 350730 1284616,ANROD 343758 1282952,ANSIM 372323 1245009,ANUBA 350746 1273523,' +
  'APARU 352442 1290932,APELA 344323 1291400,ATASO 355344 1265657,ATINA 334320 1270423,' +
  'ATOTI 300013 1251154,BASEM 365037 1275710,BEDAR 315401 1262910,BEDES 360905 1264844,' +
  'BEDOM 352513 1291754,BELTU 371218 1254759,BEPKO 333910 1265514,BESNA 343718 1290751,' +
  'BIDRI 362007 1242453,BIGOB 364325 1280952,BIKSI 374032 1283504,BILUM 334613 1270439,' +
  'BINIL 372349 1251359,BITUX 361645 1280148,BODOL 371122 1244954,BOGAN 371241 1262812,' +
  'BONSO 302840 1250851,BOPTA 364406 1263658,BULGA 355609 1294924,BULTI 364322 1264930,' +
  'BUSKO 374033 1301610,DABIK 361743 1301143,DALPO 365835 1242453,DALSU 350731 1264206,' +
  'DANPA 353036 1242453,DANTI 371806 1243929,DOMKO 322848 1255859,DOTOL 341515 1263637,' +
  'EGOBA 372915 1272246,ELAPI 362014 1285051,ELGEP 314653 1255617,ELPOS 355410 1264707,' +
  'ENGOT 344834 1282952,ENSAL 365554 1274747,ENSUM 321302 1244635,ENTEL 362311 1265705,' +
  'ESNEG 371014 1295051,GOGET 372442 1263036,GONAV 371048 1242453,GONAX 362311 1265016,' +
  'GOSBO 341517 1274734,GUKDO 370111 1273823,GUKSU 335251 1264357,GUNKU 363414 1265949,' +
  'IGDOK 353104 1274907,IGRAS 371846 1324411,IKEDO 314314 1253948,INVOK 344719 1291923,' +
  'IPDAS 341515 1264301,KAKSO 370745 1272637,KALEK 351232 1295305,KALMA 371845 1270645,' +
  'KALOD 353012 1284626,KAMIT 341514 1264618,KANKA 313155 1253504,KANSU 383800 1322830,' +
  'KARBU 373159 1273952,KIDOS 335028 1263402,LAMEN 313636 1240000,LANAT 362224 1312542,' +
  'LAPAL 355413 1290452,LESBU 374116 1294104,LIMDI 333313 1254953,LINTA 353116 1265119,' +
  'LOSNI 333315 1264153,LOSTO 362016 1292548,MAKDU 362712 1274909,MAKET 335452 1271953,' +
  'MAKSA 353011 1265422,MALSO 375440 1314904,MANGI 353011 1264432,MANOL 333629 1265514,' +
  'MASTA 352847 1283340,MEKIL 363322 1264953,MELES 355251 1271542,MONSI 371247 1265015,' +
  'MOXID 362311 1264359,MUGUS 300006 1245712,NIRAT 320354 1260329,NISAV 341519 1275835,' +
  'NOBUT 370715 1291957,NOGON 372250 1242505,NONOS 364046 1242453,NOPIK 372412 1253905,' +
  'NULDI 342514 1263739,OLBIM 371411 1240751,OLMEN 364413 1265928,OLMUD 350225 1284916,' +
  'OMKIM 331320 1264114,OMOTU 350033 1285022,ONATA 382832 1320602,ONIKU 321142 1263917,' +
  'OPEDA 355149 1273652,OROGA 364456 1272718,OSPOT 365018 1272055,OSVOM 363844 1292331,' +
  'PALDU 375813 1323625,PALSA 340131 1242453,PANSI 330014 1261225,PAPLU 333441 1270337,' +
  'PEBRI 362311 1270013,PILIT 372631 1291731,POLEG 371249 1265935,PONIK 320021 1254659,' +
  'POSAN 365615 1271316,POVEM 345523 1285416,POVOR 341520 1274400,REBIT 371203 1252913,' +
  'REMOS 332605 1262329,RILRO 371033 1241442,RIMPO 350739 1273502,RINBO 355352 1265349,' +
  'RUGMA 323012 1265753,RUNIT 350734 1282952,SABET 373829 1324019,SADLI 314948 1250000,' +
  'SAKTI 365100 1274600,SAMDO 333503 1281857,SAMLO 323223 1261536,SAMUL 350736 1265154,' +
  'SAPDI 350737 1282952,SAPRA 354926 1304325,SARAM 350736 1283147,SELPA 375515 1304911,' +
  'SOSDO 330012 1262735,TAMNA 332815 1271953,TEBEX 363341 1275929,TEDAN 350744 1271852,' +
  'TENAS 373820 1313427,TESIM 313526 1255128,TOLIS 335030 1242453,TOPAX 344555 1282952,' +
  'TORUS 373625 1280807,TOSAN 330012 1264619,UGOVI 374105 1295051,UPGOS 335733 1271953,' +
  'VASLI 364252 1273003';

let _fixMarkers = [];
let fixLayerOn = false;
try { fixLayerOn = localStorage.getItem('fixLayerOn') === '1'; } catch(e) { _swallow(e); }

function _enrFixList() {
  const dms = (d, degLen) => (+d.slice(0, degLen)) + (+d.slice(degLen, degLen + 2)) / 60 + (+d.slice(degLen + 2)) / 3600;
  return ENR_FIX_RAW.split(',').map(s => {
    const [name, la, lo] = s.trim().split(/\s+/);
    return { name, lat: dms(la, 2), lon: dms(lo, 3) };
  });
}
// ── 지도 심볼 공통 팝업: 좌표 확인·복사 / Flight Plan 추가 (+심볼별 추가 동작) ──
//   o = { title, color, name, lat, lon, sub, note, extra:[{label,onclick,fg,bg}] }
function _mapSymPopup(o) {
  const btn = 'cursor:pointer;border-radius:4px;padding:5px 8px;font-size:11px;font-weight:bold;text-align:center;flex:1;';
  const extra = (o.extra || []).map(e =>
    `<span onclick="${e.onclick}" style="${btn}background:${e.bg};color:${e.fg};border:1px solid ${e.fg}55;">${e.label}</span>`).join('');
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:11px;color:#333;line-height:1.5;min-width:210px;">` +
    `<div style="color:${o.color};font-weight:bold;font-size:13px;margin-bottom:2px;">${o.title}</div>` +
    (o.sub ? `<div style="color:#555;font-size:10px;margin-bottom:2px;">${o.sub}</div>` : '') +
    `<div style="color:#333;">${decToDMS(o.lat, true)} ${decToDMS(o.lon, false)}</div>` +
    `<div style="color:#777;font-size:10px;">${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}</div>` +
    (o.note ? `<div style="color:#b26a00;font-size:10px;margin-top:2px;">${o.note}</div>` : '') +
    `<div style="display:flex;gap:5px;margin-top:6px;">` +
      `<span onclick="fixCopyCoord(this,'${o.name}',${o.lat},${o.lon})" style="${btn}background:#eef3f7;color:#3b5a70;border:1px solid #3b5a7055;">📋 좌표 복사</span>` +
      // 이미 비행계획에 들어 있는 지점에는 '플랜 추가' 를 주지 않는다(같은 점이 둘 생긴다)
      (o.noAdd ? '' :
        `<span onclick="fixAddToPlan('${o.name}',${o.lat},${o.lon})" style="${btn}background:#e3f2ee;color:#00796b;border:1px solid #00796b55;">✈ 플랜 추가</span>`) +
    `</div>` +
    (extra ? `<div style="display:flex;gap:5px;margin-top:5px;">${extra}</div>` : '') +
    `</div>`;
}
// ── 항로 픽스 팝업 ──
function _fixPopupHtml(name, lat, lon) {
  return _mapSymPopup({ title: `▲ ${name}`, color: '#00788a', name, lat, lon });
}
// ── 지도 공항 ↔ CDU INFO 연결 ──
// AIRFIELD_INFO는 2자리 코드에서 'RK'+code로 ICAO를 파생하는데, 군 비행장 일부는
// 이 규칙이 AIRPORTS_KR의 ICAO와 어긋난다(예: 이천 = INFO 'RN' → RKRN vs 지도 RKUC).
// 그래서 ICAO로 먼저 찾고, 실패하면 공항 명칭으로 한 번 더 찾는다.
function _afldIndexOf(icao) {
  try {
    let i = AIRFIELD_INFO.findIndex(a => _afldIcao(a) === icao);
    if (i >= 0) return i;
    const nm = (typeof APT_NAME !== 'undefined') ? APT_NAME[icao] : '';
    if (nm) i = AIRFIELD_INFO.findIndex(a => a.name === nm || a.name.startsWith(nm));
    return i;
  } catch(e) { return -1; }
}
// 지도의 비행계획 웨이포인트 → CDU 의 그 지점 카드로
// 공항·VOR 은 팝업에서 곧장 상세로 갈 수 있는데 웨이포인트만 갈 데가 없었다.
function _mapOpenWpt(i) {
  try { leafMap.closePopup(); } catch(e) { _swallow(e); }
  if (i < 0 || i >= S.wps.length) return;
  if (leftSel !== 'cdu' && rightSel !== 'cdu') selectPanel(leftSel === 'map' ? 'right' : 'left', 'cdu');
  try { openFlightPlan(); fpWptOpen(i); } catch(e) { _swallow(e); }
}
function _mapOpenAirfield(icao) {
  try { leafMap.closePopup(); } catch(e) { _swallow(e); }
  const i = _afldIndexOf(icao);
  if (i < 0) return;
  if (leftSel !== 'cdu' && rightSel !== 'cdu') selectPanel(leftSel === 'map' ? 'right' : 'left', 'cdu');
  try { openAirfield(i); } catch(e) { _swallow(e); }
}
// INFO 목록에 있고, 공개 비행장이거나 잠금 해제된 경우에만 '공항 정보' 버튼을 준다(보안)
function _aptInfoAvailable(icao) {
  try {
    const i = _afldIndexOf(icao);
    if (i < 0) return false;
    const a = AIRFIELD_INFO[i];
    return !!a.pub || _afldUnlocked;
  } catch(e) { return false; }
}
// 지도 팝업 → 기존 METAR/TAF 팝업으로 전환
function mapAptWx(icao, lat, lon) {
  try { leafMap.closePopup(); } catch(e) { _swallow(e); }
  try { showAptWx(icao, APT_NAME[icao] || '', [lat, lon]); } catch(e) { _swallow(e); }
}
// 지도 VOR 팝업 → NAV1/NAV2 튜닝
function mapTuneNav(navId, freq, id) {
  try { setNavRadio(navId, freq, id); } catch(e) { _swallow(e); }
  try { leafMap.closePopup(); } catch(e) { _swallow(e); }
}
// 클립보드 복사(비보안·구형 환경 폴백 포함) + 버튼 피드백
function fixCopyCoord(el, name, lat, lon) {
  const txt = `${name} ${decToDMS(lat, true)} ${decToDMS(lon, false)} (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
  const done = ok => {
    if (!el) return;
    const orig = el.textContent;
    el.textContent = ok ? '✓ 복사됨' : '복사 실패';
    setTimeout(() => { try { el.textContent = orig; } catch(e) { _swallow(e); } }, 1200);
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(() => done(true), () => done(false));
      return;
    }
  } catch(e) { _swallow(e); }
  try {   // 폴백: 임시 textarea + execCommand
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    done(ok);
  } catch(e) { done(false); }
}
// 픽스를 비행계획 웨이포인트로 추가
function fixAddToPlan(name, lat, lon) {
  pushWP({ ident: name, lat, lon });
  try { leafMap.closePopup(); } catch(e) { _swallow(e); }
}

function _drawFixLayer() {
  _clearFixLayer();
  _enrFixList().forEach(f => {
    const icon = L.divIcon({
      html: `<div style="position:relative;">
        <div style="position:absolute;left:-10px;top:-11px;width:30px;height:30px;"></div>
        <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid #26c6da;filter:drop-shadow(0 0 1.5px #000);"></div>
        <div style="position:absolute;left:11px;top:-2px;color:#4dd0e1;font-size:8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000;">${f.name}</div>
      </div>`,
      iconSize: [10, 9], iconAnchor: [5, 5], className: ''
    });
    const mk = L.marker([f.lat, f.lon], { icon, interactive: true });
    mk.bindPopup(_fixPopupHtml(f.name, f.lat, f.lon), { maxWidth: 260 });
    mk.addTo(leafMap);
    _fixMarkers.push(mk);
  });
}
function _clearFixLayer() {
  _fixMarkers.forEach(m => { try { leafMap.removeLayer(m); } catch(e){ _swallow(e); } });
  _fixMarkers = [];
}
// ── 접근절차 픽스 ─────────────────────────────────────────────
// 한서대학교 태안비행장 비행절차(2025-09-01) 별첨 7 "주요 Point 좌표" 기재값.
// 문서에 함께 적힌 기준점 라디얼/거리와 대조해 검증했다(거리 오차 0.01NM 이내,
// 방위차 +0.7°는 앱의 자편차 -9° 와 현지 실제 편차의 차이).
//   MAGUM = RWY16 시단, GOSUM = RWY34 시단 (제2장 제1절 6항과 일치)
// ※ RNP 접근절차 자체는 문서상 "훈련 목적용이며 공식 인가 절차가 아님" 이라
//   IFR_DB(절차)에는 넣지 않고, 지도 표시용 좌표로만 둔다.
const APP_FIX_DB = [
  { grp:'태안 RNP 16', name:'BACKA', lat:36.784667, lon:126.286167, note:'SOWON 070R 5NM' },
  { grp:'태안 RNP 16', name:'SOWON', lat:36.745167, lon:126.194500, note:'MAGUM 340R 10NM' },
  { grp:'태안 RNP 16', name:'MOSAN', lat:36.671833, lon:126.244000, note:'MAGUM 340R 5NM · FAF 1500ft' },
  { grp:'태안 RNP 16', name:'MAGUM', lat:36.598500, lon:126.293167, note:'RWY 16 시단' },
  { grp:'태안 RNP 34', name:'KWANG', lat:36.482000, lon:126.489333, note:'YUMOK 070R 5NM' },
  { grp:'태안 RNP 34', name:'YUMOK', lat:36.442500, lon:126.398000, note:'GOSUM 160R 10NM' },
  { grp:'태안 RNP 34', name:'CASLE', lat:36.516000, lon:126.349000, note:'GOSUM 160R 5NM · FAF 1500ft' },
  { grp:'태안 RNP 34', name:'GOSUM', lat:36.589333, lon:126.299833, note:'RWY 34 시단' },
  { grp:'태안 IFR',    name:'KODOK', lat:36.782806, lon:126.695472, note:'SOT 229R 24.7D' },
  { grp:'태안 IFR',    name:'NAMPO', lat:36.386111, lon:126.759722, note:'SAN 154R 23.4D' },
  { grp:'태안 IFR',    name:'SAN',   lat:36.710000, lon:126.482333, note:'서산 TACAN · ILS I-SAN 111.50' },
  // NOROO(N37°17'46" E127°19'09", KSM 141R 13.5D)는 문서 표에 취소선이 그어져 있어 제외.
  // PDF 벡터 검사에서 그 행의 모든 셀에만 가로 취소선이 걸린 것을 확인했다.
];
let _appFixMarkers = [];
let appFixOn = {};
try { appFixOn = JSON.parse(localStorage.getItem('appFixOn') || '{}') || {}; } catch(e) { appFixOn = {}; }
const _appFixGrps = () => { const g = []; APP_FIX_DB.forEach(f => { if (!g.includes(f.grp)) g.push(f.grp); }); return g; };
const _appFixAnyOn = () => _appFixGrps().some(g => appFixOn[g]);

function _drawAppFixLayer() {
  _clearAppFixLayer();
  APP_FIX_DB.filter(f => appFixOn[f.grp]).forEach(f => {
    const icon = L.divIcon({
      html: `<div style="position:relative;">
        <div style="position:absolute;left:-10px;top:-11px;width:30px;height:30px;"></div>
        <div style="width:9px;height:9px;border:1.6px solid #ffb74d;transform:rotate(45deg);filter:drop-shadow(0 0 1.5px #000);"></div>
        <div style="position:absolute;left:13px;top:-3px;color:#ffb74d;font-size:8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000;">${f.name}</div>
      </div>`,
      iconSize: [12, 12], iconAnchor: [6, 6], className: ''
    });
    const mk = L.marker([f.lat, f.lon], { icon, interactive: true });
    mk.bindPopup(_mapSymPopup({ title: `◇ ${f.name}`, color: '#b26a00', name: f.name,
      lat: f.lat, lon: f.lon, sub: f.grp, note: f.note }), { maxWidth: 260 });
    mk.addTo(leafMap);
    _appFixMarkers.push(mk);
  });
}
function _clearAppFixLayer() {
  _appFixMarkers.forEach(m => { try { leafMap.removeLayer(m); } catch(e){ _swallow(e); } });
  _appFixMarkers = [];
}

// ── FIX 패널 (ENR 항로 픽스 / 접근절차 픽스) ──
function toggleFixPanel() {
  const p = document.getElementById('fix-panel');
  const open = !p.classList.contains('open');
  p.classList.toggle('open', open);
  if (open) _fixRenderPanel();
  _fixUpdateBtn();
}
function _fixUpdateBtn() {
  const p = document.getElementById('fix-panel');
  document.getElementById('fix-btn')
    .classList.toggle('active', fixLayerOn || _appFixAnyOn() || (p && p.classList.contains('open')));
}
function toggleFixLayer() {
  fixLayerOn = !fixLayerOn;
  if (fixLayerOn) _drawFixLayer(); else _clearFixLayer();
  try { localStorage.setItem('fixLayerOn', fixLayerOn ? '1' : '0'); } catch(e) { _swallow(e); }
  _fixRenderPanel(); _fixUpdateBtn();
}
function toggleAppFixGrp(grp) {
  appFixOn[grp] = !appFixOn[grp];
  _drawAppFixLayer();
  try { localStorage.setItem('appFixOn', JSON.stringify(appFixOn)); } catch(e) { _swallow(e); }
  _fixRenderPanel(); _fixUpdateBtn();
}
function _fixRenderPanel() {
  const p = document.getElementById('fix-panel');
  if (!p || !p.classList.contains('open')) return;
  let html = `<div class="fixp-hdr">항로 픽스</div>
    <label><input type="checkbox" ${fixLayerOn ? 'checked' : ''} onchange="toggleFixLayer()">
      <span style="color:#26c6da;">▲</span> ENR 항로 픽스 <span style="color:#678;">(${_enrFixList().length})</span></label>
    <div class="fixp-hdr" style="margin-top:6px;">접근절차 픽스</div>`;
  _appFixGrps().forEach(g => {
    const n = APP_FIX_DB.filter(f => f.grp === g).length;
    html += `<label><input type="checkbox" ${appFixOn[g] ? 'checked' : ''} onchange="toggleAppFixGrp('${g}')">
      <span style="color:#ffb74d;">◇</span> ${g} <span style="color:#678;">(${n})</span></label>`;
  });
  html += `<div style="color:#5a7a80;font-size:8px;line-height:1.5;padding:6px 3px 0;">
    태안 접근절차 픽스는 한서대 태안비행장 비행절차(2025-09-01) 별첨 7 기재 좌표입니다.
    RNP 절차는 문서상 훈련 목적용이라 IFR 절차 DB에는 넣지 않았습니다.</div>`;
  p.innerHTML = html;
}
// 저장된 상태 복원
if (fixLayerOn) { try { _drawFixLayer(); } catch(e) { _swallow(e); } }
try { if (_appFixAnyOn()) _drawAppFixLayer(); } catch(e) { _swallow(e); }
try { _fixUpdateBtn(); } catch(e) { _swallow(e); }

// AIRFIELD_INFO 는 js/data/airfield-info.js 로 분리했다(로드 순서상 이 파일보다 먼저 실행된다).

// ENR_ROUTES 는 js/data/enr-routes.js 로 분리했다(로드 순서상 이 파일보다 먼저 실행된다).

let _awyLayers = [];
// 카테고리별 표시 상태: Conventional 항로 / RNAV 항로 / VOR 표지소
let awyCat = { conv: false, rnav: false, vor: false, aptvor: false, loc: false };
try {
  const s = JSON.parse(localStorage.getItem('awyCat') || 'null');
  // 이전 버전은 VOR이 한 항목이었으므로, 저장값에 aptvor가 없으면 vor 상태를 물려받는다
  if (s) awyCat = { conv: !!s.conv, rnav: !!s.rnav, vor: !!s.vor, loc: !!s.loc,
                    aptvor: s.aptvor === undefined ? !!s.vor : !!s.aptvor };
} catch(e) { _swallow(e); }

// 경유점 → 좌표 (VOR는 id 참조, 그 외는 내장 좌표)
function _awyWpCoord(w) {
  if (w.vor) {
    const v = ENR_VORS.find(x => x.id === w.n);
    return v ? [v.lat, v.lon] : null;
  }
  return (w.lat != null && w.lon != null) ? [w.lat, w.lon] : null;
}
function _drawAwyLayer() {
  _clearAwyLayer();
  // 항로선 (CONV=녹색, RNAV=하늘색) — 카테고리별 표시
  ENR_ROUTES.forEach(r => {
    if (r.type === 'RNAV' ? !awyCat.rnav : !awyCat.conv) return;
    const coordsAll = r.wps.map(_awyWpCoord);   // 경유점 인덱스 보존(미해결=null)
    const coords = coordsAll.filter(Boolean);
    if (coords.length < 2) return;
    const color = r.type === 'RNAV' ? '#4dd0e1' : '#8bc34a';
    const pl = L.polyline(coords, { color, weight: 2, opacity: 0.85 });
    pl.bindTooltip(`${r.route} (${r.type}) · ${r.wps.map(w => w.n).join(' – ')}`, { sticky: true });
    pl.bindPopup(`<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-size:12px;"><b style="color:${r.type === 'RNAV' ? '#00838f' : '#558b2f'};">${r.route}</b> <span style="color:#888;font-size:10px;">(${r.type})</span><br>${r.wps.map(w => w.n).join(' → ')}</div>`, { maxWidth: 280 });
    pl.addTo(leafMap); _awyLayers.push(pl);
    // 항로명 라벨 — 모든 구간 중앙에 표시(어느 구간에서 봐도 항로명 확인 가능)
    for (let i = 0; i < coords.length - 1; i++) {
      const midLat = (coords[i][0] + coords[i + 1][0]) / 2;
      const midLon = (coords[i][1] + coords[i + 1][1]) / 2;
      const lbl = L.marker([midLat, midLon], {
        icon: L.divIcon({
          html: `<div style="color:${color};font-size:9px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000;background:rgba(0,0,0,0.55);padding:0 3px;border-radius:3px;transform:translate(-50%,-50%);">${r.route}</div>`,
          iconSize: [0, 0], className: ''
        }), interactive: false
      });
      lbl.addTo(leafMap); _awyLayers.push(lbl);
    }
    // 경유 픽스 점 + 이름 (FIX 레이어를 켜지 않아도 항로 경유점 확인 가능)
    r.wps.forEach((w, i) => {
      if (!coordsAll[i] || w.vor) return;   // VOR은 별도 육각형 심볼로 표시됨
      const mk = L.circleMarker(coordsAll[i], {
        radius: 3.5, color: '#fff', weight: 1, fillColor: color, fillOpacity: 1
      });
      mk.bindTooltip(`${w.n} (${r.route})`, { sticky: true });
      mk.bindPopup(_mapSymPopup({
        title: `▲ ${w.n}`, color: '#00788a', name: w.n,
        lat: coordsAll[i][0], lon: coordsAll[i][1], sub: `항로 ${r.route}`
      }), { maxWidth: 260 });
      mk.addTo(leafMap); _awyLayers.push(mk);
      const nmLbl = L.marker(coordsAll[i], {
        icon: L.divIcon({
          html: `<div style="color:#eee;font-size:8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000;transform:translate(7px,-11px);">${w.n}</div>`,
          iconSize: [0, 0], className: ''
        }), interactive: false
      });
      nmLbl.addTo(leafMap); _awyLayers.push(nmLbl);
    });
  });
  // VOR 표지소 — 항로(ENR 4.1) VOR과 비행장 VOR을 각각 제어
  _drawVorGroup(enrVorList(),  '#8bc34a', '#aed581');   // 항로 VOR (연두)
  _drawVorGroup(aptVorList(),  '#ffb74d', '#ffcc80');   // 비행장 VOR (호박색)
  _drawLocGroup(locList());                             // 로컬라이저 (분홍)
}
function locList() { return awyCat.loc ? (typeof LOC_STATIONS !== 'undefined' ? LOC_STATIONS : []) : []; }
// 로컬라이저 — VOR 처럼 심볼 + 식별부호를 띄운다. 다만 LOC 는 '방향을 가진'
// 시설이라 접근 코스 쪽으로 뾰족한 삼각형으로 그려 VOR 육각형과 구별한다.
// 안테나는 접근하는 쪽의 반대편 끝(활주로 너머)에 있다 — 그림에서 그렇게 보인다.
function _drawLocGroup(list) {
  const col = '#f06292', lblCol = '#f8bbd0';
  list.forEach(v => {
    // 삼각형이 '항공기가 들어오는 쪽' 을 가리키도록 코스의 반대로 돌린다
    const rot = normA(toTrue(v.crs) + 180);
    const icon = L.divIcon({
      html: `<div style="position:relative;">
        <div style="width:12px;height:12px;background:${col};filter:drop-shadow(0 0 1.5px #000);
                    clip-path:polygon(50% 0,100% 100%,0 100%);transform:rotate(${rot}deg);"></div>
        <div style="position:absolute;left:15px;top:-1px;color:${lblCol};font-size:8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000;">${v.id} ${v.freq}</div>
      </div>`,
      iconSize: [12, 12], iconAnchor: [6, 6], className: ''
    });
    const mk = L.marker([v.lat, v.lon], { icon });
    mk.bindTooltip(`${v.name} RWY ${v.rwy} LOC (${v.id})<br>${v.freq} MHz · 접근 ` +
                   `${String(v.crs).padStart(3,'0')}°M${v.crsSrc ? '(산출)' : ''}`, { sticky: true });
    const dmeTxt = v.dme ? ` · DME CH ${v.dme.ch}` : '';
    // 접근 코스가 AIP 게재값이 아니면 어디서 낸 값인지 밝힌다
    const SRC = { pair: '반대편 LOC 안테나로 산출(±1°)',
                  gp:   'GP 안테나로 산출(±3°)',
                  rwy:  '활주로 표기값' };
    const crsNote = v.crsSrc ? ` · 접근 코스는 ${SRC[v.crsSrc] || '산출값'}` : '';
    mk.bindPopup(_mapSymPopup({
      title: `◮ ${v.id}`, color: col, name: v.id, lat: v.lat, lon: v.lon,
      sub: `${v.name} RWY ${v.rwy} LOC · ${v.freq} MHz · 접근 ${String(v.crs).padStart(3,'0')}°M` +
           (v.crsSrc ? '(산출)' : '') + (v.cat ? ` · ILS CAT ${v.cat}` : '') + dmeTxt,
      note: '※ 안테나는 활주로 반대편 끝에 있습니다' + crsNote,
      extra: [
        { label: 'NAV1 튜닝', onclick: `mapTuneNav('NAV1','${v.freq}','${v.id}')`, fg: '#3b5a70', bg: '#eef3f7' },
        { label: 'NAV2 튜닝', onclick: `mapTuneNav('NAV2','${v.freq}','${v.id}')`, fg: '#3b5a70', bg: '#eef3f7' },
      ]
    }), { maxWidth: 280 });
    mk.addTo(leafMap); _awyLayers.push(mk);
  });
}
// AWY 패널 분류용 목록
function enrVorList() { return awyCat.vor    ? ENR_VORS.filter(v => !v.apt) : []; }
// 비행장 VOR은 AIP 게재 항행표지이므로 잠금 없이 모두 표시(군 비행장 포함).
// CDU INFO 화면의 ALL 코드 게이트는 비행장 상세정보에만 적용되며 이 레이어와 무관하다.
function _aptVorVisible(v) { return !!v.apt; }
function aptVorList() { return awyCat.aptvor ? ENR_VORS.filter(_aptVorVisible) : []; }
// 육각형 심볼 + ID·주파수 라벨. 좌표가 공항 기준점 근사값(src:'ARP')이면 속을 비워 구분한다.
function _drawVorGroup(list, col, lblCol) {
  list.forEach(v => {
    const approx = v.src === 'ARP';
    const body = approx
      ? `<div style="width:13px;height:13px;background:${col};clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);opacity:0.35;filter:drop-shadow(0 0 1.5px #000);"></div>`
      : `<div style="width:13px;height:13px;background:${col};clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%);filter:drop-shadow(0 0 1.5px #000);"></div>`;
    const icon = L.divIcon({
      html: `<div style="position:relative;">${body}
        <div style="position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;background:#0a0a0a;border-radius:50%;"></div>
        <div style="position:absolute;left:16px;top:-1px;color:${lblCol};font-size:8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000;">${v.id}${v.freq ? ' ' + v.freq : ''}</div>
      </div>`,
      iconSize: [13, 13], iconAnchor: [6, 6], className: ''
    });
    const mk = L.marker([v.lat, v.lon], { icon });
    mk.bindTooltip(`${v.name} (${v.id})${v.freq ? '<br>' + v.freq + ' MHz' : ''}`, { sticky: true });
    mk.bindPopup(_mapSymPopup({
      title: `⬡ ${v.id}`, color: col, name: v.id, lat: v.lat, lon: v.lon,
      sub: `${v.name}${v.freq ? ' · ' + v.freq + ' MHz' : ''}`,
      note: approx ? '※ 좌표는 공항 기준점 근사값' : '',
      extra: v.freq ? [
        { label: 'NAV1 튜닝', onclick: `mapTuneNav('NAV1','${v.freq}','${v.id}')`, fg: '#3b5a70', bg: '#eef3f7' },
        { label: 'NAV2 튜닝', onclick: `mapTuneNav('NAV2','${v.freq}','${v.id}')`, fg: '#3b5a70', bg: '#eef3f7' },
      ] : []
    }), { maxWidth: 280 });
    mk.addTo(leafMap); _awyLayers.push(mk);
  });
}
function _clearAwyLayer() {
  _awyLayers.forEach(l => { try { leafMap.removeLayer(l); } catch(e){ _swallow(e); } });
  _awyLayers = [];
}
function _awySave() { try { localStorage.setItem('awyCat', JSON.stringify(awyCat)); } catch(e) { _swallow(e); } }
function _awyUpdateBtn() {
  const any = awyCat.conv || awyCat.rnav || awyCat.vor || awyCat.aptvor || awyCat.loc;
  const p = document.getElementById('awy-panel');
  document.getElementById('awy-btn').classList.toggle('active', any || (p && p.classList.contains('open')));
}
function toggleAwyCat(k) {
  awyCat[k] = !awyCat[k];
  _drawAwyLayer(); _awySave(); _awyUpdateBtn(); _awyRenderPanel();
}
function _awySetAll(on) {
  awyCat = { conv: on, rnav: on, vor: on, aptvor: on, loc: on };
  _drawAwyLayer(); _awySave(); _awyUpdateBtn(); _awyRenderPanel();
}
function _awyRenderPanel() {
  const p = document.getElementById('awy-panel'); if (!p) return;
  const rows = [
    ['conv', 'Conventional 항로', '#8bc34a', ENR_ROUTES.filter(r=>r.type==='CONV').length + '개'],
    ['rnav', 'RNAV(Area) 항로',   '#4dd0e1', ENR_ROUTES.filter(r=>r.type==='RNAV').length + '개'],
    ['vor',    '항로(ENR) VOR', '#aed581', ENR_VORS.filter(v=>!v.apt).length + '개소'],
    ['aptvor', '비행장 VOR',    '#ffb74d', ENR_VORS.filter(_aptVorVisible).length + '개소'],
    ['loc',    '로컬라이저(LOC)', '#f06292',
      (typeof LOC_STATIONS !== 'undefined' ? LOC_STATIONS.length : 0) + '개소'],
  ];
  p.innerHTML = `<div class="aspc-grp" style="color:#8bc34a;">항로(AWY) 표시
      <div style="flex-shrink:0;"><span onclick="_awySetAll(true)">모두</span><span onclick="_awySetAll(false)">해제</span></div></div>` +
    rows.map(([k, nm, col, cnt]) =>
      `<label class="aspc-item"><input type="checkbox" ${awyCat[k] ? 'checked' : ''} onchange="toggleAwyCat('${k}')">
        <span style="color:${col};">■</span> ${nm} <span style="color:#666;font-size:8px;">${cnt}</span></label>`).join('');
}
function toggleAwyLayer() {   // AWY 버튼 → 카테고리 패널 열기/닫기
  const p = document.getElementById('awy-panel');
  const open = !p.classList.contains('open');
  p.classList.toggle('open', open);
  if (open) _awyRenderPanel();
  _awyUpdateBtn();
}
// 저장된 상태 복원
try { _drawAwyLayer(); _awyUpdateBtn(); } catch(e) { _swallow(e); }

// AIRSPACE_DB 는 js/data/airspace.js 로 분리했다(로드 순서상 이 파일보다 먼저 실행된다).

// ── 공역(Airspace) 오버레이 — 항목별 시현/미시현 ──
const _aspcColors={};
(function(){ const pal=['#26a69a','#ef5350','#42a5f5','#ffa726','#ab47bc','#66bb6a','#ec407a','#8d6e63','#78909c','#d4e157','#5c6bc0','#ff7043','#29b6f6','#9ccc65','#f06292','#ffca28','#26c6da','#7e57c2','#c0ca33','#8bc34a','#e57373'];
  let i=0; AIRSPACE_DB.forEach(a=>{ if(!(a.grp in _aspcColors)) _aspcColors[a.grp]=pal[i++%pal.length]; });})();
const _aspcLayers={};   // id -> [layers]
let aspcOn={};
try { aspcOn=JSON.parse(localStorage.getItem('aspcOn')||'{}'); } catch(e){ aspcOn={}; }

function _aspcDraw(item){
  _aspcClear(item.id);
  const color=_aspcColors[item.grp];
  const tip=`${item.grp} · ${item.name}`+(item.alt?`<br>${item.alt}`:'');
  const ls=[];
  // 모든 공역은 테두리만 그린다 — 내부를 채우면 그 위의 심볼(FIX·VOR·공항)을 터치할 수 없다.
  // 테두리 선 자체는 터치 가능하게 두어 공역 정보 툴팁을 유지한다.
  // 단 FIR·KADIZ는 경계선이 워낙 길어 다른 요소와 겹치므로 선까지 클릭 통과시킨다.
  const lineOnly = (item.grp === 'FIR' || item.grp === 'KADIZ');
  const style = { color, weight:1.5, opacity:0.9, fill:false, interactive: !lineOnly };
  let sh = null;
  if(item.poly)        sh = L.polygon(item.poly, style);
  else if(item.circle) sh = L.circle(item.circle.c, Object.assign({ radius:item.circle.r*1852 }, style));
  if(sh){
    if(!lineOnly) sh.bindTooltip(tip,{sticky:true});
    sh.addTo(leafMap); ls.push(sh);
  }
  _aspcLayers[item.id]=ls;
}
function _aspcClear(id){ (_aspcLayers[id]||[]).forEach(l=>{try{leafMap.removeLayer(l);}catch(e){ _swallow(e); }}); _aspcLayers[id]=[]; }
function _aspcSave(){ try{ localStorage.setItem('aspcOn',JSON.stringify(aspcOn)); }catch(e){ _swallow(e); } }
function toggleAspcItem(id){
  aspcOn[id]=!aspcOn[id];
  const item=AIRSPACE_DB.find(a=>a.id===id);
  if(aspcOn[id]&&item) _aspcDraw(item); else _aspcClear(id);
  _aspcSave(); _aspcUpdateBtn();
}
function _aspcGroupSet(grp,on){
  AIRSPACE_DB.filter(a=>a.grp===grp).forEach(a=>{
    aspcOn[a.id]=on;
    if(on)_aspcDraw(a); else _aspcClear(a.id);
    const cb=document.getElementById('aspc-cb-'+a.id); if(cb)cb.checked=on;
  });
  _aspcSave(); _aspcUpdateBtn();
  _aspcRenderPanel();   // 헤더 ON 카운트 갱신
}
function _aspcUpdateBtn(){
  const any=AIRSPACE_DB.some(a=>aspcOn[a.id]);
  document.getElementById('aspc-btn').classList.toggle('active',any||document.getElementById('aspc-panel').classList.contains('open'));
}
const _aspcOpen = {};   // 그룹 펼침 상태 (기본: 모두 접힘)
function _aspcToggleGrp(g){
  _aspcOpen[g] = !_aspcOpen[g];
  _aspcRenderPanel();
}
function _aspcRenderPanel(){
  const p=document.getElementById('aspc-panel');
  const grps=[]; AIRSPACE_DB.forEach(a=>{ if(!grps.includes(a.grp)) grps.push(a.grp); });
  let html='';
  grps.forEach(g=>{
    const col=_aspcColors[g];
    const open=!!_aspcOpen[g];
    const onCnt=AIRSPACE_DB.filter(a=>a.grp===g&&aspcOn[a.id]).length;
    html+=`<div class="aspc-grp" style="color:#fff;cursor:pointer;" onclick="_aspcToggleGrp('${g}')">
      <span style="border:none;background:none;padding:0;margin:0;color:#fff;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${open?'▼':'▶'} <span style="color:${col};">■</span> ${g}${onCnt?` <b style=\"color:#fff;\">(${onCnt})</b>`:''}</span>
      <div style="flex-shrink:0;" onclick="event.stopPropagation()"><span onclick="_aspcGroupSet('${g}',true)">모두</span><span onclick="_aspcGroupSet('${g}',false)">해제</span></div></div>`;
    if(open){
      AIRSPACE_DB.filter(a=>a.grp===g).forEach(a=>{
        html+=`<label class="aspc-item"><input type="checkbox" id="aspc-cb-${a.id}" ${aspcOn[a.id]?'checked':''} onchange="toggleAspcItem('${a.id}')">
          <span style="color:${col};">■</span> ${a.name}${a.alt?` <span style=\"color:#666;font-size:8px;\">${a.alt}</span>`:''}</label>`;
      });
    }
  });
  p.innerHTML=html;
}
function toggleAspcPanel(){
  const p=document.getElementById('aspc-panel');
  const open=!p.classList.contains('open');
  p.classList.toggle('open',open);
  if(open)_aspcRenderPanel();
  _aspcUpdateBtn();
}
// 저장된 표시 상태 복원
try { AIRSPACE_DB.forEach(a=>{ if(aspcOn[a.id]) _aspcDraw(a); }); _aspcUpdateBtn(); } catch(e){ _swallow(e); }

// ── Flight Plan IFR DB를 AIP ENR 데이터로 동기화 (항로·픽스 단일 소스) ──
(function syncIfrDbFromAip() {
  try {
    // ① 픽스: AIP 픽스 149개 + VOR id → IFR_FIXES 갱신/추가 (기존 오류 좌표 덮어씀)
    _enrFixList().forEach(f => { IFR_FIXES[f.name] = { lat: +f.lat.toFixed(5), lon: +f.lon.toFixed(5) }; });
    ENR_VORS.forEach(v => { IFR_FIXES[v.id] = { lat: v.lat, lon: v.lon }; });
    // ② 항로: 임시 항로망 전면 교체 → AIP ENR 3.1/3.2의 53개 항로
    Object.keys(IFR_AIRWAYS).forEach(k => delete IFR_AIRWAYS[k]);
    ENR_ROUTES.forEach(r => { IFR_AIRWAYS[r.route] = r.wps.map(w => w.n); });
    // ②-b 터미널 픽스 등록(항로 픽스에 없는 SID 전용 지점)
    Object.entries(TERMINAL_FIXES).forEach(([k,v]) => { if (!IFR_FIXES[k]) IFR_FIXES[k] = { lat:v[0], lon:v[1] }; });
    // ③ SID/STAR/APP 절차 경유점 좌표를 AIP 픽스와 동기화(이름 일치 시)
    Object.values(IFR_DB).forEach(ap => {
      ['sids', 'stars', 'approaches'].forEach(k => (ap[k] || []).forEach(proc => {
        (proc.wps || []).forEach(wp => {
          const f = IFR_FIXES[wp.ident];
          if (f) { wp.lat = f.lat; wp.lon = f.lon; }
        });
      }));
    });
  } catch(e) { console.warn('IFR DB 동기화 실패:', e); }
})();

let _notamLayers = [];
let _notamActive = false;

function toggleNotamLayer() {
  if (_notamActive) {
    _notamLayers.forEach(l => { try { leafMap.removeLayer(l); } catch(e){ _swallow(e); } });
    _notamLayers = [];
    _notamActive = false;
    document.getElementById('notam-btn').classList.remove('active');
  } else {
    document.getElementById('notamFileInput').click();
  }
}

function loadNotamFile(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const isKml = file.name.toLowerCase().endsWith('.kml');
    try {
      const features = isKml ? _parseKml(text) : _parseGpx2(text);
      _notamLayers.forEach(l => { try { leafMap.removeLayer(l); } catch(e){ _swallow(e); } });
      _notamLayers = [];
      features.forEach(f => {
        const popup = _notamPopupHtml(f.name, f.desc);
        const popupOpts = { maxWidth: 320 };
        let layer;
        if (f.type === 'point') {
          layer = L.circleMarker([f.lat, f.lon], {
            radius: 6, color: '#ff9800', fillColor: '#ff9800', fillOpacity: 0.8, weight: 2
          }).bindPopup(popup, popupOpts);
          layer.addTo(leafMap);
          _notamLayers.push(layer);
          // 폴리곤/다각형 영역 추가 (텍스트 좌표열 파싱)
          const notamText = f.name + '\n' + (f.desc || '');
          const polyCoords = _extractNotamPolygon(notamText);
          if (polyCoords) {
            const poly = L.polygon(polyCoords, {
              color: '#ff0000', weight: 0.5, opacity: 1, fill: false
            }).bindPopup(popup, popupOpts);
            poly.addTo(leafMap);
            _notamLayers.push(poly);
          } else {
            // 폴리곤 없으면 반경 원 표시
            const radiusM = _extractNotamRadius(notamText);
            if (radiusM) {
              const circle = L.circle([f.lat, f.lon], {
                radius: radiusM,
                color: '#ff0000', weight: 0.5, opacity: 1,
                fill: false
              }).bindPopup(popup, popupOpts);
              circle.addTo(leafMap);
              _notamLayers.push(circle);
            }
          }
        } else if (f.type === 'line') {
          layer = L.polyline(f.coords, { color: '#ff0000', weight: 0.5, opacity: 1 })
            .bindPopup(popup, popupOpts);
          layer.addTo(leafMap);
          _notamLayers.push(layer);
        } else if (f.type === 'polygon') {
          layer = L.polygon(f.coords, { color: '#ff0000', weight: 0.5, fill: false })
            .bindPopup(popup, popupOpts);
          layer.addTo(leafMap);
          _notamLayers.push(layer);
        }
      });
      if (_notamLayers.length === 0) {
        const hasPm = isKml ? _xmlAll(new DOMParser().parseFromString(text, 'application/xml'), 'Placemark').length : 0;
        const hasWpt = !isKml ? _xmlAll(new DOMParser().parseFromString(text, 'application/xml'), 'wpt').length + _xmlAll(new DOMParser().parseFromString(text, 'application/xml'), 'trkpt').length : 0;
        if (isKml && hasPm === 0)
          uiAlert('표시할 지형지물이 없습니다.\n\n이 KML 파일에 Placemark(위치/도형) 데이터가 없습니다.\nNOTAM 좌표 정보가 포함된 KML 파일을 사용해 주세요.');
        else if (!isKml && hasWpt === 0)
          uiAlert('표시할 지형지물이 없습니다.\n\n이 GPX 파일에 wpt/trkpt 데이터가 없습니다.');
        else
          uiAlert('표시할 지형지물이 없습니다.\n(좌표가 누락되었거나 지원하지 않는 형식입니다)');
        return;
      }
      _notamActive = true;
      document.getElementById('notam-btn').classList.add('active');
      const group = L.featureGroup(_notamLayers);
      leafMap.fitBounds(group.getBounds().pad(0.1));
    } catch(err) {
      uiAlert('파일 파싱 오류: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ── NOTAM 텍스트 좌표 파싱 ───────────────────────────────
// DMS 좌표 한 토큰을 십진도로 변환
// 지원: 3700N / 12700E / 370000N / 1270000E / N3700 / E12700 / N370000 / E1270000
function _parseDms(s) {
  s = s.trim().toUpperCase().replace(/\s/g,'');
  let m;
  // 접미사형: digits + 반구
  m = s.match(/^(\d{4,7})([NS])$/);
  if (m) {
    const d = m[1];
    const [deg, min, sec] = d.length >= 6
      ? [+d.slice(0,2), +d.slice(2,4), +d.slice(4,6)]
      : [+d.slice(0,2), +d.slice(2,4), 0];
    const v = deg + min/60 + sec/3600;
    return m[2]==='N' ? v : -v;
  }
  m = s.match(/^(\d{5,8})([EW])$/);
  if (m) {
    const d = m[1];
    const [deg, min, sec] = d.length >= 7
      ? [+d.slice(0,3), +d.slice(3,5), +d.slice(5,7)]
      : [+d.slice(0,3), +d.slice(3,5), 0];
    const v = deg + min/60 + sec/3600;
    return m[2]==='E' ? v : -v;
  }
  // 접두사형: 반구 + digits
  m = s.match(/^([NS])(\d{4,7})$/);
  if (m) {
    const d = m[2];
    const [deg, min, sec] = d.length >= 6
      ? [+d.slice(0,2), +d.slice(2,4), +d.slice(4,6)]
      : [+d.slice(0,2), +d.slice(2,4), 0];
    const v = deg + min/60 + sec/3600;
    return m[1]==='N' ? v : -v;
  }
  m = s.match(/^([EW])(\d{5,8})$/);
  if (m) {
    const d = m[2];
    const [deg, min, sec] = d.length >= 7
      ? [+d.slice(0,3), +d.slice(3,5), +d.slice(5,7)]
      : [+d.slice(0,3), +d.slice(3,5), 0];
    const v = deg + min/60 + sec/3600;
    return m[1]==='E' ? v : -v;
  }
  return null;
}

// NOTAM 설명 텍스트에서 위경도 쌍 목록을 추출 → 3점 이상이면 폴리곤 반환
// 한국 NOTAM E) 항목 형식 예:
//   370000N 1270000E - 370000N 1273000E - 373000N 1273000E - ...
//   N3700 E12700 TO N3730 E12730
function _extractNotamPolygon(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  const pairs = [];

  // 접미사형: DDMM(SS)N DDDMM(SS)E (공백 0~3개로 분리)
  const re1 = /(\d{4,7}[NS])[\s]{0,3}(\d{5,8}[EW])/g;
  let m;
  while ((m = re1.exec(t)) !== null) {
    const lat = _parseDms(m[1]), lon = _parseDms(m[2]);
    if (lat !== null && lon !== null) pairs.push([lat, lon]);
  }

  // 접두사형: N/SDDMM(SS) E/WDDDMM(SS)
  if (pairs.length === 0) {
    const re2 = /([NS]\d{4,7})[\s]{1,3}([EW]\d{5,8})/g;
    while ((m = re2.exec(t)) !== null) {
      const lat = _parseDms(m[1]), lon = _parseDms(m[2]);
      if (lat !== null && lon !== null) pairs.push([lat, lon]);
    }
  }

  if (pairs.length < 3) return null;

  // 첫 점과 마지막 점이 같으면(닫힌 링) 마지막 제거
  const [f, l] = [pairs[0], pairs[pairs.length-1]];
  if (Math.abs(f[0]-l[0]) < 0.0001 && Math.abs(f[1]-l[1]) < 0.0001) pairs.pop();

  return pairs.length >= 3 ? pairs : null;
}

// NOTAM 텍스트에서 반경(미터) 추출
// 우선순위: ① Q라인 좌표+반경 필드(가장 권위 있음) → ② 본문 자유 텍스트 패턴
function _extractNotamRadius(text) {
  if (!text) return null;
  const t = text.toUpperCase();

  // ① Q라인 마지막 필드: <lat><lon><radius>
  //    좌표 = DDMM[N/S]DDDMM[E/W] (초 단위 없음), 반경 = 3자리 NM
  const qm = t.match(/Q\)[^\n]*?(\d{4}[NS]\d{5}[EW])(\d{3})\b/);
  if (qm) {
    const r = parseInt(qm[2], 10);
    if (r > 0 && r < 1000) return r * 1852;   // 999NM 미만이면 유효
  }

  // ② 본문 자유 텍스트 — NM 단위
  const num = '(\\d+(?:\\.\\d+)?)';
  const nmPats = [
    new RegExp(`RADIUS\\s+OF\\s+${num}\\s*NM`),
    new RegExp(`RADIUS[:\\s]+${num}\\s*NM`),
    new RegExp(`${num}\\s*NM\\s+RADIUS`),
    new RegExp(`WITHIN\\s+(?:A\\s+)?${num}\\s*NM`),
    new RegExp(`${num}\\s*NM\\s+(?:OF|FROM)\\b`),
    new RegExp(`CIRCLE[^,\\n]*?${num}\\s*NM`),
    new RegExp(`반경\\s*${num}\\s*(?:NM|해리)`),
  ];
  for (const p of nmPats) {
    const m = t.match(p);
    if (m) return parseFloat(m[1]) * 1852;
  }

  // ③ 미터/킬로미터 단위 (드물지만 일부 NOTAM 사용)
  let m = t.match(new RegExp(`RADIUS[:\\s]+${num}\\s*KM`)) || t.match(new RegExp(`${num}\\s*KM\\s+RADIUS`));
  if (m) return parseFloat(m[1]) * 1000;
  m = t.match(new RegExp(`RADIUS[:\\s]+${num}\\s*M\\b`)) || t.match(new RegExp(`반경\\s*${num}\\s*(?:M|미터)\\b`));
  if (m) return parseFloat(m[1]);

  return null;
}

// NOTAM 팝업 HTML 생성
function _notamPopupHtml(name, desc) {
  const raw = (desc || '').trim();
  const interp = _interpretNotam(raw || name || '');
  let html = '<div style="max-height:220px;overflow-y:auto;font-size:11px;line-height:1.5">';
  if (name) html += `<div style="font-weight:bold;color:#ffcc00;margin-bottom:4px">${_escHtml(name)}</div>`;
  if (interp) {
    html += `<div style="background:rgba(0,60,120,0.7);border-radius:4px;padding:4px 6px;color:#a8d8ff;margin-bottom:5px">${interp.replace(/\n/g,'<br>')}</div>`;
  }
  if (raw) {
    html += `<div style="color:#ccc;white-space:pre-wrap;font-size:10px">${_escHtml(raw)}</div>`;
  }
  html += '</div>';
  return html;
}

function _escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// NOTAM 텍스트 자동 해석
function _interpretNotam(text) {
  if (!text) return '';
  const lines = [];
  // Q라인 파싱
  const qm = text.match(/Q\)\s*([^\n\r]+)/);
  if (qm) {
    const parts = qm[1].split('/');
    if (parts.length >= 2) {
      const subj = _notamSubject(parts[1] || '');
      if (subj) lines.push('종류: ' + subj);
    }
    if (parts.length >= 3) {
      const tr = { 'IV':'IFR+VFR', 'I':'IFR만', 'V':'VFR만', 'K':'체크리스트' };
      const tv = tr[(parts[2]||'').trim()];
      if (tv) lines.push('해당: ' + tv);
    }
    // 고도 범위 (하한/상한 FL — Q라인 6·7번째 필드)
    if (parts.length >= 7) {
      const lo = (parts[5]||'').trim(), hi = (parts[6]||'').trim();
      if (/^\d{3}$/.test(lo) && /^\d{3}$/.test(hi)) {
        const fl = v => v === '000' ? 'GND/SFC' : 'FL' + v;
        lines.push(`고도: ${fl(lo)} – ${hi==='999'?'무제한':fl(hi)}`);
      }
    }
  }
  // 시작/종료
  const bm = text.match(/B\)\s*(\d{10})/);
  const cm = text.match(/C\)\s*(\d{10}|PERM)/i);
  if (bm) lines.push('시작: ' + _fmtNotamDt(bm[1]));
  if (cm) lines.push('종료: ' + (cm[1].toUpperCase()==='PERM'?'영구':_fmtNotamDt(cm[1])));
  // E라인 (본문)
  const em = text.match(/E\)\s*([\s\S]+?)(?=\r?\n[A-Z]\)|$)/);
  if (em) {
    const body = em[1].trim();
    if (body) lines.push('내용: ' + body.substring(0, 300) + (body.length > 300 ? '…' : ''));
  }
  // 반경 정보 표시
  const rm = _extractNotamRadius(text);
  if (rm) lines.push(`반경: ${(rm/1852).toFixed(1)} NM (${Math.round(rm)} m)`);
  return lines.join('\n');
}

function _notamSubject(code) {
  const c = code.toUpperCase();
  const map = [
    ['QRTCA','임시비행제한구역(TFR)'], ['QRDCA','위험구역(D)'], ['QRPCA','금지구역(P)'],
    ['QRACA','제한구역(R)'], ['QWWXX','경고'], ['QLCAS','착륙구역 폐쇄'],
    ['QFAXX','공항 운영정보'], ['QNVAS','항법장비 운용 중단'],
    ['QOBCE','장애물 신설'], ['QOBCL','조명 장애물'],
    ['QPICH','PIC 주의'], ['QSPAH','공역 변경'],
  ];
  for (const [k, v] of map) if (c.includes(k)) return v;
  return code;
}

function _fmtNotamDt(s) {
  if (!s || s.length < 10) return s;
  return `20${s.slice(0,2)}-${s.slice(2,4)}-${s.slice(4,6)} ${s.slice(6,8)}:${s.slice(8,10)}Z`;
}

// ── 공통 GPX 헬퍼 ──────────────────────────────────────
// getElementsByTagName은 네임스페이스를 무시 → xmlns 선언된 KML/GPX에서도 동작
function _gpxLatLon(el) {
  return [parseFloat(el.getAttribute('lat')), parseFloat(el.getAttribute('lon'))];
}
// XML 조회는 네임스페이스 접두사(gpx:trkpt 등)와 무관하게 로컬명으로 찾는다.
// getElementsByTagName은 XML 문서에서 접두사까지 일치해야 하므로 기기·도구별
// 내보내기 형식에 따라 조회가 통째로 실패한다.
function _xmlAll(parent, tag) { return Array.from(parent.getElementsByTagNameNS('*', tag)); }
function _xml1(parent, tag)   { return parent.getElementsByTagNameNS('*', tag)[0] ?? null; }

function _parseGpx2(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const features = [];
  _xmlAll(doc, 'wpt').forEach(w => {
    const [lat, lon] = _gpxLatLon(w);
    features.push({ type: 'point', lat, lon,
      name: _xml1(w, 'name')?.textContent || '',
      desc: _xml1(w, 'desc')?.textContent || '' });
  });
  _xmlAll(doc, 'trk').forEach(trk => {
    const name = _xml1(trk, 'name')?.textContent || '';
    const desc = _xml1(trk, 'desc')?.textContent  || '';
    _xmlAll(trk, 'trkseg').forEach(seg => {
      const coords = _xmlAll(seg, 'trkpt').map(_gpxLatLon);
      if (coords.length > 1) features.push({ type: 'line', coords, name, desc });
    });
  });
  _xmlAll(doc, 'rte').forEach(rte => {
    const name = _xml1(rte, 'name')?.textContent || '';
    const desc = _xml1(rte, 'desc')?.textContent  || '';
    const coords = _xmlAll(rte, 'rtept').map(_gpxLatLon);
    if (coords.length > 1) features.push({ type: 'line', coords, name, desc });
  });
  return features;
}

function _parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const features = [];
  const parseCoordStr = s => s.trim().split(/\s+/).map(c => {
    const [lon, lat] = c.split(',').map(Number);
    return [lat, lon];
  }).filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));

  // Placemark 하나에서 도형 목록 추출 (MultiGeometry 포함)
  function extractGeoms(pm) {
    const geoms = [];
    // MultiGeometry 내 자식 도형들 재귀 처리
    const mgEl = _xml1(pm, 'MultiGeometry');
    if (mgEl) {
      _xmlAll(mgEl, 'Point').forEach(el => { const c = _xml1(el,'coordinates'); if(c) geoms.push({tag:'Point',el:c}); });
      _xmlAll(mgEl, 'LineString').forEach(el => { const c = _xml1(el,'coordinates'); if(c) geoms.push({tag:'LineString',el:c}); });
      _xmlAll(mgEl, 'Polygon').forEach(el => geoms.push({tag:'Polygon',el}));
      _xmlAll(mgEl, 'LinearRing').forEach(el => { const c = _xml1(el,'coordinates'); if(c) geoms.push({tag:'LinearRing',el:c}); });
      return geoms;
    }
    const ptEl = _xml1(pm, 'Point');
    if (ptEl) { const c = _xml1(ptEl,'coordinates'); if(c) geoms.push({tag:'Point',el:c}); return geoms; }
    const lsEl = _xml1(pm, 'LineString');
    if (lsEl) { const c = _xml1(lsEl,'coordinates'); if(c) geoms.push({tag:'LineString',el:c}); return geoms; }
    const pgEl = _xml1(pm, 'Polygon');
    if (pgEl) { geoms.push({tag:'Polygon',el:pgEl}); return geoms; }
    // LinearRing이 Placemark 바로 아래 있는 경우 (비표준이지만 일부 앱이 생성)
    const lrEl = _xml1(pm, 'LinearRing');
    if (lrEl) { const c = _xml1(lrEl,'coordinates'); if(c) geoms.push({tag:'LinearRing',el:c}); }
    return geoms;
  }

  _xmlAll(doc, 'Placemark').forEach(pm => {
    const name = _xml1(pm, 'name')?.textContent || '';
    const descEl = _xml1(pm, 'description');
    const desc   = descEl ? (descEl.textContent || '') : '';
    const extPairs = _xmlAll(pm, 'Data').map(d =>
      `${d.getAttribute('name')}: ${_xml1(d, 'value')?.textContent || ''}`).join('\n');
    const fullDesc = [desc, extPairs].filter(Boolean).join('\n');

    const geoms = extractGeoms(pm);
    geoms.forEach(g => {
      if (g.tag === 'Point') {
        const [lon, lat] = g.el.textContent.trim().split(',').map(Number);
        if (!isNaN(lat) && !isNaN(lon)) features.push({ type: 'point', lat, lon, name, desc: fullDesc });
      } else if (g.tag === 'LineString') {
        const coords = parseCoordStr(g.el.textContent);
        if (coords.length > 1) features.push({ type: 'line', coords, name, desc: fullDesc });
      } else if (g.tag === 'LinearRing') {
        const coords = parseCoordStr(g.el.textContent);
        if (coords.length > 2) features.push({ type: 'polygon', coords, name, desc: fullDesc });
      } else if (g.tag === 'Polygon') {
        const obEl = _xml1(g.el, 'outerBoundaryIs') || g.el;
        const lrEl = _xml1(obEl, 'LinearRing') || obEl;
        const cEl  = _xml1(lrEl, 'coordinates');
        if (cEl) {
          const coords = parseCoordStr(cEl.textContent);
          if (coords.length > 2) features.push({ type: 'polygon', coords, name, desc: fullDesc });
        }
      }
    });
  });
  return features;
}

function loadFdrFile(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('fdr-status').textContent = '파싱 중…';
  const reader = new FileReader();
  const isKml = /\.kml$/i.test(file.name);
  reader.onload = e => {
    try {
      _fdrRawTrack = isKml ? _parseFdrKml(e.target.result) : _parseFdrGpx(e.target.result);
      _fdrTrack    = _fdrInterpolate(_fdrRawTrack, 50);
      if (_fdrTrack.length < 2) {
        document.getElementById('fdr-status').textContent = '트랙 포인트 없음';
        return;
      }
      _fdrIdx = 0;
      _fdrShowTrackOnMap();
      document.getElementById('fdr-status').textContent = `✔ ${file.name}`;
      const info = document.getElementById('fdr-track-info');
      const totalSec = (_fdrTrack[_fdrTrack.length-1].timeMs - _fdrTrack[0].timeMs) / 1000;
      const hh = Math.floor(totalSec/3600), mm = Math.floor((totalSec%3600)/60), ss = Math.floor(totalSec%60);
      info.textContent = `${_fdrTrack.length}pt · ${hh?hh+'h ':''}${mm}m ${ss}s`;
      info.style.display = 'block';
      // show controls
      document.getElementById('fdr-controls').style.display = 'flex';
      document.getElementById('fdr-speed').style.display    = 'flex';
      document.getElementById('fdr-timeline').style.display = 'block';
      const slider = document.getElementById('fdr-slider');
      slider.max   = _fdrTrack.length - 1;
      slider.value = 0;
      _fdrRenderFrame(0);
    } catch(err) {
      document.getElementById('fdr-status').textContent = '파싱 오류: ' + err.message;
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function _parseFdrGpx(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror')[0];
  if (perr) throw new Error('GPX XML 형식 오류');
  // 트랙(trkpt)이 우선. 앱의 '트랙 저장소 → GPX 내보내기'는 rte/rtept로,
  // 일부 도구는 wpt만으로 내보내므로 순서대로 대체한다.
  let pts = _xmlAll(doc, 'trkpt');
  if (!pts.length) pts = _xmlAll(doc, 'rtept');
  if (!pts.length) pts = _xmlAll(doc, 'wpt');
  if (pts.length < 2) throw new Error('좌표점 없음 (trkpt·rtept·wpt 모두 2점 미만)');
  const track = [];
  let prevLat = null, prevLon = null, prevTimeMs = null;
  for (const pt of pts) {
    const [lat, lon] = _gpxLatLon(pt);
    const eleEl  = _xml1(pt, 'ele');
    const timeEl = _xml1(pt, 'time');
    const altM   = eleEl ? (parseFloat(eleEl.textContent) || 0) : 0;
    // 시간이 없거나 형식이 이상하면 1초 간격으로 채운다(NaN이 들어가면 재생이 멈춘다)
    let timeMs = timeEl ? new Date(timeEl.textContent).getTime() : NaN;
    if (!isFinite(timeMs)) timeMs = track.length * 1000;
    // Speed: distance from previous point / time delta
    let speedKt = 0;
    if (prevLat !== null) {
      const distNM  = distance(prevLat, prevLon, lat, lon);
      const dtH     = (timeMs - prevTimeMs) / 3600000;
      speedKt = dtH > 0 ? distNM / dtH : 0;
    }
    track.push({ lat, lon, altM, speedKt, timeMs });
    prevLat = lat; prevLon = lon; prevTimeMs = timeMs;
  }
  // 시간이 단조증가하지 않으면(모두 같거나 역행) index 기반으로 다시 부여
  let monotonic = true;
  for (let i = 1; i < track.length; i++) if (track[i].timeMs <= track[i-1].timeMs) { monotonic = false; break; }
  if (!monotonic) {
    track.forEach((t, i) => { t.timeMs = i * 1000; });
    let prev = null;
    for (const t of track) {
      if (prev) t.speedKt = distance(prev.lat, prev.lon, t.lat, t.lon) / ((t.timeMs - prev.timeMs) / 3600000);
      prev = t;
    }
  }
  // Smooth speed with simple 3-point average
  for (let i = 1; i < track.length - 1; i++) {
    track[i].speedKt = (track[i-1].speedKt + track[i].speedKt + track[i+1].speedKt) / 3;
  }
  return track;
}

// KML FDR 파서 — gx:Track(시간 포함) 우선, 없으면 LineString 좌표열 사용
function _parseFdrKml(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  // 네임스페이스(gx:) 무관하게 로컬명으로 조회
  const byLocal = local => Array.from(doc.getElementsByTagNameNS('*', local));
  const track = [];

  // ① gx:Track: <when> … <gx:coord>lon lat alt</gx:coord> 쌍
  const coords = byLocal('coord');
  const whens  = byLocal('when');
  if (coords.length) {
    for (let i = 0; i < coords.length; i++) {
      const p = coords[i].textContent.trim().split(/\s+/).map(Number); // lon lat alt
      if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) continue;
      const timeMs = whens[i] ? new Date(whens[i].textContent).getTime() : (track.length * 1000);
      track.push({ lat: p[1], lon: p[0], altM: p[2] || 0, speedKt: 0, timeMs });
    }
  }

  // ② LineString/coordinates 좌표열(시간 없음 → 1초 간격 부여)
  if (track.length < 2) {
    track.length = 0;
    const csNodes = byLocal('coordinates');
    for (const cs of csNodes) {
      const tokens = cs.textContent.trim().split(/\s+/);
      for (const tk of tokens) {
        const p = tk.split(',').map(Number); // lon,lat,alt
        if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) continue;
        track.push({ lat: p[1], lon: p[0], altM: p[2] || 0, speedKt: 0, timeMs: track.length * 1000 });
      }
      if (track.length >= 2) break;   // 첫 유효 트랙만 사용
    }
  }

  if (track.length < 2) throw new Error('KML 트랙 좌표 없음 (gx:Track 또는 LineString 필요)');

  // 시간이 없는(모두 0) 경우 index 기반 시간 부여 보정
  if (track[track.length - 1].timeMs <= track[0].timeMs) {
    track.forEach((t, i) => { t.timeMs = i * 1000; });
  }

  // 속도 계산 + 3점 평활(_parseFdrGpx와 동일)
  let prev = null;
  for (const t of track) {
    if (prev) {
      const distNM = distance(prev.lat, prev.lon, t.lat, t.lon);
      const dtH    = (t.timeMs - prev.timeMs) / 3600000;
      t.speedKt = dtH > 0 ? distNM / dtH : 0;
    }
    prev = t;
  }
  for (let i = 1; i < track.length - 1; i++) {
    track[i].speedKt = (track[i-1].speedKt + track[i].speedKt + track[i+1].speedKt) / 3;
  }
  return track;
}

// Linear interpolation between raw GPX points at stepMs intervals (default 500ms).
// Lat/lon use great-circle interpolation via destPoint; alt/speed are lerped linearly.
function _fdrInterpolate(raw, stepMs) {
  if (raw.length < 2) return raw;
  const out = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const a  = raw[i], b = raw[i + 1];
    const dt = b.timeMs - a.timeMs;
    if (dt <= 0) { out.push(a); continue; }
    // heading from a → b (used for all sub-points in this segment)
    const segHdg = bearing(a.lat, a.lon, b.lat, b.lon);
    const distNM = distance(a.lat, a.lon, b.lat, b.lon);
    const steps  = Math.max(1, Math.round(dt / stepMs));
    for (let s = 0; s < steps; s++) {
      const t   = s / steps;            // 0 … <1
      const p   = destPoint(a.lat, a.lon, segHdg, distNM * t);
      out.push({
        lat:     p[0],
        lon:     p[1],
        altM:    a.altM    + (b.altM    - a.altM)    * t,
        speedKt: a.speedKt + (b.speedKt - a.speedKt) * t,
        timeMs:  a.timeMs  + dt * t,
      });
    }
  }
  out.push(raw[raw.length - 1]); // always include the last original point
  return out;
}

function _fdrShowTrackOnMap() {
  // ── 2D Leaflet: full route preview + start marker ──
  if (_fdrLayer2d)  { leafMap.removeLayer(_fdrLayer2d);  _fdrLayer2d  = null; }
  if (_fdrMarker2d) { leafMap.removeLayer(_fdrMarker2d); _fdrMarker2d = null; }

  // Use original (non-interpolated) GPX points for the route preview line
  const src = _fdrRawTrack.length ? _fdrRawTrack : _fdrTrack;
  const latlngs = src.map(p => [p.lat, p.lon]);
  _fdrLayer2d  = L.polyline(latlngs, { color: '#ff8800', weight: 2.5, opacity: 0.9 }).addTo(leafMap);
  _fdrMarker2d = L.circleMarker([src[0].lat, src[0].lon],
    { radius: 7, color: '#ff8800', fillColor: '#ffaa00', fillOpacity: 1, weight: 2 }).addTo(leafMap);
  leafMap.fitBounds(_fdrLayer2d.getBounds(), { padding: [20, 20] });

  // ── 3D maplibre: draw now if loaded, otherwise queue for when it loads ──
  _fdrDraw3dTrackRoute();
}

// Draws (or redraws) the full GPX route preview on the 3D map.
// Called immediately if the map is ready, or deferred to the next 'load' event.
function _fdrDraw3dTrackRoute() {
  if (!_ml3d) return;                // 3D not open yet — _init3dMap will call this on load
  if (!_ml3d.loaded()) {
    _ml3d.once('load', _fdrDraw3dTrackRoute);
    return;
  }
  // Remove old layer/source if present
  if (_fdrLayer3d) {
    try { _ml3d.removeLayer('fdr-track'); } catch(e) { _swallow(e); }
    try { _ml3d.removeSource('fdr-track'); } catch(e) { _swallow(e); }
    _fdrLayer3d = false;
  }
  const src = _fdrRawTrack.length ? _fdrRawTrack : _fdrTrack;
  if (!src.length) return;
  const coords = src.map(p => [p.lon, p.lat]);
  _ml3d.addSource('fdr-track', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
  });
  _ml3d.addLayer({
    id: 'fdr-track', type: 'line', source: 'fdr-track',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ff8800', 'line-width': 2.5, 'line-opacity': 0.9 }
  }, _firstSymbolLayerId());
  _fdrLayer3d = true;
}

function _fdrRenderFrame(idx) {
  _fdrIdx = Math.max(0, Math.min(_fdrTrack.length - 1, idx));
  const p = _fdrTrack[_fdrIdx];

  // Update position marker on 2D map
  if (_fdrMarker2d) _fdrMarker2d.setLatLng([p.lat, p.lon]);

  // Calculate heading from next point (or previous if at end)
  let hdg = 0;
  if (_fdrIdx < _fdrTrack.length - 1) {
    hdg = bearing(p.lat, p.lon, _fdrTrack[_fdrIdx+1].lat, _fdrTrack[_fdrIdx+1].lon);
  } else if (_fdrIdx > 0) {
    hdg = bearing(_fdrTrack[_fdrIdx-1].lat, _fdrTrack[_fdrIdx-1].lon, p.lat, p.lon);
  }

  // Inject into sim state (replay mode — overrides physics)
  S.lat = p.lat;
  S.lon = p.lon;
  S.alt = p.altM * 3.28084;   // metres → feet
  S.spd = Math.round(p.speedKt);
  S.hdg = hdg;
  syncHdgBug();   // 리플레이 종료 후 옛 HDG bug로 선회하지 않도록

  // Accumulate trail so 2D/3D trail lines update during FDR replay
  const last = S.trail[S.trail.length - 1];
  if (!last || distance(last[0], last[1], S.lat, S.lon) > 0.001) {
    S.trail.push([S.lat, S.lon]);
    if (S.trail.length > 3000) S.trail.shift();
  }

  // Update map aircraft marker + follow (triggers _applyFollow for 3D follow mode)
  updateAcOnMap();
  _update3dTrail();
  drawPFD();

  // Update timeline slider
  document.getElementById('fdr-slider').value = _fdrIdx;
  // Time label
  const elapsed = (_fdrTrack[_fdrIdx].timeMs - _fdrTrack[0].timeMs) / 1000;
  const total   = (_fdrTrack[_fdrTrack.length-1].timeMs - _fdrTrack[0].timeMs) / 1000;
  document.getElementById('fdr-time-label').textContent =
    _fmtTime(elapsed) + ' / ' + _fmtTime(total);
}

function _fmtTime(sec) {
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
           : `${m}:${String(s).padStart(2,'0')}`;
}

// rAF-based playback loop: advances to the track point whose timeMs matches
// current elapsed wall-clock time × speed multiplier.
function _fdrRafLoop(wallNow) {
  if (!_fdrPlaying) return;

  const trackNow = _fdrTrackStart + (wallNow - _fdrWallStart) * _fdrSpeed;
  const last     = _fdrTrack[_fdrTrack.length - 1];

  if (trackNow >= last.timeMs) {
    _fdrRenderFrame(_fdrTrack.length - 1);
    fdrPause();
    return;
  }

  // Binary search for the correct index
  let lo = _fdrIdx, hi = _fdrTrack.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (_fdrTrack[mid].timeMs <= trackNow) lo = mid; else hi = mid;
  }
  if (lo !== _fdrIdx) {
    _fdrRenderFrame(lo);
  } else {
    // Index unchanged but 3D camera (follow/track-up) must update every frame
    if (_view3dOn && _ml3d && _ml3dReady && followMode) _applyFollow();
  }

  _fdrRafId = requestAnimationFrame(_fdrRafLoop);
}

function fdrPlay() {
  if (!_fdrTrack.length) return;
  if (_fdrIdx >= _fdrTrack.length - 1) _fdrIdx = 0;
  _fdrPlaying    = true;
  _fdrWallStart  = performance.now();
  _fdrTrackStart = _fdrTrack[_fdrIdx].timeMs;
  document.getElementById('fdr-play-btn').classList.add('active');
  if (_fdrRafId) cancelAnimationFrame(_fdrRafId);
  _fdrRafId = requestAnimationFrame(_fdrRafLoop);
}

function fdrPause() {
  _fdrPlaying = false;
  if (_fdrRafId) { cancelAnimationFrame(_fdrRafId); _fdrRafId = null; }
  document.getElementById('fdr-play-btn').classList.remove('active');
}

function fdrStop() {
  fdrPause();
  _fdrIdx = 0;
  S.trail = []; updateTrail();   // clear trail when rewinding to start
  if (_fdrTrack.length) _fdrRenderFrame(0);
}

function fdrSeek(val) {
  const idx = parseInt(val);
  const wasPlaying = _fdrPlaying;
  if (wasPlaying) {
    // cancel current loop, move index, restart from new position
    _fdrPlaying = false;
    if (_fdrRafId) { cancelAnimationFrame(_fdrRafId); _fdrRafId = null; }
  }
  _fdrRenderFrame(idx);
  if (wasPlaying) fdrPlay();
}

function fdrSetSpeed(val) {
  const wasPlaying = _fdrPlaying;
  if (wasPlaying) fdrPause();
  _fdrSpeed = parseFloat(val);
  if (wasPlaying) fdrPlay();
}


// ══════════════════════════════════════════════════════════════
//  주소 · 지명 검색 (지도 ＋ 메뉴)
//  찾은 자리를 그대로 웨이포인트로 넣는다.
//  자료는 OpenStreetMap Nominatim — 사용자가 검색을 누를 때만 한 번 부른다
//  (자동 완성처럼 글자마다 부르지 않는다). 같은 말은 다시 묻지 않게 담아 둔다.
//  ※ 항법용 자료가 아니다. 안내 문구를 패널에 함께 적어 둔다.
// ══════════════════════════════════════════════════════════════
const GEO_URL = 'https://nominatim.openstreetmap.org/search';
const _geoCache = new Map();

// "37.5665, 126.978" 처럼 좌표를 그대로 넣은 경우 — 검색 없이 그 자리로 간다
function geoParseLatLon(q) {
  const m = String(q || '').trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, detail: '좌표 입력', lat, lon };
}

// 검색 한 번. 결과는 [{name, detail, lat, lon}] 로 다듬어 돌려준다.
async function geoSearch(q) {
  const key = String(q || '').trim();
  if (!key) return [];
  const direct = geoParseLatLon(key);
  if (direct) return [direct];
  if (_geoCache.has(key)) return _geoCache.get(key);
  const url = `${GEO_URL}?format=jsonv2&limit=8&accept-language=ko&q=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const raw = await res.json();
  const list = (Array.isArray(raw) ? raw : []).map(r => {
    const full = String(r.display_name || '');
    return { name: (r.name && r.name.trim()) || full.split(',')[0] || full,
             detail: full, lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
  }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  _geoCache.set(key, list);
  return list;
}

let _geoResults = [];
function openGeoSearch() {
  const p = document.getElementById('geo-panel');
  if (!p) return;
  p.classList.add('open');
  const q = document.getElementById('geo-q');
  if (q) { try { q.focus(); q.select(); } catch (e) { _swallow(e); } }
}
function closeGeoSearch() {
  const p = document.getElementById('geo-panel');
  if (p) p.classList.remove('open');
}
function _geoMsg(txt, col) {
  const el = document.getElementById('geo-list');
  if (el) el.innerHTML = `<div id="geo-msg" style="color:${col || '#8a97a5'};">${txt}</div>`;
}
function _geoRender() {
  const el = document.getElementById('geo-list');
  if (!el) return;
  if (!_geoResults.length) { _geoMsg('찾은 곳이 없습니다. 다른 말로 찾아보십시오.'); return; }
  el.innerHTML = _geoResults.map((r, i) =>
    `<div class="geo-item" data-act="geoPick" data-arg='[${i}]'>` +
    `<b>${_geoEsc(r.name)}</b><span>${_geoEsc(r.detail)}</span>` +
    `<span style="color:#4a7a8a;">${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}</span></div>`).join('');
}
function _geoEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function runGeoSearch() {
  const q = (document.getElementById('geo-q') || {}).value || '';
  if (!q.trim()) { _geoMsg('찾을 주소나 지명을 넣으십시오.'); return; }
  _geoMsg('찾는 중…');
  try {
    _geoResults = await geoSearch(q);
    _geoRender();
  } catch (e) {
    _geoResults = [];
    _geoMsg('찾지 못했습니다 — 연결을 확인하십시오(오프라인에서는 검색이 안 됩니다).', '#ff8877');
  }
}
// 결과를 고르면 그 자리에 웨이포인트를 넣고 지도를 옮긴다
function geoPick(i) {
  const r = _geoResults[i];
  if (!r) return;
  const n = S.wps.filter(w => /^AD\d*$/.test(w.ident)).length + 1;
  pushWP({ ident: 'AD' + n, name: r.name, lat: r.lat, lon: r.lon });
  try { leafMap.setView([r.lat, r.lon], Math.max(leafMap.getZoom(), 12)); } catch (e) { _swallow(e); }
  closeGeoSearch();
  const btn = document.getElementById('pp-btn');
  if (btn) {
    btn.style.background = 'rgba(0,50,10,0.95)'; btn.style.borderColor = '#00ff88'; btn.style.color = '#00ff88';
    setTimeout(() => { btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }, 700);
  }
}
// 입력창에서 엔터로도 찾는다
(function initGeoSearch() {
  const q = document.getElementById('geo-q');
  if (!q) return;
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); runGeoSearch(); }
  });
})();
