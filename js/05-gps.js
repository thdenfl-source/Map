// ─────────────────────────────────────────────────────────────
// 05-gps.js — GPS 모드 · 위치 서비스
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// GPS MODE
// ══════════════════════════════════════════════════════
let gpsMode = false;
let gpsWatchId = null;

let lastGpsMs = 0;

function toggleGPS() {
  gpsMode ? stopGPS() : startGPS();
}

function startGPS() {
  if (!('geolocation' in navigator)) {
    showGpsError('이 기기에서 GPS를 사용할 수 없습니다');
    return;
  }
  // 보안 컨텍스트(HTTPS/localhost)가 아니면 브라우저가 위치를 차단함
  if (window.isSecureContext === false) {
    showGpsError('보안 연결(HTTPS)에서만 GPS 사용 가능');
    return;
  }
  // 이전 watch가 남아있으면 정리(중복 방지)
  if (gpsWatchId !== null) { try { navigator.geolocation.clearWatch(gpsWatchId); } catch(e){ _swallow(e); } gpsWatchId = null; }

  // 즉시 GPS 모드로 전환(시뮬레이션 물리와 충돌 방지) + '위치 확인 중' 표시
  gpsMode = true;
  lastGpsMs = 0;
  _gpsPrev = null;
  startDevOrientation();   // 저속(10kt 미만) 헤딩용 기기 나침반(권한은 이 제스처에서 요청)
  updateGpsBtn();
  const status = document.getElementById('gps-status');
  if (status) { status.style.display = 'block'; status.innerHTML = '📡 위치 확인 중…'; }

  // maximumAge 3초: OS가 최근 위치를 재사용하게 해 GPS 칩 부하·발열 완화
  const onPos = pos => {
    if (!gpsMode) return;          // 그 사이 GPS를 껐다면 무시
    lastGpsMs = Date.now();
    applyGPS(pos);
  };

  // ① 첫 위치는 one-shot으로 빠르게 획득(watch가 늦게 뜨는 문제 완화)
  //    첫 시도는 timeout을 둬서 권한 거부 시 즉시 안내(gpsError에서 code 1만 치명적 처리)
  navigator.geolocation.getCurrentPosition(
    onPos, gpsError,
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );

  // ② 이후 연속 갱신은 watch로(3초 스로틀)
  //    watch에는 timeout을 주지 않는다 — 신호가 잠깐 끊겨도 spurious TIMEOUT으로
  //    GPS가 꺼지지 않도록(신호가 돌아오면 자동 재개)
  gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      if (!gpsMode) return;
      const now = Date.now();
      if (now - lastGpsMs >= 3000) { lastGpsMs = now; applyGPS(pos); }
    },
    gpsError,
    { enableHighAccuracy: true, maximumAge: 3000 }
  );
}

function stopGPS() {
  if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  gpsMode = false;
  _gpsPrev = null;
  stopDevOrientation();
  updateGpsBtn();
  // Reset to simulation defaults
  S.spd = 80; S.hdg = 360; S.alt = 500;
  S.pit = pitchFromSpd(80); S.bnk = 0; bankTarget = 0; _rollRate = 0;
  syncHdgBug();
  rollApOn = true;
  S.running = false;
  updateFlyBtns();
}

let _gpsPrev = null;   // 직전 GPS 위치(속도·방위각 산출용)

// ── 기기 방향(나침반) — GPS 모드 저속(10kt 미만)용 헤딩 ──
let _devHdg = null, _devHdgBound = false, _devHdgLastApply = 0;
function _onDevOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
    h = e.webkitCompassHeading;                    // iOS: 진북 기준 시계방향
  } else if (e.absolute === true && e.alpha !== null && !isNaN(e.alpha)) {
    h = 360 - e.alpha;                             // 표준: alpha(반시계) → 방위
  }
  if (h === null) return;
  _devHdg = normA(h);
  // 저속에서는 GPS 갱신(3초)과 무관하게 헤딩을 즉시 반영(0.2초 스로틀)
  const now = Date.now();
  if (gpsMode && S.spd < 10 && now - _devHdgLastApply > 200) {
    _devHdgLastApply = now;
    S.hdg = _devHdg;
    bankTarget = 0; S.bnk = 0; _rollRate = 0; syncHdgBug();
  }
}
function startDevOrientation() {
  if (_devHdgBound) return;
  const bind = () => {
    window.addEventListener('deviceorientation', _onDevOrientation);
    _devHdgBound = true;
  };
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+: 사용자 제스처(GPS 버튼) 안에서 권한 요청
      DeviceOrientationEvent.requestPermission()
        .then(res => { if (res === 'granted') bind(); })
        .catch(() => {});
    } else {
      bind();
    }
  } catch(e) { _swallow(e); }
}
function stopDevOrientation() {
  if (_devHdgBound) { window.removeEventListener('deviceorientation', _onDevOrientation); _devHdgBound = false; }
  _devHdg = null;
}
// 발열 저감: 항적 헤딩 구간(≥12kt)에서는 나침반 이벤트 일시 해제,
// 저속(<8kt) 복귀 시 재바인딩(히스테리시스로 경계 떨림 방지)
function _devHdgAuto(spdKt) {
  if (!gpsMode || spdKt === null) return;
  if (spdKt >= 12 && _devHdgBound) {
    window.removeEventListener('deviceorientation', _onDevOrientation);
    _devHdgBound = false; _devHdg = null;
  } else if (spdKt < 8 && !_devHdgBound) {
    window.addEventListener('deviceorientation', _onDevOrientation);
    _devHdgBound = true;
  }
}

function applyGPS(pos) {
  const c = pos.coords;
  const nowMs = pos.timestamp || Date.now();
  const lat = c.latitude, lon = c.longitude;

  // ── 속도 ── 기기 제공값 우선, 없으면 이전 위치로부터 계산
  let spdKt = null;
  if (c.speed !== null && !isNaN(c.speed) && c.speed >= 0) {
    spdKt = c.speed * 1.94384;                       // m/s → kt
  } else if (_gpsPrev) {
    const dtH = (nowMs - _gpsPrev.ms) / 3600000;
    if (dtH > 0) spdKt = distance(_gpsPrev.lat, _gpsPrev.lon, lat, lon) / dtH;
  }
  if (spdKt !== null) {
    S.spd = Math.max(0, Math.round(spdKt));
    S.pit = pitchFromSpd(S.spd);
  }
  _devHdgAuto(spdKt);   // 속도에 따라 나침반 이벤트 자동 on/off(발열 저감)

  // ── 방위각 ──
  // 10kt 미만: 기기 방향(나침반) 사용 / 10kt 이상: 항적(track) 기준
  let hdg = null;
  if (spdKt !== null && spdKt < 10 && _devHdg !== null) {
    hdg = _devHdg;
  } else if (c.heading !== null && !isNaN(c.heading) && (c.speed == null || c.speed > 0.5)) {
    hdg = c.heading;                                  // GPS 항적(track)
  } else if (_gpsPrev) {
    const dNM = distance(_gpsPrev.lat, _gpsPrev.lon, lat, lon);
    if (dNM > 0.0027) hdg = bearing(_gpsPrev.lat, _gpsPrev.lon, lat, lon);  // ~5m 이상 이동
  }
  if (hdg === null && _devHdg !== null && (spdKt === null || spdKt < 10)) hdg = _devHdg;
  if (hdg !== null) {
    S.hdg = normA(hdg);
    bankTarget = 0; S.bnk = 0; _rollRate = 0; syncHdgBug();
  }

  // ── 고도 ── GPS 고도(m) → ft
  if (c.altitude !== null && !isNaN(c.altitude)) {
    S.alt = Math.max(0, Math.round(c.altitude * 3.28084));
  }

  S.lat = lat; S.lon = lon;
  _gpsPrev = { lat, lon, ms: nowMs };

  // Trail
  const last = S.trail[S.trail.length - 1];
  if (!last || distance(last[0], last[1], S.lat, S.lon) > 0.01) {
    S.trail.push([S.lat, S.lon]);
    if (S.trail.length > 600) S.trail.shift();
    updateTrail();
  }
  leafMap.setView([S.lat, S.lon]);
  updateAcOnMap();
  updateNav();
  // Status overlay (좌표 + 속도/고도/방위 요약)
  const acc = c.accuracy ? c.accuracy.toFixed(0) + 'm' : '--';
  // 좌표창 오른쪽에 한 줄로 표시(높이 통일)
  document.getElementById('gps-status').innerHTML =
    `● ${decToDMS(S.lat, true)} ${decToDMS(S.lon, false)} · ` +
    `${uSpd(S.spd)} · ${uAlt(S.alt)} · ${fmtA(toMag(S.hdg))}° · ±${acc}`;
}

function decToDMS(deg, isLat) {
  const abs = Math.abs(deg);
  let d = Math.floor(abs);
  const mTotal = (abs - d) * 60;
  let m = Math.floor(mTotal);
  let s = Math.round((mTotal - m) * 60);
  // 초를 반올림하면 60 이 될 수 있다. 올려 주지 않으면 126.8 이 126°47′60″ 로 나온다.
  if (s === 60) { s = 0; m++; }
  if (m === 60) { m = 0; d++; }
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
  return `${d}°${String(m).padStart(2,'0')}′${String(s).padStart(2,'0')}″${dir}`;
}

function showGpsError(msg) {
  const btn = document.getElementById('gps-btn');
  const status = document.getElementById('gps-status');
  btn.textContent = '⚠ GPS';
  btn.classList.remove('active');
  btn.style.borderColor = '#aa3322';
  btn.style.color = '#ff6655';
  status.style.display = 'block';
  status.style.borderColor = '#aa3322';
  status.style.color = '#ff7766';
  status.innerHTML = '⚠ ' + msg;
}

function gpsError(err) {
  // 권한 거부(code 1)만 치명적 → GPS 종료 후 안내
  if (err && err.code === 1) {
    showGpsError('위치 권한이 거부되었습니다<br>설정 → Safari(브라우저) → 위치 → 허용');
    stopGPS();
    return;
  }
  // 위치 불가(2)·시간 초과(3)는 일시적일 수 있음 → 감시는 유지하고 대기 안내만
  if (!gpsMode) return;
  const status = document.getElementById('gps-status');
  if (status) {
    status.style.display = 'block';
    status.style.borderColor = '';
    status.style.color = '';
    status.innerHTML = (err && err.code === 3)
      ? '📡 위치 신호 대기 중… (하늘이 트인 곳에서 더 잘 잡힙니다)'
      : '📡 위치 확인 중… (신호 불안정, 재시도)';
  }
}

function updateGpsBtn() {
  const btn = document.getElementById('gps-btn');
  const status = document.getElementById('gps-status');
  btn.style.borderColor = '';
  btn.style.color = '';
  status.style.borderColor = '';
  status.style.color = '';
  if (gpsMode) {
    btn.textContent = 'GPS';   // 글자는 그대로, 색상(.active)만 변경 → 버튼 높이 불변
    btn.classList.add('active');
    status.style.display = 'block';
  } else {
    btn.textContent = 'GPS';
    btn.classList.remove('active');
    status.style.display = 'none';
  }
}

// ── HDG-UP absolute-direction pan ──
// When HDG-UP is active, Leaflet dragging is disabled (toggleMapOrient).
// We handle panning manually: rotate the screen drag vector by the current heading
// so dragging right always shows content to the visual right (absolute, not heading-relative).
let _hdgPanState = null, _hdgPanMoved = false;
leafMap.getContainer().addEventListener('pointerdown', e => {
  if (!mapHdgUp) return;
  if (e.target.closest('.leaflet-marker-icon, .leaflet-control, .leaflet-popup')) return;
  _hdgPanState = { x: e.clientX, y: e.clientY };
  _hdgPanMoved = false;
  const onMove = ev => {
    if (!_hdgPanState) return;
    const dx = ev.clientX - _hdgPanState.x, dy = ev.clientY - _hdgPanState.y;
    _hdgPanState = { x: ev.clientX, y: ev.clientY };
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    _hdgPanMoved = true;
    // 화면 드래그 벡터를 heading 각도로 회전해 Leaflet 내부 좌표로 변환.
    // CSS rotate(-heading)의 역변환(+heading 회전)만 하면 된다 — 확대가 없으므로
    // 화면 1px 이 지도 1px 이다(종전에는 scale(1.42) 를 나눠 줘야 했다).
    // panBy에 음수 부호: 손가락이 닿은 지점의 지도 내용이 손가락을 따라오게 함.
    const θ = S.hdg * D2R;
    const dxL = dx * Math.cos(θ) - dy * Math.sin(θ);
    const dyL = dx * Math.sin(θ) + dy * Math.cos(θ);
    leafMap.panBy([-dxL, -dyL], { animate: false });
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', () => {
    _hdgPanState = null;
    document.removeEventListener('pointermove', onMove);
  }, { once: true });
});
// Suppress the map click event that fires after a pan drag
leafMap.getContainer().addEventListener('click', e => {
  if (_hdgPanMoved) { _hdgPanMoved = false; e.stopImmediatePropagation(); }
}, true);

let trailLine = L.polyline([],{color:'#00ff88',weight:1.5,opacity:0.65}).addTo(leafMap);
let shipTrail = [];
let shipTrailLine = L.polyline([],{color:'#ff3333',weight:1.5,opacity:0.65}).addTo(leafMap);
let routeLine = L.polyline([],{color:'#4488ff',weight:2,dashArray:'6 5',opacity:0.8}).addTo(leafMap);
// CRS 라인 색은 HSI BRG 색 체계와 통일: FMS=BRG2 초록, VOR/LOC=BRG1 파랑
let crsLine   = L.polyline([],{color:'#00cc44',weight:1.5,dashArray:'10 5',opacity:0.9}).addTo(leafMap);
let holdLine  = L.polyline([],{color:'#ffcc44',weight:2,opacity:0.9}).addTo(leafMap);
let vorCrsLine = L.polyline([],{color:'#44aaff',weight:1.5,dashArray:'10 5',opacity:0.9}).addTo(leafMap);

// ── 속도 벡터 (헤딩 방향 붉은 화살표, 1분 예상위치 길이·최대 130kt) ──
// 화살촉은 HSI 코스/BRG 니들과 같은 '채워진 삼각형' 스타일
let spdVecLine = L.polyline([], {color:'#ff1744', weight:2.5, opacity:0.95}).addTo(leafMap);
let spdVecHead = L.polygon([],  {color:'#ff1744', weight:1, fillColor:'#ff1744', fillOpacity:1, opacity:1}).addTo(leafMap);

// FDR 재생 여부 — 선언이 FDR 블록(아래쪽)에 있었는데 여기서 먼저 읽어
// 기동 중 TDZ 예외("Cannot access '_fdrPlaying' before initialization")가
// 조용히 삼켜지고 있었다. 첫 사용처보다 앞으로 옮겨 근본 원인을 없앤다.
let _fdrPlaying = false;

function updateSpeedVector() {
  // 1분 예상궤적: 선회 중(뱅크)에는 선회율+바람을 적분한 곡선,
  // 직진 시에는 기존처럼 직선. GPS/FDR 모드는 지상속도·트랙 그대로 직선.
  const simMode = !gpsMode && !_fdrPlaying;
  const airSpd = Math.min(Math.max(S.spd || 0, 0), 130);   // 130kt 상한
  const wEff = (simMode && typeof effectiveWindSpd === 'function') ? effectiveWindSpd() : 0;
  const wt = normA(windDir + 180) * D2R;
  const wN = wEff * Math.cos(wt), wE = wEff * Math.sin(wt);

  let pts, lastTrk, totalNM;
  if (simMode && (gspdOn || gspdCoasting)) {
    // ── GSPD: 호버 디스플레이의 전후(gspdActFwd)/좌우(gspdActLat) 벡터 그대로 ──
    // 물리 이동과 동일하게 기체좌표 → 지상좌표 변환(바람 미적용), 직선 1분 예측
    const ch = Math.cos(S.hdg * D2R), sh = Math.sin(S.hdg * D2R);
    const gsN = gspdActFwd * ch - gspdActLat * sh;
    const gsE = gspdActFwd * sh + gspdActLat * ch;
    const gs = Math.min(Math.hypot(gsN, gsE), 130);
    if (gs < 3) {   // 사실상 정지 → 숨김
      spdVecLine.setLatLngs([]);
      spdVecHead.setLatLngs([]);
      return;
    }
    lastTrk = normA(Math.atan2(gsE, gsN) / D2R);
    totalNM = gs / 60;
    pts = [[S.lat, S.lon], destPoint(S.lat, S.lon, lastTrk, totalNM)];
  } else {
    // 선회율(°/s): 시뮬 물리(협조선회)와 동일 — g·tan(bank)/V
    let turnRate = 0;
    if (simMode && Math.abs(S.bnk) > 2 && airSpd > 5) {
      const V_ms = Math.max(10, airSpd) * 0.5144;
      turnRate = 9.81 * Math.tan(S.bnk * D2R) / V_ms / D2R;
    }

    // 60초 적분(2초 스텝) — 직진이면 1스텝 직선과 동일
    const dt = 2, steps = 30;
    pts = [[S.lat, S.lon]];
    let lat = S.lat, lon = S.lon, hdg = S.hdg || 0;
    lastTrk = S.hdg || 0;
    for (let i = 0; i < steps; i++) {
      const vN = airSpd * Math.cos(hdg * D2R) + wN;
      const vE = airSpd * Math.sin(hdg * D2R) + wE;
      const gsI = Math.hypot(vN, vE);
      if (gsI > 0.5) {
        lastTrk = normA(Math.atan2(vE, vN) / D2R);
        const p = destPoint(lat, lon, lastTrk, gsI * dt / 3600);
        lat = p[0]; lon = p[1];
      }
      pts.push([lat, lon]);
      hdg = normA(hdg + turnRate * dt);
    }

    totalNM = airSpd / 60;
    if (totalNM * 60 < 3 && wEff < 3) {   // 사실상 정지 → 숨김
      spdVecLine.setLatLngs([]);
      spdVecHead.setLatLngs([]);
      return;
    }
  }

  // 화살촉(채워진 삼각형): 궤적 끝점, 마지막 진행방향 기준 (HSI 니들 스타일)
  const tip = pts[pts.length - 1];
  const headLen = Math.max(totalNM * 0.022, 0.007);
  const base = destPoint(tip[0], tip[1], normA(lastTrk + 180), headLen);
  const halfW = headLen * 0.45;
  const hb1 = destPoint(base[0], base[1], normA(lastTrk + 90), halfW);
  const hb2 = destPoint(base[0], base[1], normA(lastTrk - 90), halfW);
  spdVecHead.setLatLngs([tip, hb1, hb2]);
  pts[pts.length - 1] = base;   // 샤프트는 삼각형 밑변까지
  spdVecLine.setLatLngs(pts);
}

// ── TERRAIN CUT: 기수 기준 전방 10NM 지형 단면 ──
// 3D 지도와 동일한 Terrarium DEM 타일 사용 (elev = R*256+G+B/256-32768, m)
const _TC = { z: 11, tiles: {}, pend: {} };
function _tcElev(lat, lon) {
  const z = _TC.z, n = 1 << z;
  const xf = (lon + 180) / 360 * n;
  const latR = lat * Math.PI / 180;
  const yf = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
  const tx = Math.floor(xf), ty = Math.floor(yf);
  const key = z + '/' + tx + '/' + ty;
  const t = _TC.tiles[key];
  if (t === undefined) { _tcFetch(key, tx, ty); return null; }
  if (t === null) return null;
  const px = Math.min(255, Math.floor((xf - tx) * 256));
  const py = Math.min(255, Math.floor((yf - ty) * 256));
  const i = (py * 256 + px) * 4, d = t.data;
  return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;   // m
}
async function _tcFetch(key, x, y) {
  if (_TC.pend[key] || _TC.tiles[key] !== undefined) return;
  _TC.pend[key] = 1;
  try {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${_TC.z}/${x}/${y}.png`);
    if (!r.ok) throw 0;
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const cx = c.getContext('2d'); cx.drawImage(bmp, 0, 0);
    _TC.tiles[key] = cx.getImageData(0, 0, 256, 256);
  } catch(e) { _TC.tiles[key] = null; }
  delete _TC.pend[key];
}
// ── VNAV (수직항법) : 타깃 WP까지 거리 기준 입력 각도의 강하/상승선 ──
let vnavActive = false, vnavTgtAlt = 0, vnavAngle = -3;   // angle: 음수=강하
// FT_PER_NM 은 01-state.js 에 있다(DME 경사거리와 같은 값을 쓴다)
function vnavCalc() {
  if (!vnavActive) return null;
  if (S.awp < 0 || S.awp >= S.wps.length) return { err: '활성 웨이포인트(타깃) 없음' };
  const wp = S.wps[S.awp];
  // 경로 거리는 직선거리가 아니라 레그 방향 거리(along-track)를 쓴다.
  // 코스에서 벗어나 있으면 직선거리가 실제 남은 경로보다 길어 강하각이 어긋난다.
  const dDir = distance(S.lat, S.lon, wp.lat, wp.lon);        // NM (직선)
  let d = dDir;
  try {
    const _L = activeCourseLine();
    if (_L) {
      const _x = courseXtk(_L);
      d = Math.sqrt(Math.max(0, dDir * dDir - _x * _x));      // 레그 방향 성분
    }
  } catch(e) { _swallow(e); }
  // 웨이포인트에 VNAV 고도를 넣어 뒀으면 그것이 타깃이다(UTIL 의 전역값보다 우선).
  // 오프셋은 "지점보다 몇 NM 앞에서 그 고도에 닿는가" 이므로 남은 거리에서 뺀다.
  const tgtAlt = Number.isFinite(wp.vnavAlt) ? wp.vnavAlt : vnavTgtAlt;
  const ofs = Number.isFinite(wp.vnavOfs) ? Math.max(0, wp.vnavOfs) : 0;
  d = Math.max(0, d - ofs);
  const slope = Math.tan(Math.abs(vnavAngle) * D2R);
  const sign = vnavAngle < 0 ? 1 : -1;                        // 강하각이면 타깃보다 높은 곳이 경로
  const pathH = d * FT_PER_NM * slope * sign;                 // 타깃 대비 현재 거리에서의 경로 고도차
  const reqAlt = tgtAlt + pathH;                              // 현재 위치에서 경로상 고도
  const dev = S.alt - reqAlt;                                 // +면 경로 위(높음)
  const gs = Math.max(1, groundSpdKt());                      // 실제 지상속도
  const vs = -sign * gs * FT_PER_NM / 60 * slope;             // 유지 수직속도(ft/min)
  const todFromTgt = (S.alt - tgtAlt) / (FT_PER_NM * slope);   // 타깃에서 강하시작점까지 거리
  const todDist = d - todFromTgt;                             // 현재→강하시작(TOD)까지 남은 거리
  return { wp: wp.ident, d, reqAlt, dev, vs, todDist, tgtAlt, ang: vnavAngle, ofs };
}

// VNAV 강하 알림: TOD 10초 전 예고 + Begin Descent
let _vnavAlertState = '';   // '' | 'pre' | 'begin'
function vnavAlertCheck() {
  const el = document.getElementById('vnav-alert');
  if (!el) return;
  const vn = (vnavActive ? vnavCalc() : null);
  // 강하(각도<0)이고 비행 중일 때만
  if (!vn || vn.err || vnavAngle >= 0 || !(gpsMode || S.running)) {
    if (_vnavAlertState) { _vnavAlertState = ''; el.className = ''; el.textContent = ''; }
    return;
  }
  const gs = Math.max(1, groundSpdKt());
  const tToTod = vn.todDist / gs * 3600;   // TOD까지 초
  let st = '';
  if (vn.todDist <= 0.05 && vn.dev > 30) st = 'begin';        // TOD 도달·아직 경로 위 → 강하 시작
  else if (tToTod > 0 && tToTod <= 10 && vn.dev > 30) st = 'pre';   // 10초 전 예고
  if (st !== _vnavAlertState) {
    _vnavAlertState = st;
    if (st === 'pre')  { el.className = 'pre';   el.textContent = '▼ VNAV: 강하 시작 10초 전'; try { navigator.vibrate && navigator.vibrate(150); } catch(e) { _swallow(e); } }
    else if (st === 'begin') { el.className = 'begin'; el.textContent = '▼ BEGIN DESCENT — ' + Math.round(vn.vs) + ' fpm'; try { navigator.vibrate && navigator.vibrate([250,100,250]); } catch(e) { _swallow(e); } }
    else { el.className = ''; el.textContent = ''; }
  }
}
setInterval(() => { try { vnavAlertCheck(); } catch(e) { _swallow(e); } }, 1000);

// VNAV 리드아웃 HTML(실시간 갱신용) — UTIL VNAV 화면에서 재사용
function _vnavReadoutHtml() {
  let vn = null; try { vn = vnavCalc(); } catch(e) { _swallow(e); }
  if (!vnavActive) {
    return `<div style="color:#567;font-size:10px;padding:8px 4px;">타깃 고도와 각도(강하 −, 상승 +)를 입력하고 ENT 하세요. 활성 웨이포인트가 타깃입니다.</div>`;
  }
  if (vn && vn.err) {
    return `<div style="color:#e8a;font-size:11px;padding:8px 4px;">⚠ ${vn.err} — Flight Plan에서 웨이포인트를 활성화하세요.</div>`;
  }
  if (!vn) return '';
  const R = (l, v, c) => `<div style="display:flex;justify-content:space-between;padding:2.5px 6px;border-bottom:1px solid #12212c;">` +
    `<span style="color:#6a8494;font-size:9px;">${l}</span><span style="color:${c||'#dfeaf2'};font-size:12px;font-weight:bold;">${v}</span></div>`;
  const devC = Math.abs(vn.dev) < 100 ? '#4ade80' : (vn.dev > 0 ? '#ffd54f' : '#ff8a65');
  const devTxt = (vn.dev>=0?'+':'') + Math.round(vn.dev) + ' ft ' + (vn.dev>0?'(경로 위)':(vn.dev<0?'(경로 아래)':''));
  return `<div style="border:1px solid #223a4a;border-radius:6px;background:#08131c;padding:2px 6px;">` +
    R('타깃 WP', vn.wp, '#00e5ff') +
    R('타깃까지 거리', uDist(vn.d)) +
    R('경로상 요구고도(현재)', uAlt(vn.reqAlt), '#9fd0ff') +
    R('편차', devTxt, devC) +
    R('요구 수직속도', Math.round(vn.vs)+' fpm', '#ffb0ea') +
    R('TOD까지', (vn.todDist>0? uDist(vn.todDist)+' 후 강하' : '지금 강하'), '#facc15') +
    `</div>`;
}
// UTIL VNAV 화면이 열려 있으면 리드아웃을 1초마다 실시간 갱신(입력 포커스는 유지)
setInterval(() => {
  try {
    if (typeof currentMode !== 'undefined' && currentMode === 'UTIL' && typeof utilTab !== 'undefined' && utilTab === 'VNAV') {
      const el = document.getElementById('vnav-readout');
      if (el) el.innerHTML = _vnavReadoutHtml();
    }
  } catch(e) { _swallow(e); }
}, 1000);

function updateTerrainCut() {
  const cv = document.getElementById('tcut-canvas');
  if (!cv || cv.clientWidth === 0) return;   // 맵 페이지 숨김 상태 등
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  const N = 50, DIST = 20;   // 전방 20NM, 0.4NM 간격 샘플
  const elevs = []; let maxFt = 0, miss = 0;
  for (let i = 0; i <= N; i++) {
    const p = destPoint(S.lat, S.lon, S.hdg, DIST * i / N);
    const e = _tcElev(p[0], p[1]);
    if (e == null) miss++;
    const ft = e == null ? 0 : Math.max(0, e) * 3.28084;
    elevs.push(ft); if (ft > maxFt) maxFt = ft;
  }
  const acFt = S.alt || 0;
  // ── 항공기 고도 중심 표시: 현재고도를 화면 중앙(H/2)에 고정, 반경 VR(ft) 내 상대 표시 ──
  let _vn = null; try { _vn = vnavCalc(); } catch(e) { _swallow(e); }
  let maxDelta = 1000;
  for (let i = 0; i <= N; i++) { const dd = Math.abs(elevs[i] - acFt); if (dd > maxDelta) maxDelta = dd; }
  if (_vn && !_vn.err) maxDelta = Math.max(maxDelta, Math.min(Math.abs(_vn.tgtAlt - acFt), 6000));
  const VR = Math.min(maxDelta * 1.2, 9000);           // 화면 상/하 반경(ft)
  const Y = a => H / 2 - (a - acFt) / VR * (H / 2);    // 고도→y (acFt=중앙)
  g.fillStyle = '#06090d'; g.fillRect(0, 0, W, H);
  // 지형 세그먼트: 여유고도별 색(적: <100ft, 황: <500ft, 녹: 그 이상)
  for (let i = 0; i < N; i++) {
    const eMax = Math.max(elevs[i], elevs[i + 1]);
    const clr = acFt - eMax < 100 ? '#c62828' : (acFt - eMax < 500 ? '#c9a227' : '#4e6b3a');
    const x0 = W * i / N, x1 = W * (i + 1) / N;
    const y0 = Math.max(0, Math.min(H, Y(elevs[i])));
    const y1 = Math.max(0, Math.min(H, Y(elevs[i + 1])));
    g.fillStyle = clr;
    g.beginPath();
    g.moveTo(x0, H); g.lineTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x1, H);
    g.closePath(); g.fill();
  }
  // 항공기 고도선(중앙) + 심볼(좌측)
  const ay = H / 2;
  g.strokeStyle = '#00e5ff'; g.lineWidth = 1.5; g.setLineDash([6, 4]);
  g.beginPath(); g.moveTo(0, ay); g.lineTo(W, ay); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#00e5ff';
  g.beginPath(); g.moveTo(14, ay); g.lineTo(3, ay - 5); g.lineTo(3, ay + 5); g.closePath(); g.fill();
  // 거리 눈금·라벨
  g.font = 'bold 10px -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillStyle = '#7fa8c9'; g.strokeStyle = '#22303d'; g.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => { g.beginPath(); g.moveTo(W * f, H); g.lineTo(W * f, H - 6); g.stroke(); });
  g.textAlign = 'center';
  g.fillText('5', W * 0.25, H - 3); g.fillText('10NM', W * 0.5, H - 3); g.fillText('15', W * 0.75, H - 3);
  g.textAlign = 'right'; g.fillText('20NM', W - 3, H - 3);
  // 고도 라벨: 중앙(현재고도) + 상/하단(±VR)
  g.textAlign = 'left';
  g.fillStyle = '#00e5ff'; g.fillText(uAlt(acFt), 18, ay - 5);
  g.fillStyle = '#4a6274';
  g.fillText('+' + uAlt(VR), 4, 11);
  g.fillText('-' + uAlt(VR), 4, H - 16);
  g.textAlign = 'right'; g.fillStyle = '#e0c097'; g.fillText('MAX ' + uAlt(maxFt), W - 4, 11); g.textAlign = 'left';
  if (miss > N / 2) {
    g.fillStyle = '#889'; g.textAlign = 'center';
    g.fillText('지형 데이터 로딩 중…', W / 2, H / 2 + 16); g.textAlign = 'left';
  }
  // ── VNAV 강하/상승선(마젠타) : 현재→타깃 거리 기준 경로 ──
  try {
    const vn = _vn;
    if (vn && !vn.err) {
      const xt = W * Math.min(vn.d, DIST) / DIST;
      const yNow = Y(vn.reqAlt);
      const yTgt = Y(vn.tgtAlt);
      g.save();
      g.beginPath(); g.rect(0, 0, W, H); g.clip();
      g.strokeStyle = '#ff4dd2'; g.lineWidth = 2; g.setLineDash([]);
      g.beginPath(); g.moveTo(0, yNow); g.lineTo(xt, yTgt); g.stroke();
      g.restore();
      g.fillStyle = '#ff4dd2';
      g.beginPath(); g.arc(xt, Math.max(0, Math.min(H, yTgt)), 3.5, 0, Math.PI * 2); g.fill();
      if (vn.todDist > 0 && vn.todDist <= DIST) {
        const xi = W * vn.todDist / DIST, yi = ay;
        g.strokeStyle = '#ff4dd2'; g.lineWidth = 1; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(xi, yi); g.lineTo(xi, H); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#ff4dd2'; g.beginPath(); g.arc(xi, yi, 4, 0, Math.PI * 2); g.fill();
        g.font = 'bold 9px -apple-system, Segoe UI, Roboto, sans-serif';
        g.textAlign = 'center'; g.fillStyle = '#ff9de8'; g.fillText('TOD', xi, yi - 6); g.textAlign = 'left';
      }
      g.font = 'bold 10px -apple-system, Segoe UI, Roboto, sans-serif';
      g.textAlign = 'left'; g.fillStyle = '#ff9de8';
      const devTxt = (vn.dev >= 0 ? '+' : '') + Math.round(vn.dev);
      g.fillText(`VNAV ${vn.ang.toFixed(1)}°  Δ${devTxt}ft`, 4, H / 2 + 16);
    }
  } catch(e) { _swallow(e); }
  // 간이 TAWS: 전방 10NM 이내(샘플 절반)에 여유고도 100ft 미만 지형이 있으면 경고
  {
    let danger = false;
    // INHIBIT 시 경고 억제 (inhibTaws는 뒤에서 선언되므로 방어적 접근)
    let _inh = false; try { _inh = inhibTaws; } catch(e) { _swallow(e); }
    if (_inh) {
      const ta0 = document.getElementById('terrain-alert');
      if (ta0) ta0.classList.remove('on');
    } else {
    for (let i = 0; i < N / 2; i++) {
      if (acFt - Math.max(elevs[i], elevs[i + 1]) < 100 && Math.max(elevs[i], elevs[i+1]) > 0) { danger = true; break; }
    }
    const ta = document.getElementById('terrain-alert');
    if (ta) {
      const was = ta.classList.contains('on');
      ta.classList.toggle('on', danger);
      if (danger && !was) { try { navigator.vibrate && navigator.vibrate([300,100,300]); } catch(e) { _swallow(e); } }
    }
    }
  }
}
// 발열 저감: GPS 모드에서는 지형 단면을 4초 주기로 완화(시뮬은 1초 유지)
let _tcTick = 0;
setInterval(() => {
  _tcTick++;
  if (gpsMode && _tcTick % 4 !== 0) return;
  try { updateTerrainCut(); } catch(e) { _swallow(e); }
}, 1000);

// T-CUT 버튼: vertical situation(지형 단면) 패널 표시/숨김 토글.
// 지도 높이가 80%↔100%로 바뀌므로 Leaflet/3D 리사이즈 필수 —
// 리사이즈가 끝나야 십자마크(top:40%↔50%)와 getCenter() 좌표가 정확히 일치한다.
function toggleTcut() {
  const wrap = document.getElementById('map-wrap');
  const hidden = wrap.classList.toggle('tcut-off');
  document.getElementById('map-tcut-btn').classList.toggle('active', !hidden);
  setTimeout(() => {
    // T-CUT 은 #map 의 높이를 바꾼다(80%↔100%). 감싸는 상자는 그대로라
    // ResizeObserver 가 울지 않으므로 여기서 직접 다시 잰다.
    try { hdgUpResize(); } catch(e) { _swallow(e); }
    try { leafMap.invalidateSize(); } catch(e) { _swallow(e); }
    try { if (_ml3d) _ml3d.resize(); } catch(e) { _swallow(e); }
    try { updateCenterCoord(); } catch(e) { _swallow(e); }
    if (!hidden) { try { updateTerrainCut(); } catch(e) { _swallow(e); } }
  }, 60);
}
// 지도 영역이 80%로 바뀌었으므로 Leaflet 리사이즈 강제(초기 렌더 보정)
setTimeout(() => { try { leafMap.invalidateSize(); } catch(e) { _swallow(e); } try { updateTerrainCut(); } catch(e) { _swallow(e); } }, 300);

// ── BRG1/BRG2 베어링 라인 (HSI 사이드패널과 동일 소스·색) ──
//  BRG1(파랑): 항공기 → 선택 항법시설(VOR/ILS)
//  BRG2(초록): 항공기 → FMS 활성 웨이포인트
let brg1Line = L.polyline([],{color:'#44aaff',weight:2,opacity:0.85}).addTo(leafMap);
let brg2Line = L.polyline([],{color:'#00cc44',weight:2,opacity:0.85}).addTo(leafMap);

function _brgLabelMarker(color) {
  const icon = L.divIcon({
    html: `<div style="color:${color};font-size:9px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000,-1px -1px 2px #000;transform:translate(6px,-6px);"></div>`,
    iconSize: [0, 0], className: ''
  });
  return L.marker([0, 0], { icon, interactive: false }).addTo(leafMap);
}
function _setBrgLine(line, mkRef, show, tLat, tLon, tag, brg, dist, color) {
  if (!show || tLat == null) {
    line.setLatLngs([]);
    if (mkRef.mk) { leafMap.removeLayer(mkRef.mk); mkRef.mk = null; }
    return;
  }
  line.setLatLngs([[S.lat, S.lon], [tLat, tLon]]);
  if (!mkRef.mk) mkRef.mk = _brgLabelMarker(color);
  const midLat = (S.lat + tLat) / 2, midLon = (S.lon + tLon) / 2;
  mkRef.mk.setLatLng([midLat, midLon]);
  const el = mkRef.mk.getElement();
  if (el && el.firstChild) el.firstChild.textContent = `${tag} ${fmtA(toMag(brg))}° ${dist.toFixed(1)}NM`;
}
const _brg1Ref = { mk: null }, _brg2Ref = { mk: null };
function updateBrgLines() {
  // 지도 시현은 #1BDP·#2BDP 가 정한다 — 선과 이름표가 함께 켜지고 함께 꺼진다.
  // (BRG1·BRG2 버튼은 계기의 니들, 여기 토글은 지도에 그릴지 말지)
  // BRG1: 항법시설(VOR/ILS) — HSI BRG1 패널과 같은 국을 쓴다(brg1Station)
  const b1 = (brg1Visible && brg1LblOn) ? brg1Station() : null;
  _setBrgLine(brg1Line, _brg1Ref, !!b1, b1?.lat, b1?.lon, 'BRG1',
    b1 ? bearing(S.lat, S.lon, b1.lat, b1.lon) : 0,
    b1 ? dmeDist(b1.lat, b1.lon, b1.elev) : 0, '#44aaff');   // DME 는 경사거리
  // BRG2: FMS 활성 웨이포인트 — HSI BRG2 패널과 동일
  const wpOk = S.awp >= 0 && S.awp < S.wps.length;
  const wp = wpOk ? S.wps[S.awp] : null;
  _setBrgLine(brg2Line, _brg2Ref, brg2Visible && brg2LblOn && wpOk, wp?.lat, wp?.lon, 'BRG2',
    wp ? bearing(S.lat, S.lon, wp.lat, wp.lon) : 0,
    wp ? distance(S.lat, S.lon, wp.lat, wp.lon) : 0, '#00cc44');
}
let vorStationMarker = null;
let wpMarkers = [];

// 비행계획에 정의된 모든 홀딩 패턴을 지도에 그린다(무장 여부와 무관).
function updateHoldLine() {
  try {
    if (typeof holdLine === 'undefined' || !holdLine) return;
    const segs = [];
    S.wps.forEach(wp => { if (wp && wp.hold) segs.push(holdPatternLatLngs(wp, wp.hold)); });
    holdLine.setLatLngs(segs);
  } catch(e) { _swallow(e); }
}

function updateCrsLine() {
  updateHoldLine();
  if (navSrc !== 'FMS') {
    crsLine.setLatLngs([]);
    if (navLat === null) {
      vorCrsLine.setLatLngs([]);
      if (vorStationMarker) { leafMap.removeLayer(vorStationMarker); vorStationMarker = null; }
    } else {
      // CDI가 쓰는 대권과 같도록 다중선분으로(직선 2점이면 최대 0.2NM 어긋남)
      vorCrsLine.setLatLngs(_gcCourseLatLngs(activeCourseLine(), 150));
      if (vorStationMarker) { leafMap.removeLayer(vorStationMarker); vorStationMarker = null; }
      const stIcon = L.divIcon({
        html: `<div style="position:relative;">
          <div style="width:10px;height:10px;background:#44aaff;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.7);transform:rotate(45deg);"></div>
          <div style="position:absolute;left:13px;top:-3px;color:#44aaff;font-size:9px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;white-space:nowrap;text-shadow:1px 1px 2px #000;">${navSrc}${navIcao?':'+navIcao:''}</div>
        </div>`,
        iconSize:[10,10], iconAnchor:[5,5], className:''
      });
      vorStationMarker = L.marker([navLat, navLon], {icon: stIcon}).addTo(leafMap);
    }
  } else {
    vorCrsLine.setLatLngs([]);
    if (vorStationMarker) { leafMap.removeLayer(vorStationMarker); vorStationMarker = null; }
    const L = activeCourseLine();
    if (!L) { crsLine.setLatLngs([]); return; }
    crsLine.setLatLngs(_gcCourseLatLngs(L, 150));
  }
}

// 코스선을 대권 다중선분으로 만든다.
// Leaflet은 두 점을 머케이터 직선으로 잇기 때문에, 긴 구간을 두 점으로 그리면
// CDI가 쓰는 대권과 지도의 선이 어긋난다(150NM에서 최대 0.6NM).
function _gcCourseLatLngs(L, extNM) {
  // 아크 구간은 원호 그대로 그린다 — 나는 길과 그려진 길이 달라선 안 된다
  if (L.arc) {
    return arcPoints(L.from[0], L.from[1], L.to[0], L.to[1],
                     L.arc.clat, L.arc.clon, L.arc.dir, 64);
  }
  const b0 = bearing(L.from[0], L.from[1], L.to[0], L.to[1]);
  const dTot = distance(L.from[0], L.from[1], L.to[0], L.to[1]);
  // to 지점에서의 진행 방위(대권은 지점마다 방위가 달라진다)
  const bAt = bearing(destPoint(L.from[0], L.from[1], b0, Math.max(0, dTot - 0.5))[0],
                      destPoint(L.from[0], L.from[1], b0, Math.max(0, dTot - 0.5))[1],
                      L.to[0], L.to[1]);
  const pts = [];
  const STEP = 10;   // 10NM 간격 — 대권 곡률을 눈에 띄지 않게 따라감
  for (let d = -extNM; d < 0; d += STEP) {                       // to 이전(뒤쪽)
    const back = Math.min(dTot, -d);
    pts.push(destPoint(L.to[0], L.to[1], normA(bAt + 180), back));
  }
  pts.push([L.to[0], L.to[1]]);
  for (let d = STEP; d <= extNM; d += STEP) pts.push(destPoint(L.to[0], L.to[1], bAt, d));
  return pts;
}

function updateTrail(){
  trailLine.setLatLngs(S.trail.map(t=>[t[0],t[1]]));
  _update3dTrail();
}

// Returns the id of the first symbol layer (labels etc.) in the current style,
// so we can insert the trail layer just below it — rendered ON terrain tiles.
function _firstSymbolLayerId() {
  if (!_ml3d) return undefined;
  const layers = _ml3d.getStyle().layers;
  for (const l of layers) { if (l.type === 'symbol') return l.id; }
  return undefined; // insert at top if no symbols
}

function _update3dTrail() {
  if (!_ml3d || !_ml3d.loaded() || !_ml3d.getSource('ac-trail')) return;
  // Coordinates are [lon, lat] with NO altitude so maplibre drapes the
  // line flat on the terrain surface — matching the 2D Leaflet appearance.
  _ml3d.getSource('ac-trail').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: S.trail.map(t => [t[1], t[0]]) }
  });
}
function updateShipTrail(){ shipTrailLine.setLatLngs(shipTrail.map(t=>[t[0],t[1]])); }
// ── 1인칭 Follow Mode ────────────────────────────────────────────────────
// When active: 2D map centres on aircraft every frame;
//              3D map additionally tracks heading and scales zoom with altitude.
// Dragging is disabled while following (like HDG-UP) to avoid fighting snaps.
let followMode = false;

function toggleFollow() {
  followMode = !followMode;
  const btn = document.getElementById('follow-btn');
  btn.classList.toggle('active', followMode);
  try { updateCenterCoord(); } catch(e) { _swallow(e); }   // 좌표 기준(중앙↔항공기) 즉시 전환
  // 1인칭 모드에서는 중앙 십자마크 숨김(항공기 기준 좌표 표시 중)
  const ch = document.getElementById('map-crosshair');
  if (ch) ch.style.display = followMode ? 'none' : '';
  if (followMode) {
    // Disable Leaflet dragging while following
    leafMap.dragging.disable();
    _applyFollow();
  } else {
    // Re-enable Leaflet dragging unless HDG-UP also needs it disabled
    if (!mapHdgUp) leafMap.dragging.enable();
    // Clear any 3D camera padding so manual exploration recentres normally
    if (_ml3d) { try { _ml3d.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); } catch (e) { _swallow(e); } }
  }
}

// ── 지도 중앙(1인칭: 항공기 위치) 좌표 표시 ──
function updateCenterCoord() {
  const el = document.getElementById('center-coord');
  if (!el) return;
  let lat, lon, tag;
  if (followMode) { lat = S.lat; lon = S.lon; tag = '✈'; }   // 1인칭: 항공기 기준
  else { const c = leafMap.getCenter(); lat = c.lat; lon = c.lng; tag = '＋'; }
  el.textContent = `${tag} ${decToDMS(lat, true)} ${decToDMS(lon, false)}`;   // 북위·동경 1줄 표시
}
leafMap.on('move', updateCenterCoord);
try { updateCenterCoord(); } catch(e) { _swallow(e); }

// In 1인칭, place the aircraft a quarter of the way up from the bottom of the
// screen (vertical position ≈ 0.75 H from top) so the forward view is larger.
const FOLLOW_FWD_FRAC = 0.25; // fraction of screen height the aircraft sits above the bottom

// 3D 카메라 방위 — HDG↑ 면 기수 위로 맞춘다.
// 추종(1인칭)과는 별개다. 추종을 꺼 두고 지도를 손으로 옮겨 보는 중에도
// HDG↑ 는 살아 있어야 한다(2D 는 그렇게 동작한다). 중심·줌·틸트는 건드리지
// 않고 방위만 맞춘다 — 그래야 손으로 옮겨 둔 자리가 유지된다.
// N↑ 에서는 매 프레임 강제하지 않는다. 3D 는 손으로 돌려 볼 수 있는 화면이고,
// 매번 북쪽으로 되돌리면 그 조작을 빼앗는다. (N↑ 로 되돌리는 그 순간에만
// 한 번 북쪽으로 맞춘다 — toggleMapOrient 참고)
function _apply3dBearing() {
  if (!mapHdgUp || !_view3dOn || !_ml3d || !_ml3dReady) return;
  if (Math.abs(normAS(_ml3d.getBearing() - S.hdg)) < 0.3) return;
  _ml3d.easeTo({ bearing: S.hdg, duration: 0, easing: t => t });
}

// Called every frame from updateAcOnMap() to keep the view locked to the aircraft.
function _applyFollow() {
  if (!followMode) return;

  if (_view3dOn && _ml3d && _ml3dReady) {
    // ── 3D follow ──
    // Altitude-based zoom: camera feels proportional to S.alt each frame.
    // S.alt is in feet; 500 ft → zoom≈14, 10000 ft → zoom≈10.
    const altFt = Math.max(100, S.alt);
    const zoom  = Math.max(4, Math.min(16, 16 - Math.log2(altFt / 100)));
    // Aircraft should sit at 1/4 from the bottom (75% from top).
    // easeTo (duration:0) honours the offset param unlike jumpTo.
    // offset [x,y]: positive y shifts the focal point DOWN → aircraft moves DOWN.
    const H      = _ml3d.getContainer().clientHeight || 600;
    const offsetY = H * FOLLOW_FWD_FRAC; // 0.25 * H → aircraft at 75% from top
    const opt = {
      center:   [S.lon, S.lat],
      zoom,
      pitch:    _ml3dPitch,
      offset:   [0, offsetY],
      duration: 0,
      easing:   t => t
    };
    // 방위는 N↑/HDG↑ 버튼을 따른다 — 2D 와 같은 규칙이다. 종전에는 추종 중이면
    // N↑ 를 골라 놔도 3D 만 늘 기수 위로 돌아, 버튼이 3D 에서는 없는 것과 같았다.
    // N↑ 에서는 bearing 을 넣지 않는다(사용자가 손으로 돌려 둔 각도를 지운다).
    if (mapHdgUp) opt.bearing = S.hdg;
    _ml3d.easeTo(opt);
  } else {
    // ── 2D follow ──
    // Shift the map centre forward (along heading when HDG-UP, else north) so
    // the aircraft appears ~1/4 up from the bottom, showing more ahead.
    const z = leafMap.getZoom();
    const acP = leafMap.project([S.lat, S.lon], z);
    const ang = (mapHdgUp ? S.hdg : 0) * D2R;
    // HDG↑ 에서 지도 엘리먼트는 보이는 영역보다 크다(대각선 정사각형). 화면에서
    // 원하는 위치에 놓으려면 보이는 높이를 기준으로 계산해야 한다.
    const visH = (mapHdgUp && _hdgBox) ? _hdgBox.h : leafMap.getSize().y;
    const k = visH * FOLLOW_FWD_FRAC;
    const cP = L.point(acP.x + Math.sin(ang) * k, acP.y - Math.cos(ang) * k);
    leafMap.setView(leafMap.unproject(cP, z), z, { animate: false });
    // HDG-UP CSS rotation (rotate(-hdg)) is re-applied by updateAcOnMap below,
    // so the map already shows the aircraft heading at the top.
  }
}

let mapHdgUp = false;

// ── HDG↑ 에서 모서리를 채우는 방법 ──
// 종전에는 지도를 scale(1.42) 로 키워 덮었다. 그런데 그건 축척이 바뀌는 일이라
// 모드를 바꾸는 순간 지도가 확대돼 버렸고, 게다가 √2 배는 정사각형에서만 충분해서
// 세로로 긴 화면에서는 여전히 모서리에 검은 삼각형이 남았다.
//
// 크기로 덮는다. 보이는 영역의 대각선 길이를 한 변으로 하는 정사각형으로 #map 을
// 키우고 그 중심을 보이는 영역 중심에 맞추면, 어느 각도로 돌려도 모서리가 채워진다
// (정사각형은 회전해도 내접원이 그대로다). 축척은 그대로 — scale 을 쓰지 않는다.
let _hdgBox = null;   // { w, h } — 보이는 지도 영역(회전 전 크기)
function _hdgUpApplySize() {
  const el = document.getElementById('map');
  const wrap = document.getElementById('map-wrap');
  if (!el || !wrap) return;
  if (!mapHdgUp) {
    el.classList.remove('hdg-rot');
    el.style.width = el.style.height = el.style.left = el.style.top = '';
    _hdgBox = null;
    // 되돌릴 때도 반드시 알려야 한다. 이걸 빠뜨리면 Leaflet 은 커진 크기를
    // 그대로 기억한 채 계산해서, 1인칭(추종)이 항공기를 화면 밖에 놓는다.
    try { leafMap.invalidateSize({ animate: false }); } catch (e) { _swallow(e); }
    return;
  }
  // 보이는 크기는 회전을 걸기 전(=클래스가 없을 때)에 재야 한다
  if (!_hdgBox) {
    el.classList.remove('hdg-rot');
    el.style.width = el.style.height = el.style.left = el.style.top = '';
    _hdgBox = { w: el.clientWidth, h: el.clientHeight };
  }
  const { w, h } = _hdgBox;
  if (!w || !h) { _hdgBox = null; return; }
  const d = Math.ceil(Math.hypot(w, h));
  el.classList.add('hdg-rot');
  el.style.width = d + 'px';
  el.style.height = d + 'px';
  el.style.left = Math.round(w / 2 - d / 2) + 'px';
  el.style.top  = Math.round(h / 2 - d / 2) + 'px';
  // 줌 버튼 등은 커진 지도의 모서리로 밀려난다. 보이는 사각형 위로 되돌리고
  // 부모의 회전을 상쇄해 세워 둔다(둘의 중심이 같아 정확히 겹친다).
  const ctrl = wrap.querySelector('.leaflet-control-container');
  if (ctrl) {
    ctrl.style.position = 'absolute';
    ctrl.style.left = Math.round(d / 2 - w / 2) + 'px';
    ctrl.style.top  = Math.round(d / 2 - h / 2) + 'px';
    ctrl.style.width = w + 'px';
    ctrl.style.height = h + 'px';
    ctrl.style.transformOrigin = 'center center';
  }
  try { leafMap.invalidateSize({ animate: false }); } catch (e) { _swallow(e); }
}
// 화면이 바뀌면(분할↔전체, T-CUT 등) 다시 잰다
function hdgUpResize() {
  if (!mapHdgUp) return;
  _hdgBox = null;
  _hdgUpApplySize();
  updateAcOnMap();
}
try {
  new ResizeObserver(() => { try { hdgUpResize(); } catch (e) { _swallow(e); } })
    .observe(document.getElementById('map-wrap'));
} catch (e) { _swallow(e); }

function toggleMapOrient() {
  mapHdgUp = !mapHdgUp;
  const btn = document.getElementById('orient-btn');
  if (mapHdgUp) {
    btn.textContent = 'HDG↑'; btn.classList.add('hdg-up');
    leafMap.dragging.disable();
    _hdgUpApplySize();
    _apply3dBearing();          // 3D 도 즉시 기수 위로
  } else {
    btn.textContent = 'N↑'; btn.classList.remove('hdg-up');
    document.getElementById('map').style.transform = '';
    const ctrl = document.querySelector('.leaflet-control-container');
    if (ctrl) {
      ctrl.style.transform = '';
      ctrl.style.position = ctrl.style.left = ctrl.style.top = '';
      ctrl.style.width = ctrl.style.height = '';
    }
    _hdgUpApplySize();          // 크기·위치를 원래대로
    // 3D 는 N↑ 로 돌아오는 이 순간에만 북쪽으로 맞춘다(이후 손 조작은 그대로 둔다)
    try {
      if (_view3dOn && _ml3d && _ml3dReady)
        _ml3d.easeTo({ bearing: 0, duration: 250 });
    } catch (e) { _swallow(e); }
    // Only re-enable dragging if follow mode is also off
    if (!followMode) leafMap.dragging.enable();
  }
  updateAcOnMap();
}
// ── 레인지 링(거리·방위 링) ──
let rangeRingsOn = false, ringRadii = [5, 10];   // NM
try { rangeRingsOn = localStorage.getItem('rangeRingsOn') === '1'; } catch(e) { _swallow(e); }
let _ringLayer = null;
function _updateRangeRings() {
  if (_ringLayer) { leafMap.removeLayer(_ringLayer); _ringLayer = null; }
  if (!rangeRingsOn) return;
  const g = L.layerGroup();
  ringRadii.forEach(nm => {
    L.circle([S.lat, S.lon], { radius: nm * 1852, color: '#00e5ff', weight: 1, opacity: 0.6, fill: false, dashArray: '4 5', interactive: false }).addTo(g);
    const edge = destPoint(S.lat, S.lon, mapHdgUp ? S.hdg : 0, nm);   // 상단(기수/북) 라벨
    L.marker(edge, { interactive: false, icon: L.divIcon({ className: '', html: `<div style="color:#00e5ff;font-size:9px;font-weight:bold;text-shadow:1px 1px 2px #000;transform:translate(-50%,-50%);">${unitDist === 'km' ? (nm*1.852).toFixed(1)+'km' : nm+'NM'}</div>`, iconSize: [0,0] }) }).addTo(g);
  });
  // 방위 눈금(외곽 링에 30°마다)
  const rOut = ringRadii[ringRadii.length - 1];
  for (let b = 0; b < 360; b += 30) {
    const p = destPoint(S.lat, S.lon, b, rOut);
    L.circleMarker(p, { radius: 1.5, color: '#00e5ff', opacity: 0.5, fill: true, fillOpacity: 0.5, interactive: false }).addTo(g);
  }
  _ringLayer = g.addTo(leafMap);
}
function toggleRangeRings() {
  rangeRingsOn = !rangeRingsOn;
  try { localStorage.setItem('rangeRingsOn', rangeRingsOn ? '1' : '0'); } catch(e) { _swallow(e); }
  _ringLastLat = null;   // 즉시 갱신 강제
  _updateRangeRings();
}
// 매 프레임 재생성은 부담 → 이동/회전 시에만 재구성
let _ringLastLat = null, _ringLastLon = null, _ringLastHdg = null;
function _maybeUpdateRings() {
  if (!rangeRingsOn) { if (_ringLayer) { leafMap.removeLayer(_ringLayer); _ringLayer = null; } return; }
  const moved = _ringLastLat === null || !_ringLayer ||
    distance(_ringLastLat, _ringLastLon, S.lat, S.lon) > 0.02 ||
    (mapHdgUp && Math.abs((_ringLastHdg ?? 0) - S.hdg) > 1);
  if (!moved) return;
  _ringLastLat = S.lat; _ringLastLon = S.lon; _ringLastHdg = S.hdg;
  _updateRangeRings();
}

function updateAcOnMap(){
  if (!acDragging) {
    acMarker.setLatLng([S.lat,S.lon]);
    acMarker.setIcon(makeAircraftIcon(S.hdg));
    _bindAcPointerDown(); // re-bind after setIcon creates a new DOM element
  }
  _maybeUpdateRings();   // 레인지 링 위치 갱신(이동 시에만)
  updateSpeedVector();   // 헤딩 방향 속도 벡터(1분 예상위치) 갱신
  if (followMode) updateCenterCoord();   // 1인칭: 항공기 기준 좌표 갱신
  _update3dMarker();
  _applyFollow();    // 1인칭: centre map / 3D view on aircraft every frame
  _apply3dBearing(); // HDG↑: 3D 카메라도 기수 위로(추종을 꺼도 동작)
  if (mapHdgUp) {
    // 확대하지 않는다 — 크기(정사각형)로 모서리를 덮으므로 축척이 그대로다
    document.getElementById('map').style.transform = `rotate(${-S.hdg}deg)`;
    const ctrl = document.querySelector('.leaflet-control-container');
    if (ctrl) { ctrl.style.transformOrigin='center center'; ctrl.style.transform=`rotate(${S.hdg}deg)`; }
  }
}
function updateWpMarkers(){
  wpMarkers.forEach(m=>leafMap.removeLayer(m));
  wpMarkers=[];
  const coords=[];
  S.wps.forEach((wp,i)=>{
    const isA=i===S.awp;
    const bg=isA?'#ffaa00':'#3377dd';
    const icon=L.divIcon({
      html:`<div style="position:relative;">
        <div style="width:10px;height:10px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>
        <div style="position:absolute;left:12px;top:-2px;color:#fff;font-size:8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;white-space:nowrap;text-shadow:1px 1px 2px #000;">${wp.ident}</div>
      </div>`,
      iconSize:[10,10],iconAnchor:[5,5],className:'',
    });
    const m=L.marker([wp.lat,wp.lon],{icon}).addTo(leafMap);
    // 공항·VOR 처럼 설명창을 연다. 종전에는 누르는 즉시 활성 웨이포인트가 되어
    // 좌표를 확인할 방법도, 되돌릴 방법도 없었다(비행계획 목록과 같은 문제였다).
    m.bindPopup(() => _mapSymPopup({
      title: (isA ? '◉ ' : '● ') + (wp.ident || 'WPT'),
      color: isA ? '#c47a00' : '#1f5fa9',
      sub: `비행계획 ${i + 1}번째` + (isA ? ' · 활성' : '')
           + (wp.hold ? ' · HOLD' : '')
           + (Number.isFinite(wp.vnavAlt) ? ` · VNAV ${Math.round(wp.vnavAlt).toLocaleString()}ft` : ''),
      name: wp.ident || 'WPT', lat: wp.lat, lon: wp.lon,
      noAdd: true,
      extra: [{ label: 'ℹ 정보', onclick: `_mapOpenWpt(${i})`, bg: '#e8eefb', fg: '#1f5fa9' }],
    }), { maxWidth: 260 });
    wpMarkers.push(m);
    if (i > 0 && wp.arc) {
      const prev = S.wps[i - 1];
      arcPoints(prev.lat, prev.lon, wp.lat, wp.lon,
                wp.arc.clat, wp.arc.clon, wp.arc.dir, 48)
        .forEach(p => coords.push(p));
    } else {
      coords.push([wp.lat, wp.lon]);
    }
  });
  routeLine.setLatLngs(coords);
}


// ══════════════════════════════════════════════════════════════
// HOLD ENTRY — 홀딩 진입 판정 레이어
// ══════════════════════════════════════════════════════════════
// 홀딩 픽스에 다 와서 "직진이냐 평행이냐 눈물방울이냐"를 머릿속으로 그리는
// 일이 실기에서 제일 자주 틀리는 대목이다. 그 그림을 그대로 띄운다.
//
// 판정은 시뮬이 실제로 쓰는 _holdEntryType 하나만 쓴다. 그림을 위해 규칙을
// 다시 적으면 둘이 어긋나는 순간 그림이 거짓말을 하게 된다.
//
// 구역을 어느 각도에 칠하느냐 — 화면의 각 방향 θ 는 "픽스에서 본 방위",
// 즉 항공기가 어느 방향에서 들어오는가이고, 그것이 곧 판정 기준이다.
// 그래서 항공기 기호는 언제나 자기 진입 구역 안에 놓인다.
// 나침반은 자북 위쪽(°M) — 패널의 숫자와 눈금이 같은 기준이어야 읽힌다.
let holdEntryOn = false;

const HOLD_ENTRY_COLOR = {
  DIRECT:   { fill: 'rgba(196,110,42,0.32)',  line: '#e08a3c', label: 'DIRECT',   ko: '직진' },
  PARALLEL: { fill: 'rgba(38,132,80,0.32)',   line: '#3fbf7f', label: 'PARALLEL', ko: '평행' },
  TEARDROP: { fill: 'rgba(48,110,190,0.32)',  line: '#5aa7f0', label: 'TEARDROP', ko: '눈물방울' },
};

// 그릴 홀딩을 고른다 — 무장된 것이 먼저, 없으면 비행계획의 첫 홀딩.
// (아직 활성 웨이포인트가 아니어도 미리 보고 준비할 수 있어야 한다)
function _holdEntryTarget() {
  if (holdOn && holdFix) {
    return { fix: holdFix, right: holdRight, crs: holdCrs,
             legType: holdLegType, legVal: holdLegVal, armed: true };
  }
  const wp = (S.wps || []).find(w => w && w.hold);
  if (!wp) return null;
  const h = wp.hold;
  return { fix: { lat: wp.lat, lon: wp.lon, ident: wp.ident || 'WPT' },
           right: h.dir !== 'L', crs: h.crs,
           legType: h.legType === 'DIST' ? 'DIST' : 'TIME',
           legVal: h.legVal || (h.legType === 'DIST' ? 5 : 60), armed: false };
}

// 진입 구역의 경계를 _holdEntryType 에서 되읽는다(규칙을 베끼지 않는다).
// 반환: [{type, from, to}] — 진방위 기준, from→to 는 시계방향.
function holdEntrySectors(crs, right) {
  const at = θ => _holdEntryType(normA(θ + 180), crs, right);
  const runs = [];
  for (let θ = 0; θ < 360; θ += 0.5) {
    const t = at(θ);
    const last = runs[runs.length - 1];
    if (last && last.type === t) last.to = θ + 0.5;
    else runs.push({ type: t, from: θ, to: θ + 0.5 });
  }
  // 0° 를 걸쳐 이어지는 구역은 하나로 잇는다
  if (runs.length > 1 && runs[0].type === runs[runs.length - 1].type) {
    const first = runs.shift();
    runs[runs.length - 1].to = first.to + 360;
  }
  return runs;
}

function drawHoldEntry() {
  const wrap = document.getElementById('map-wrap');
  const cv = document.getElementById('hold-entry-canvas');
  if (!wrap || !cv || !wrap.classList.contains('hold-entry-on')) return;
  const info = document.getElementById('hold-entry-info');
  const T = _holdEntryTarget();
  const fixEl = document.getElementById('hold-entry-fix');

  const W = cv.clientWidth || 210, H = cv.clientHeight || 210;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  if (!T) {
    if (fixEl) fixEl.textContent = '—';
    g.fillStyle = '#4a5866';
    g.font = '10px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('설정된 홀딩이 없습니다', W / 2, H / 2 - 6);
    g.fillText('FPL → 웨이포인트 → HOLD', W / 2, H / 2 + 10);
    if (info) info.innerHTML = '비행계획의 웨이포인트에 홀딩을 넣으면 여기에 진입 구역이 그려집니다.';
    return;
  }

  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 12;
  const P = m => [cx + R * Math.sin(m * D2R), cy - R * Math.cos(m * D2R)];   // 자방위 → 원둘레
  const at = (m, r) => [cx + r * Math.sin(m * D2R), cy - r * Math.cos(m * D2R)];

  // ── 진입 구역 ──
  const sectors = holdEntrySectors(T.crs, T.right);
  sectors.forEach(s => {
    const c = HOLD_ENTRY_COLOR[s.type];
    if (!c) return;
    // 캔버스 각은 3시 방향 0°·시계방향. 자방위 m 은 12시 0° 이므로 m − 90.
    const a0 = (toMag(s.from) - 90) * D2R, a1 = a0 + (s.to - s.from) * D2R;
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath();
    g.fillStyle = c.fill; g.fill();
    g.strokeStyle = c.line; g.lineWidth = 1; g.stroke();
  });
  // 구역 이름 — 부채꼴 한가운데
  g.font = 'bold 9px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  sectors.forEach(s => {
    const c = HOLD_ENTRY_COLOR[s.type];
    if (!c) return;
    const [lx, ly] = at(toMag((s.from + s.to) / 2), R * 0.7);
    // 밑에 부채꼴·눈금·패턴이 깔려 있어 글자만 얹으면 읽히지 않는다
    g.lineWidth = 3; g.strokeStyle = 'rgba(6,10,14,0.85)';
    g.strokeText(c.label, lx, ly);
    g.fillStyle = c.line;
    g.fillText(c.label, lx, ly);
  });

  // ── 나침반 눈금 ──
  g.strokeStyle = '#3d4a58'; g.lineWidth = 1;
  for (let m = 0; m < 360; m += 10) {
    const long = m % 30 === 0;
    const [x0, y0] = at(m, R), [x1, y1] = at(m, R - (long ? 8 : 4));
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.fillStyle = '#8fa6bb'; g.font = '8px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif';
  for (let m = 0; m < 360; m += 30) {
    const [lx, ly] = at(m, R - 16);
    g.fillText(m === 0 ? 'N' : String(m / 10).padStart(2, '0'), lx, ly);
  }

  // ── 홀딩 패턴 ──
  // 픽스에서 본 방위·거리로 놓는다. 부채꼴·눈금·기준선과 같은 at() 을 쓰므로
  // 인바운드 레그가 기준선 위에 정확히 얹힌다. (종전에는 좌표 오프셋을 편차만큼
  // 직접 돌렸는데 방향이 반대라 패턴만 18° 어긋나 있었다 — 각도 변환을 두 벌
  // 두면 이런 일이 난다)
  const pts = holdPatternLatLngs(T.fix, { dir: T.right ? 'R' : 'L', crs: T.crs,
                                          legType: T.legType, legVal: T.legVal });
  const pol = pts.map(p => ({ m: toMag(bearing(T.fix.lat, T.fix.lon, p[0], p[1])),
                              d: distance(T.fix.lat, T.fix.lon, p[0], p[1]) }));
  let ext = 0.5;
  pol.forEach(q => { ext = Math.max(ext, q.d); });
  const pxPerNM = (R * 0.62) / ext;
  g.beginPath();
  pol.forEach((q, i) => {
    const [x, y] = at(q.m, q.d * pxPerNM);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = '#d0d6dd'; g.lineWidth = 1.6; g.stroke();

  // ── 인바운드 코스 기준선 ──
  // 구역은 이 선에서 각도를 재어 나눈다. 종전에는 픽스로 들어오는 쪽(반대편)
  // 반쪽만 그려서, 정작 평행·눈물방울을 가르는 연장선 쪽에는 아무 선이 없었다.
  // 눈에 띄는 선이 기준이 아닌 쪽에 있으니 거꾸로 읽기 딱 좋았다.
  // 지도의 홀딩 인바운드 연장선처럼 픽스를 지나 반대편까지 긋는다.
  const inbM = toMag(T.crs);
  const [hx, hy] = at(normA(inbM + 180), R);   // 인바운드 레그가 들어오는 쪽
  const [ex, ey] = at(inbM, R);                // 픽스 너머 — 연장선
  g.strokeStyle = '#ffd54f'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(cx, cy); g.stroke();
  g.setLineDash([5, 4]);
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
  g.setLineDash([]);
  // 픽스로 향하는 방향 화살표 — 어느 쪽이 인바운드인지 선만으로는 모른다
  const [px, py] = at(normA(inbM + 180), R * 0.45);
  g.save(); g.translate(px, py); g.rotate(inbM * D2R);
  g.fillStyle = '#ffd54f';
  g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 4); g.lineTo(-4, 4); g.closePath(); g.fill();
  g.restore();
  // 기준선 각도 — 연장선 끝에 적는다(구역 경계가 이 각도다)
  g.font = 'bold 8px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // 항공기가 연장선 위로 들어오면 글자와 겹치므로 선에서 살짝 비켜 놓는다
  const [qx0, qy0] = at(inbM, R * 0.86);
  const qx = qx0 + 9 * Math.sin((inbM + 90) * D2R), qy = qy0 - 9 * Math.cos((inbM + 90) * D2R);
  g.lineWidth = 3; g.strokeStyle = 'rgba(6,10,14,0.85)';
  g.strokeText(fmtA(inbM), qx, qy);
  g.fillStyle = '#ffd54f'; g.fillText(fmtA(inbM), qx, qy);

  // ── 픽스 ──
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(cx, cy, 3, 0, 2 * Math.PI); g.fill();

  // ── 항공기 — 픽스에서 본 실제 방위·거리에 놓는다 ──
  const brgT = bearing(T.fix.lat, T.fix.lon, S.lat, S.lon);   // 픽스 → 항공기
  const dist = distance(S.lat, S.lon, T.fix.lat, T.fix.lon);
  const apprT = normA(brgT + 180);                            // 픽스로 향하는 접근방향
  const entry = _holdEntryType(apprT, T.crs, T.right);
  const rAc = Math.min(R * 0.9, Math.max(6, dist * pxPerNM));
  const [ax, ay] = at(toMag(brgT), rAc);
  g.save();
  g.translate(ax, ay); g.rotate(toMag(apprT) * D2R);
  g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath();
  g.fill(); g.stroke();
  g.restore();
  // 접근방향 화살(항공기 → 픽스)
  const ec = HOLD_ENTRY_COLOR[entry];
  g.strokeStyle = ec ? ec.line : '#fff'; g.lineWidth = 2;
  g.setLineDash([4, 3]);
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(cx, cy); g.stroke();
  g.setLineDash([]);

  // ── 글자 ──
  if (fixEl) fixEl.textContent = (T.fix.ident || 'WPT') + (T.armed ? '' : ' (예정)');
  if (info) {
    const outHdg = fmtA(toMag(windCorrectedHdg(normA(T.crs + 180))));
    const inHdg  = fmtA(toMag(windCorrectedHdg(T.crs)));
    const leg = T.legType === 'DIST' ? T.legVal + ' NM'
              : (T.legVal >= 60 ? (T.legVal / 60) + ':' + String(T.legVal % 60).padStart(2, '0')
                                : T.legVal + 's');
    info.innerHTML =
      `<div style="color:${ec ? ec.line : '#fff'};font-weight:bold;font-size:12px;">` +
      `${ec ? ec.label : entry} <span style="font-size:9px;">${ec ? ec.ko : ''} 진입</span></div>` +
      `픽스 기준 <b>${fmtA(toMag(brgT))}°M</b> 에서 접근 · <b>${uDist(dist)}</b><br>` +
      `<span style="color:#67788a;">기수 ${fmtA(toMag(apprT))}°</span> · ` +
      `인바운드 <b>${fmtA(inbM)}°M</b> · ${T.right ? '우선회' : '좌선회'} · 레그 ${leg}<br>` +
      `<span style="color:#67788a;">바람 보정 기수 — 인바운드 ${inHdg}° / 아웃바운드 ${outHdg}°</span>`;
  }
}

// HOLD 버튼 — 진입 판정 레이어 표시/숨김
function toggleHoldEntry() {
  const wrap = document.getElementById('map-wrap');
  if (!wrap) return;
  if (!holdEntryOn && !_holdEntryTarget()) {
    uiToast('설정된 홀딩이 없습니다 — FPL 에서 웨이포인트를 골라 HOLD 를 넣어 주세요.', 'warn');
    return;
  }
  holdEntryOn = wrap.classList.toggle('hold-entry-on');
  const b = document.getElementById('map-hold-btn');
  if (b) b.classList.toggle('active', holdEntryOn);
  if (holdEntryOn) { try { drawHoldEntry(); } catch (e) { _swallow(e); } }
}

// 항공기가 움직이는 동안 계속 다시 그린다(꺼져 있으면 첫 줄에서 곧장 빠진다)
setInterval(() => { try { drawHoldEntry(); } catch (e) { _swallow(e); } }, 400);
