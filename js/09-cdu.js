// ─────────────────────────────────────────────────────────────
// 09-cdu.js — CDU (세션 복원 · 각 화면 · 액션 위임)
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  세션 상태 지속/복원 — 화면 꺼짐·앱 전환으로 탭이 자동 리로드돼도
//  마지막 상태를 그대로 복원한다. (모바일 브라우저는 백그라운드에서 JS를
//  계속 돌릴 수 없으므로, "리로드 후 즉시 복원"으로 연속성을 확보)
//  ⟳ 새로고침 버튼(hardReload)만 세션을 지워 초기 상태로 시작한다.
// ═══════════════════════════════════════════════════════════════
const SESSION_KEY = 'flightSession';
const SESSION_TTL = 6 * 3600 * 1000;   // 6시간 이내 스냅샷만 복원

function saveSession() {
  try {
    const snap = {
      v: 1, ts: Date.now(),
      s: { lat:S.lat, lon:S.lon, hdg:S.hdg, spd:S.spd, alt:S.alt, pit:S.pit, bnk:S.bnk,
           crs:S.crs, vs:S.vs, running:S.running, wps:S.wps, awp:S.awp, fwp:S.fwp },
      gps: gpsMode,
      fcp: { selSpd, selAlt, selCrht, selVS, selHdg, hdgSelOn, altHoldOn, crhtOn, gspdOn, rollApOn, bankTarget,
             gspdActLat, gspdActFwd, gspdRefLat, gspdRefFwd, gspdCoasting },
      nav: { obsOn, navSrc, navRadios, vorObsCrs },
      view: { mapHdgUp, followMode, leftSel, midSel, rightSel, tripleMode },
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
  } catch(e) { _swallow(e); }
}

function restoreSession() {
  let snap = null;
  try { snap = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch(e) { _swallow(e); }
  if (!snap || snap.v !== 1 || (Date.now() - snap.ts) > SESSION_TTL) return false;
  try {
    const s = snap.s || {};
    Object.assign(S, {
      lat:s.lat, lon:s.lon, hdg:s.hdg, spd:s.spd, alt:s.alt, pit:s.pit, bnk:s.bnk,
      crs:s.crs, vs:s.vs, running:!!s.running, lastT:null,
      wps:Array.isArray(s.wps)?s.wps:[], awp:s.awp??-1, fwp:s.fwp??-1,
    });
    const f = snap.fcp || {};
    if (f.selSpd!=null) selSpd=f.selSpd; if (f.selAlt!=null) selAlt=f.selAlt;
    if (f.selCrht!=null) selCrht=f.selCrht; if (f.selVS!=null) selVS=f.selVS; if (f.selHdg!=null) selHdg=f.selHdg; if (f.hdgSelOn!=null) hdgSelOn=f.hdgSelOn;
    altHoldOn=!!f.altHoldOn; crhtOn=!!f.crhtOn; gspdOn=!!f.gspdOn; rollApOn=f.rollApOn!==false;
    bankTarget=f.bankTarget||0;
    gspdActLat=f.gspdActLat||0; gspdActFwd=f.gspdActFwd||0;
    gspdRefLat=(f.gspdRefLat===undefined?null:f.gspdRefLat); gspdRefFwd=(f.gspdRefFwd===undefined?null:f.gspdRefFwd);
    gspdCoasting=!!f.gspdCoasting;
    const n = snap.nav || {};
    obsOn=!!n.obsOn; navSrc=n.navSrc||'FMS'; vorObsCrs=n.vorObsCrs??360;
    if (n.navRadios) { try { ['NAV1','NAV2'].forEach(k => { if (n.navRadios[k]) navRadios[k] = Object.assign({}, navRadios[k], n.navRadios[k]); }); } catch(e) { _swallow(e); } }
    const v = snap.view || {};
    mapHdgUp=!!v.mapHdgUp; followMode=!!v.followMode;
    if (v.leftSel) leftSel=v.leftSel; if (v.midSel) midSel=v.midSel; if (v.rightSel) rightSel=v.rightSel;
    if (v.tripleMode != null) tripleMode = !!v.tripleMode;
    // 재적용
    try { updateFlyBtns(); } catch(e) { _swallow(e); }
    try { updateHoverBtns(); } catch(e) { _swallow(e); }
    try { updateCrsButtons(); } catch(e) { _swallow(e); }
    try { setNavSrc(navSrc); } catch(e) { _swallow(e); }
    try { applyPanels(); } catch(e) { _swallow(e); }
    try { updateWpMarkers(); fpRender(); updateNav(); } catch(e) { _swallow(e); }
    try { updateAcOnMap(); leafMap.setView([S.lat, S.lon]); } catch(e) { _swallow(e); }
    if (snap.gps) { try { startGPS(); } catch(e) { _swallow(e); } }   // GPS 켜져 있었으면 재개
    return true;
  } catch(e) { return false; }
}

// ── 야간 모드 ──
let nightMode = false;
try { nightMode = localStorage.getItem('nightMode') === '1'; } catch(e) { _swallow(e); }
function applyNightMode() { document.body.classList.toggle('night-mode', nightMode); }
function toggleNightMode() {
  nightMode = !nightMode;
  try { localStorage.setItem('nightMode', nightMode ? '1' : '0'); } catch(e) { _swallow(e); }
  applyNightMode();
}

// ── 근처 공항 자동 METAR → OAT/QNH 자동 반영 ──
let autoMetarOn = true, _autoMetarLast = 0, _autoMetarIcao = '';
try { autoMetarOn = localStorage.getItem('autoMetarOn') !== '0'; } catch(e) { _swallow(e); }
function _nearestAirport() {
  let best = null, bd = Infinity;
  (WX_AIRPORTS || []).forEach(a => {
    const d = distance(S.lat, S.lon, a.lat, a.lon);
    if (d < bd) { bd = d; best = a; }
  });
  return best ? { a: best, d: bd } : null;
}
async function _autoMetarTick() {
  if (!autoMetarOn) return;
  if (!(gpsMode || S.running)) return;             // 실제 비행/시뮬 중에만
  if (Date.now() - _autoMetarLast < 5 * 60 * 1000) return;   // 5분 스로틀
  const near = _nearestAirport();
  if (!near || near.d > 60) return;                // 60NM 넘으면 생략
  _autoMetarLast = Date.now();
  _autoMetarIcao = near.a.icao;
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 6000);
    let raw = null;
    try { raw = await _ivaoMetar(near.a.icao, ctl.signal); }
    catch(e) { try { raw = await _vatsimMetar(near.a.icao, ctl.signal); } catch(e2) { _swallow(e2); } }
    if (raw) _parseMetar(raw.split('\n')[0]);       // _oatSurfaceC 자동 갱신
  } catch(e) { _swallow(e); }
}
setInterval(() => { try { _autoMetarTick(); } catch(e) { _swallow(e); } }, 30000);

// ── PWA 설치 프롬프트 ──
let _deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _deferredPrompt = e; });
function pwaInstall() {
  if (_deferredPrompt) { _deferredPrompt.prompt(); _deferredPrompt = null; }
  else uiAlert('홈 화면에 추가:\n\niOS Safari — 공유 버튼 → "홈 화면에 추가"\nAndroid Chrome — 메뉴(⋮) → "앱 설치"');
}

// ── 지도 타일 프리캐시(현재 화면 주변) — 음영지역 대비 ──
function _lonLatToTile(lon, lat, z) {
  const n = 1 << z;
  const x = Math.floor((lon + 180) / 360 * n);
  const latR = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
  return { x, y, n };
}
async function prefetchTiles() {
  const c = leafMap.getCenter(), z0 = Math.round(leafMap.getZoom());
  const sat = document.getElementById('layer-btn')?.classList.contains('sat');
  const urlFor = (z, x, y) => sat
    ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
    : `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  let count = 0;
  const zs = [z0, Math.min(18, z0 + 1)];
  for (const z of zs) {
    const t = _lonLatToTile(c.lng, c.lat, z);
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      const x = t.x + dx, y = t.y + dy;
      if (x < 0 || y < 0 || x >= t.n || y >= t.n) continue;
      try { await fetch(urlFor(z, x, y), { mode: 'no-cors' }); count++; } catch(e) { _swallow(e); }
    }
  }
  uiAlert(`주변 지도 타일 ${count}개를 캐시했습니다.\n(오프라인/음영지역에서 이 영역이 표시됩니다)`);
}

// ⟳ 새로고침: 세션을 지우고 초기 상태로 리로드(백그라운드 복원 종료)
function hardReload() {
  try { localStorage.removeItem(SESSION_KEY); } catch(e) { _swallow(e); }
  location.reload();
}

// 주기적 + 이탈 시점 저장
setInterval(saveSession, 4000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSession(); });
window.addEventListener('pagehide', saveSession);

function init(){
  resizePFD();
  applyNightMode();   // 야간 모드 복원
  showHelpOnLaunch();
  const _restored = restoreSession();   // 자동 리로드 복원(있으면 FPL 복원 생략)
  if (!_restored) _fplRestore();        // 저장된 비행계획 복원(새로고침 대비)
  fpRender();
  updateAcOnMap();
  S.pit = pitchFromSpd(S.spd);
  // NAV1/NAV2 무선의 튜닝 VOR 좌표 해석(ENR_VORS 정의 이후에 실행되도록 지연)
  setTimeout(() => {
    try { ['NAV1','NAV2'].forEach(k => setNavRadio(k, navRadios[k].freq, navRadios[k].id)); } catch(e) { _swallow(e); }
    try { setNavSrc(navSrc); } catch(e) { _swallow(e); }   // 현재 소스 라벨/CDI 반영
  }, 0);
  if (!_restored) setPage(0);   // 복원 시엔 restoreSession의 applyPanels로 배치 유지
  window.addEventListener('resize', () => { resizePFD(); try { leafMap.invalidateSize(); } catch(e) { _swallow(e); } scaleCdu(); });
  setTimeout(() => leafMap.invalidateSize(), 100);
  // 저장된 표시 포인트를 지도에 복원.
  // init()은 CDU 캡슐화 IIFE보다 먼저 실행되므로, 그 시점엔 _tpRenderMapPoints가
  // 아직 공개되지 않았다. 스크립트 전체가 끝난 뒤로 미룬다.
  setTimeout(() => { try { _tpRenderMapPoints(); } catch(e) { _swallow(e); } }, 0);
  if (!_simLoopRunning) { _simLoopRunning = true; requestAnimationFrame(simStep); }

  // ── PFD canvas tap-to-edit ──
  // FMA row (top of AI)  : middle cell → HDG preselect, right cell → IAS preselect
  // ALT header box (top of ALT tape, right column top half) → selAlt
  // CRHT header box (top of CRHT display, right column bottom half) → selCrht
  async function onPfdTap(clientX, clientY) {
    const rect = cvs.getBoundingClientRect();
    const scX  = cvs.width  / rect.width;
    const scY  = cvs.height / rect.height;
    const px   = (clientX - rect.left) * scX;
    const py   = (clientY - rect.top)  * scY;

    // Mirror drawPFD geometry
    const ctrlEl = document.querySelector('.ctrl-bar');
    const CTRL_H = ctrlEl ? ctrlEl.offsetHeight : 80;
    const W      = cvs.width;
    const H      = cvs.height;
    const usableH = H - CTRL_H;
    const tapW   = Math.max(56, Math.min(76, W * 0.082));
    const vsiW   = Math.max(28, Math.min(38, W * 0.046));
    const aiX    = tapW;
    const aiW    = W - tapW * 2 - vsiW;
    const aiH    = Math.floor(usableH * 0.52);

    // Right-column header box (where selAlt / selCrht + VS are shown)
    const HEAD_H   = 26;
    const altX     = W - tapW - vsiW;
    const altRight = W - vsiW;                  // ALT tape right edge (top half)
    const crhtRight = W;                        // CRHT display right edge (bottom half — full width incl. former VSI column)

    // — ALT tape header (top half, x in [altX, altRight]) —
    // Header is sub-divided: top half ≈ selAlt, bottom half ≈ selVS
    if (py >= 0 && py <= HEAD_H && px >= altX && px <= altRight) {
      if (py < HEAD_H * 0.5) {
        const v = await uiPrompt('ALT preselect (ft):', selAlt, { numeric: true });
        if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0) selAlt = n; }
      } else {
        const v = await uiPrompt('VS preselect (fpm, magnitude — direction is auto):', Math.abs(selVS), { numeric: true });
        if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0) selVS = Math.max(50, Math.min(3000, n)); }
      }
      return;
    }
    // — CRHT display header (bottom half, x in [altX, crhtRight]) —
    // Tap for a free-form CRHT target entry (alternative to the
    // 10 ft step CRHT +/- buttons in the ctrl-bar's first row).
    if (py >= aiH && py <= aiH + HEAD_H && px >= altX && px <= crhtRight) {
      const v = await uiPrompt('CRHT preselect (ft):', selCrht, { numeric: true });
      if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0) selCrht = n; }
      return;
    }

    // — FMA row (centre AI column, top) — HDG / IAS preselect entry —
    if (px < aiX || px > aiX + aiW) return;
    const cellW  = Math.floor((aiW - FMA_MARGIN * 2 - FMA_GAP * 2) / 3);
    const relX   = px - (aiX + FMA_MARGIN);
    const boxIdx = Math.max(0, Math.min(2, Math.floor(relX / (cellW + FMA_GAP))));

    const fmaTop = FMA_MARGIN;
    const fmaBtm = FMA_MARGIN + FMA_BOX_H;
    if (py >= fmaTop && py <= fmaBtm) {
      if (boxIdx === 1) {
        const v = await uiPrompt('HDG preselect (1–360°M):', fmtA(toMag(selHdg)), { numeric: true });
        if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n)) { selHdg = toTrue(Math.max(1, Math.min(360, n))) || 360; hdgSelOn = true; rollApOn = true; } }
      } else if (boxIdx === 2) {
        const v = await uiPrompt('IAS preselect (kt):', selSpd, { numeric: true });
        if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0) selSpd = n; }
      }
    }
  }

  // Touch: guard against scroll drags; click: desktop support
  let pfdTouchX = 0, pfdTouchY = 0;
  cvs.addEventListener('touchstart', e => {
    pfdTouchX = e.touches[0].clientX;
    pfdTouchY = e.touches[0].clientY;
  }, { passive: true });
  cvs.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    const dx = t.clientX - pfdTouchX, dy = t.clientY - pfdTouchY;
    if (Math.sqrt(dx*dx + dy*dy) < 10) onPfdTap(t.clientX, t.clientY);
  }, { passive: true });
  cvs.addEventListener('click', e => onPfdTap(e.clientX, e.clientY));
}
// ── Ship Feature ──
let shipLat = null, shipLon = null;
let shipHdg = 0, shipSpd = 0;
let shipMarker = null, shipVisible = false, shipDragging = false;
let shipInputMode = 'SPD', shipInput = '';

function shipIcon() {
  return L.divIcon({
    html: `<div data-act="openShipPanel" style="transform:rotate(${shipHdg}deg);transform-origin:12px 20px;line-height:0;cursor:pointer;"><svg width="24" height="40" viewBox="0 0 24 40" xmlns="http://www.w3.org/2000/svg"><path d="M12 1 Q20 7 21 17 L21 33 Q21 39 12 39 Q3 39 3 33 L3 17 Q4 7 12 1Z" fill="#1a5fa8" stroke="#7ab8f5" stroke-width="1.5"/><rect x="8" y="16" width="8" height="10" rx="2" fill="#2277bb" stroke="#7ab8f5" stroke-width="0.7"/><circle cx="12" cy="5" r="2.5" fill="#7ab8f5" opacity="0.9"/><line x1="12" y1="1" x2="12" y2="39" stroke="#88ccff" stroke-width="0.5" stroke-dasharray="2,3" opacity="0.4"/></svg></div>`,
    iconSize: [24, 40], iconAnchor: [12, 20], className: ''
  });
}

// 하단 SHIP 버튼: INHIBIT처럼 선택 메뉴(배 표시 / 설정창) 열기·닫기
function toggleShip(force) {
  const m = document.getElementById('ship-menu');
  if (force === false) m.classList.remove('open');
  else m.classList.toggle('open');
  renderShipOnOff();
}

// 메뉴: 배 표시 ON/OFF (마커 생성/제거)
function shipToggleOn() {
  if (shipVisible) {
    if (shipMarker) { leafMap.removeLayer(shipMarker); shipMarker = null; }
    shipVisible = false;
    shipTrail = []; updateShipTrail();
    document.getElementById('ship-panel').style.display = 'none';   // 배 끄면 설정창도 닫음
  } else {
    const c = leafMap.getCenter();
    shipLat = c.lat; shipLon = c.lng;
    shipTrail = []; updateShipTrail();
    shipVisible = true;
    createShipMarker();
  }
  renderShipOnOff();
}

// 메뉴: 설정창 ON/OFF (배가 있어야 열림)
function shipTogglePanel() {
  const panel = document.getElementById('ship-panel');
  const open = panel.style.display === 'block';
  if (open) { panel.style.display = 'none'; }
  else {
    if (!shipVisible) shipToggleOn();   // 설정창을 열면 배도 자동 ON
    openShipPanel();
  }
  renderShipOnOff();
}

// 상태 표시 갱신(메뉴·패널 토글·하단 버튼)
function renderShipOnOff() {
  const panelOpen = document.getElementById('ship-panel').style.display === 'block';
  const sShow = document.getElementById('ship-menu-show');
  if (sShow) { sShow.classList.toggle('on', shipVisible); sShow.querySelector('span').textContent = shipVisible ? 'ON' : 'OFF'; }
  const sPanel = document.getElementById('ship-menu-panel');
  if (sPanel) { sPanel.classList.toggle('on', panelOpen); sPanel.querySelector('span').textContent = panelOpen ? 'ON' : 'OFF'; }
  const mb = document.getElementById('map-ship-btn');
  if (mb) mb.classList.toggle('ship-active', shipVisible);
}

function createShipMarker() {
  shipMarker = L.marker([shipLat, shipLon], { icon: shipIcon(), draggable: true, zIndexOffset: 500 }).addTo(leafMap);
  shipMarker.on('drag', e => { shipLat = e.latlng.lat; shipLon = e.latlng.lng; shipDragging = true; });
  shipMarker.on('dragend', () => { shipDragging = false; shipTrail = []; updateShipTrail(); });
  // 배를 두 번 터치(더블탭/더블클릭)하면 속도·방향 설정 창 다시 열기
  let _shipLastTap = 0;
  shipMarker.on('click', e => {
    const t = Date.now();
    if (t - _shipLastTap < 450) { try { L.DomEvent.stop(e); } catch(_) { _swallow(_); } openShipPanel(); _shipLastTap = 0; }
    else { _shipLastTap = t; }
  });
  shipMarker.on('dblclick', e => { try { L.DomEvent.stop(e); } catch(_) { _swallow(_); } openShipPanel(); });
}

function updateShipMarker() {
  if (!shipMarker || shipDragging) return;
  shipMarker.setLatLng([shipLat, shipLon]);
  shipMarker.setIcon(shipIcon());
}

function openShipPanel() {
  shipSetMode(shipInputMode);
  updateShipStatus();
  renderShipOnOff();
  document.getElementById('ship-panel').style.display = 'block';
}

function shipSetMode(mode) {
  shipInputMode = mode; shipInput = '';
  ['SPD','CRS'].forEach(m => {
    document.getElementById('ship-tab-' + m.toLowerCase()).classList.toggle('ship-tab-active', m === mode);
  });
  const units = { SPD: 'kt · max 50', CRS: '° · 000–359' };
  document.getElementById('ship-unit').textContent = units[mode];
  updateShipDisplay();
}

function updateShipDisplay() {
  const cur = shipInputMode === 'SPD' ? String(shipSpd) : fmtA(toMag(shipHdg));
  document.getElementById('ship-display').textContent = shipInput || cur;
}

function updateShipStatus() {
  document.getElementById('ship-stat-spd').textContent = shipSpd + 'kt';
  document.getElementById('ship-stat-crs').textContent = fmtA(toMag(shipHdg)) + '°';
}

function shipKey(k) {
  if (k === 'CLR') { shipInput = shipInput.slice(0, -1); updateShipDisplay(); return; }
  if (k === 'ENT') {
    const v = parseInt(shipInput, 10);
    if (!isNaN(v)) {
      if (shipInputMode === 'SPD')      shipSpd = Math.min(50, Math.max(0, v));
      else if (shipInputMode === 'CRS') shipHdg = toTrue(v);   // 입력은 자북 → 내부는 진북
    }
    shipInput = '';
    updateShipDisplay();
    updateShipStatus();
    updateShipMarker();
    return;
  }
  if (shipInput.length < 5) { shipInput += k; updateShipDisplay(); }
}

// Ship panel drag
// 패널 헤더를 잡아 끌어 옮기는 공용 헬퍼 (SHIP·WX 패널이 같은 코드를 각자 갖고 있던 것을 통합)
function makePanelDraggable(panelId, headerId) {
  const panel = document.getElementById(panelId);
  const hdr   = document.getElementById(headerId);
  if (!panel || !hdr) return;
  let sx, sy, sl, st;
  const onMM = e => { panel.style.left=(sl+e.clientX-sx)+'px'; panel.style.top=(st+e.clientY-sy)+'px'; };
  const onTM = e => { panel.style.left=(sl+e.touches[0].clientX-sx)+'px'; panel.style.top=(st+e.touches[0].clientY-sy)+'px'; };
  function stopD() {
    document.removeEventListener('mousemove',onMM);
    document.removeEventListener('mouseup',stopD);
    document.removeEventListener('touchmove',onTM);
    document.removeEventListener('touchend',stopD);
    hdr.style.cursor='grab';
  }
  function startD(cx,cy) {
    const r=panel.getBoundingClientRect();
    sx=cx; sy=cy; sl=r.left; st=r.top;
    panel.style.left=sl+'px'; panel.style.top=st+'px';
    panel.style.right='auto'; panel.style.bottom='auto';
    hdr.style.cursor='grabbing';
    document.addEventListener('mousemove',onMM);
    document.addEventListener('mouseup',stopD);
    document.addEventListener('touchmove',onTM,{passive:true});
    document.addEventListener('touchend',stopD);
  }
  hdr.addEventListener('mousedown', e=>{e.preventDefault();startD(e.clientX,e.clientY);});
  hdr.addEventListener('touchstart', e=>startD(e.touches[0].clientX,e.touches[0].clientY),{passive:true});
}
makePanelDraggable('ship-panel', 'ship-panel-header');

// Ship marker tap on touch (Leaflet drag handler blocks touch→click on draggable markers)
(function() {
  let _tx = 0, _ty = 0;
  const mc = document.getElementById('map');
  mc.addEventListener('touchstart', function(e) {
    _tx = e.touches[0].clientX;
    _ty = e.touches[0].clientY;
  }, {passive: true, capture: true});
  mc.addEventListener('touchend', function(e) {
    if (!shipVisible || !shipMarker) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - _tx, dy = t.clientY - _ty;
    if (dx * dx + dy * dy > 100) return; // moved >10px = drag, skip
    const rect = mc.getBoundingClientRect();
    const cx = t.clientX - rect.left;
    const cy = t.clientY - rect.top;
    const mp = leafMap.latLngToContainerPoint(shipMarker.getLatLng());
    if ((cx - mp.x) * (cx - mp.x) + (cy - mp.y) * (cy - mp.y) < 900) {
      openShipPanel(); // tapped within 30px of marker center
    }
  }, {passive: true, capture: true});
})();

// ── METAR / TAF Weather Panel ────────────────────────────────────────────
function openWxPanel() {
  document.getElementById('wx-panel').style.display = 'block';
  document.getElementById('wx-btn').classList.add('wx-active');
}

function closeWxPanel() {
  document.getElementById('wx-panel').style.display = 'none';
  document.getElementById('wx-btn').classList.remove('wx-active');
}

function toggleWxPanel() {
  const panel = document.getElementById('wx-panel');
  if (panel.style.display === 'block') closeWxPanel();
  else openWxPanel();
}

// PP: 현재 항공기 위치를 Flight Plan에 웨이포인트로 추가
function togglePpMenu(force) {
  const m = document.getElementById('pp-menu');
  const open = (force !== undefined) ? force : !m.classList.contains('open');
  m.classList.toggle('open', open);
  if (open) {
    // ＋ 버튼 바로 아래 위치 정렬
    const btn = document.getElementById('pp-btn');
    const bar = document.getElementById('map-top-bar');
    m.style.left = Math.max(4, btn.offsetLeft + bar.offsetLeft - 6) + 'px';
  }
}
// 십자(지도 중앙) 위치에 웨이포인트 추가
function chAddWaypoint() {
  const c = leafMap.getCenter();
  const cnt = S.wps.filter(w => /^WP\d*$/.test(w.ident)).length;
  pushWP({ ident: 'WP' + (cnt + 1), lat: c.lat, lon: c.lng });
  const btn = document.getElementById('pp-btn');
  btn.style.background = 'rgba(0,50,10,0.95)'; btn.style.borderColor = '#00ff88'; btn.style.color = '#00ff88';
  setTimeout(() => { btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }, 700);
}
function ppAddWaypoint() {
  const ppCount = S.wps.filter(w => /^PP\d*$/.test(w.ident)).length;
  const name = 'PP' + (ppCount + 1);
  pushWP({ ident: name, lat: S.lat, lon: S.lon });
  const btn = document.getElementById('pp-btn');
  btn.style.background = 'rgba(0,50,10,0.95)';
  btn.style.borderColor = '#00ff88';
  btn.style.color = '#00ff88';
  setTimeout(() => {
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  }, 700);
}


function setWxIcao(icao, btn) {
  document.getElementById('wx-icao').value = icao;
  document.querySelectorAll('.wx-ap-btn').forEach(b => b.classList.remove('wx-ap-sel'));
  if (btn) btn.classList.add('wx-ap-sel');
}

// ── METAR/TAF fetcher ──
// Strategy: fire all 6 transport options simultaneously and take the FIRST
// valid response (Promise.any). Then cache by URL for 5 min.
// aviationweather.gov blocks some proxies → wider net + JSON wrapper
// (allorigins /get) lets us verify upstream HTTP status to filter HTML errors.

const _wxCache = new Map();
const WX_CACHE_TTL = 10 * 60 * 1000;

// 첫 번째 유효 결과 반환, 3초 초과 시 timeout으로 reject
const raceValid = (promises, guard) => {
  const race = new Promise((resolve, reject) => {
    let pending = promises.length, lastErr = null;
    if (!pending) return reject(new Error('no sources'));
    promises.forEach(p => p
      .then(v => { if (guard(v)) resolve(v); else if (--pending === 0) reject(lastErr || new Error('no valid data')); })
      .catch(e => { lastErr = e; if (--pending === 0) reject(e); })
    );
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
  return Promise.race([race, timeout]);
};

async function _wxGet(url, sig) {
  const c = _wxCache.get(url);
  if (c && Date.now() - c.ts < WX_CACHE_TTL) return c.data;

  const proxies = [
    url, // 직접 시도 (모바일 등 CORS 허용 환경)
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    'https://corsproxy.io/?' + encodeURIComponent(url),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
  ];

  const tryFetch = async (u) => {
    const r = await fetch(u, { signal: sig });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = (await r.text()).trim();
    if (body.startsWith('<')) throw new Error('html');
    if (!body) throw new Error('empty');
    return body;
  };

  const body = await Promise.race([
    Promise.any(proxies.map(u => tryFetch(u))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
  ]);

  if (body) _wxCache.set(url, { data: body, ts: Date.now() });
  return body;
}

function _ivaoMetar(icao, sig) {
  return _wxGet(`https://metar.ivao.aero/${icao}`, sig);
}
function _vatsimMetar(icao, sig) {
  return _wxGet(`https://metar.vatsim.net/metar.php?id=${icao}`, sig);
}

async function _metarTafScrape(icao, sig) {
  const target = `https://metar-taf.com/metar/${icao}`;
  const proxies = [
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(target),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(target),
    'https://corsproxy.io/?' + encodeURIComponent(target),
  ];
  const re = new RegExp(icao + '\\s+\\d{6}Z\\b[^<\\n]*', 'i');
  return Promise.any(proxies.map(async px => {
    const r = await fetch(px, { signal: sig });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const m = html.match(re);
    if (!m) throw new Error('no match');
    const txt = m[0].replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (txt.length < 8) throw new Error('too short');
    return txt;
  }));
}

async function fetchWx(type) {
  const icao = (document.getElementById('wx-icao').value || '').trim().toUpperCase();
  if (icao.length < 3) {
    const r = document.getElementById('wx-result');
    r.style.display = 'block';
    r.innerHTML = '<span style="color:#ff8800;">ICAO 코드를 입력하거나 선택하세요</span>';
    return;
  }
  const resultEl = document.getElementById('wx-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = `<span style="color:#446644;">🔄 ${icao} ${type} 조회 중…</span>`;

  const ctl = new AbortController();
  const sig = ctl.signal;
  const AMO_LINK = `<a href="https://global.amo.go.kr/observation/metar.do" target="_blank" style="color:#66aaff;">AMO METAR 조회</a>`;

  try {
    if (type === 'METAR') {
      let raw = '';
      try {
        raw = await raceValid(
          [_ivaoMetar(icao, sig), _vatsimMetar(icao, sig), _metarTafScrape(icao, sig)],
          v => typeof v === 'string' && v.length >= 8 && v.toUpperCase().includes(icao)
        );
      } catch { raw = ''; }

      if (raw.length < 8) {
        resultEl.innerHTML = `<span style="color:#ff8800;">${icao}: METAR 없음</span> — ${AMO_LINK}`;
        return;
      }
      renderWxMetar(raw, resultEl, icao);

    } else {
      let rawTaf = '';
      try {
        const awUrl = `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`;
        const noaaUrl = `https://tgftp.weather.gov/data/forecasts/taf/stations/${icao}.TXT`;
        const proxies = [
          'https://api.allorigins.win/raw?url=' + encodeURIComponent(awUrl),
          'https://corsproxy.io/?' + encodeURIComponent(awUrl),
          'https://api.allorigins.win/raw?url=' + encodeURIComponent(noaaUrl),
          'https://corsproxy.io/?' + encodeURIComponent(noaaUrl),
        ];
        const fetchTaf = async (url) => {
          const r = await fetch(url, { signal: sig });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const body = (await r.text()).trim();
          // JSON 응답 (aviationweather)
          if (body.startsWith('[') || body.startsWith('{')) {
            let data; try { data = JSON.parse(body); } catch { throw new Error('parse'); }
            const t = (data?.[0]?.rawTAF || data?.[0]?.rawTaf || data?.[0]?.taf || '').trim();
            if (t.length >= 10) return t;
            throw new Error('empty');
          }
          // 평문 TAF (NOAA tgftp) — 첫 줄 타임스탬프 제거
          const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
          const t = (lines.length > 1 ? lines.slice(1).join(' ') : lines[0] || '').trim();
          if (t.length >= 10) return t;
          throw new Error('empty');
        };
        rawTaf = await Promise.race([
          Promise.any(proxies.map(u => fetchTaf(u))),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
      } catch { rawTaf = ''; }

      if (!rawTaf) { resultEl.innerHTML = `<span style="color:#ff8800;">${icao}: TAF 없음</span>`; return; }
      renderWxTaf(rawTaf, resultEl, icao);
    }
  } catch (e) {
    resultEl.innerHTML = `<span style="color:#ff8800;">${icao}: 조회 실패</span> — ${AMO_LINK}`;
  } finally {
    ctl.abort();
  }
}

// Regex-based METAR parser — works on raw METAR string
function _parseMetar(raw) {
  const p = { time:'---', wind:'---', vis:'---', wx:'', sky:[], temp:'---', qnh:'---' };

  // Time: DDHHmmZ
  const tm = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (tm) p.time = `${tm[1]}일 ${tm[2]}:${tm[3]}Z`;

  // Wind: VRB or 3-digit dir, 2-3 digit speed, optional gust, KT or MPS
  const wm = raw.match(/\b(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?(KT|MPS)\b/);
  if (wm) {
    const dir = wm[1] === 'VRB' ? 'VRB' : wm[1] + '°';
    p.wind = `${dir} ${wm[2]}${wm[5]}${wm[4] ? ' G' + wm[4] + wm[5] : ''}`;
  }

  // CAVOK
  if (/\bCAVOK\b/.test(raw)) {
    p.vis = 'CAVOK (>10km, 무구름, 기상현상 없음)';
    p.sky = ['CAVOK'];
  } else {
    // Metric visibility: 4-digit (meters)
    const vm = raw.match(/\b(9999|\d{4})\b/);
    if (vm) {
      const m = parseInt(vm[1]);
      p.vis = m >= 9999 ? '10km 이상' : `${m}m`;
    }
    // SM visibility (US format)
    const sm = raw.match(/\b(\d+(?:\/\d+)?)\s*SM\b/);
    if (sm) p.vis = `${sm[1]}SM (${(parseFloat(sm[1]) * 1.852).toFixed(1)}km)`;

    // Present weather (simplified: tokens between vis and clouds)
    const wxM = raw.match(/\b([-+]?(?:VC)?(?:MI|BC|PR|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|BR|SA|DU|HZ|FU|PY|VA|PO|SQ|FC|SS|DS)+)\b/g);
    if (wxM) p.wx = wxM.join(' ');

    // Cloud layers: FEW/SCT/BKN/OVC + 3-digit height + optional CB/TCU
    const skRe = /\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/g;
    let sk;
    while ((sk = skRe.exec(raw)) !== null)
      p.sky.push(`${sk[1]} ${parseInt(sk[2]) * 100}ft${sk[3] ? ' ' + sk[3] : ''}`);
    if (!p.sky.length && /\b(SKC|CLR|NSC|NCD)\b/.test(raw)) p.sky.push('Clear');
  }

  // Temp/Dew: ##/## or M##/## etc.
  const tdm = raw.match(/\b(M?\d{1,2})\/(M?\d{1,2})\b/);
  if (tdm) {
    const toC = s => uTemp(parseInt(s.replace('M', '-'), 10));
    p.temp = `${toC(tdm[1])} / DP ${toC(tdm[2])}`;
    // PFD OAT 계산용 지면 온도 갱신(가장 최근 조회한 METAR 기준)
    _oatSurfaceC = parseInt(tdm[1].replace('M', '-'), 10);
  }

  // QNH
  const qm = raw.match(/\bQ(\d{4})\b/);
  if (qm) p.qnh = `Q${qm[1]} hPa`;
  else {
    const am = raw.match(/\bA(\d{4})\b/);
    if (am) p.qnh = `${(parseInt(am[1]) / 100).toFixed(2)} inHg (≈${Math.round(parseInt(am[1]) / 100 * 33.8639)} hPa)`;
  }

  return p;
}

function renderWxMetar(text, el, icao) {
  // text may contain multiple METARs (one per line) — use the most recent
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
  const raw = lines[0];
  const p = _parseMetar(raw);

  const ROW = (lbl, val, clr) =>
    `<div style="display:grid;grid-template-columns:60px 1fr;gap:4px;margin-bottom:4px;">` +
    `<span style="color:#446644;font-size:18px;">${lbl}</span>` +
    `<span style="color:${clr || '#cccccc'};font-size:18px;">${val}</span></div>`;

  el.innerHTML =
    `<div style="color:#00ff88;font-size:20px;font-weight:bold;margin-bottom:5px;letter-spacing:0.5px;">${icao} — METAR</div>` +
    `<div style="color:#559955;font-size:16px;margin-bottom:8px;word-break:break-all;line-height:1.6;border-left:2px solid #1a3a1a;padding-left:5px;">${raw}</div>` +
    ROW('TIME', p.time) +
    ROW('WIND', p.wind) +
    ROW('VIS',  p.vis) +
    (p.wx ? ROW('WX', p.wx, '#ffaa44') : '') +
    ROW('SKY',  p.sky.join('  ') || '---') +
    ROW('TEMP', p.temp) +
    ROW('QNH',  p.qnh, '#66ccff') +
    (lines.length > 1
      ? `<div style="color:#335533;font-size:16px;margin-top:5px;">+ ${lines.length - 1}건 추가 관측</div>`
      : '');
}

function renderWxTaf(text, el, icao) {
  const raw = text.trim();
  const fmt = raw.replace(/(BECMG|TEMPO|FM\d{6}|PROB\d{2}\s+TEMPO|PROB\d{2}(?!\s+TEMPO))/g, '\n  $1');
  el.innerHTML =
    `<div style="color:#00ff88;font-size:20px;font-weight:bold;margin-bottom:5px;letter-spacing:0.5px;">${icao} — TAF</div>` +
    `<pre style="color:#aaa;font-size:16px;white-space:pre-wrap;word-break:break-all;line-height:1.6;margin:0;border-left:2px solid #1a3a1a;padding-left:5px;">${fmt}</pre>`;
}

// WX panel drag (same pattern as ship panel)
makePanelDraggable('wx-panel', 'wx-panel-header');

init();

// ── Service Worker 등록 (PWA 오프라인 지원) ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.warn('SW 등록 실패:', err));
  });
}

// ── CDU Logic ──
// ── CDU 액션 위임 ────────────────────────────────────────────────────
// 인라인 data-act="foo" data-arg='["X"]'은 전역 스코프에서만 동작한다. 그래서 CDU 내부 함수를
// 캡슐화할 수 없고, 이름을 잘못 적어도 문자열이라 정적으로 잡히지 않아 버튼이
// 조용히 죽는다. data-act/data-arg로 바꾸고 여기서 이름→함수를 명시적으로 잇는다.
//   · data-act : 액션 이름(레지스트리 키)
//   · data-arg : 인자 JSON 배열. 문자열 "$event"는 실제 이벤트 객체로 치환된다.
// ── 앱 전역 액션 위임 ────────────────────────────────────────────
// 인라인 onclick 은 전역 스코프에서만 이름을 찾기 때문에, 함수를 모듈/IIFE 안으로
// 옮기는 순간 "버튼이 조용히 죽는다"(clBack 사례). 위임을 쓰면 등록된 이름만
// 부르므로 그런 사고가 나지 않고, 미등록이면 콘솔에 경고가 남는다.
//
// 레지스트리는 APP_ACT · CDU_ACT 둘이지만 "이름 → 함수" 는 한 곳에서만 푼다.
// 종전에는 듣는 자리로 갈랐다 — CDU 안(#cdu-wrap)은 CDU_ACT, 밖은 APP_ACT.
// 그런데 PDF 뷰어·Flight Plan 처럼 APP_ACT 에 등록된 화면이 CDU 안에 그려지면
// 어느 쪽도 처리하지 않아 버튼이 통째로 죽었다(◀/▶ 페이지 넘김, 📍 위치 보정 등).
// 이제 듣는 자리는 그대로 두되(중복 발화 방지) 조회는 양쪽을 다 본다.
const APP_ACT = {};
function appRegister(map) { Object.assign(APP_ACT, map); }
// 이름을 두 레지스트리에서 찾는다. 자기 쪽을 먼저 보고 없으면 반대쪽.
function _actLookup(name, mine, other) {
  const fn = mine[name];
  return typeof fn === 'function' ? fn : other[name];
}
(function initAppDelegation() {
  const run = (e, kind) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    // CDU 리스너(#cdu-wrap)가 먼저 잡았으면 여기서 또 부르지 않는다.
    // contains() 만으로는 부족하다 — 핸들러가 화면을 다시 그리면 el 이 DOM 에서
    // 떨어져 나가 contains() 가 false 가 되고, 같은 클릭이 두 번 실행된다
    // (체크리스트 Back 을 한 번 눌렀는데 두 단계 올라가 HOME 으로 튀던 증상).
    if (e.__actDone) return;
    const cdu = document.getElementById('cdu-wrap');
    if (cdu && cdu.contains(el)) return;
    if ((el.dataset.on || 'click') !== kind) return;
    const fn = _actLookup(el.dataset.act, APP_ACT, CDU_ACT);
    if (typeof fn !== 'function') { console.warn('[APP] 미등록 액션:', el.dataset.act); return; }
    let args = [];
    if (el.dataset.arg) {
      try { args = JSON.parse(el.dataset.arg); }
      catch (err) { console.warn('[APP] 인자 파싱 실패:', el.dataset.arg); return; }
    }
    args = args.map(a => a === '$event' ? e : (a === '$el' ? el : a));
    fn(...args);
  };
  document.addEventListener('click', e => run(e, 'click'));
  document.addEventListener('pointerdown', e => run(e, 'pointerdown'));
})();

const CDU_ACT = {};
function cduRegister(map) { Object.assign(CDU_ACT, map); }
// cduFooter(함수) 로 지정한 Back 실행기
CDU_ACT.cduBack = () => { if (typeof _cduBackFn === 'function') _cduBackFn(); };
function act(name, ...args) {
  if (!args.length) return `data-act="${name}"`;
  return `data-act="${name}" data-arg='${JSON.stringify(args).replace(/'/g, "&#39;")}'`;
}
(function initCduDelegation() {
  const root = document.getElementById('cdu-wrap');
  if (!root) return;
  // 기본은 click. 볼륨 슬라이더처럼 누르는 즉시 반응해야 하는 요소는 data-on="pointerdown".
  const run = (e, kind) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    if ((el.dataset.on || 'click') !== kind) return;
    e.__actDone = true;    // 문서 리스너가 같은 클릭을 다시 처리하지 않게
    const fn = _actLookup(el.dataset.act, CDU_ACT, APP_ACT);
    if (typeof fn !== 'function') { console.warn('[CDU] 미등록 액션:', el.dataset.act); return; }
    let args = [];
    if (el.dataset.arg) {
      try { args = JSON.parse(el.dataset.arg); }
      catch (err) { console.warn('[CDU] 인자 파싱 실패:', el.dataset.arg); return; }
    }
    fn(...args.map(a => a === '$event' ? e : a === '$el' ? el : a));
  };
  root.addEventListener('click',       e => run(e, 'click'));
  root.addEventListener('pointerdown', e => run(e, 'pointerdown'));
})();

// ── CDU 캡슐화 ───────────────────────────────────────────────────────
// 이 IIFE 안의 이름 190여 개는 전역에 노출되지 않는다. 화면 버튼은 위에서 만든
// data-act 위임(CDU_ACT)으로 연결되므로 전역일 필요가 없다.
// 밖에서 실제로 쓰는 이름만 아래 '공개' 블록에서 명시적으로 내보낸다.
(function () {
    // --- State Variables ---
    let currentMode = 'HOME';
    let audioTab = 'COM'; 
    let inputTarget = 'com1';
    let currentInput = "";
    let xpdrInput = "";
    
    // SELCAL State
    let selcalCode = "BCAJ";
    let selcalInput = "";
    
    let hasStartedTyping = false; 
    
    let micSelected = 'COM1'; 
    let monStates = { com1: true, com2: true, uvhf: false, vhffm: true, hf: false, selcal: false, nav1: true, nav2: true, speaker: true };
    let clicksState = 'Off'; 
    let icStates = { CoPilot: true, Pilot: true, Crew1: true, Pass: true, Crew2: true, wICS: true, Isolate: false, Loop1: false, Loop2: false, Loop5: false };
    
    let voxState = 'Off';
    let volumes = { com1: 100, com2: 75, uvhf: 90, pb: 100, intercom: 100, vhffm: 100, hf: 100, clicks: 100, nav1: 100, nav2: 100, speaker: 100, vox: 50 };
    
    let freqs = { 
        com1: { act: "118.850", stb: "124.600" }, com2: { act: "126.200", stb: "125.300" },
        uvhf: { act: "115.000", stb: "110.000" }, hf: { act: "7.5423", stb: "11.4570" },
        nav1: { act: "117.80", stb: "113.00", id: "TOP" }, nav2: { act: "115.50", stb: "113.25", id: "STJ" }
    };
    
    let xpdrState = { mode: 'Auto', code: '1234', active: 'XPDR2', adsb: true, flightId: 'TERRY' };
    let hfState = { tuning: 'Simplex', emission: 'LSB V', sql: 'SQ3', pwr: 'High' };
    let utilTab    = 'MENU'; // 현재 페이지: MENU | DIST | COORD | WEIGHT | PRESS | FUEL | DENSALT
    let utilActive = 'm';    // focused field key for numpad input
    let utilInput  = '';     // numpad buffer
    // 항공유 유종별 밀도(lb/US gal). Jet A를 기본값으로.
    const _FUELS = [
      { name:'Jet A',        d:6.8 },
      { name:'Jet A-1',      d:6.7 },
      { name:'Avgas 100LL',  d:6.0 },
      { name:'Jet B',        d:6.4 },
    ];
    let fuelTypeIdx = 0;              // 현재 유종(_FUELS 인덱스)
    let fuelLbGal   = _FUELS[0].d;    // 현재 밀도(lb/US gal)
    const _UF = {
      m:    { label:'미터',       unit:'m',   neg:false, dec:3 },
      ft:   { label:'피트',       unit:'ft',  neg:false, dec:3 },
      km:   { label:'킬로미터',   unit:'km',  neg:false, dec:4 },
      nm:   { label:'해상마일',   unit:'NM',  neg:false, dec:4 },
      sm:   { label:'법정마일',   unit:'SM',  neg:false, dec:4 },
      dd:   { label:'십진도 DD',  unit:'°',   neg:true,  dec:6 },
      dmd:  { label:'DM 도',      unit:'°',   neg:true,  dec:0 },
      dmm:  { label:'DM 분',      unit:"'",   neg:false, dec:4 },
      dmsd: { label:'DMS 도',     unit:'°',   neg:true,  dec:0 },
      dmsm: { label:'DMS 분',     unit:"'",   neg:false, dec:0 },
      dmss: { label:'DMS 초',     unit:'"',   neg:false, dec:2 },
      // Weight / Mass
      wkg:  { label:'kilograms',        unit:'kg',  neg:false, dec:2 },
      wlb:  { label:'pounds',           unit:'lb',  neg:false, dec:2 },
      wg:   { label:'grams',            unit:'g',   neg:false, dec:0 },
      woz:  { label:'ounce',            unit:'oz',  neg:false, dec:2 },
      wmt:  { label:'metric ton',       unit:'t',   neg:false, dec:4 },
      // Pressure
      phpa: { label:'hectopascal / mbar', unit:'hPa',  neg:false, dec:2 },
      pinhg:{ label:'inch mercury',       unit:'inHg', neg:false, dec:2 },
      pkpa: { label:'kilopascal',         unit:'kPa',  neg:false, dec:2 },
      ppsi: { label:'pounds/sq inch',     unit:'psi',  neg:false, dec:2 },
      pmmhg:{ label:'millimeter mercury', unit:'mmHg', neg:false, dec:2 },
      patm: { label:'atmosphere',         unit:'atm',  neg:false, dec:4 },
      // Fuel
      flb:  { label:'pounds',        unit:'lb',  neg:false, dec:1 },
      fkg:  { label:'kilograms',     unit:'kg',  neg:false, dec:1 },
      fusgal:{ label:'US gallons',   unit:'gal', neg:false, dec:2 },
      fltr: { label:'litres',        unit:'L',   neg:false, dec:2 },
      // Density Altitude
      daIA: { label:'Indicated Alt',    unit:'ft',   neg:true,  dec:0 },
      daAS: { label:'Altimeter Setting',unit:'inHg', neg:false, dec:2 },
      daOAT:{ label:'Outside Air Temp', unit:'°C',   neg:true,  dec:0 },
      daOut:{ label:'Density Altitude', unit:'ft',   neg:true,  dec:0 },
      // VNAV
      vnavAlt:{ label:'타깃 고도',  unit:'ft',  neg:false, dec:0 },
      vnavAng:{ label:'강하/상승 각', unit:'°', neg:true,  dec:1 },
      // Speed
      skt:  { label:'노트',          unit:'kt',   neg:false, dec:2 },
      skmh: { label:'킬로미터/시',   unit:'km/h', neg:false, dec:2 },
      smph: { label:'마일/시',       unit:'mph',  neg:false, dec:2 },
      sms:  { label:'미터/초',       unit:'m/s',  neg:false, dec:3 },
      // Temperature
      tc:   { label:'섭씨',          unit:'°C',   neg:true,  dec:1 },
      tf:   { label:'화씨',          unit:'°F',   neg:true,  dec:1 },
      tk:   { label:'켈빈',          unit:'K',    neg:false, dec:1 },
      // Time / Speed / Distance
      tsdGs:   { label:'지상속도 GS', unit:'kt',  neg:false, dec:0 },
      tsdDist: { label:'거리',        unit:'NM',  neg:false, dec:1 },
      tsdTime: { label:'소요시간',    unit:'min', neg:false, dec:1 },
      // Fuel Endurance
      feQty:  { label:'잔여 연료',      unit:'lb',    neg:false, dec:0 },
      feFlow: { label:'연료 소모율',    unit:'lb/hr', neg:false, dec:0 },
      feGs:   { label:'지상속도 GS',    unit:'kt',    neg:false, dec:0 },
      feRsv:  { label:'예비연료(시간)', unit:'min',   neg:false, dec:0 },
      feEnd:  { label:'총 잔여시간',    unit:'min',   neg:false, dec:0 },
      feUse:  { label:'예비 제외 가용', unit:'min',   neg:false, dec:0 },
      feRange:{ label:'항속거리',       unit:'NM',    neg:false, dec:0 },
      // Wind Component
      wcCrs:  { label:'코스/활주로 방향', unit:'°',  neg:false, dec:0 },
      wcDir:  { label:'풍향 (from)',      unit:'°',  neg:false, dec:0 },
      wcSpd:  { label:'풍속',             unit:'kt', neg:false, dec:0 },
      wcHead: { label:'정풍(+) / 배풍(−)', unit:'kt', neg:true, dec:1 },
      wcCross:{ label:'측풍 (+우 / −좌)',  unit:'kt', neg:true, dec:1 },
      wcAng:  { label:'상대각',           unit:'°',  neg:true,  dec:0 },
      // True ↔ Magnetic
      mvTrue: { label:'진방위 TRUE',       unit:'°', neg:false, dec:0 },
      mvVar:  { label:'자기편차 (E+ / W−)', unit:'°', neg:true,  dec:1 },
      mvMag:  { label:'자방위 MAG',        unit:'°', neg:false, dec:0 },
      // Sunrise / Sunset
      sunLat: { label:'위도',  unit:'°', neg:true, dec:4 },
      sunLon: { label:'경도',  unit:'°', neg:true, dec:4 },
      // True ↔ Indicated Airspeed
      tasPA:  { label:'기압고도 PA',      unit:'ft', neg:true,  dec:0 },
      tasOAT: { label:'외기온도 OAT',     unit:'°C', neg:true,  dec:0 },
      tasIAS: { label:'지시대기속도 IAS', unit:'kt', neg:false, dec:1 },
      tasTAS: { label:'진대기속도 TAS',   unit:'kt', neg:false, dec:1 },
    };
    const _UV = { m:0, ft:0, km:0, nm:0, sm:0, dd:0, dmd:0, dmm:0, dmsd:0, dmsm:0, dmss:0,
      wkg:0, wlb:0, wg:0, woz:0, wmt:0,
      phpa:1013.25, pinhg:29.92, pkpa:101.325, ppsi:14.696, pmmhg:760.0, patm:1,
      flb:0, fkg:0, fusgal:0, fltr:0,
      daIA:0, daAS:29.92, daOAT:15, daOut:0,
      vnavAlt:0, vnavAng:-3,
      skt:0, skmh:0, smph:0, sms:0,
      tc:15, tf:59, tk:288.2,
      tsdGs:80, tsdDist:0, tsdTime:0,
      feQty:0, feFlow:600, feGs:80, feRsv:20, feEnd:0, feUse:0, feRange:0,
      wcCrs:0, wcDir:0, wcSpd:0, wcHead:0, wcCross:0, wcAng:0,
      mvTrue:0, mvVar:-8, mvMag:8,
      sunLat:37.5665, sunLon:126.9780,
      tasPA:0, tasOAT:15, tasIAS:100, tasTAS:100 };

    // --- EXACT EXCEL PERF DATA ENGINE ---
    let perfData = { alt: "0", temp: "20", weight: "16000", vs: "0" };
    let perfResults = { oge: "0.0", ige: "0.0", oge_gonogo: "0.0", ige_gonogo: "0.0", mta30: "0.0", mta10: "0.0", mta25: "0.0", vy: "0.0", vsTq: "0.0", outOfLimits: false };

    // ── AS-565 성능 데이터·보간 (내부 전용) ─────────────────────────────
    // 성능표 11종과 보간 함수 3종은 calculatePerformance()만 쓰는데 전역에 노출돼
    // 있었다. IIFE로 감싸 밖으로 내보내는 이름을 calculatePerformance 하나로 줄인다.
    // (perfData·perfResults는 화면 렌더에서 읽고 쓰므로 바깥에 남긴다)
    let calculatePerformance;
    (function () {
    // Vy Tables
    const vyTemps = [-32, -20, -10, 0, 10, 20, 30, 40];
    const vyWeights = [16000, 18000, 19200];
    const vyData = [
        [72.0, 71.8, 71.0, 70.8, 70.7, 70.3, 70.1, 70.0],
        [75.8, 75.3, 74.9, 74.3, 74.0, 73.5, 73.2, 72.8],
        [77.2, 77.0, 76.8, 76.0, 75.8, 75.0, 74.6, 74.0]
    ];

    // Climb/Descent TQ Tables
    const vsRates = [0, 500, 1000, 1500, 2000, 2500, 3000];
    const vsWeights = [16000, 18000, 20000];
    const climbData = [
        [0, 12.2, 24.8, 36.9, 49.2, 61.3, 73.9],
        [0, 13.8, 28.0, 41.5, 55.3, 69.2, 83.4],
        [0, 15.2, 30.8, 46.1, 61.3, 76.6, 93.6]
    ];
    const descentData = [
        [0, 11.0, 22.0, 33.0, 43.8, 54.9, 65.8],
        [0, 12.2, 22.4, 37.0, 49.2, 61.6, 74.0],
        [0, 13.8, 27.2, 41.0, 54.8, 68.5, 82.2]
    ];

    const igeOgeMap = [
        [70, 64.5], [71, 65.5], [72, 66], [73, 67], [74, 68], [75, 68.5], [76, 69.5], [77, 70], [78, 71], [79, 72],
        [80, 73], [81, 73.5], [82, 74.5], [83, 75], [84, 76], [85, 77], [86, 78], [87, 78.5], [88, 79.5], [89, 80],
        [90, 81], [91, 82], [92, 82.5], [93, 83.5], [94, 84.5], [95, 85], [96, 86], [97, 86.5], [98, 87.5], [99, 88.5],
        [100, 89], [101, 90], [102, 91], [103, 92], [104, 92.5], [105, 93.5], [106, 94], [107, 95], [108, 96],
        [109, 96.5], [110, 97.5], [111, 98], [112, 99], [113, 100], [114, 101]
    ];

    const oge19200_data = [
        [94, 94, 95, 95.5, 96, 97, 97.5, 98.5, 99, 100],          
        [95, 95.5, 96, 97, 97.5, 98.5, 99, 100, 101, 102],        
        [96, 97, 97.5, 98.5, 99, 100, 101, 102, 103, 104],        
        [97.5, 98.5, 99, 100, 101, 102, 103, 104, 105, 106],      
        [99, 100, 101, 102, 103, 104, 105, 106, 107, 108],        
        [101, 102, 103, 104, 105, 106, 107, 108, 110, 111.5],     
        [103, 104, 105, 106, 107, 108, 110, 111.5, 112.5, 114.5]  
    ];

    const oge16000_data = [
        [75.5, 75.5, 76, 76, 76.5, 76.5, 77, 77.5, 77.5, 78],     
        [76, 76.5, 76.5, 77, 77, 77.5, 77.5, 78.5, 78.5, 79],     
        [77, 77, 77.5, 78, 78.5, 78.5, 78.5, 79, 79.5, 80],       
        [78, 78.5, 78.5, 79, 79.5, 80, 80, 80.5, 81, 81.5],       
        [79, 79.5, 80, 80.5, 80.5, 81, 81.5, 82, 82.5, 83],       
        [80, 80.5, 81, 81.5, 82, 82.5, 83, 83.5, 84, 84.5],       
        [81.5, 82, 82.5, 83, 83.5, 84, 84.5, 85, 85.5, 86]        
    ];

    const mta30_data = [
        [129,129,130,131,131,131,132,132,133,133,134,134,135,135,136,136,137,137,136,135,133,132,131,129,128,127,125,123,121,120,118,115,114,112,110,107,105,103],
        [125,125,126,126,127,127,127,128,128,129,129,130,130,131,131,131,132,132,131,131,129,128,127,126,124,123,121,118,117,115,115,112,110,109,106,104,102,100],
        [120,120,121,121,122,122,123,123,124,124,124,125,125,126,126,126,127,127,127,125,124,123,121,120,119,117,116,114,113,111,110,107,105,104,102,100,97,96],
        [116,116,117,117,118,118,119,119,119,120,120,121,121,121,122,122,123,123,122,121,120,119,117,116,114,113,112,110,109,107,105,103,102,100,99,96,94,92],
        [111,112,112,113,113,113,114,114,115,115,115,116,117,117,117,118,118,119,117,116,115,114,112,111,111,109,108,106,105,103,101,99,97,96,94,92,90,88],
        [108,108,109,109,109,110,110,111,111,111,112,112,112,113,113,113,114,114,113,112,111,110,109,108,106,105,103,102,101,99,97,95,94,92,90,88,86,85],
        [103,104,104,105,105,105,106,106,107,107,107,108,108,109,109,109,109,110,109,108,107,105,104,103,102,101,99,97,96,95,93,91,90,89,87,84,81,81],
        [100,100,100,101,101,102,102,102,103,103,103,104,104,104,105,105,105,105,105,103,103,101,100,99,98,97,95,93,93,91,89,88,86,85,83,81,79,78],
        [96,97,97,97,97,98,98,99,99,99,100,100,100,101,101,101,102,102,101,99,98,97,96,95,94,93,91,90,89,87,87,84,83,81,79,77,76,75],
        [92,93,93,93,94,94,95,95,95,95,96,96,96,96,97,97,97,97,97,95,95,93,92,91,90,89,88,86,85,84,82,81,79,78,76,75,74],
        [89,89,90,90,90,91,91,91,91,92,92,92,93,93,93,93,94,93,92,91,91,89,89,88,86,85,84,83,81,80,78,77,75,74,73,72],
        [86,86,86,87,87,87,87,88,88,88,89,89,89,89,89,90,90,89,89,87,86,85,85,84,83,82,80,79,77,76,75,74,72,71,70],
        [82,83,83,83,83,84,84,84,84,85,85,85,85,85,86,86,87,86,85,84,83,82,81,80,79,78,77,75,74,73,71,71,69,68],
        [79,79,80,80,80,80,81,81,81,81,81,82,82,82,83,83,83,82,81,80,79,79,78,77,76,75,74,72,71,70,69,67,66],
        [76,76,76,76,77,77,77,77,78,78,78,78,79,79,79,79,79,79,78,77,76,75,74,73,72,71,70,69,68,66,66,65]
    ];

    function interpolate1D(x, x0, x1, y0, y1) {
        if (x1 === x0) return y0;
        return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
    }

    function interpolate2D(xArr, yArr, data2D, xVal, yVal) {
        let x0 = 0, x1 = 1;
        for (let i = 0; i < xArr.length - 1; i++) {
            if (xVal >= xArr[i] && xVal <= xArr[i+1]) { x0 = i; x1 = i+1; break; }
        }
        if (xVal < xArr[0]) { x0 = 0; x1 = 1; }
        if (xVal > xArr[xArr.length-1]) { x0 = xArr.length-2; x1 = xArr.length-1; }

        let y0 = 0, y1 = 1;
        for (let j = 0; j < yArr.length - 1; j++) {
            if (yVal >= yArr[j] && yVal <= yArr[j+1]) { y0 = j; y1 = j+1; break; }
        }
        if (yVal < yArr[0]) { y0 = 0; y1 = 1; }
        if (yVal > yArr[yArr.length-1]) { y0 = yArr.length-2; y1 = yArr.length-1; }

        let valY0 = interpolate1D(xVal, xArr[x0], xArr[x1], data2D[y0][x0], data2D[y0][x1]);
        let valY1 = interpolate1D(xVal, xArr[x0], xArr[x1], data2D[y1][x0], data2D[y1][x1]);
        return interpolate1D(yVal, yArr[y0], yArr[y1], valY0, valY1);
    }

    function getOgeVal(dataArray, altIdx, tempIdx) {
        let a0 = Math.floor(altIdx); let a1 = Math.ceil(altIdx);
        let t0 = Math.floor(tempIdx); let t1 = Math.ceil(tempIdx);
        let aFrac = altIdx - a0; let tFrac = tempIdx - t0;

        let val00 = dataArray[a0][t0]; let val01 = dataArray[a0][t1];
        let val10 = dataArray[a1][t0]; let val11 = dataArray[a1][t1];

        let val0 = interpolate1D(tFrac, 0, 1, val00, val01);
        let val1 = interpolate1D(tFrac, 0, 1, val10, val11);
        return interpolate1D(aFrac, 0, 1, val0, val1);
    }

    calculatePerformance = function() {
        let alt = parseFloat(perfData.alt) || 0;
        let temp = parseFloat(perfData.temp) || 0;
        let wt = parseFloat(perfData.weight) || 16000;
        let vs = parseFloat(perfData.vs) || 0;

        // 경고 검증 로직 추가
        perfResults.outOfLimits = (alt > 14000 || temp > 40 || temp < -34);

        let cAlt = Math.max(0, Math.min(14000, alt));
        let cTemp = Math.max(-34, Math.min(40, temp));

        // 1. MTA
        let altIdx = cAlt / 1000;
        let alt0 = Math.floor(altIdx);
        let alt1 = Math.ceil(altIdx);
        let altFrac = altIdx - alt0;

        let tempIdx = (cTemp + 34) / 2;
        let temp0 = Math.floor(tempIdx);
        let temp1 = Math.ceil(tempIdx);
        let tempFrac = tempIdx - temp0;

        function getMtaVal(r, c) {
            if(r >= mta30_data.length || c >= mta30_data[r].length) return null;
            return mta30_data[r][c];
        }

        let mta00 = getMtaVal(alt0, temp0); let mta01 = getMtaVal(alt0, temp1);
        let mta10 = getMtaVal(alt1, temp0); let mta11 = getMtaVal(alt1, temp1);

        if (mta00 && mta01 && mta10 && mta11) {
            let mta0 = interpolate1D(tempFrac, 0, 1, mta00, mta01);
            let mta1 = interpolate1D(tempFrac, 0, 1, mta10, mta11);
            let mta30 = interpolate1D(altFrac, 0, 1, mta0, mta1);

            perfResults.mta30 = mta30.toFixed(1);
            perfResults.mta10 = (mta30 + 7).toFixed(1); 
            perfResults.mta25 = (mta30 + 11).toFixed(1); 
        } else {
            perfResults.mta30 = "N/A"; perfResults.mta10 = "N/A"; perfResults.mta25 = "N/A";
        }

        // 2. OGE 
        let oAltIdx = Math.max(0, Math.min(6, cAlt / 1000));
        let oTempIdx = Math.max(0, Math.min(9, (cTemp - (-10)) / 5));

        let oge16k = getOgeVal(oge16000_data, oAltIdx, oTempIdx);
        let oge19k = getOgeVal(oge19200_data, oAltIdx, oTempIdx);

        let w_factor = (wt - 16000) / (19200 - 16000);
        let finalOGE = interpolate1D(w_factor, 0, 1, oge16k, oge19k);

        perfResults.oge = finalOGE.toFixed(1);
        perfResults.oge_gonogo = oge19k.toFixed(1); 

        // 3. IGE 
        function getIGEfromOGE(targetOGE) {
            let ige = 0;
            for (let i = 0; i < igeOgeMap.length - 1; i++) {
                if (targetOGE >= igeOgeMap[i][0] && targetOGE <= igeOgeMap[i+1][0]) {
                    ige = interpolate1D(targetOGE, igeOgeMap[i][0], igeOgeMap[i+1][0], igeOgeMap[i][1], igeOgeMap[i+1][1]);
                    break;
                }
            }
            if (targetOGE < igeOgeMap[0][0]) ige = igeOgeMap[0][1] - (igeOgeMap[0][0] - targetOGE); 
            if (targetOGE > igeOgeMap[igeOgeMap.length-1][0]) ige = igeOgeMap[igeOgeMap.length-1][1] + (targetOGE - igeOgeMap[igeOgeMap.length-1][0]);
            return ige;
        }

        perfResults.ige = getIGEfromOGE(finalOGE).toFixed(1);
        perfResults.ige_gonogo = getIGEfromOGE(oge19k).toFixed(1);

        // 4. Vy
        let vyCalc = interpolate2D(vyTemps, vyWeights, vyData, cTemp, wt);
        perfResults.vy = vyCalc.toFixed(1);

        // 5. VS Torque Margin
        let absVs = Math.abs(vs);
        let vsTqCalc = 0;
        if (vs > 0) {
            vsTqCalc = interpolate2D(vsRates, vsWeights, climbData, absVs, wt);
            perfResults.vsTq = "+" + vsTqCalc.toFixed(1);
        } else if (vs < 0) {
            vsTqCalc = interpolate2D(vsRates, vsWeights, descentData, absVs, wt);
            perfResults.vsTq = "-" + vsTqCalc.toFixed(1);
        } else {
            perfResults.vsTq = "0.0";
        }
    };
    })();

    // --- High-fidelity SVG Icons ---
    const homeButtons = [
        /* Row 1 */
        /* Weather — sun + cloud + rain */
        { id: 'weather', text: 'Windy', icon: '<svg viewBox="0 0 100 100"><circle cx="38" cy="38" r="16" fill="#ffcc00"/><ellipse cx="55" cy="54" rx="22" ry="14" fill="#bdbdbd"/><ellipse cx="38" cy="54" rx="16" ry="13" fill="#e0e0e0"/><line x1="44" y1="70" x2="40" y2="82" stroke="#42a5f5" stroke-width="3" stroke-linecap="round"/><line x1="55" y1="70" x2="51" y2="82" stroke="#42a5f5" stroke-width="3" stroke-linecap="round"/><line x1="66" y1="70" x2="62" y2="82" stroke="#42a5f5" stroke-width="3" stroke-linecap="round"/></svg>' },
        /* 저고도 날씨 — helicopter */
        { id: 'directTo', text: '저고도<br>날씨', icon: '<svg viewBox="0 0 100 100"><line x1="14" y1="24" x2="86" y2="24" stroke="#00e5ff" stroke-width="5" stroke-linecap="round"/><line x1="50" y1="24" x2="50" y2="36" stroke="#00e5ff" stroke-width="4"/><ellipse cx="46" cy="52" rx="26" ry="14" fill="none" stroke="#00e5ff" stroke-width="5"/><path d="M72 50 L90 54 L90 62 L58 62" fill="none" stroke="#00e5ff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><line x1="88" y1="46" x2="88" y2="60" stroke="#00e5ff" stroke-width="4" stroke-linecap="round"/><line x1="32" y1="66" x2="32" y2="74" stroke="#00e5ff" stroke-width="4"/><line x1="60" y1="66" x2="60" y2="74" stroke="#00e5ff" stroke-width="4"/><line x1="24" y1="74" x2="68" y2="74" stroke="#00e5ff" stroke-width="4" stroke-linecap="round"/></svg>' },
        /* CCTV — BADA/Park 선택 (video camera) */
        { id: 'cctv', text: 'CCTV', icon: '<svg viewBox="0 0 100 100"><rect x="10" y="30" width="55" height="40" rx="5" fill="none" stroke="#00e5ff" stroke-width="5"/><polygon points="65,40 88,28 88,72 65,60" fill="#00e5ff"/><circle cx="35" cy="50" r="10" fill="none" stroke="#00e5ff" stroke-width="4"/><circle cx="35" cy="50" r="4" fill="#00e5ff"/><path d="M10 78 Q50 90 90 78" fill="none" stroke="#00e5ff" stroke-width="3" stroke-dasharray="4,3"/></svg>' },
        /* PERF — colored bar chart */
        { id: 'metar', text: 'METAR/<br>TAF', icon: '<svg viewBox="0 0 100 100"><line x1="15" y1="35" x2="65" y2="35" stroke="#29b6f6" stroke-width="6" stroke-linecap="round"/><polygon points="60,25 78,35 60,45" fill="#29b6f6"/><line x1="15" y1="55" x2="55" y2="55" stroke="#29b6f6" stroke-width="6" stroke-linecap="round"/><polygon points="50,45 68,55 50,65" fill="#29b6f6"/><rect x="78" y="18" width="8" height="42" rx="4" fill="none" stroke="#ef5350" stroke-width="3"/><rect x="79.5" y="40" width="5" height="22" rx="2.5" fill="#ef5350"/><circle cx="82" cy="66" r="7" fill="#ef5350"/></svg>' },
        /* Row 2 */
        /* METAR/TAF — wind arrows + thermometer */
        { id: 'perf', text: 'PERF', icon: '<svg viewBox="0 0 100 100"><line x1="18" y1="15" x2="18" y2="82" stroke="#fff" stroke-width="4"/><line x1="18" y1="82" x2="88" y2="82" stroke="#fff" stroke-width="4"/><rect x="26" y="48" width="15" height="34" rx="2" fill="#e91e63"/><rect x="48" y="28" width="15" height="54" rx="2" fill="#00e5ff"/><rect x="70" y="38" width="15" height="44" rx="2" fill="#e91e63"/></svg>' },
        /* Charts — bar chart with colored bars */
        { id: 'charts', text: 'Charts', icon: '<svg viewBox="0 0 100 100"><rect x="20" y="10" width="60" height="80" rx="4" fill="#0a0a0a" stroke="#00e5ff" stroke-width="4"/><circle cx="50" cy="50" r="19" fill="none" stroke="#00e5ff" stroke-width="2.5"/><line x1="50" y1="28" x2="50" y2="72" stroke="#00e5ff" stroke-width="1.5"/><line x1="28" y1="50" x2="72" y2="50" stroke="#00e5ff" stroke-width="1.5"/><rect x="45" y="40" width="10" height="26" rx="1.5" transform="rotate(35 50 53)" fill="#fff" stroke="#fff" stroke-width="1"/><path d="M30 82 L50 53 L74 22" fill="none" stroke="#ff1744" stroke-width="2.5" stroke-dasharray="5,3"/><polygon points="74,22 66,26 71,31" fill="#ff1744"/></svg>' },
        /* NOTAM — yellow warning triangle + NOTAM text */
        { id: 'notam', text: 'NOTAM', icon: '<svg viewBox="0 0 100 100"><polygon points="50,10 95,88 5,88" fill="none" stroke="#f5c518" stroke-width="6"/><polygon points="50,10 95,88 5,88" fill="#1a1500"/><text x="50" y="66" font-size="22" font-weight="bold" text-anchor="middle" fill="#f5c518" font-family="monospace">!</text><text x="50" y="84" font-size="12" font-weight="bold" text-anchor="middle" fill="#f5c518" font-family="monospace">NOTAM</text></svg>' },
        /* Services — headphone */
        { id: 'serv', text: 'Services', icon: '<svg viewBox="0 0 100 100"><path d="M22 52 C22 28, 78 28, 78 52" fill="none" stroke="#00e5ff" stroke-width="6"/><rect x="14" y="50" width="14" height="24" rx="6" fill="#00e5ff"/><rect x="72" y="50" width="14" height="24" rx="6" fill="#00e5ff"/><path d="M78 68 C78 80, 62 85, 50 85" fill="none" stroke="#00e5ff" stroke-width="4"/></svg>' },
        /* Row 3 */
        /* Aircraft Systems — monitor screen */
        { id: 'sys', text: 'Track &<br>Point', icon: '<svg viewBox="0 0 100 100"><polyline points="18,80 42,52 60,64 84,26" fill="none" stroke="#00e5ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="7,5"/><circle cx="18" cy="80" r="6" fill="#00e5ff"/><circle cx="42" cy="52" r="6" fill="#00e5ff"/><circle cx="60" cy="64" r="6" fill="#00e5ff"/><path d="M84 12 C74 12 70 20 70 26 C70 34 84 44 84 44 C84 44 98 34 98 26 C98 20 94 12 84 12 Z" fill="#ff5252" transform="translate(-8,0)"/><circle cx="76" cy="25" r="4" fill="#fff"/></svg>' },
        /* Flight Plan — dashed waypoint path */
        { id: 'fpl', text: 'Flight Plan', icon: '<svg viewBox="0 0 100 100"><circle cx="18" cy="78" r="6" fill="#00e5ff"/><circle cx="45" cy="45" r="6" fill="#00e5ff"/><circle cx="82" cy="22" r="6" fill="#00e5ff"/><line x1="18" y1="78" x2="45" y2="45" stroke="#00e5ff" stroke-width="4" stroke-dasharray="6,4"/><line x1="45" y1="45" x2="82" y2="22" stroke="#00e5ff" stroke-width="4" stroke-dasharray="6,4"/></svg>' },
        /* PROC — Y-fork cyan */
        { id: 'proc', text: 'PROC', icon: '<svg viewBox="0 0 100 100"><line x1="50" y1="85" x2="50" y2="50" stroke="#00e5ff" stroke-width="6" stroke-linecap="round"/><line x1="50" y1="50" x2="20" y2="20" stroke="#00e5ff" stroke-width="6" stroke-linecap="round"/><line x1="50" y1="50" x2="80" y2="20" stroke="#00e5ff" stroke-width="6" stroke-linecap="round"/><rect x="43" y="70" width="14" height="10" rx="3" fill="#00e5ff"/></svg>' },
        /* VNAV — 강하 경로 */
        { id: 'vnav', text: 'VNAV', icon: '<svg viewBox="0 0 100 100"><line x1="12" y1="18" x2="12" y2="84" stroke="#888" stroke-width="3"/><line x1="12" y1="84" x2="92" y2="84" stroke="#888" stroke-width="3"/><line x1="20" y1="28" x2="82" y2="74" stroke="#ff4dd2" stroke-width="5" stroke-linecap="round"/><circle cx="20" cy="28" r="5" fill="#ff4dd2"/><polygon points="82,74 73,71 77,81" fill="#ff4dd2"/></svg>' },
        /* Row 4 */
        /* Map Settings — green map + red pin */
        { id: 'map', text: 'MAP', icon: '<svg viewBox="0 0 100 100"><rect x="12" y="22" width="76" height="56" rx="4" fill="#2e7d32"/><path d="M12 42 L30 32 L55 48 L76 34 L88 42 L88 78 L12 78Z" fill="#388e3c"/><circle cx="30" cy="35" r="10" fill="#e53935"/><circle cx="30" cy="35" r="5" fill="#fff"/><line x1="30" y1="45" x2="30" y2="56" stroke="#e53935" stroke-width="3"/></svg>' },
        /* Checklist — clipboard + checkmarks */
        { id: 'check', text: 'Checklist', icon: '<svg viewBox="0 0 100 100"><rect x="22" y="14" width="56" height="72" rx="4" fill="none" stroke="#fff" stroke-width="5"/><rect x="36" y="8" width="28" height="12" rx="4" fill="#555"/><polyline points="30,38 38,48 52,28" fill="none" stroke="#00e5ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><line x1="57" y1="38" x2="70" y2="38" stroke="#aaa" stroke-width="4" stroke-linecap="round"/><polyline points="30,58 38,68 52,48" fill="none" stroke="#00e5ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><line x1="57" y1="58" x2="70" y2="58" stroke="#aaa" stroke-width="4" stroke-linecap="round"/></svg>' },
        /* Utilities — wrench */
        { id: 'util', text: 'Utilities', icon: '<svg viewBox="0 0 100 100"><path d="M62 22 C75 22, 84 32, 80 44 L48 76 C44 88, 28 88, 22 78 C16 68, 22 54, 34 52 L66 20" fill="none" stroke="#9e9e9e" stroke-width="8" stroke-linecap="round"/><circle cx="34" cy="66" r="8" fill="none" stroke="#9e9e9e" stroke-width="5"/><line x1="72" y1="22" x2="82" y2="12" stroke="#9e9e9e" stroke-width="6" stroke-linecap="round"/></svg>' },
        /* AS-565 Performance — orange trend line */
        /* INFO — 비행장 정보 (control tower + freq) */
        { id: 'afld', text: 'INFO', icon: '<svg viewBox="0 0 100 100"><rect x="42" y="30" width="16" height="52" fill="#00e5ff"/><polygon points="34,30 66,30 58,18 42,18" fill="#00e5ff"/><circle cx="50" cy="12" r="4" fill="#ff5252"/><path d="M62 20 a14 14 0 0 1 10 10" fill="none" stroke="#ffca28" stroke-width="4"/><path d="M38 20 a14 14 0 0 0 -10 10" fill="none" stroke="#ffca28" stroke-width="4"/><rect x="30" y="82" width="40" height="6" fill="#00e5ff"/></svg>' },
        /* Row 5 */
        /* SkyVector — 항공 차트 (지구+경위선) */
        { id: 'skyvector', text: 'SkyVector', icon: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="none" stroke="#00e5ff" stroke-width="4"/><ellipse cx="50" cy="50" rx="14" ry="34" fill="none" stroke="#00e5ff" stroke-width="3"/><line x1="16" y1="50" x2="84" y2="50" stroke="#00e5ff" stroke-width="3"/><line x1="50" y1="16" x2="50" y2="84" stroke="#00e5ff" stroke-width="3"/></svg>' },
        /* Tide forecast — 파도 */
        { id: 'tide', text: 'Tide<br>forecast', icon: '<svg viewBox="0 0 100 100"><path d="M8 46 q11 -14 22 0 t22 0 t22 0 t22 0" fill="none" stroke="#29b6f6" stroke-width="5"/><path d="M8 62 q11 -14 22 0 t22 0 t22 0 t22 0" fill="none" stroke="#29b6f6" stroke-width="5"/><path d="M8 78 q11 -14 22 0 t22 0 t22 0 t22 0" fill="none" stroke="#4fc3f7" stroke-width="5"/></svg>' },
        /* ER availability — 응급실 십자 */
        { id: 'eravail', text: 'ER<br>availability', icon: '<svg viewBox="0 0 100 100"><rect x="18" y="18" width="64" height="64" rx="10" fill="none" stroke="#ff5252" stroke-width="5"/><rect x="44" y="30" width="12" height="40" fill="#ff5252"/><rect x="30" y="44" width="40" height="12" fill="#ff5252"/></svg>' },
        /* Wildfire status — 불꽃 */
        { id: 'wildfire', text: 'Wildfire<br>status', icon: '<svg viewBox="0 0 100 100"><path d="M50 12 C58 34 78 40 72 62 C68 82 50 88 40 80 C28 70 34 58 40 52 C40 62 48 64 50 60 C54 52 42 46 50 12 Z" fill="#ff7043" stroke="#ff5722" stroke-width="3"/></svg>' }
    ];

    function switchMode(mode, target = '') {
        currentMode = mode;
        if(target) inputTarget = target;
        
        if (mode === 'PERF_INPUT') {
            // target 없이 들어오면 inputTarget이 COM 쪽 값일 수 있으므로 방어
            if (!(inputTarget in perfData)) inputTarget = 'alt';
            currentInput = String(perfData[inputTarget]);
            hasStartedTyping = false; 
        } else if (mode === 'COM_INPUT') {
            if (!freqs[inputTarget]) inputTarget = 'com1';
            currentInput = freqs[inputTarget].stb.replace(/\./g, '');
            hasStartedTyping = false; 
        } else if (mode === 'XPDR_CODE') {
            xpdrInput = xpdrState.code;
            hasStartedTyping = false;
        } else if (mode === 'SELCAL_INPUT') {
            selcalInput = selcalCode;
            hasStartedTyping = false;
        } else if (mode === 'CHARTS') {
            expandedAirport = null;
        }

        renderContent();
    }

    function switchAudioTab(tab) {
        audioTab = tab;
        renderContent();
    }

    function toggleClicks() {
        clicksState = clicksState === 'Off' ? 'On' : 'Off';
        renderContent();
    }

    function setVoxMode(mode) {
        voxState = mode;
        renderContent();
    }

    // --- Modularized Render Functions ---
    
    function renderHomeScreen(container, footer, title) {
        title.innerText = "Home";
        
        let gridHtml = `<div class="home-grid">`;
        homeButtons.forEach(btn => {
            const links = {
                'weather': "https://www.windy.com",
                'notam': "https://aim.koca.go.kr/xNotam/index.do?type=search2&language=ko_KR",
                'serv': "https://thdenfl.tistory.com",
                'metar': "https://global.amo.go.kr/observation/metar.do",
                'directTo': "https://global.amo.go.kr/aami/lamis/main",
                'skyvector': "https://skyvector.com",
                'tide': "https://www.khoa.go.kr/swtc/mobile.do",
                'eravail': "https://mediboard.nemc.or.kr/emergency_room_in_hand",
                'wildfire': "https://fd.forest.go.kr/ffas/"
            };

            let isActiveBtn = ['weather', 'charts', 'notam', 'metar', 'directTo', 'map', 'fpl', 'serv', 'sys', 'perf', 'util', 'proc', 'cctv', 'vnav', 'check', 'afld', 'skyvector', 'tide', 'eravail', 'wildfire'].includes(btn.id);
            let boxClass = isActiveBtn ? 'icon-box func-active' : 'icon-box';

            if (links[btn.id]) {
                gridHtml += `
                    <a href="${links[btn.id]}" target="_blank" class="home-icon-wrapper" style="text-decoration:none; color:inherit;">
                        <div class="${boxClass}">${btn.icon}</div>
                        <div class="icon-label">${btn.text}</div>
                    </a>`;
            } else {
                let clickAction = btn.id === 'sys' ? `data-act="switchMode" data-arg='["TRACKPOINT"]'` :
                                  btn.id === 'perf' ? `data-act="switchMode" data-arg='["PERF"]'` :
                                  btn.id === 'fpl'  ? `data-act="openFlightPlan"` :
                                  btn.id === 'proc' ? `data-act="openProc"` :
                                  btn.id === 'util' ? `data-act="utilOpen" data-arg='["MENU"]'` :
                                  btn.id === 'map'  ? `data-act="cduOpenMap"` :
                                  btn.id === 'check' ? `data-act="clOpen"` :
                                  btn.id === 'afld' ? `data-act="switchMode" data-arg='["AIRFIELD"]'` :
                                  btn.id === 'cctv' ? `data-act="switchMode" data-arg='["CCTV"]'` :
                                  btn.id === 'vnav' ? `data-act="utilOpen" data-arg='["VNAV"]'` :
                                  btn.id === 'charts' ? `data-act="switchMode" data-arg='["CHARTS"]'` : '';
                gridHtml += `
                    <div class="home-icon-wrapper" ${clickAction}>
                        <div class="${boxClass}">${btn.icon}</div>
                        <div class="icon-label">${btn.text}</div>
                    </div>`;
            }
        });
        gridHtml += `</div>`;
        container.innerHTML = gridHtml;
        footer.innerHTML = cduFooter('', `<div class="nav-btn" data-act="openUbikais"><span>🛰</span>UBIKAIS</div>`);
    }

    const UBIKAIS_URL = 'https://ubikais.fois.go.kr:8030/common/login?systemId=sysUbikais';

    // UBIKAIS 는 모바일 브라우저를 서버에서 걸러 낸다. 브라우저가 보내는
    // User-Agent 를 웹 페이지가 바꿀 방법은 없으므로 앱이 대신 통과시켜 줄 수는 없다.
    // 다만 브라우저의 '데스크톱 사이트' 설정을 켜면 UA 가 PC 것으로 바뀌어 열린다.
    // 그래서 모바일에서는 링크만 던지지 않고 그 한 단계를 함께 안내한다.
    // (PC 는 곧장 새 탭으로 연다 — 안내가 필요 없다)
    function openUbikais() {
        if (!uiIsMobile()) { uiOpenExternal(UBIKAIS_URL); return; }
        const ios = /iP(ad|hone|od)/.test(navigator.userAgent || '') ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const how = ios
            ? '사파리 주소창 왼쪽 [ㅏA] → "데스크탑 웹사이트 요청"'
            : '크롬 우측 상단 [⋮] → "데스크톱 사이트" 체크';
        uiConfirm(
            'UBIKAIS 는 모바일 브라우저로는 접속이 막혀 있습니다.\n' +
            '브라우저를 PC 모드로 바꾸면 그대로 열립니다.\n\n' +
            `① 아래 [새 탭에서 열기] 를 누릅니다\n` +
            `② ${how}\n` +
            '③ 새로고침하면 로그인 화면이 나옵니다\n\n' +
            '(한 번 켜 두면 그 브라우저는 다음부터 기억합니다)',
            { okText: '새 탭에서 열기', cancelText: '취소', linkHref: UBIKAIS_URL });
    }

    function renderPerfScreen(container, footer, title) {
        calculatePerformance(); 
        title.innerText = "Performance (Hover & Climb)";
        
        let warningHtml = perfResults.outOfLimits ? 
            `<div style="background-color:#3a0000; border:1px solid #f44336; color:#f44336; font-size:9px; font-weight:bold; text-align:center; padding:3px; border-radius:3px; margin-bottom:8px; animation: blink 1.5s infinite;">⚠️ CAUTION: OUT OF CHART LIMITS (Data Capped)</div>` : '';

        container.innerHTML = `
            ${warningHtml}
            <div style="display:flex; justify-content:space-between; align-items:flex-end; padding:0 5px 5px 5px; border-bottom:1px solid #333; margin-bottom:10px;">
                <span style="color:white; font-size:10px; font-weight:bold;">CONDITIONS</span>
                <span style="color:white; font-size:10px; font-weight:bold;">RESULTS</span>
            </div>
            
            <div style="display:flex; gap:8px; height:100%;">
                <div style="flex:1; display:flex; flex-direction:column; gap:8px; justify-content:flex-start;">
                    <div>
                        <div class="perf-label">ALTITUDE (FT)</div>
                        <div class="perf-val-box" data-act="switchMode" data-arg='["PERF_INPUT","alt"]'>${perfData.alt}</div>
                    </div>
                    <div>
                        <div class="perf-label">TEMP (OAT °C)</div>
                        <div class="perf-val-box" data-act="switchMode" data-arg='["PERF_INPUT","temp"]'>${perfData.temp}</div>
                    </div>
                    <div>
                        <div class="perf-label">GROSS WT (LBS)</div>
                        <div class="perf-val-box" data-act="switchMode" data-arg='["PERF_INPUT","weight"]'>${perfData.weight}</div>
                    </div>
                    <div>
                        <div class="perf-label">V/S (FPM)</div>
                        <div class="perf-val-box" data-act="switchMode" data-arg='["PERF_INPUT","vs"]'>${perfData.vs}</div>
                    </div>
                </div>
                
                <div style="width:1px; background:#333;"></div>

                <div style="flex:1.4; display:flex; flex-direction:column; justify-content:flex-start; gap: 6px;">
                    <div style="display:flex; gap:5px;">
                        <div style="flex:1;">
                            <div class="perf-result-title">IGE TQ</div>
                            <div class="perf-result-box" style="color:#0f0;">${perfResults.ige}%</div>
                        </div>
                        <div style="flex:1;">
                            <div class="perf-result-title">OGE TQ</div>
                            <div class="perf-result-box" style="color:#0f0;">${perfResults.oge}%</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <div style="flex:1;">
                            <div class="perf-result-title">IGE GO/NO-GO</div>
                            <div class="perf-result-box" style="color:#ff9800;">${perfResults.ige_gonogo}%</div>
                        </div>
                        <div style="flex:1;">
                            <div class="perf-result-title">OGE GO/NO-GO</div>
                            <div class="perf-result-box" style="color:#ff9800;">${perfResults.oge_gonogo}%</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <div style="flex:1;">
                            <div class="perf-result-title">Vy (IAS)</div>
                            <div class="perf-result-box" style="color:#fff;">${perfResults.vy} KT</div>
                        </div>
                        <div style="flex:1;">
                            <div class="perf-result-title">V/S ∆TQ</div>
                            <div class="perf-result-box" style="color:#fff;">${perfResults.vsTq}%</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <div style="flex:1;">
                            <div class="perf-result-title">MTA(30)</div>
                            <div class="perf-result-box" style="color:var(--text-cyan); font-size:10.5px;">${perfResults.mta30}%</div>
                        </div>
                        <div style="flex:1;">
                            <div class="perf-result-title">MTA(10)</div>
                            <div class="perf-result-box" style="color:yellow; font-size:10.5px;">${perfResults.mta10}%</div>
                        </div>
                        <div style="flex:1;">
                            <div class="perf-result-title">MTA(2.5)</div>
                            <div class="perf-result-box" style="color:#f44336; font-size:10.5px;">${perfResults.mta25}%</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        footer.innerHTML = cduFooter("switchMode('HOME')");
    }

    function renderPerfInputScreen(container, footer, title) {
        let titleText = inputTarget === 'alt' ? 'ALTITUDE' : 
                        (inputTarget === 'temp' ? 'TEMPERATURE' : 
                        (inputTarget === 'vs' ? 'VERTICAL SPEED (FPM)' : 'GROSS WEIGHT'));
        title.innerText = `${titleText} ENTRY`;
        
        let displayVal = !hasStartedTyping ? perfData[inputTarget] : currentInput;
        if (displayVal === "") displayVal = "0";

        container.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; padding-top:20px;">
            <div class="input-row" style="margin-top:0;">
                <div class="freq-box-main" style="width:150px;">${displayVal}</div>
                <div class="item-btn" style="width:45px; height:45px;" data-act="backspaceInput">⬅<br>Bksp</div>
            </div>
            <div class="numpad-grid" style="margin-top:10px;">
                ${[1,2,3,4,5,6,7,8,9].map(n => `<div class="num-circle" data-act="addInput" data-arg='["${n}"]'>${n}</div>`).join('')}
                <div class="num-circle" data-act="addInput" data-arg='["-"]'>-</div>
                <div class="num-circle" data-act="addInput" data-arg='["0"]'>0</div>
                <div></div>
            </div></div>`;
        
        footer.innerHTML = cduFooter("switchMode('PERF')", `<div class="nav-btn enter-btn-blue" data-act="confirmPerfInput"><span>↩</span>Enter</div>`);
    }

    function renderAudioScreen(container, footer, title) {
        title.innerText = "Audio & Radios";
        
        let audioContent = '';

        if (audioTab === 'COM') {
            audioContent = `
                <div style="display:flex; justify-content:space-between; font-size:7px; color:#888; margin-bottom:5px; padding: 0 60px 0 100px;">
                    <span>Volume</span><span>Control</span>
                </div>
                ${renderAudioRow('COM1', 'com1')} 
                ${renderAudioRow('COM2', 'com2')} 
                ${renderAudioRow('U/VHF', 'uvhf')}
                <div class="volume-row">
                    <div class="item-btn">▶<br>Playback</div>
                    <div class="wedge-slider" style="grid-column: span 2;" data-act="handleVol" data-on="pointerdown" data-arg='["pb","$event","$el"]'>
                        <span class="wedge-text">${volumes.pb}%</span>
                        <div class="wedge-fill" style="width:${volumes.pb}%"></div>
                    </div>
                    <div style="display:flex; gap:3px;">
                        <button class="item-btn" style="width:30px; height:35px;">|◀</button>
                        <button class="item-btn" style="width:30px; height:35px;">▶|</button>
                    </div>
                </div>
            `;
        } 
        else if (audioTab === 'NAV') {
            audioContent = `
                <div style="display:flex; justify-content:space-between; font-size:7px; color:#ccc; margin-bottom:4px; padding: 0 70px 0 80px;">
                    <span>Volume</span><span>Control</span>
                </div>
                <div style="display: grid; grid-template-columns: 60px 1fr 80px; align-items: center; margin-bottom: 7px; gap: 6px;">
                    <div class="item-btn ${monStates.speaker?'on':''}" data-act="toggleMon" data-arg='["speaker"]'>Speaker<div class="status-line"></div></div>
                    <div class="wedge-slider" data-act="handleVol" data-on="pointerdown" data-arg='["speaker","$event","$el"]'>
                        <span class="wedge-text">${volumes.speaker}%</span>
                        <div class="wedge-fill" style="width:${volumes.speaker}%"></div>
                    </div>
                    <div></div>
                </div>
                <div style="display: grid; grid-template-columns: 60px 1fr 80px; align-items: center; margin-bottom: 7px; gap: 6px;">
                    <div class="item-btn">▶<br>Playback</div>
                    <div class="wedge-slider" data-act="handleVol" data-on="pointerdown" data-arg='["pb","$event","$el"]'>
                        <span class="wedge-text">${volumes.pb}%</span>
                        <div class="wedge-fill" style="width:${volumes.pb}%"></div>
                    </div>
                    <div style="display:flex; gap:4px;">
                        <button class="item-btn" style="flex:1; height:35px; font-size:9px;">|◀◀</button>
                        <button class="item-btn" style="flex:1; height:35px; font-size:9px;">▶▶|</button>
                    </div>
                </div>
                ${renderNavRow('NAV1', 'nav1')}
                ${renderNavRow('NAV2', 'nav2')}
            `;
        }
        else if (audioTab === 'Mission') {
            audioContent = `
                <div style="margin-bottom: 6px;">
                    <div style="display:flex; justify-content:space-between; font-size:7px; color:#ccc; margin-bottom:4px; padding: 0 45px 0 130px;">
                        <span>Volume</span><span>Control</span>
                    </div>
                    ${renderMissionRow('VHF-FM', 'vhffm')}
                </div>
                <div style="margin-bottom: 6px;">
                    ${renderMissionRow('HF', 'hf')}
                </div>
                <div class="volume-row">
                    <div class="item-btn ${monStates.selcal?'on':''}" data-act="toggleMon" data-arg='["selcal"]'>SELCAL<div class="status-line"></div></div>
                    <div></div>
                    <div></div>
                    <div class="freq-display-box" style="align-items:center; justify-content:center;" data-act="switchMode" data-arg='["SELCAL_INPUT"]'>
                        <div style="color:white; font-size:7px; margin-bottom:2px;">SELCAL ID</div>
                        <div style="color:var(--text-cyan); font-size:11px; font-weight:bold;">${selcalCode}</div>
                    </div>
                </div>
            `;
        } 
        else if (audioTab === 'Other') {
            audioContent = `
                <div style="display:flex; justify-content:space-between; font-size:7px; color:#ccc; margin-bottom:4px; padding: 0 50px 0 130px;">
                    <span>Volume</span><span>Control</span>
                </div>
                <div style="display: flex; gap: 8px; margin-bottom: 8px; padding-left: 5px;">
                    <div class="item-btn" style="width: 65px; height: 35px;" data-act="toggleClicks">
                        <span style="font-size: 9px; color: white;">Clicks</span>
                        <span style="font-size: 10px; color: var(--text-cyan); font-weight: bold; margin-top: 2px;">${clicksState}</span>
                    </div>
                    <div class="wedge-slider" style="width: 140px; height: 30px; align-self: center;" data-act="handleVol" data-on="pointerdown" data-arg='["clicks","$event","$el"]'>
                        <span class="wedge-text">${volumes.clicks}%</span>
                        <div class="wedge-fill" style="width:${volumes.clicks}%"></div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; padding-left: 5px;">
                    <div class="item-btn ${micSelected === 'PA' ? 'on' : ''}" style="width: 65px; height: 35px;" data-act="setMic" data-arg='["PA"]'>
                        <span style="font-size: 9px;">PA</span>
                        <div class="status-line"></div>
                    </div>
                    <div style="flex: 1; background: black; border: 0.7px solid #444; border-radius: 4px; height: 35px;"></div>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="sub-header">
                <div class="user-3d-btn" style="width:57px;">User<br><span style="color:var(--text-cyan)">Pilot</span></div>
                <div class="tab-container">
                    <div class="tab ${audioTab==='COM'?'active':''}" data-act="switchAudioTab" data-arg='["COM"]'>COM</div>
                    <div class="tab ${audioTab==='NAV'?'active':''}" data-act="switchAudioTab" data-arg='["NAV"]'>NAV</div>
                    <div class="tab ${audioTab==='Mission'?'active':''}" data-act="switchAudioTab" data-arg='["Mission"]'>Mission</div>
                    <div class="tab ${audioTab==='Other'?'active':''}" data-act="switchAudioTab" data-arg='["Other"]'>Other</div>
                </div>
            </div>
            <div class="panel-border">
                ${audioContent}
            </div>`;
        footer.innerHTML = cduFooter("switchMode('HOME')");
    }

    function renderIntercomScreen(container, footer, title) {
        title.innerText = "Intercom";
        container.innerHTML = `
            <div class="sub-header" style="justify-content: space-between; padding-bottom:5px;">
                <div class="user-3d-btn" style="width:60px;">User<br><span style="color:var(--text-cyan)">CoPilot</span></div>
                <div class="wedge-slider" style="flex:1; margin:0 8px;" data-act="handleVol" data-on="pointerdown" data-arg='["intercom","$event","$el"]'>
                    <span class="wedge-text">${volumes.intercom}%</span>
                    <div class="wedge-fill" style="width:${volumes.intercom}%"></div>
                </div>
                <div class="item-btn ${icStates.Isolate?'on':''}" style="width:45px; height:37px;" data-act="toggleIsolate">Isolate<div class="status-line"></div></div>
                <div class="item-btn" style="width:40px; height:37px;" data-act="switchMode" data-arg='["VOX_MODE"]'>VOX<br><span style="color:var(--text-cyan)">${voxState.toUpperCase()}</span></div>
            </div>
            <div class="panel-border" style="padding-top:12px;">
                <div class="intercom-grid">
                    <div class="item-btn ${icStates.CoPilot?'on':''}" style="height:60px;" data-act="toggleIC" data-arg='["CoPilot"]'>👨‍✈️<br>CoPilot<div class="status-line"></div></div>
                    <div class="item-btn ${icStates.Pilot?'on':''}" style="height:60px;" data-act="toggleIC" data-arg='["Pilot"]'>Pilot<div class="status-line"></div></div>
                    <div class="item-btn ${icStates.Crew1?'on':''}" style="height:60px;" data-act="toggleIC" data-arg='["Crew1"]'>Crew 1<div class="status-line"></div></div>
                    <div class="item-btn ${icStates.Pass?'on':''}" style="height:60px;" data-act="toggleIC" data-arg='["Pass"]'>Pass<div class="status-line"></div></div>
                    <div class="item-btn ${icStates.Crew2?'on':''}" style="height:60px;" data-act="toggleIC" data-arg='["Crew2"]'>Crew 2<div class="status-line"></div></div>
                    <div class="item-btn ${icStates.wICS?'on':''}" style="height:60px;" data-act="toggleIC" data-arg='["wICS"]'>wICS<div class="status-line"></div></div>
                </div>
                <div class="loop-row">
                    <div class="item-btn ${icStates.Loop1?'on':''}" style="flex:1; height:45px;" data-act="toggleIC" data-arg='["Loop1"]'>Loop 1<br>Mission Crew<div class="status-line"></div></div>
                    <div class="item-btn ${icStates.Loop2?'on':''}" style="flex:1; height:45px;" data-act="toggleIC" data-arg='["Loop2"]'>Loop 2<br>All Pass<div class="status-line"></div></div>
                    <div class="item-btn ${icStates.Loop5?'on':''}" style="flex:1; height:45px;" data-act="toggleIC" data-arg='["Loop5"]'>Loop 5<br>All<div class="status-line"></div></div>
                </div>
            </div>`;
        footer.innerHTML = cduFooter("switchMode('HOME')");
    }

    function renderSelcalInputScreen(container, footer, title) {
        title.innerText = "COM SELCAL";
        
        let displayVal = !hasStartedTyping ? selcalCode : selcalInput.padEnd(4, '_');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; padding-top:10px; height:100%;">
                <div style="text-align:center; color:white; font-size:10px; font-weight:bold; margin-bottom:5px;">SELCAL ID</div>
                <div class="input-row" style="margin-top:0; margin-bottom: 15px;">
                    <div class="freq-box-main" style="width:140px; letter-spacing: 8px; font-size: 24px;">${displayVal}</div>
                </div>
                <div class="selcal-grid">
                    ${['A','B','C','D','E', 'F','G','H','J','K', 'L','M','P','Q','R'].map(c => 
                        `<div class="num-circle" style="width:45px; height:45px; font-size:16px;" data-act="addSelcalInput" data-arg='["${c}"]'>${c}</div>`
                    ).join('')}
                    <div class="item-btn" style="width:45px; height:45px;">🔍<br>Find</div>
                    <div style="visibility:hidden"></div>
                    <div class="num-circle" style="width:45px; height:45px; font-size:16px;" data-act="addSelcalInput" data-arg='["S"]'>S</div>
                    <div style="visibility:hidden"></div>
                    <div class="item-btn" style="width:45px; height:45px;" data-act="backspaceSelcal">⬅<br>Bksp</div>
                </div>
            </div>
        `;
        footer.innerHTML = cduFooter(() => { switchMode('AUDIO'); switchAudioTab('Mission'); }, `<div class="nav-btn enter-btn-blue" data-act="confirmSelcal"><span>↩</span>Enter</div>`);
    }

    function renderVoxModeScreen(container, footer, title) {
        title.innerText = "Intercom";

        let isManual = (voxState === 'Manual');
        let sliderOpacity = isManual ? '1' : '0.3';
        let pointerEvents = isManual ? 'auto' : 'none';

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; padding-top:20px; height:100%; width:100%;">
                <div style="color:white; font-size:12px; font-weight:bold; margin-bottom:15px; border-bottom:1px solid #555; width:90%; text-align:center; padding-bottom:5px;">ICS VOX MODE</div>
                
                <div style="display:flex; gap:10px; width:90%; justify-content:center; margin-bottom:25px;">
                    ${['Off', 'Manual', 'Auto'].map(m => 
                        `<div class="item-btn ${voxState === m ? 'on' : ''}" style="flex:1; height:45px; font-size:12px; font-weight:bold;" data-act="setVoxMode" data-arg='["${m}"]'>
                            ${m.toUpperCase()}<div class="status-line"></div>
                        </div>`
                    ).join('')}
                </div>

                <div style="width:90%; opacity:${sliderOpacity}; pointer-events:${pointerEvents}; transition: opacity 0.3s ease;">
                    <div style="font-size:9px; color:#ccc; margin-bottom:5px; text-align:left;">VOX SENSITIVITY (MANUAL)</div>
                    <div class="wedge-slider" style="height:35px; border:1px solid #555; border-radius:4px; margin-bottom:10px;" data-act="handleVol" data-on="pointerdown" data-arg='["vox","$event","$el"]'>
                        <span class="wedge-text" style="font-size:12px; top:11px;">${volumes.vox}%</span>
                        <div class="wedge-fill" style="width:${volumes.vox}%"></div>
                    </div>
                </div>
            </div>
        `;
        footer.innerHTML = cduFooter("switchMode('INTERCOM')");
    }

    function renderHfControlScreen(container, footer, title) {
        title.innerText = "HF";
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; height:100%; padding-top:5px;">
                <div style="border: 1px solid var(--text-cyan); border-radius: 5px; background: #050505; display: flex; flex-direction: column; margin-bottom: 5px; padding: 5px;">
                    <div style="position: relative; height: 45px; display: flex; justify-content: center; align-items: center;">
                        <div style="position: absolute; top: 0; left: 5px; font-size: 9px; color: white;">Active</div>
                        <div style="position: absolute; bottom: 0; left: 20px; font-size: 10px; color: white; font-weight: bold;">${hfState.emission}</div>
                        <div style="font-size: 24px; color: white; font-weight: bold;">${freqs.hf.act}</div>
                    </div>
                    <div style="position: relative; height: 15px; display: flex; justify-content: center; align-items: center;">
                        <div style="width: 100%; height: 1px; background: #555; position: absolute;"></div>
                        <div style="background: #050505; padding: 0 5px; z-index: 1; color: #555; font-size: 10px;">▼</div>
                    </div>
                    <div style="position: relative; height: 50px; display: flex; justify-content: center; align-items: center;">
                        <div style="position: absolute; top: -5px; left: 5px; font-size: 9px; color: white;">Standby</div>
                        <div class="item-btn" style="width: 130px; height: 35px; border: 1px solid var(--text-cyan); background: transparent; color: var(--text-cyan); font-size: 18px; font-weight: bold; cursor: pointer;" data-act="switchMode" data-arg='["COM_INPUT","hf"]'>
                            ${freqs.hf.stb}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 10px; margin-bottom: 2px;">
                    <div class="item-btn" style="flex: 1; height: 45px;" data-act="toggleHfTuning">
                        <div style="font-size: 9px; color: white; margin-bottom: 3px;">Tuning Mode</div>
                        <div style="font-size: 12px; color: var(--text-cyan); font-weight: bold;">${hfState.tuning}</div>
                    </div>
                    <div class="item-btn" style="flex: 1; height: 45px;" data-act="toggleHfEmission">
                        <div style="font-size: 9px; color: white; margin-bottom: 3px;">Emission Mode</div>
                        <div style="font-size: 12px; color: var(--text-cyan); font-weight: bold;">${hfState.emission}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <div class="item-btn" style="width: 45px; height: 45px;">
                        <div style="font-size: 16px; margin-bottom: 2px;">🔍</div>
                        <div style="font-size: 8px; color: white;">Find</div>
                    </div>
                    <div class="item-btn" style="flex: 1; height: 45px;" data-act="toggleHfSql">
                        <div style="font-size: 9px; color: white; margin-bottom: 3px;">SQL LVL</div>
                        <div style="font-size: 12px; color: var(--text-cyan); font-weight: bold;">${hfState.sql}</div>
                    </div>
                    <div class="item-btn" style="flex: 1; height: 45px;" data-act="toggleHfPwr">
                        <div style="font-size: 9px; color: white; margin-bottom: 3px;">XMIT PWR</div>
                        <div style="font-size: 12px; color: var(--text-cyan); font-weight: bold;">${hfState.pwr}</div>
                    </div>
                    <div class="item-btn" style="width: 55px; height: 45px;" data-act="swapFreq" data-arg='["hf"]'>
                        <div style="font-size: 12px; color: white; font-weight: bold;">↕ XFER</div>
                    </div>
                </div>
            </div>
        `;
        footer.innerHTML = cduFooter("switchMode('AUDIO')");
    }

    function renderComInputScreen(container, footer, title) {
        title.innerText = `${inputTarget.toUpperCase()} Standby`;
        
        let displayStr = currentInput;
        if (hasStartedTyping) {
            if (inputTarget === 'hf' && displayStr.length > 2 && !displayStr.includes('.')) {
                displayStr = displayStr.slice(0, 2) + '.' + displayStr.slice(2);
            } 
            else if (inputTarget !== 'hf' && displayStr.length > 3 && !displayStr.includes('.')) {
                displayStr = displayStr.slice(0, 3) + '.' + displayStr.slice(3);
            }
        }
        
        let displayVal = !hasStartedTyping ? freqs[inputTarget].stb : displayStr;
        let activeFreqHtml = '';
        
        if (inputTarget.startsWith('nav')) {
            activeFreqHtml = `
                <div style="text-align:center; color:white; font-size:10px; font-weight:bold; margin-bottom:2px;">${inputTarget.toUpperCase()}</div>
                <div style="text-align:center; color:white; font-size:11px; margin-bottom:10px;">
                    Active Freq: <span style="color:var(--text-green); font-weight:bold;">${freqs[inputTarget].act}</span>
                </div>
            `;
        }

        container.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; padding-top:10px;">
            ${activeFreqHtml}
            <div class="input-row" style="margin-top:0;">
                <div class="item-btn" style="width:45px; height:45px;">🔍<br>Find</div>
                <div class="freq-box-main">${displayVal}</div>
                <div class="item-btn" style="width:45px; height:45px;" data-act="backspaceInput">⬅<br>Bksp</div>
            </div>
            <div class="numpad-grid">
                ${[1,2,3,4,5,6,7,8,9].map(n => `<div class="num-circle" data-act="addInput" data-arg='["${n}"]'>${n}</div>`).join('')}
                <div></div><div class="num-circle" data-act="addInput" data-arg='["0"]'>0</div>
                <div class="item-btn" style="height:55px; font-size:12px;" data-act="handleInputXfer">↕ XFER</div>
            </div></div>`;
        
        let backMode = inputTarget === 'hf' ? "'HF_CONTROL'" : "'AUDIO'";
        footer.innerHTML = cduFooter(`switchMode(${backMode}, '${inputTarget}')`, `<div class="nav-btn enter-btn-blue" data-act="confirmInput"><span>↩</span>Enter</div>`);
    }

    function renderXpdrModeScreen(container, footer, title) {
        title.innerText = "Transponder";
        container.innerHTML = `
            <div style="display:flex; height:100%; padding-top:5px;">
                <div style="flex:1; display:flex; flex-direction:column; gap:6px; border-right:1px solid #333; padding-right:10px;">
                    <div style="color:white; font-size:10px; padding-bottom:3px; border-bottom:1px solid #555;">XPDR/TCAS Mode</div>
                    ${['Auto', 'TA Only', 'Altitude Reporting', 'On', 'Standby'].map(m => 
                        `<div class="item-btn ${xpdrState.mode === m ? 'on' : ''}" style="height:35px; font-size:9px;" data-act="setXpdrMode" data-arg='["${m}"]'>
                            ${m.replace(' ', '<br>')}<div class="status-line"></div>
                        </div>`
                    ).join('')}
                </div>
                <div style="flex:1; display:flex; flex-direction:column; gap:15px; padding-left:10px; justify-content:flex-start; padding-top:20px;">
                    <div class="item-btn" style="height:45px; font-size:10px;">Active<br><span style="color:var(--text-cyan); font-size:11px;">${xpdrState.active}</span></div>
                    <div class="item-btn ${xpdrState.adsb ? 'on' : ''}" style="height:45px; font-size:10px;" data-act="toggleAdsb">ADS-B TX<div class="status-line"></div></div>
                    <div class="item-btn" style="height:45px; font-size:10px;">Flight ID<br><span style="color:var(--text-cyan); font-size:11px;">${xpdrState.flightId}</span></div>
                </div>
            </div>
        `;
        footer.innerHTML = cduFooter("switchMode('HOME')");
    }

    function renderXpdrCodeScreen(container, footer, title) {
        title.innerText = "Transponder 2";
        let displayVal = !hasStartedTyping ? xpdrState.code : xpdrInput;
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; padding-top:10px; height:100%;">
                <div style="display:flex; gap:10px; margin-bottom:20px; align-items:center; width:100%; justify-content:center;">
                    <div style="background:#0a0a0a; border:1px solid #444; width:120px; height:35px; display:flex; align-items:center; justify-content:center; color:var(--text-cyan); font-size:20px; font-weight:bold; border-radius:4px;">${displayVal}</div>
                    <div class="item-btn" style="width:45px; height:35px;" data-act="backspaceXpdr">←<br>BKSP</div>
                </div>
                <div class="xpdr-numpad-grid">
                    ${[0,1,2,3,4,5,6,7].map(n => `<div class="num-circle" style="width:45px; height:45px;" data-act="addXpdrInput" data-arg='["${n}"]'>${n}</div>`).join('')}
                </div>
                <div style="display:flex; gap:10px; width:100%; justify-content:center; margin-top:10px;">
                    <div class="item-btn" style="flex:1; height:35px; font-size:10px;" data-act="flashIdent">IDENT</div>
                    <div class="item-btn" style="flex:1; height:35px; font-size:10px;" data-act="setXpdrPreset" data-arg='["1200"]'>VFR</div>
                    <div class="item-btn" style="flex:1; height:35px; font-size:10px;" data-act="setXpdrPreset" data-arg='["7700"]'>EMER</div>
                </div>
            </div>
        `;
        footer.innerHTML = cduFooter("switchMode('XPDR_MODE')", `<div class="nav-btn enter-btn-blue" data-act="confirmXpdr"><span>↩</span>Enter</div>`);
    }

    // ── Utilities: Unit Converter (numpad-driven) ────────────────────────────

    // 페이지 정의 (메뉴에서 선택)
    const _UPAGES = {
      DIST:    { title:'Length / Distance', fields:['m','ft','km','nm','sm'] },
      SPEED:   { title:'Speed', fields:['skt','skmh','smph','sms'] },
      TEMP:    { title:'Temperature', fields:['tc','tf','tk'] },
      TSD:     { title:'Time / Speed / Distance', fields:['tsdGs','tsdDist','tsdTime'] },
      FUELEND: { title:'Fuel Endurance', inputs:['feQty','feFlow','feGs','feRsv'], answers:['feEnd','feUse','feRange'] },
      WIND:    { title:'Wind Component', inputs:['wcCrs','wcDir','wcSpd'], answers:['wcHead','wcCross','wcAng'] },
      SUN:     { title:'Sunrise / Sunset', sun:true },
      MAGVAR:  { title:'True ↔ Magnetic', fields:['mvTrue','mvVar','mvMag'] },
      COORD:   { title:'GPS Coordinates', coord:true },
      WEIGHT:  { title:'Weight / Mass', fields:['wkg','wlb','wg','woz','wmt'] },
      PRESS:   { title:'Pressure', fields:['phpa','pinhg','pkpa','ppsi','pmmhg','patm'] },
      FUEL:    { title:'Fuel Conversion', fields:['flb','fkg','fusgal','fltr'], fuel:true },
      DENSALT: { title:'Density Altitude', densalt:true },
      TAS:     { title:'True / Indicated Airspeed', fields:['tasPA','tasOAT','tasIAS','tasTAS'], tas:true },
      VNAV:    { title:'VNAV', fields:['vnavAlt','vnavAng'], vnav:true },
    };
    const _UMENU = [
      { id:'DIST',    name:'Length / Distance', sub:'m · ft · km · NM · SM' },
      { id:'SPEED',   name:'Speed',             sub:'kt · km/h · mph · m/s' },
      { id:'TEMP',    name:'Temperature',       sub:'°C · °F · K' },
      { id:'TSD',     name:'Time / Speed / Distance', sub:'GS · 거리 ↔ 소요시간' },
      { id:'FUELEND', name:'Fuel Endurance',    sub:'잔여연료 · 소모율 → 잔여시간 · 항속거리' },
      { id:'WIND',    name:'Wind Component',    sub:'코스 · 풍향풍속 → 정풍 · 측풍' },
      { id:'SUN',     name:'Sunrise / Sunset',  sub:'일출 · 일몰 · 시민박명' },
      { id:'MAGVAR',  name:'True ↔ Magnetic',   sub:'진방위 ↔ 자방위 (자기편차)' },
      { id:'COORD',   name:'GPS Coordinates',   sub:'DD · DM · DMS' },
      { id:'WEIGHT',  name:'Weight / Mass',     sub:'kg · lb · g · oz · ton' },
      { id:'PRESS',   name:'Pressure',          sub:'inHg · hPa · kPa · psi · mmHg · atm' },
      { id:'FUEL',    name:'Fuel Conversion',   sub:'gal · L · lb · kg' },
      { id:'DENSALT', name:'Density Altitude',  sub:'IA · Alt setting · OAT → DA' },
      { id:'TAS',     name:'True / Indicated Airspeed', sub:'PA · OAT → IAS ↔ TAS' },
    ];

    function utilOpen(id) {
      if (id === 'SETTINGS') { switchMode('SETTINGS'); return; }
      utilTab   = id;
      utilInput = '';
      if (id !== 'MENU') {
        const p = _UPAGES[id];
        utilActive = p.coord ? 'dd' : p.densalt ? 'daIA' : p.sun ? 'sunLat'
                   : (p.inputs ? p.inputs[0] : p.fields[0]);
      }
      switchMode('UTIL');
    }

    // 기압고도(ft)에서의 정압(hPa) — ISA 대류권 식
    function _tasPressHpa(ft) {
      return 1013.25 * Math.pow(1 - 6.87535e-6 * Math.max(-2000, Math.min(36089, ft)), 5.2558797);
    }
    // TAS / IAS 배율 = √(ρ0/ρ)
    function _tasRatio() {
      const T = _UV.tasOAT + 273.15;
      if (T <= 0) return 1;
      const rho = _tasPressHpa(_UV.tasPA) * 100 / (287.05287 * T);
      return rho > 0 ? Math.sqrt(1.225 / rho) : 1;
    }
    // 근거가 되는 값들을 같이 보여 준다 — 숫자 하나만 던지면 검산할 수가 없다
    function _tasNoteHtml() {
      const isa  = 15 - 1.98 * (_UV.tasPA / 1000);
      const dev  = _UV.tasOAT - isa;
      const da   = Math.round((_UV.tasPA + 120 * dev) / 10) * 10;
      const r    = _tasRatio();
      // 계산기 안에서 검산이 되도록 근거를 한 줄로 붙인다 — 화면을 길게 쓰면
      // 숫자판이 밀려 내려가므로 두 줄 안에 담는다.
      const line = (k, v) => `<span style="color:#556;">${k}</span> ` +
        `<span style="color:#8fb8bf;">${v}</span>`;
      return `<div style="font-size:9px;line-height:1.7;font-family:-apple-system,BlinkMacSystemFont,` +
        `Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;border-top:1px solid #1a2a30;` +
        `margin-top:8px;padding-top:5px;">` +
        `<div>` + line('ISA', isa.toFixed(1) + '°C · ' + (dev >= 0 ? '+' : '') + dev.toFixed(1) + '°C') +
        ` &nbsp;·&nbsp; ` + line('밀도고도', da.toLocaleString() + ' ft') +
        ` &nbsp;·&nbsp; ` + line('배율', '×' + r.toFixed(4)) + `</div>` +
        `<div style="color:#445;">밀도비 환산 (TAS = IAS × √(ρ₀/ρ)) · 압축성 보정 없음</div>` +
        `</div>`;
    }
    // 지금 비행 상태를 그대로 넣는다
    function utilTasHere() {
      try {
        _UV.tasPA  = Math.round(S.alt);
        _UV.tasOAT = Math.round(_oatSurfaceC - 1.98 * S.alt / 1000);
        _UV.tasIAS = +S.spd.toFixed(1);
        _utilConvert('tasIAS', _UV.tasIAS);
      } catch (e) { _swallow(e); }
      utilInput = '';
      switchMode('UTIL');
    }

    function utilFocus(fld) {
      utilActive = fld;
      utilInput  = '';
      switchMode('UTIL');
    }

    // ── Sunrise/Sunset: 현재 위치 채우기 + 결과 렌더 ──
    function utilSunHere() {
      try { _UV.sunLat = +S.lat.toFixed(4); _UV.sunLon = +S.lon.toFixed(4); } catch(e) { _swallow(e); }
      utilInput = '';
      switchMode('UTIL');
    }
    function _sunReadoutHtml() {
      let t = null;
      try { t = _sunTimes(_UV.sunLat, _UV.sunLon, new Date()); } catch(e) { _swallow(e); }
      if (!t) return `<div style="color:#e8a;font-size:11px;padding:8px 4px;">계산할 수 없습니다.</div>`;
      const hm = d => d ? String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') : '--:--';
      const R = (l, v, c) => `<div style="display:flex;justify-content:space-between;padding:4px 6px;border-bottom:1px solid #12212c;">` +
        `<span style="color:#6a8494;font-size:10px;">${l}</span>` +
        `<span style="color:${c||'#dfeaf2'};font-size:13px;font-weight:bold;">${v}</span></div>`;
      let dayTxt = '--';
      if (t.rise && t.set) {
        const mins = Math.round((t.set - t.rise) / 60000);
        dayTxt = Math.floor(mins/60) + 'h ' + String(mins%60).padStart(2,'0') + 'm';
      }
      const today = new Date();
      const dstr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      return `<div style="border:1px solid #223a4a;border-radius:6px;background:#08131c;padding:2px 6px;">` +
        R('날짜 (현지)', dstr, '#00e5ff') +
        R('시민박명 시작', hm(t.dawn), '#ffd54f') +
        R('일출', hm(t.rise), '#ffb74d') +
        R('일몰', hm(t.set), '#ff8a65') +
        R('시민박명 종료', hm(t.dusk), '#ba9bff') +
        R('주간 길이', dayTxt) +
        `</div>` +
        `<div style="color:#4a6274;font-size:9px;margin-top:5px;line-height:1.4;">※ 기기 현지시각 기준 · 오차 약 ±2분<br>야간비행 판단은 박명 시각을 기준으로 하십시오.</div>`;
    }

    function utilFuelDensity() {
      fuelTypeIdx = (fuelTypeIdx + 1) % _FUELS.length;   // 유종 순환
      fuelLbGal   = _FUELS[fuelTypeIdx].d;
      _utilConvert('flb', _UV.flb);      // 현재 값 기준 재환산
      switchMode('UTIL');
    }

    function utilNumKey(k) {
      const cfg = _UF[utilActive];
      if (!cfg) return;
      if (k === 'CLR') {
        utilInput = utilInput.slice(0, -1);
      } else if (k === 'ENT') {
        const v = parseFloat(utilInput);
        if (!isNaN(v)) { _UV[utilActive] = v; _utilConvert(utilActive, v); }
        utilInput = '';
        switchMode('UTIL');
        return;
      } else if (k === '±') {
        if (!cfg.neg) return;
        utilInput = utilInput.startsWith('-') ? utilInput.slice(1) : (utilInput ? '-' + utilInput : '-');
      } else if (k === '.') {
        if (!utilInput.includes('.')) utilInput += '.';
      } else {
        if (utilInput.length < 12) utilInput += k;
      }
      const disp = document.getElementById('unp-disp');
      if (disp) disp.textContent = utilInput || _UV[utilActive].toFixed(cfg.dec);
    }

    function _utilConvert(src, v) {
      _UV[src] = v;
      // ── Length / Distance (base 미터) — m·ft·km·nm·sm 상호 변환 ──
      if (['m','ft','km','nm','sm'].includes(src)) {
        const meters = src==='m'?v : src==='ft'?v*0.3048 : src==='km'?v*1000 : src==='nm'?v*1852 : v*1609.344;
        _UV.m  = +meters.toFixed(3);        _UV.ft = +(meters/0.3048).toFixed(3);
        _UV.km = +(meters/1000).toFixed(4); _UV.nm = +(meters/1852).toFixed(4);
        _UV.sm = +(meters/1609.344).toFixed(4);
      }
      else if (src === 'dd') { _utilDDtoAll(v); }
      else if (src === 'dmd' || src === 'dmm') {
        const sgn = _UV.dmd < 0 ? -1 : 1;
        _utilDDtoAll(sgn * (Math.abs(_UV.dmd) + _UV.dmm / 60));
      }
      // ── Weight (base kg) ──
      else if (['wkg','wlb','wg','woz','wmt'].includes(src)) {
        const kg = src==='wkg'?v : src==='wlb'?v/2.20462 : src==='wg'?v/1000 : src==='woz'?v/35.27396 : v*1000;
        _UV.wkg=+kg.toFixed(2); _UV.wlb=+(kg*2.20462).toFixed(2); _UV.wg=+(kg*1000).toFixed(0);
        _UV.woz=+(kg*35.27396).toFixed(2); _UV.wmt=+(kg/1000).toFixed(4);
      }
      // ── Pressure (base hPa) ──
      else if (['phpa','pinhg','pkpa','ppsi','pmmhg','patm'].includes(src)) {
        const h = src==='phpa'?v : src==='pinhg'?v*33.8639 : src==='pkpa'?v*10 : src==='ppsi'?v*68.9476 : src==='pmmhg'?v/0.7500617 : v*1013.25;
        _UV.phpa=+h.toFixed(2); _UV.pinhg=+(h/33.8639).toFixed(2); _UV.pkpa=+(h/10).toFixed(2);
        _UV.ppsi=+(h/68.9476).toFixed(2); _UV.pmmhg=+(h*0.7500617).toFixed(2); _UV.patm=+(h/1013.25).toFixed(4);
      }
      // ── Fuel (base lb, 밀도 fuelLbGal) ──
      else if (['flb','fkg','fusgal','fltr'].includes(src)) {
        const d = fuelLbGal;
        const lb = src==='flb'?v : src==='fkg'?v*2.20462 : src==='fusgal'?v*d : (v/3.785412)*d;
        _UV.flb=+lb.toFixed(1); _UV.fkg=+(lb/2.20462).toFixed(1);
        _UV.fusgal=+(lb/d).toFixed(2); _UV.fltr=+(lb/d*3.785412).toFixed(2);
      }
      // ── Density Altitude (계산) ──
      else if (['daIA','daAS','daOAT'].includes(src)) {
        const pa  = _UV.daIA + (29.92 - _UV.daAS) * 1000;
        const isa = 15 - 1.98 * (pa / 1000);
        _UV.daOut = Math.round((pa + 120 * (_UV.daOAT - isa)) / 10) * 10;
      }
      // ── True ↔ Indicated Airspeed ──
      // 기압고도·외기온도로 공기밀도를 구해 밀도비로 환산한다(E6B·비행컴퓨터와 같은 방식).
      //   TAS = IAS × √(ρ0/ρ)
      // 압축성 보정은 넣지 않았다. 200kt 아래에서는 0.1% 수준이라 눈금에 안 보이고,
      // 넣으면 조종사가 원판 계산기로 검산한 값과 오히려 어긋난다.
      // IAS 를 넣으면 TAS 가, TAS 를 넣으면 IAS 가 나온다. PA·OAT 를 바꾸면
      // 지금 들어 있는 IAS 기준으로 TAS 를 다시 잡는다.
      else if (['tasPA','tasOAT','tasIAS','tasTAS'].includes(src)) {
        const r = _tasRatio();
        if (src === 'tasTAS') _UV.tasIAS = +(_UV.tasTAS / r).toFixed(1);
        else                  _UV.tasTAS = +(_UV.tasIAS * r).toFixed(1);
      }
      // ── Speed (base m/s) ──
      else if (['skt','skmh','smph','sms'].includes(src)) {
        const ms = src==='sms'?v : src==='skt'?v/1.94384 : src==='skmh'?v/3.6 : v/2.23694;
        _UV.sms=+ms.toFixed(3);          _UV.skt=+(ms*1.94384).toFixed(2);
        _UV.skmh=+(ms*3.6).toFixed(2);   _UV.smph=+(ms*2.23694).toFixed(2);
      }
      // ── Temperature (base °C) ──
      else if (['tc','tf','tk'].includes(src)) {
        const c = src==='tc'?v : src==='tf'?(v-32)*5/9 : v-273.15;
        _UV.tc=+c.toFixed(1); _UV.tf=+(c*9/5+32).toFixed(1); _UV.tk=+(c+273.15).toFixed(1);
      }
      // ── Time / Speed / Distance ──
      // GS·거리를 넣으면 시간이, 시간을 넣으면 거리가 계산된다
      else if (['tsdGs','tsdDist','tsdTime'].includes(src)) {
        if (src === 'tsdTime') {
          _UV.tsdDist = +(_UV.tsdGs * _UV.tsdTime / 60).toFixed(1);
        } else {
          _UV.tsdTime = _UV.tsdGs > 0 ? +(_UV.tsdDist / _UV.tsdGs * 60).toFixed(1) : 0;
        }
      }
      // ── Fuel Endurance (잔여연료·소모율 → 잔여시간·항속거리) ──
      else if (['feQty','feFlow','feGs','feRsv'].includes(src)) {
        const total = _UV.feFlow > 0 ? _UV.feQty / _UV.feFlow * 60 : 0;   // 총 잔여시간(min)
        const use   = Math.max(0, total - _UV.feRsv);                      // 예비 제외 가용(min)
        _UV.feEnd   = Math.round(total);
        _UV.feUse   = Math.round(use);
        _UV.feRange = Math.round(use / 60 * _UV.feGs);
      }
      // ── Wind Component (코스·풍향풍속 → 정풍/배풍·측풍) ──
      else if (['wcCrs','wcDir','wcSpd'].includes(src)) {
        const a = ((_UV.wcDir - _UV.wcCrs + 540) % 360) - 180;   // -180~+180
        _UV.wcAng   = Math.round(a);
        _UV.wcHead  = +(_UV.wcSpd * Math.cos(a * Math.PI/180)).toFixed(1);
        _UV.wcCross = +(_UV.wcSpd * Math.sin(a * Math.PI/180)).toFixed(1);
      }
      // ── True ↔ Magnetic (편차 East +, West −) ──
      else if (['mvTrue','mvVar','mvMag'].includes(src)) {
        const norm = d => ((Math.round(d) % 360) + 360) % 360;
        if (src === 'mvMag') _UV.mvTrue = norm(_UV.mvMag + _UV.mvVar);
        else                 _UV.mvMag  = norm(_UV.mvTrue - _UV.mvVar);
      }
      // ── Sunrise/Sunset: 입력만 저장(표시는 _sunReadoutHtml에서 계산) ──
      else if (src === 'sunLat' || src === 'sunLon') { /* no-op */ }
      // ── VNAV (타깃 고도·각도 입력 → 전역 상태 동기화, T-CUT 연동) ──
      else if (src === 'vnavAlt' || src === 'vnavAng') {
        try { vnavTgtAlt = _UV.vnavAlt; vnavAngle = _UV.vnavAng; vnavActive = true; } catch(e) { _swallow(e); }
        try { updateTerrainCut(); } catch(e) { _swallow(e); }
      }
      else {
        const sgn = _UV.dmsd < 0 ? -1 : 1;
        _utilDDtoAll(sgn * (Math.abs(_UV.dmsd) + _UV.dmsm / 60 + _UV.dmss / 3600));
      }
    }

    function _utilDDtoAll(dd) {
      _UV.dd = +dd.toFixed(6);
      const abs = Math.abs(dd), sgn = dd < 0 ? -1 : 1;
      const dInt = Math.floor(abs);
      const mTot = (abs - dInt) * 60;
      const mInt = Math.floor(mTot);
      const sec  = (mTot - mInt) * 60;
      _UV.dmd  = sgn * dInt;  _UV.dmm  = +mTot.toFixed(4);
      _UV.dmsd = sgn * dInt;  _UV.dmsm = mInt;  _UV.dmss = +sec.toFixed(2);
    }

    function renderUtilScreen(container, footer, title) {

      // ── 메뉴 목록 ──
      if (utilTab === 'MENU') {
        title.innerText = 'Utilities — Menu';
        container.innerHTML =
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:2px 0 6px;">기능을 선택하세요</div>` +
          _UMENU.map(it =>
            `<div data-act="utilOpen" data-arg='["${it.id}"]' style="display:flex;align-items:center;justify-content:space-between;` +
              `padding:10px 10px;margin-bottom:5px;border:1px solid #1e3a4a;border-radius:5px;background:#0a1620;cursor:pointer;">` +
              `<div><div style="color:#00cfff;font-size:12px;font-weight:bold;">${it.name}</div>` +
              `<div style="color:#567;font-size:9px;margin-top:1px;">${it.sub}</div></div>` +
              `<div style="color:#0090b0;font-size:14px;">›</div></div>`
          ).join('');
        footer.innerHTML = cduFooter("switchMode('HOME')");
        return;
      }

      const page = _UPAGES[utilTab];
      title.innerText = 'Utilities — ' + page.title;

      // 목록으로 돌아가기 버튼
      const backToMenu = `<div data-act="utilOpen" data-arg='["MENU"]' style="display:inline-flex;align-items:center;gap:4px;` +
        `padding:5px 10px;margin-bottom:7px;border:1px solid #2a4a5a;border-radius:4px;background:#0a1620;color:#00cfff;` +
        `font-size:10px;font-weight:bold;cursor:pointer;">☰ 목록</div>`;

      // Tappable field row
      const ROW = (fld, answer) => {
        const c = _UF[fld], isAct = !answer && utilActive === fld;
        const val = (isAct && utilInput) ? utilInput : _UV[fld].toFixed(c.dec);
        const bg = answer ? '#0d2230' : (isAct ? '#001e28' : 'transparent');
        const bd = answer ? '#00cfff' : (isAct ? '#00e5ff' : '#1a1a1a');
        const vc = answer ? '#00e5ff' : (isAct ? '#00e5ff' : '#aaa');
        const click = answer ? '' : `data-act="utilFocus" data-arg='["${fld}"]'`;
        return `<div ${click} style="` +
          `display:flex;align-items:center;justify-content:space-between;` +
          `padding:7px 8px;border-radius:4px;cursor:${answer?'default':'pointer'};margin-bottom:3px;` +
          `background:${bg};border:1px solid ${bd};">` +
          `<span style="color:${answer?'#8fb8bf':'#666'};font-size:9px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;letter-spacing:0.5px;">${c.label}</span>` +
          `<span style="color:${vc};font-size:14px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;letter-spacing:1px;">` +
            `${val}<span style="color:#446;font-size:10px;margin-left:3px;">${c.unit}</span>` +
          `</span></div>`;
      };

      let fieldsHtml = '';
      if (page.coord) {
        fieldsHtml =
          `<div style="color:#333;font-size:8px;letter-spacing:1px;margin:2px 0 3px;">── DD ──────────────────</div>` +
          ROW('dd') +
          `<div style="color:#333;font-size:8px;letter-spacing:1px;margin:4px 0 3px;">── DM ──────────────────</div>` +
          ROW('dmd') + ROW('dmm') +
          `<div style="color:#333;font-size:8px;letter-spacing:1px;margin:4px 0 3px;">── DMS ─────────────────</div>` +
          ROW('dmsd') + ROW('dmsm') + ROW('dmss');
      } else if (page.densalt) {
        fieldsHtml =
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:2px 0 4px;">INPUT (값 입력 후 ENT)</div>` +
          ROW('daIA') + ROW('daAS') + ROW('daOAT') +
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:8px 0 4px;">ANSWER</div>` +
          ROW('daOut', true);
      } else if (page.vnav) {
        fieldsHtml =
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:2px 0 4px;">INPUT (값 입력 후 ENT)</div>` +
          ROW('vnavAlt') + ROW('vnavAng') +
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:8px 0 4px;">VNAV (실시간)</div>` +
          `<div id="vnav-readout">${_vnavReadoutHtml()}</div>`;
      } else if (page.sun) {
        fieldsHtml =
          `<div data-act="utilSunHere" style="display:inline-flex;align-items:center;gap:4px;` +
            `padding:5px 10px;margin-bottom:7px;border:1px solid #2a4a5a;border-radius:4px;background:#0a1620;` +
            `color:#00cfff;font-size:10px;font-weight:bold;cursor:pointer;">📍 현재 위치 사용</div>` +
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:2px 0 4px;">POSITION (값 입력 후 ENT)</div>` +
          ROW('sunLat') + ROW('sunLon') +
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:8px 0 4px;">SUN (오늘)</div>` +
          _sunReadoutHtml();
      } else if (page.tas) {
        fieldsHtml =
          `<div data-act="utilTasHere" style="display:inline-flex;align-items:center;gap:4px;` +
            `padding:5px 10px;margin-bottom:7px;border:1px solid #2a4a5a;border-radius:4px;background:#0a1620;` +
            `color:#00cfff;font-size:10px;font-weight:bold;cursor:pointer;">✈ 현재 비행상태 사용</div>` +
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:2px 0 4px;">CONDITION (값 입력 후 ENT)</div>` +
          ROW('tasPA') + ROW('tasOAT') +
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:8px 0 4px;">SPEED (어느 쪽이든 넣으면 나머지가 나온다)</div>` +
          ROW('tasIAS') + ROW('tasTAS') +
          _tasNoteHtml();
      } else if (page.inputs) {
        // 입력 → 계산 결과(ANSWER) 형태의 범용 페이지
        fieldsHtml =
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:2px 0 4px;">INPUT (값 입력 후 ENT)</div>` +
          page.inputs.map(f => ROW(f)).join('') +
          `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:8px 0 4px;">ANSWER</div>` +
          page.answers.map(f => ROW(f, true)).join('');
      } else if (page.fuel) {
        fieldsHtml =
          `<div data-act="utilFuelDensity" style="display:flex;align-items:center;justify-content:space-between;` +
            `padding:6px 8px;margin-bottom:6px;border:1px solid #2a4a6a;border-radius:4px;background:#0a1420;cursor:pointer;">` +
            `<span style="color:#88aacc;font-size:9px;">Fuel Type</span>` +
            `<span style="color:#8ac6ff;font-size:12px;font-weight:bold;">${_FUELS[fuelTypeIdx].name} · ${fuelLbGal.toFixed(1)} lb/gal ⟳</span></div>` +
          page.fields.map(f => ROW(f)).join('');
      } else {
        fieldsHtml = page.fields.map(f => ROW(f)).join('');
      }

      // Numpad
      const cfg = _UF[utilActive];
      const dispVal = utilInput || (cfg ? _UV[utilActive].toFixed(cfg.dec) : '0');
      // 주파수 입력창과 동일한 둥근(원형) 버튼 스타일 — 절반 크기(36px)로 축소
      const CB = `display:flex;align-items:center;justify-content:center;width:36px;height:36px;` +
        `background:radial-gradient(circle at 30% 30%, #444, #111);border:0.7px solid #555;border-radius:50%;` +
        `box-shadow:0 2px 4px rgba(0,0,0,0.55);cursor:pointer;user-select:none;` +
        `font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;color:#00e5ff;font-size:14px;`;
      // CLR/ENT는 키패드 우측에 세로 배치 → 높이 축소(한 화면에 들어오도록)
      const PBc = `display:flex;align-items:center;justify-content:center;flex:1;border-radius:12px;cursor:pointer;user-select:none;` +
        `font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;font-weight:bold;font-size:13px;`;
      const numpadHtml =
        `<div style="background:#050f14;border:1px solid #1a1a1a;border-radius:9px;padding:7px;margin-top:6px;">` +
          `<div id="unp-disp" style="background:#000;border:1.5px solid #333;border-radius:7px;` +
            `color:#00e5ff;font-size:17px;text-align:right;padding:4px 10px;margin-bottom:6px;` +
            `font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;min-height:26px;display:flex;align-items:center;justify-content:flex-end;` +
            `letter-spacing:1px;">${dispVal}</div>` +
          `<div style="display:flex;gap:6px;justify-content:center;align-items:stretch;">` +
            `<div style="display:grid;grid-template-columns:repeat(3,36px);gap:6px;">` +
              ['7','8','9','4','5','6','1','2','3'].map(n =>
                `<div style="${CB}" data-act="utilNumKey" data-arg='["${n}"]'>${n}</div>`
              ).join('') +
              `<div style="${CB}color:#aaa;" data-act="utilNumKey" data-arg='["±"]'>±</div>` +
              `<div style="${CB}" data-act="utilNumKey" data-arg='["0"]'>0</div>` +
              `<div style="${CB}color:#aaa;" data-act="utilNumKey" data-arg='["."]'>.</div>` +
            `</div>` +
            `<div style="display:flex;flex-direction:column;gap:6px;width:54px;">` +
              `<div style="${PBc}background:#2a0e0e;color:#ff6666;border:1px solid #663333;" data-act="utilNumKey" data-arg='["CLR"]'>CLR</div>` +
              `<div style="${PBc}background:#00252e;color:#00e5ff;border:1px solid #00e5ff;" data-act="utilNumKey" data-arg='["ENT"]'>ENT</div>` +
            `</div>` +
          `</div>` +
        `</div>`;

      // VNAV는 독립 기능이라 상단 '목록' 버튼 없이 표시하고, Back은 HOME으로
      container.innerHTML = (page.vnav ? '' : backToMenu) + fieldsHtml + numpadHtml;

      footer.innerHTML = cduFooter(page.vnav ? "switchMode('HOME')" : "utilOpen('MENU')");
    }


    // ══════════════════════════════════════════════════════════════
    //  CHECK LIST — KUH-1CG 조종사 점검표 (정상/특수/비상)
    //  '› ' 로 시작하는 항목은 조건 안내(체크 없음)
    // ══════════════════════════════════════════════════════════════
    const CL = {
      normal: { name:'정상 절차', color:'#00e07a', children:[
        { name:'외부 점검 전 점검', items:[
          '탑재용 항공일지·발간물·서류 – 확인',
          '조종사 음성표본(파일) 보유 – 확인',
          '항공기 커버·잠금장치·타이다운·접지선 – 제거 및 저장',
          'DTC – 장착',
          '연료 – 점검. 임무 필요량',
          '연료 샘플 오염 여부 – 확인(당일 첫 비행 전)',
          '배터리 – 점검. 25V 이상(-18℃ 미만 24V 이상)',
        ]},
        { name:'외부 점검', children:[
          { name:'기수 부분(제1구역)', items:[
            '메인로터 블레이드 – 점검. 긁힘·패임·균열·안정성',
            '기체 – 점검(전선절단기·윈드실드·와이퍼·트랙커·피토관·하부창·OAT감지기)',
            '레이돔 – 점검. 청결·문 잠금', '기수부 – 점검. 장비 안정성·문 잠금',
            'EO/IR 터릿 – 점검. 균열·청결·습도지시기(정상 청색)',
            '착륙등·탐색등 – 점검', '전륜 착륙장치 – 점검', '안테나 – 점검', 'PA 확성기 – 점검',
          ]},
          { name:'조종실 우측(제2구역)', items:[
            '조종실 – 점검(문·투하장치·의자·벨트·비상조명)', '전방 비상부주 조립체 – 점검',
            '비상부주 입수감지기 – 점검', '착빙 탐지기 – 점검',
            '축압기 – 점검. 1,985~3,200 psi(최대 4,000)', '엔진 오일 수준 – 점검',
            '승객실 전방 창문 – 점검', '외장형 호이스트(O) – 점검',
          ]},
          { name:'승객실 내부(제3구역)', items:[
            '승객실 – 점검(문·소화기·구급낭·회로차단기·모니터·의자·비상조명)',
            '임무장비 – 필요시 점검', '연료필터 적색 버튼 – 점검', '내부 인테리어 – 점검',
            '전이부 – 점검(결속·정비등·APU CONT 3RD In·환기구·응축기)',
            'CPI SIU SYSTEM SHUT OFF 스위치 – OFF',
          ]},
          { name:'상부 데크(제4구역)', items:[
            '편대등 – 점검', '카울링 – 개방', '엔진 공기 흡입구 – 점검(이물질·빙결)',
            '엔진 격실 – 점검(돌출버튼·누유·배기구)', '메인기어박스 오일 수준 – 점검',
            '유압계통 – 점검(저장조·오일·필터)', '로터 제동장치 – 점검', '소화기 – 점검',
            'APU – 점검(오일·이물질·누유)', '메인로터 계통 – 점검(블레이드·댐퍼·마스트)',
            '상부데크 모든 카울링 – 잠금 및 확인',
          ]},
          { name:'동체 우측(제5구역)', items:[
            '승객실 후방창 – 점검', '외부 보조 연료탱크(O) – 점검',
            '위치등·편대등·하부 충돌방지등 – 점검',
            '주륜 착륙장치 – 점검(가스실린더 압력·브레이크·완충기·타이어)',
            '외부 전원·공압·유압 연결구 – 점검', '비상부주 조립체 – 점검',
            '비상부주 입수감지기 – 점검', '전이부 통풍구 – 점검', '테일 구동축 – 점검. 덮개 잠금',
          ]},
          { name:'미부 동체(제6구역)', items:[
            '사다리 – 장착', '중간 기어박스 – 점검(오일·누유·마개)', '수직 안정판 – 점검',
            '수평 안정판 – 점검', '테일로터 블레이드 – 점검', '테일로터 – 점검(로드·댐퍼)',
            '테일기어박스 – 점검(오일·누유·마개)', '충돌방지등·편대등·위치등 – 점검',
            '테일 범퍼 – 점검', '사다리 – 제거 및 저장', '전이부 문 – 잠금', 'AD-ELT BEACON – 점검',
          ]},
          { name:'동체 좌측(제7구역)', items:[
            '비상부주 조립체 – 점검', '외부 보조 연료탱크(좌측,O) – 점검',
            '기체 – 점검(유압 연결구·배터리 격실·급유구)', '주륜 착륙장치 – 점검',
            '위치등·편대등 – 점검', '비상부주 입수감지기 – 점검', '후방 중력식 급유구 – 점검',
            '승객실 후방창 – 점검',
          ]},
          { name:'조종실 좌측(제8구역)', items:[
            '승객실 문·전방 창문 – 점검', '전방 중력식 급유구 – 점검', '엔진 오일 수준 – 점검',
            '탐조등(O) – 점검', '조종실 – 점검(문·투하장치·의자·벨트·비상조명)',
            '비상부주 조립체 – 점검', '비상부주 입수감지기 – 점검',
            '승무원 및 탑승자 브리핑 – 수행',
          ]},
        ]},
        { name:'조종실 장비 점검', items:[
          '부기장 컬렉티브 – 연장 및 잠금', '중량 선택레버/허리지지대 – 조절',
          '조종석 의자·페달 – 조절', '안전벨트 – 결속 및 점검', '출입문 – 잠금·안정성',
          'PARKING BRAKE – ON', 'NOSE WHEEL LOCK – LOCK', '회로차단기 – In',
          '상부콘솔 스위치 – 설정(WIPER OFF·GEN1/2 ON·TRU1/2 ON·BATT OFF·AIR SOUR OFF)',
          'FIRE EXTGH – OFF, FIRE DETECTOR – OPER', 'ENG ANTI ICE – OFF',
          'EMERG PUMP – OFF', 'PITOT HEAT – AUTO', 'BATT HEAT – OFF',
          'PCD – OFF', 'ENG FUEL SYS 레버 – FUEL OPEN', 'ENG FIRE 레버 – 최대 전방',
          '계기패널(예비나침반·ISI·MFD·FCP·PIP·시계) – 확인',
          'ENGINE IGNITION – OFF', '중앙콘솔 – 확인 및 설정',
          'FUEL 패널 스위치 – OFF(XFER AUTO)', 'AHRS/RCU – 모두 N',
          'EMERG FLOATS ARMED/OFF – OFF', 'HOIST ENABLE(O) – OFF',
          '헤드셋 및 조종 장갑 – 착용',
        ]},
        { name:'엔진 시동 전 점검', items:[
          'BATT 스위치 – ON', '내부 통화 – 점검', 'NLG LOCK·PRK ON 조언 – 확인',
          '주 경고패널 작동(Lamp Test) – 확인 후 해제', 'ISI 정상 지시 – 확인',
          '연료계기 – 연료량 확인', 'EIS 정상 지시 – 확인', 'FIRE DETECTOR – TEST 후 OPER',
          'FUEL BP2 – ON. P2 14 psi 이상', 'APU 배기구 안정성 – 확인',
          'APU CONTR – ON(APU ON 조언)', 'APU/GPU – APU GEN', 'AIR SOUR – APU',
          'MFD3·CDU2·DB 유효기간 – 확인', 'ECS 패널 – 설정', 'U/VHF-AM/FM 무전기 – On',
          'VHF/FM MN – On', 'MPP RADAR·EGPWS·DMM – On', 'AVCS POWER – On',
          '통신장비 – 설정 및 점검', 'AHRS1·AHRS2 – On', 'TRIM FEEL – On',
          'EMERG FLOATS ARMED/OFF – ARMED', 'HOIST ENABLE(O) – OFF',
          'CPI SIU SHUT OFF – ARM', 'MC 상태 – 점검(Avionics Status·CVFDR)',
          'GPS – 점검(GPS1/2 녹색)', '시스템 메시지 – 점검',
          '임무 필요 데이터 – 입력(INIT·W&B·Flight Plan·Accept·PERF Config)',
          '기압고도계 수정치 – 설정(PFD·ISI)', 'CHIP DETECTOR – TEST',
          'EMERG PUMP – AUTO(E-PUMP ON 조언)', '컬렉티브 – 잠금 해제',
          '조종간 – 점검(전 범위·걸림/뻑뻑함 확인)', '컬렉티브 – 잠금',
          'EIS ACCP 압력 1,985~3,200 psi – 확인', 'EMERG PUMP – OFF',
        ]},
        { name:'엔진 시동', items:[
          'MPP RADAR – OFF', 'FUEL BP1 – ON(F5 XFER AUTO). 1 F/L PRES 미시현, P1 14 psi 이상',
          'ENGINE IGNITION – ON', 'NO.1·NO.2 ENG FUEL SYS 레버 FUEL OPEN – 확인',
          '로터 브레이크 – 해제 또는 적용. 150~165 bar', '로터 회전 지역 장애물 – 확인',
          '화재 경계 요원 – 배치', '조종간 – 파지',
          'FUEL X-FEED – 해당 엔진(당일 첫 시동)',
          '한 엔진 – 시동(PCD IDLE, ENG STRT·NG·TGT·NP·NR·EOP 증가)',
          'FUEL X-FEED – 다른 엔진(당일 첫 시동)', '다른 엔진 – 시동(상기 반복)',
          'FUEL X-FEED – OFF', '로터 브레이크 – 적용 시 해제', '사이클릭 – 필요한 적용',
          '시스템 – 점검(NG 68%·EOP 23~100·MGB P 6↑·HYD P 2,700~3,200)',
          'EMERG PUMP – AUTO',
        ]},
        { name:'엔진 Runup', items:[
          '조종간 – 파지', '컬렉티브 – 잠금 해제', 'NOSE WHEEL LOCK – LOCK 확인',
          'PCD – FLY(LOW ROTOR RPM 미시현, 1/2 GEN 미시현)',
          '시스템 – 점검(TQ1/TQ2 5% 이내·MGB P 6↑)', 'AIR SOUR – 설정',
          'APU/GPU – OFF', 'APU CONTR – OFF', 'HEELS – ARM', '연료 이송 – 점검',
          '외부 보조 연료탱크(O) – 필요시 점검',
          'AFCS 비행 전 시험 – 수행(AP1/AP2 TEST OK)',
          '사이클릭 AFCS FAST CUT OFF – 점검', '엔진 성능/동력 추이 – 점검(해당 시)',
          '비행 계기 – 점검 및 설정', 'CDU 정상 상태 – 확인',
        ]},
        { name:'지상 활주', items:[
          '고임목 – 제거', '출입문 – 잠금·안정성', 'PARKING BRAKE – REL',
          'NOSE WHEEL LOCK – 설정', '페달 브레이크 – 필요시 점검',
          '› 사이클릭 움직임 최소화, 착륙등/탐색등 전개 시 지면 이격 주의',
        ]},
        { name:'이륙', children:[
          { name:'이륙 전 점검', items:[
            'PCD – FLY. NP/NR 100%', '시스템 – 점검(경고/주의·System Message 정상)',
            'CNS 및 항공전자장비 – 설정', 'MPP RADAR – ON(필요시)',
            '방빙·제빙장치 – 설정', '내·외부 등화 – 설정', '승무원·탑승자·임무장비 – 안전 확인',
          ]},
          { name:'제자리비행 점검', items:[
            '시스템 – 점검(경고/주의·System Message 정상)', 'PFD·ISI 정상 시현',
            '동력 – 점검 및 예상 데이터 비교',
          ]},
          { name:'이륙 후 점검', items:[
            'EO/IR – 필요시 INS 정렬(50 kt 이상)', '탐조등 EO/IR – 필요시 연동',
            '탐색 레이더 – 필요시 운용',
          ]},
        ]},
        { name:'착륙', children:[
          { name:'착륙 전 점검', items:[
            'NOSE WHEEL LOCK – LOCK 확인', 'PARKING BRAKE – 설정', '승무원·탑승자 – 안전 확인',
            '임무장비 – 안전 확인·설정', '탐조등 – Off(STOW)', 'EO/IR HCU STOW – 누름',
            'VCC RDR TX – 해제', 'MPP RADAR – OFF',
          ]},
          { name:'착륙 후 점검', items:[
            'NOSE WHEEL LOCK – 설정', '외부 등화 – 설정', '항공전자/임무장비 – 설정',
          ]},
        ]},
        { name:'주기 및 엔진 정지', items:[
          'NOSE WHEEL LOCK – LOCK', 'PARKING BRAKE – ON',
          '조종간 – 파지(사이클릭 중립·페달 중앙·컬렉티브 최하단·잠금)', '고임목 – 설치',
          '방빙·제빙 스위치 – OFF', 'AP1·AP2 – OFF', 'EMERG FLOATS ARMED/OFF – OFF',
          'APU CONTR – ON', 'APU/GPU – APU GEN', 'AIR SOUR – APU', 'PCD – IDLE',
          'ENGINE IGNITION – OFF', 'FUEL BP1 – OFF', 'EMERG PUMP – OFF',
          'PCD – NG 90% 이하 2분 냉각 후 OFF', 'TGT – 관찰(540℃↑ 시 MTRING)',
          '로터 브레이크 – NR 50% 미만 적용', 'MPP EGPWS·DMM – OFF', 'AVCS POWER – OFF',
          '무전기 전원 – Off', 'AHRS1·AHRS2 – OFF', 'PA VOL – OFF', '임무장비 – Off',
          '내·외부 등화 – 저장 및 OFF', '상부콘솔 스위치 – 설정', '승객실 장비 – OFF',
          'FUEL 패널 스위치 – OFF', 'AIR SOUR – OFF', 'APU/GPU – OFF', 'APU CONTR – OFF',
          'BATT – OFF', 'DTC – 제거', '부기장석 컬렉티브 – 돌려 넣음',
        ]},
        { name:'항공기 이탈 전 점검', items:[
          '항공기 – 점검(손상·누유·오일 수준)', '임무장비 안전성 – 확인',
          '항공기 기록부 – 작성', '항공기 안정성 – 확인',
        ]},
      ]},

      special: { name:'특수 점검 절차', color:'#ffaa33', children:[
        { name:'증기 배출(Vapor Vent) 절차', items:[
          'FUEL BP1·BP2 – ON', 'ENG FUEL SYS 레버 – OPEN',
          'VAPOR VENT – ON. 연료 배출 확인', 'VAPOR VENT – OFF',
          'FUEL X-FEED – 해당 ENG(반복)', 'FUEL X-FEED – OFF',
          'ENG FUEL SYS 레버 – 설정', 'BP1·BP2 – 설정',
        ]},
        { name:'MAS 보정', children:[
          { name:'MAS 지상 보정', items:[
            '항공기 착륙', 'AHRS1·AHRS2 – OFF',
            'COMP1 누른 상태 AHRS1 – On(COMP 점등)', 'COMP2 누른 상태 AHRS2 – On(COMP 점등)',
            '약 2분 대기(COMP1/2 점등, DG/MG1/2 DG 점등)', 'AUTO TRIM – On',
            '› 지상 보정 후 10분 이내 공중 보정 진입',
          ]},
          { name:'MAS 공중 보정', items:[
            '› 경사 20° 이내, AGL 1,500±200 ft, 100±20 KIAS',
            'COMP1·COMP2 – 약 2초 동시 누름', '30° 우경사 – 유지(COMP 점멸=진입)',
            '우경사 25~35° 유지 약 2분(COMP 점등=완료)', '약 5초 우경사 유지 후 수평 복귀',
            '30° 좌경사 – 유지(COMP 점멸=진입)', '좌경사 25~35° 유지 약 2분(COMP 소등=완료)',
          ]},
        ]},
        { name:'최대 동력 점검', items:[
          '고도계 – 29.92 설정', 'AIR SOUR – OFF', 'ECS 모드 – OFF', 'ENG ANTI ICE – OFF',
          'Engines 화면 – 선택', 'System Test – 터치', '모든 상위 모드 – 해제',
          '속도 – 80 KIAS', '점검 안 하는 엔진 TRAINING – TRNG(NP 95%)',
          '컬렉티브 – 증가(고도 유지). TGT 951±5℃ 또는 NG 한계 확인·기록',
        ]},
        { name:'엔진 동력 점검(대체 절차)', items:[
          '› 80≤IAS≤160, ENG ANTI ICE OFF, 초기 TGT 10℃ 이내',
          '고도계 – 29.92 설정', 'AIR SOUR – OFF', 'ECS 모드 – OFF', 'ENG ANTI-ICE – OFF',
          'Engines 화면 – 선택. ETF 기록', 'System Test – 선택', '모든 상위 모드 – 해제',
          '컬렉티브 – 조절(Vh 동력·NR 100%·30초 안정)', 'Engine # – 선택',
          '약 20초 후 Completed 시 ETF – 기록', '컬렉티브 – 감소', 'AIR SOUR – 설정',
          '기록 ETF 비교', '다른 엔진 – 반복',
        ]},
      ]},

      emerg: { name:'비상 및 고장 조치 절차', color:'#ff5555', children:[
        { name:'제 1 절 엔진계통', children:[
          { name:'한 엔진 고장', items:[
            '컬렉티브 – 조절. NR 운용 범위 유지', '한 엔진 속도 유지', '내·외부 화물 – 필요시 투하',
            '› 계속 비행 불가 시', 'LAND AS SOON AS POSSIBLE',
            '› 계속 비행 가능 시', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'비행 중 엔진 재시동', items:[
            'EMER APU START', 'AIR SOUR – APU', '해당 PCD – OFF', '해당 PCD – FLY',
          ]},
          { name:'두 엔진 고장', items:[
            'AUTOROTATE', '› 시간 가용 시', 'EMERG PUMP – ON', 'EMER APU START',
          ]},
          { name:'#FADEC 주의 / ENG# FAIL FIX(PFL)', items:[
            '컬렉티브 – 조절. NR 운용 범위', '내·외부 화물 – 필요시 투하',
            'LAND AS SOON AS PRACTICABLE', '› NR 유지 불가 시', '한 엔진 속도 유지',
            '정상 엔진 – TQ 15% 이상 유지', 'EMER ENG SHUTDOWN(해당 엔진)',
            '한 엔진 고장 절차 – 수행',
          ]},
          { name:'#FADEC 주의 / ENG# FIX-PWR(PFL)', items:[
            '컬렉티브 – 조절. NR 운용 범위', '내·외부 화물 – 필요시 투하',
            'LAND AS SOON AS PRACTICABLE', '› NR 유지 불가 시', '한 엔진 속도 유지',
            '정상 엔진 – TQ 15% 이상 유지', 'EMER ENG SHUTDOWN(해당 엔진)', '한 엔진 고장 절차 – 수행',
          ]},
          { name:'#FADEC 주의 / PFL 미시현', items:[
            '컬렉티브 – 조절. NR 운용 범위', '내·외부 화물 – 필요시 투하',
            'LAND AS SOON AS PRACTICABLE', '› NR 유지 불가 시', '한 엔진 속도 유지',
            '정상 엔진 – TQ 15% 이상 유지', 'EMER ENG SHUTDOWN(해당 엔진)', '한 엔진 고장 절차 – 수행',
          ]},
          { name:'#FADEC / FADEC# TEMP HIGH(PFL)', items:[ 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'#ENG FAULT / ENG# TRAN LIMIT(PFL)', items:[
            '컬렉티브 – 천천히 조작(급조작 금지)', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'#ENG FAULT / ENG# PWR LIMIT(PFL)', items:[
            '컬렉티브 – 조절', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'1/2 INLET A/I 주의 시현', items:[ '착빙 지역 – 이탈' ]},
          { name:'엔진 압축기 실속', items:[
            '컬렉티브 – 감소', '› 실속 지속 시', '해당 PCD – IDLE', '› 실속 사라지면', '해당 PCD – FLY',
            '› 실속 재발생 시', '한 엔진 속도 유지', 'EMER ENG SHUTDOWN(해당 엔진)', '한 엔진 고장 절차 – 수행',
          ]},
          { name:'비정상 엔진 소음', items:[ '컬렉티브 – 감소', 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'엔진 주 구동축 고장', items:[
            '컬렉티브 – 조절. NR 운용 범위', '한 엔진 속도 유지',
            'EMER ENG SHUTDOWN(해당 엔진). 재시동 금지', '한 엔진 고장 절차 – 수행',
          ]},
          { name:'#ENG OIL P / OIL T / CHIP 주의', items:[
            '› 한 엔진 비행 불가 시', 'LAND AS SOON AS POSSIBLE',
            '› 한 엔진 비행 가능 시', '한 엔진 속도로 조절', '해당 PCD – IDLE', 'LAND AS SOON AS PRACTICABLE',
          ]},
        ]},
        { name:'제 2 절 메인로터 및 조종계통', children:[
          { name:'비행 중 테일로터 추력 상실', items:[
            '속도 – 조절. 75 KIAS 이상', 'AUTOROTATE', 'PCD – OFF(감속 조작 시)',
          ]},
          { name:'제자리/저속 테일로터 추력 상실(좌회전)', items:[
            '컬렉티브 – 감소', 'PCD – OFF(접지 5~10 ft 전)',
          ]},
          { name:'좌측 페달 고정(낮은 피치)', items:[
            '75 KIAS 얕은각 접근', '정풍 또는 우전방풍으로 시도', '15~20 ft에서 감속',
            '활주로 정대', '유연한 착륙', '페달 브레이크로 기수 유지',
          ]},
          { name:'우측 페달 고정(높은 피치)', items:[
            '정풍 또는 좌전방풍 접근', '컬렉티브 적절히 내려 강하', '20° 편요 내 좌경사 비행',
            '컬렉티브 증가로 기수 정대', 'PCD – 필요시 OFF(접지 5~10 ft 전)',
            '유연한 접지', '페달 브레이크로 기수 유지',
          ]},
          { name:'T/R CABLE 주의 시현', items:[
            '좌·우 페달 – 적용. 조종 가능 여부 확인',
            '› 페달 조종 가능 시', 'LAND AS SOON AS PRACTICABLE',
            '› 페달 조종 불가 시', '컬렉티브 – 조절', 'LAND AS SOON AS PRACTICABLE(활주 착륙)',
          ]},
          { name:'RTR BRK ON 주의 시현', items:[
            '로터 브레이크 레버 – OFF 확인', '2차 징후(소음·냄새·연기) – 확인',
            '› 2차 징후 있으면', 'LAND AS SOON AS POSSIBLE',
            '› 2차 징후 없으면', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'조종계통 고장', items:[ 'LAND AS SOON AS POSSIBLE', '착륙 후 EMER ENG SHUTDOWN' ]},
          { name:'메인로터계통 고장', items:[
            'LAND AS SOON AS POSSIBLE', '착륙 후 EMER ENG SHUTDOWN',
            '› 로터 완전 정지 후 이탈',
          ]},
        ]},
        { name:'제 3 절 동력전달계통', children:[
          { name:'CHIP DETECT MGB/IGB/TGB 주의', items:[ '속도 – 조절. 75 KIAS', 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'MGB TOT P 경고', items:[
            'LAND AS SOON AS POSSIBLE', '› 시간 가용 시', '속도 – 75 KIAS', 'EMER APU START', 'GEN1·GEN2 – OFF',
          ]},
          { name:'MGB TEMP 주의', items:[
            '속도 – 75 KIAS 이하', '› 5분 이상 지속 시', 'LAND AS SOON AS PRACTICABLE',
            '› 사라지면', '계속 비행',
          ]},
          { name:'MGB MAIN P 주의', items:[
            'MGB T·MGB P – 확인', '› MGB T 120℃ 초과 시', '속도 – 75 KIAS', 'LAND AS SOON AS PRACTICABLE',
            '› MGB P 6 psi↑·T 120℃ 이하 유지 시', '계속 비행',
          ]},
          { name:'MGB EM P 주의', items:[ '속도 – 75 KIAS', 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'IGB/TGB TEMP 주의', items:[ '속도 – 75 KIAS', 'LAND AS SOON AS POSSIBLE' ]},
        ]},
        { name:'제 4 절 연료계통', children:[
          { name:'#ENG F/FLT 또는 #F/L FILT 주의', items:[
            'FUEL X-FEED – 해당 엔진', 'FUEL XFER·AUX XFER·F5 XFER – OFF', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'1&2 ENG F/FLT 또는 F/L FILT 주의', items:[ 'LAND AS SOON AS POSSIBLE' ]},
          { name:'1/2 FUEL LOW 주의', items:[
            '급격한 기동 제한, 착륙 시 피치 10° 이내', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'#ENG FUEL P 주의', items:[
            '› 한 엔진 비행 불가 시', 'X-FEED – 해당 엔진', 'LAND AS SOON AS POSSIBLE', '착륙 후 EMER ENG SHUTDOWN',
            '› 한 엔진 비행 가능 시', '한 엔진 속도 유지', '해당 BP – OFF', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'1&2 ENG FUEL P 주의', items:[ 'LAND AS SOON AS POSSIBLE', '착륙 후 EMER ENG SHUTDOWN' ]},
          { name:'#F/L PRES 주의', items:[
            '› 5,000 ft↑ 엔진정지 위험·30° 이상 경사 금지',
            'FUEL BP1·BP2 – ON 확인', '해당 FUEL P – 확인', 'X-FEED – 해당 엔진', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'1&2 F/L PRES 주의', items:[
            'FUEL BP1·BP2 – ON 확인', 'FUEL P1·P2 – 확인', 'LAND AS SOON AS POSSIBLE',
          ]},
          { name:'AUX-P 주의', items:[
            '해당 AUX XFER – OFF', '정상 AUX XFER – ON. 이송 확인',
            '› 외부탱크 850 lb 이상 시', 'LAND AS SOON AS PRACTICABLE',
            '› 850 lb 미만 시', '총 연료량 따라 임무 판단', '필요시 탑승자·화물 – 앞으로 이동',
          ]},
          { name:'AUX-C 주의', items:[ 'AUX1·AUX2 XFER – ON. 이송·균형 확인' ]},
        ]},
        { name:'제 5 절 전기계통', children:[
          { name:'1&2 GEN 주의', items:[
            '모든 제빙/방빙·Hoist·에어컨·불필요장비 – OFF', 'GEN1·GEN2 – OFF 후 ON',
            '› 미회복 시', 'EMB RST1·RST2 – 누름', '› 미회복 시', 'GEN1·GEN2 – OFF',
            'EMER APU START', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'#GEN 주의', items:[
            'BLADE DEICE POWER – OFF', '해당 GEN – OFF 후 ON',
            '› 미회복 시', '해당 EMB RST – 누름', '› 미회복 시', '해당 GEN – OFF',
            '필요시 EMER APU START', '필요시 BLADE DEICE POWER – ON', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'1&2 TRU 주의', items:[
            'TRU1·TRU2 – OFF 후 ON', '› 미회복 시', 'EMB RST1·RST2 – 누름', '› 미회복 시',
            'TRU1·TRU2 – OFF', '비필수 직류전원 장비 – OFF', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'#TRU 주의', items:[
            '해당 TRU – OFF 후 ON', '› 미회복 시', '해당 EMB RST – 누름', '› 미회복 시', '해당 TRU – OFF',
          ]},
          { name:'BATT TEMP 주의', items:[ 'BATT – OFF', 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'BATT LOW 주의', items:[ '› 배터리가 유일 전원 시', 'LAND AS SOON AS POSSIBLE(10분 이내)' ]},
        ]},
        { name:'제 6 절 유압계통', children:[
          { name:'1 HYD PUMP 주의', items:[
            'EMERG PUMP – ON', '› E-PUMP ON 미시현 시', 'LAND AS SOON AS POSSIBLE', '정지 시 주기 브레이크 사용',
            '› E-PUMP ON 시현 시', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'2 HYD PUMP 주의', items:[ 'LAND AS SOON AS POSSIBLE' ]},
          { name:'1&2 HYD PUMP 주의', items:[
            'EMERG PUMP – ON', 'E-PUMP ON 조언 – 확인', 'HYD P1 – 확인', 'LAND AS SOON AS POSSIBLE',
          ]},
          { name:'#M/R ACT 또는 #T/R ACT 주의', items:[ '조종간 – 유연한 조작. 경사 30° 이내', 'LAND AS SOON AS POSSIBLE' ]},
          { name:'1 RSVR LOW 주의', items:[ 'LAND AS SOON AS POSSIBLE', '정지 시 주기 브레이크 사용' ]},
          { name:'2 RSVR LOW 주의', items:[ 'LAND AS SOON AS POSSIBLE' ]},
          { name:'HYD TEMP 주의', items:[
            'HYD T1·T2 – 확인', '› 135℃ 초과 시', 'LAND AS SOON AS POSSIBLE',
            '› 135℃ 이하 시', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'HYD P 2,700 psi 미만', items:[ 'HYD P1·P2 – 확인', 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'HYD P 3,200 psi 이상', items:[
            'HYD P1·P2 – 확인', '› 3,600 psi 초과 시', 'LAND AS SOON AS PRACTICABLE',
            '› 3,200~3,600 유지 시', '계속 비행(착륙 후 재이륙 제한)',
          ]},
        ]},
        { name:'제 7 절 계기 및 자동비행 조종계통', children:[
          { name:'ADC 고장', items:[
            '› 황색박스 IAS/ALT', 'ADC 노브 – 1 또는 2(ISI 근접)',
            '› 흰색박스·적색 X', 'ADC 노브 – 정상 센서', '› 미복구 시', 'ADC 노브 – BACKUP',
            'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'1개 MFD 고장 / REV 점등', items:[ 'REV 주의등 – 누름' ]},
          { name:'3개 이상 MFD 또는 2개 CDU 고장', items:[
            'MFD/CDU 회로차단기 – Out 후 In', '› 미회복 시', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'GPS/INS 고장', items:[ 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'AFCS FAIL 경고', items:[ '조종간 – 파지', '속도 – 130 KIAS 이내', 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'COLL LINK 주의', items:[
            '조종간 – 유연한 조작', 'AP2 – OFF 후 ON', '› 계속 시현 시', '속도 – 130 KIAS 이내', '컬렉티브 – 수동 조절',
          ]},
          { name:'PITOT HEAT 주의', items:[
            '› 1개 고장', 'ADC 노브 – 정상 작동 쪽', '계속 비행',
            '› 2개 모두 고장', 'PITOT HEAT – OFF 후 AUTO', '계속 시현 시 OFF 후 ON', '착빙 지역 – 이탈',
          ]},
          { name:'트림 작동기 고착', items:[
            '조종간 – 유연한 조작', '안전 절단핀 – 필요시 절단', '속도 – 130 KIAS 이내', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'2개 SEMA 또는 SEMA2 고장', items:[
            '조종간 – 유연한 조작', '속도 – 130 KIAS 이내', 'LAND AS SOON AS PRACTICABLE',
          ]},
        ]},
        { name:'제 8 절 보조동력장치계통', children:[
          { name:'APU OIL TEMP 주의', items:[
            'APU CONTR – OFF', '오일량 확인 전 재시동 금지(최소 30분 냉각)',
          ]},
          { name:'APU FAIL 주의', items:[
            'APU CONTR – OFF(2분 대기, ESU 코드 확인)', 'APU CONTR – ON',
          ]},
        ]},
        { name:'제 9 절 화재 및 낙뢰', children:[
          { name:'지상 엔진/기체 화재', items:[
            'No.1·No.2 PCD – OFF', '해당 ENG FIRE 레버 – 당김', 'FIRE EXTGH – MAIN 또는 RESERVE',
            'FUEL BP1·BP2 – OFF', 'APU CONTR – OFF',
          ]},
          { name:'APU 격실 화재', items:[
            'APU FIRE EXTGH T핸들 – 당김', 'FIRE EXTGH – MAIN 또는 RESERVE', 'LAND AS SOON AS POSSIBLE',
          ]},
          { name:'비행 중 MGB 격실 화재', items:[
            'LAND AS SOON AS POSSIBLE', '휴대용 소화기 준비', '승객실 문 – 필요시 개방',
          ]},
          { name:'비행 중 엔진 화재', items:[
            '한 엔진 속도 유지', '해당 PCD – OFF', '해당 ENG FIRE 레버 – 당김',
            'FIRE EXTGH – MAIN 또는 RESERVE', '해당 BP – OFF', 'LAND AS SOON AS POSSIBLE',
          ]},
          { name:'비행 중 전기계통 화재', items:[
            'GEN1·GEN2 – OFF', 'BATT – 필요시 OFF', 'LAND AS SOON AS POSSIBLE',
          ]},
          { name:'비행 중 외부 보조연료탱크 화재', items:[
            'AUX1·AUX2 XFER – OFF', '속도 – 75 KIAS 이하', 'LAND AS SOON AS POSSIBLE',
          ]},
          { name:'연기 또는 타는 냄새 제거', items:[
            'ECS 모드 – VENT', 'ECS AIR SEL – EXT AIR', '› 미제거 시', '속도 – 75 KIAS 이하',
            '승객실 문·창문 – 개방', '페달 조종 OUT OF TRIM 유지', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'낙뢰', items:[
            '› FADEC 정상 작동 안 하면', 'PCD – IDLE(해당 엔진)',
            '› FADEC 반응 없으면', 'EMER ENG SHUTDOWN(해당 엔진)', '한 엔진 고장 절차 – 수행',
          ]},
        ]},
        { name:'제 10 절 비상착륙 및 불시착수', children:[
          { name:'산림지역 비상 착륙(무동력)', items:[
            'AUTOROTATE. 나무 높이에서 전진속도 0', '컬렉티브 – 조절(가지 닿기 전 최대량)',
          ]},
          { name:'불시 착수 – 유동력', items:[
            '착수 전 점검(벨트·화물 고정, 탐조등 OFF/-90°)', 'EMERG FLOATS ARMED/OFF – ARMED',
            '브리핑 – 승무원·승객', 'WINDSHIELD WIPER – HI', '접근 및 제자리비행',
            '착수 – 수평~기수 약간 들림(5° 이내)', '비상부주 – 팽창 확인(미작동 시 FLOAT)',
            '컬렉티브 – 최하단', 'EMER ENG SHUTDOWN', '로터 브레이크 – 필요시 적용',
            '항공기 전원 – 차단', '이탈 및 구명정 탑승',
          ]},
          { name:'불시 착수 – 무동력', items:[
            'AUTOROTATE', '착수 전 점검 – 시간 가용 시', 'EMERG FLOATS ARMED/OFF – ARMED',
            '브리핑', 'WINDSHIELD WIPER – HI', 'AGL 100 ft 감속 자세(5~10°)',
            '착수 – 수평, 30 KIAS 이하, 300 fpm 이하', '비상부주 – 팽창 확인(미작동 시 FLOAT)',
            '컬렉티브 – 최하단', 'EMER ENG SHUTDOWN', '항공기 전원 – 차단', '이탈 및 구명정 탑승',
          ]},
        ]},
        { name:'제 11 절 임무장비 및 기타', children:[
          { name:'호이스트 비상투하', items:[ 'CABLE CUT 스위치 – 누름(조종사/승무원 패널)' ]},
          { name:'호이스트 완전 풀림', items:[
            'PILOT OVERRIDE – UP 또는 DOWN', '› 조절 불가 시', 'HOIST ENABLE – OFF', '브리핑 지시 절차 조치',
          ]},
          { name:'호이스트 케이블 고착', items:[
            'HOIST ENABLE – OFF', '항공기 고도 – 강하', 'CABLE CUT – 상황에 따라 누름',
          ]},
          { name:'MR/TR DIC FAULT/FAIL 주의', items:[
            '착빙 지역 – 이탈', 'BLADE DEICE POWER – OFF', '› 진동 증가 시', 'LAND AS SOON AS POSSIBLE',
          ]},
          { name:'BLADE DEICE AUTO FAIL', items:[
            'BLADE DEICE MODE – MANUAL 적절한 강도', '› 진동/토크 증가 시', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'ICE DETECD 주의', items:[
            'BLADE DEICE POWER – ON', 'BLADE DEICE MODE – AUTO', '토크 증가·진동 – 관찰',
          ]},
          { name:'WIRE CUTTER 주의', items:[ 'ANTI ICE WIRE CUTTER – OFF 후 ON', '› 계속 시현 시', '착빙 지역 – 이탈' ]},
          { name:'WINDSHIELD LH/RH FAIL', items:[ 'ANTI ICE WINDSHIELD – OFF 후 ON', '› 계속 시현 시', '착빙 지역 – 이탈' ]},
          { name:'COWLING UNLOCK 주의', items:[ '속도 – 75 KIAS 이하', 'LAND AS SOON AS POSSIBLE' ]},
          { name:'CABIN DOOR OPEN LH/RH 주의', items:[ '속도 – 60 KIAS 이하', '문 닫거나 완전 개방 고정' ]},
          { name:'비행 중 윈드실드 파손', items:[ '속도 – 75 KIAS 이하, 피치 -5° 이상 유지', 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'비행 중 비상부주 우발 팽창', items:[
            '속도 – 70 KIAS 이하(선회 10°·상승/강하 ±500 fpm)', 'LAND AS SOON AS PRACTICABLE',
          ]},
          { name:'임무 컴퓨터(2개 MC) 고장', items:[ 'LAND AS SOON AS PRACTICABLE' ]},
          { name:'냉방장치 주의등', items:[ 'ECS 모드 – VENT 또는 OFF(필요시)' ]},
        ]},
      ]},
    };

    let clPath = [];              // 현재 경로(인덱스 배열)
    const clChecked = {};         // 완료 체크 상태(경로+인덱스 키)
    function _clRoot() { return { name:'CHECK LIST', children:[CL.normal, CL.special, CL.emerg] }; }
    function _clNode() { let n = _clRoot(); for (const i of clPath) n = (n.children||[])[i]; return n || _clRoot(); }
    function _clColor() { return clPath.length ? (_clRoot().children[clPath[0]].color || '#00e5ff') : '#00e5ff'; }
    function clOpen()  { clPath = []; switchMode('CHECKLIST'); }
    function clInto(i) { clPath.push(i); switchMode('CHECKLIST'); }
    function clBack()  { if (clPath.length) { clPath.pop(); switchMode('CHECKLIST'); } else { switchMode('HOME'); } }
    function clToggle(i) { const k = clPath.join('.') + '#' + i; clChecked[k] = !clChecked[k]; switchMode('CHECKLIST'); }
    function clResetLeaf() { const p = clPath.join('.'); Object.keys(clChecked).forEach(k => { if (k.startsWith(p + '#')) delete clChecked[k]; }); switchMode('CHECKLIST'); }
    function _clParent() { let n = _clRoot(); for (let i = 0; i < clPath.length - 1; i++) n = n.children[clPath[i]]; return n; }
    // 같은 단계의 이전/다음 형제 항목으로 이동
    function clSibling(dir) {
      if (!clPath.length) return;
      const parent = _clParent();
      const cur = clPath[clPath.length - 1];
      const nx = cur + dir;
      if (parent.children && nx >= 0 && nx < parent.children.length) {
        clPath[clPath.length - 1] = nx;
        switchMode('CHECKLIST');
      }
    }

    function renderChecklistScreen(container, footer, title) {
      const node = _clNode();
      const col = _clColor();
      // 브레드크럼 제목
      const crumbs = []; let n = _clRoot(); crumbs.push(n.name);
      for (const i of clPath) { n = n.children[i]; crumbs.push(n.name); }
      title.innerText = clPath.length ? node.name : 'CHECK LIST';

      const crumbBar = `<div style="color:#667;font-size:8px;letter-spacing:0.5px;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${crumbs.join(' › ')}</div>`;

      // 이전/다음 형제 이동 바 (2단계 이상에서 표시)
      let sibBar = '';
      if (clPath.length) {
        const parent = _clParent();
        const cur = clPath[clPath.length - 1];
        const total = parent.children ? parent.children.length : 1;
        const prevN = cur > 0 ? parent.children[cur - 1].name : null;
        const nextN = cur < total - 1 ? parent.children[cur + 1].name : null;
        const cell = (dir, label, name) => {
          const on = !!name;
          const arrow = dir < 0 ? '◀' : '▶';
          const txt = on ? (dir < 0 ? `${arrow} ${label}` : `${label} ${arrow}`) : `${dir < 0 ? arrow + ' 처음' : '마지막 ' + arrow}`;
          return `<div ${on ? `data-act="clSibling" data-arg='[${dir}]'` : ''} style="flex:1;min-width:0;text-align:${dir<0?'left':'right'};` +
            `padding:6px 9px;border:1px solid ${on ? col+'66' : '#1b222a'};border-radius:4px;` +
            `background:${on ? '#0a1620' : '#0a0e12'};cursor:${on?'pointer':'default'};overflow:hidden;">` +
            `<div style="color:${on ? col : '#3a4653'};font-size:11px;font-weight:bold;">${dir<0?arrow+' 이전':'다음 '+arrow}</div>` +
            (on ? `<div style="color:#778;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>` : '') +
            `</div>`;
        };
        sibBar = `<div style="display:flex;gap:5px;align-items:stretch;margin-bottom:7px;">` +
          cell(-1, '이전', prevN) +
          `<div style="flex:0 0 auto;display:flex;align-items:center;color:#667;font-size:9px;padding:0 2px;">${cur+1}/${total}</div>` +
          cell(1, '다음', nextN) + `</div>`;
      }

      if (node.children) {
        // 목록 화면
        const listHtml = node.children.map((c, i) => {
          const c2 = c.color || col;
          const cnt = c.children ? `${c.children.length}개 절차` : (c.items ? `${c.items.filter(x=>!x.startsWith('› ')).length}개 항목` : '');
          return `<div data-act="clInto" data-arg='[${i}]' style="display:flex;align-items:center;justify-content:space-between;` +
            `padding:9px 10px;margin-bottom:5px;border:1px solid ${c2}44;border-radius:5px;background:#0a1116;cursor:pointer;">` +
            `<div><div style="color:${c2};font-size:12px;font-weight:bold;">${c.name}</div>` +
            (cnt ? `<div style="color:#567;font-size:9px;margin-top:1px;">${cnt}</div>` : '') + `</div>` +
            `<div style="color:${c2}aa;font-size:14px;">›</div></div>`;
        }).join('');
        container.innerHTML = crumbBar + sibBar + listHtml;
      } else {
        // 체크리스트 항목 화면
        let idx = 0;
        const rows = (node.items || []).map((it, i) => {
          if (it.startsWith('› ')) {
            return `<div style="color:#ffcc44;font-size:10px;font-style:italic;margin:6px 2px 2px;letter-spacing:0.3px;">${it.slice(2)}</div>`;
          }
          const k = clPath.join('.') + '#' + i;
          const done = !!clChecked[k];
          idx++;
          return `<div data-act="clToggle" data-arg='[${i}]' style="display:flex;align-items:center;gap:8px;` +
            `padding:7px 8px;margin-bottom:3px;border:1px solid ${done ? col : '#1e2630'};border-radius:4px;` +
            `background:${done ? col+'18' : '#0a1116'};cursor:pointer;">` +
            `<div style="flex:0 0 18px;width:18px;height:18px;border-radius:3px;border:1.5px solid ${done ? col : '#3a4653'};` +
            `display:flex;align-items:center;justify-content:center;color:${col};font-size:12px;font-weight:bold;">${done ? '✓' : ''}</div>` +
            `<div style="flex:1;color:${done ? '#8fb8bf' : '#cdd6df'};font-size:11px;line-height:1.35;` +
            `text-decoration:${done ? 'line-through' : 'none'};">${it}</div></div>`;
        }).join('');
        const resetBtn = `<div data-act="clResetLeaf" style="text-align:right;margin-bottom:6px;">` +
          `<span style="display:inline-block;color:#ff8877;font-size:9px;border:1px solid #5a2a2a;border-radius:3px;padding:3px 9px;cursor:pointer;">전체 해제</span></div>`;
        container.innerHTML = crumbBar + sibBar + resetBtn + rows;
      }

      footer.innerHTML = cduFooter(clBack);
    }


    // ── 설정(Settings) 화면 ──
    function _setToggle(which) {
      if (which === 'night') toggleNightMode();
      else if (which === 'rings') toggleRangeRings();
      else if (which === 'metar') { autoMetarOn = !autoMetarOn; try { localStorage.setItem('autoMetarOn', autoMetarOn ? '1' : '0'); } catch(e) { _swallow(e); } }
      else if (which === 'aspc') toggleInhib('aspc');
      else if (which === 'taws') toggleInhib('taws');
      else if (which === 'kbd') toggleKbdShortcuts();
      switchMode('SETTINGS');
    }
    function renderSettingsScreen(container, footer, title) {
      title.innerText = 'Settings';
      const back = `<div data-act="switchMode" data-arg='["HOME"]' style="display:inline-flex;align-items:center;gap:4px;` +
        `padding:5px 10px;margin-bottom:8px;border:1px solid #2a4a5a;border-radius:4px;background:#0a1620;color:#00cfff;` +
        `font-size:10px;font-weight:bold;cursor:pointer;">🏠 홈</div>`;
      const TOG = (which, label, sub, on) =>
        `<div data-act="_setToggle" data-arg='["${which}"]' style="display:flex;align-items:center;justify-content:space-between;` +
          `padding:9px 10px;margin-bottom:5px;border:1px solid ${on ? '#00e5ff66' : '#1e2630'};border-radius:5px;` +
          `background:#0a1116;cursor:pointer;">` +
          `<div><div style="color:#cdd6df;font-size:12px;font-weight:bold;">${label}</div>` +
          `<div style="color:#567;font-size:9px;margin-top:1px;">${sub}</div></div>` +
          `<div style="flex:0 0 auto;width:46px;height:22px;border-radius:11px;background:${on ? '#00485a' : '#20262e'};` +
          `border:1px solid ${on ? '#00e5ff' : '#3a4653'};position:relative;">` +
          `<div style="position:absolute;top:1px;${on ? 'right:1px' : 'left:1px'};width:18px;height:18px;border-radius:50%;` +
          `background:${on ? '#00e5ff' : '#6b7683'};"></div></div></div>`;
      const ACT = (attrs, label, sub) =>
        `<div ${attrs} style="display:flex;align-items:center;justify-content:space-between;` +
          `padding:9px 10px;margin-bottom:5px;border:1px solid #2a3a4a;border-radius:5px;background:#0a1420;cursor:pointer;">` +
          `<div><div style="color:#8ac6ff;font-size:12px;font-weight:bold;">${label}</div>` +
          `<div style="color:#567;font-size:9px;margin-top:1px;">${sub}</div></div>` +
          `<div style="color:#4a7aaa;font-size:14px;">›</div></div>`;
      // 단위 선택(2지선다) 행
      const UNI = (kind, label, opts, cur) =>
        `<div style="display:flex;align-items:center;justify-content:space-between;` +
          `padding:8px 10px;margin-bottom:5px;border:1px solid #1e2630;border-radius:5px;background:#0a1116;">` +
          `<div style="color:#cdd6df;font-size:12px;font-weight:bold;">${label}</div>` +
          `<div style="display:flex;gap:4px;">` +
          opts.map(o => `<div data-act="setUnit" data-arg='["${kind}","${o.v}');switchMode('SETTINGS"]' ` +
            `style="cursor:pointer;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:bold;` +
            `border:1px solid ${cur===o.v?'#00e5ff':'#3a4653'};background:${cur===o.v?'#00303c':'#161c23'};` +
            `color:${cur===o.v?'#00e5ff':'#8a97a5'};">${o.t}</div>`).join('') +
          `</div></div>`;
      container.innerHTML = back +
        `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:2px 0 5px;">단위 (정보 표시)</div>` +
        UNI('alt',  '고도', [{v:'ft',t:'ft'},   {v:'m',t:'m'}],      unitAlt) +
        UNI('dist', '거리', [{v:'NM',t:'NM'},   {v:'km',t:'km'}],    unitDist) +
        UNI('spd',  '속도', [{v:'kt',t:'kt'},   {v:'kmh',t:'km/h'}], unitSpd) +
        UNI('temp', '온도', [{v:'C',t:'°C'},    {v:'F',t:'°F'}],     unitTemp) +
        `<div style="color:#4a5563;font-size:9px;margin:-1px 0 8px 2px;line-height:1.4;">` +
          `PFD 계기(속도·고도·CRHT·VSI·BRG)와 지도·T-CUT·VNAV·INFO·경보에 모두 적용됩니다.<br>` +
          `고도를 m로 두면 수직속도(VSI)는 m/s로 표시됩니다.</div>` +
        `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:2px 0 5px;">표시 / 경보</div>` +
        TOG('night', '야간 모드', '지도·화면 저휘도 + 붉은 딤', nightMode) +
        TOG('rings', '레인지 링', `항공기 중심 ${ringRadii.join('/')} NM 거리·방위 링`, rangeRingsOn) +
        TOG('metar', '자동 METAR', '근처 공항 METAR로 OAT 자동 반영', autoMetarOn) +
        TOG('aspc', '공역 경보', inhibAspc ? 'INHIBIT(억제됨)' : '접근/진입 경보 사용', !inhibAspc) +
        TOG('taws', 'HTAWS 지형경보', inhibTaws ? 'INHIBIT(억제됨)' : '전방 지형 경보 사용', !inhibTaws) +
        TOG('kbd', '키보드 단축키', kbdShortcuts ? '숫자·방향키로 계기 조작' : '해제됨(DeX 등 물리 키보드 오작동 방지)', kbdShortcuts) +
        `<div style="color:#556;font-size:9px;letter-spacing:1px;margin:10px 0 5px;">앱 / 오프라인</div>` +
        ACT(act('pwaInstall'), '홈 화면에 추가', 'PWA 설치(앱처럼 실행)') +
        ACT(act('prefetchTiles'), '주변 지도 캐시', '현재 화면 주변 타일 미리 저장') +
        ACT(act('showHelpOverlay'), '사용 안내 다시 보기', '시작 안내 오버레이 표시');
      footer.innerHTML = cduFooter("switchMode('HOME')");
    }

    // ══════════════════════════════════════════════════════════════
    //  TRACK & POINT — 포인트/트랙 저장(기기 저장소) 및 항법 사용
    // ══════════════════════════════════════════════════════════════
    let tpTab = 'POINT';
    let tpFolderIdx = null;         // null=폴더 목록, 숫자=폴더 내부
    let _tpIconPick = null;         // 아이콘 선택 대상 {type:'point'|'folder', fi, pi}
    // 지도 표시용 아이콘 세트(이모지)
    const TP_ICONS = ['📍','🔴','🔺','⭐','🚩','🏁','❌','⚓','🚁','🏥','⚠️','⛵','🔷','🟢','🟡','🟣'];
    function _tpLoad(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { return []; } }
    function _tpSave(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch(e) { _swallow(e); } }
    // 폴더 구조: [{name, pts:[{name,lat,lon}]}]. 구버전 평면 tpPoints는 '기본' 폴더로 이전.
    function tpFolders() {
      let f = _tpLoad('tpFolders');
      if (!Array.isArray(f) || !f.length) {
        const old = _tpLoad('tpPoints');
        if (Array.isArray(old) && old.length) { f = [{ name: '기본', pts: old }]; _tpSave('tpFolders', f); }
        else if (!Array.isArray(f)) f = [];
      }
      return f;
    }
    function tpTracks() { return _tpLoad('tpTracks'); }
    function tpSetTab(t) { tpTab = t; tpFolderIdx = null; _tpIconPick = null; _tpRepoView = false; switchMode('TRACKPOINT'); }

    // ── 지도에 포인트 마커 표시(show=true인 포인트, 전 폴더 대상) ──
    let _tpPointLayer = null;
    function _tpMarkerIcon(emoji, name) {
      return L.divIcon({ className: '', iconSize: [0, 0], html:
        `<div style="position:relative;transform:translate(-50%,-100%);white-space:nowrap;">` +
        `<div style="font-size:20px;line-height:1;filter:drop-shadow(0 0 2px #000);">${emoji || '📍'}</div>` +
        `<div style="position:absolute;left:15px;top:1px;color:#fff;font-size:9px;font-weight:bold;text-shadow:1px 1px 2px #000,-1px -1px 2px #000;">${name || ''}</div></div>` });
    }
    function _tpRenderMapPoints() {
      if (_tpPointLayer) { leafMap.removeLayer(_tpPointLayer); _tpPointLayer = null; }
      const g = L.layerGroup();
      tpFolders().forEach((fd, fi) => (fd.pts || []).forEach((p, pi) => {
        if (!p.show) return;
        const emoji = p.icon || fd.icon || '📍';
        const m = L.marker([p.lat, p.lon], { icon: _tpMarkerIcon(emoji, p.name) });
        const btn = 'cursor:pointer;border-radius:4px;padding:4px 6px;font-size:10px;font-weight:bold;text-align:center;flex:1;';
        // 이 팝업은 지도(#map-wrap) 위에 뜨므로 #cdu-wrap 위임이 닿지 않는다 → 인라인 onclick 유지
        m.bindPopup(`<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:11px;color:#333;line-height:1.5;min-width:180px;">` +
          `<div style="color:#0077aa;font-weight:bold;font-size:12px;margin-bottom:3px;">${emoji} ${p.name}</div>` +
          `<div>위치: ${_tpDMS(p.lat, true)} ${_tpDMS(p.lon, false)}</div>` +
          `<div style="display:flex;gap:5px;margin-top:6px;">` +
            `<span onclick="tpMapHide(${fi},${pi})" style="${btn}background:#eee;color:#555;">숨기기</span>` +
            `<span onclick="tpMapAddFpl(${fi},${pi})" style="${btn}background:#e3f2ee;color:#00796b;border:1px solid #00796b55;">플랜 추가</span>` +
            `<span onclick="tpMapDirect(${fi},${pi})" style="${btn}background:#e8f1fb;color:#0077aa;border:1px solid #0077aa55;">Direct</span>` +
          `</div></div>`);
        m.addTo(g);
      }));
      _tpPointLayer = g.addTo(leafMap);
    }
    // ── 지도 포인트 팝업 동작 ──
    function _tpMapPt(fi, pi) { const fd = tpFolders()[fi]; return fd && fd.pts ? { f: tpFolders(), fd, p: fd.pts[pi] } : null; }
    function tpMapHide(fi, pi) {
      const r = _tpMapPt(fi, pi); if (!r || !r.p) return;
      r.p.show = false; _tpSave('tpFolders', r.f); _tpRenderMapPoints();
      if (currentMode === 'TRACKPOINT') switchMode('TRACKPOINT');
    }
    function _tpFplIdent(name) {
      const c = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (c) return c;
      return 'PT' + (S.wps.filter(w => /^PT\d*$/.test(w.ident)).length + 1);
    }
    function tpMapAddFpl(fi, pi) {
      const r = _tpMapPt(fi, pi); if (!r || !r.p) return;
      pushWP({ ident: _tpFplIdent(r.p.name), lat: r.p.lat, lon: r.p.lon });
      try { leafMap.closePopup(); } catch (e) { _swallow(e); }
    }
    function tpMapDirect(fi, pi) {
      const r = _tpMapPt(fi, pi); if (!r || !r.p) return;
      pushWP({ ident: _tpFplIdent(r.p.name), lat: r.p.lat, lon: r.p.lon });
      selectWP(S.wps.length - 1);   // 현재 위치 → 이 포인트로 Direct-To
      try { leafMap.closePopup(); } catch (e) { _swallow(e); }
    }

    // 아이콘 선택 화면 열기/적용
    function tpPickIcon(type, fi, pi) { _tpIconPick = { type, fi, pi }; switchMode('TRACKPOINT'); }
    function tpApplyIcon(emoji) {
      if (!_tpIconPick) return;
      const f = tpFolders();
      if (_tpIconPick.type === 'folder') {
        const fd = f[_tpIconPick.fi];
        if (fd) {
          fd.icon = emoji;
          // 폴더 아이콘은 폴더 내 모든 포인트에 일괄 적용(개별 아이콘 초기화 → 폴더 아이콘 상속)
          (fd.pts || []).forEach(p => { delete p.icon; });
        }
      } else {
        const fd = f[_tpIconPick.fi]; if (fd && fd.pts[_tpIconPick.pi]) fd.pts[_tpIconPick.pi].icon = emoji;
      }
      _tpSave('tpFolders', f); _tpIconPick = null; _tpRenderMapPoints(); switchMode('TRACKPOINT');
    }
    function tpIconCancel() { _tpIconPick = null; switchMode('TRACKPOINT'); }

    function _tpDMS(dd, isLat) {
      const a = Math.abs(dd), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60);
      const dir = isLat ? (dd >= 0 ? 'N' : 'S') : (dd >= 0 ? 'E' : 'W');
      return `${d}°${String(m).padStart(2,'0')}'${String(s).padStart(2,'0')}"${dir}`;
    }

    // ── 폴더 CRUD ──
    async function tpFolderAdd() {
      const f = tpFolders();
      const name = (await uiPrompt('새 폴더 이름', '폴더' + (f.length + 1)) || '').trim();
      if (!name) return;
      f.push({ name, pts: [] }); _tpSave('tpFolders', f); switchMode('TRACKPOINT');
    }
    function tpFolderOpen(i) { tpFolderIdx = i; _tpIconPick = null; switchMode('TRACKPOINT'); }
    function tpFolderBack() { tpFolderIdx = null; _tpIconPick = null; switchMode('TRACKPOINT'); }
    async function tpFolderRename(i) {
      const f = tpFolders(); const name = (await uiPrompt('폴더 이름', f[i].name) || '').trim();
      if (name) { f[i].name = name; _tpSave('tpFolders', f); switchMode('TRACKPOINT'); }
    }
    async function tpFolderDel(i) {
      const f = tpFolders();
      if (!await uiConfirm(`폴더 "${f[i].name}"(포인트 ${f[i].pts.length}개)를 삭제할까요?`,
            { okText: '삭제', cancelText: '취소' })) return;
      f.splice(i, 1); _tpSave('tpFolders', f); _tpRenderMapPoints(); switchMode('TRACKPOINT');
    }
    function _curFolder() { const f = tpFolders(); return f[tpFolderIdx] ? { f, folder: f[tpFolderIdx] } : null; }

    // ── 폴더 내 포인트 ──
    async function tpAddPoint(src) {
      const cf = _curFolder(); if (!cf) return;
      let lat, lon;
      if (src === 'pos') { lat = S.lat; lon = S.lon; }
      else if (src === 'cross') { const c = leafMap.getCenter(); lat = c.lat; lon = c.lng; }
      else {
        const v = await uiPrompt('좌표 입력 (위도,경도) 십진수\n예: 37.3895, 126.6550', '');
        if (!v) return;
        const m = v.split(',').map(x => parseFloat(x.trim()));
        if (m.length < 2 || isNaN(m[0]) || isNaN(m[1])) { uiAlert('좌표 형식이 올바르지 않습니다.'); return; }
        lat = m[0]; lon = m[1];
      }
      const name = (await uiPrompt('포인트 이름', 'PT' + (cf.folder.pts.length + 1)) || '').trim() || ('PT' + (cf.folder.pts.length + 1));
      cf.folder.pts.push({ name, lat: +lat.toFixed(6), lon: +lon.toFixed(6) });
      _tpSave('tpFolders', cf.f); switchMode('TRACKPOINT');
    }
    function tpDelPoint(i) { const cf = _curFolder(); if (!cf) return; cf.folder.pts.splice(i, 1); _tpSave('tpFolders', cf.f); _tpRenderMapPoints(); switchMode('TRACKPOINT'); }
    function tpNavPoint(i) {
      const cf = _curFolder(); if (!cf) return; const p = cf.folder.pts[i]; if (!p) return;
      pushWP({ ident: p.name, lat: p.lat, lon: p.lon });
      selectWP(S.wps.length - 1);
      try { cduOpenMap(); } catch(e) { _swallow(e); }
    }
    // 선택 = 지도 표시(show). 체크 시 지도에 마커, 내보내기 대상도 됨.
    function tpSelToggle(i) { const cf = _curFolder(); if (!cf) return; const p = cf.folder.pts[i]; p.show = !p.show; _tpSave('tpFolders', cf.f); _tpRenderMapPoints(); switchMode('TRACKPOINT'); }
    function tpSelAll() { const cf = _curFolder(); if (!cf) return; cf.folder.pts.forEach(p => p.show = true); _tpSave('tpFolders', cf.f); _tpRenderMapPoints(); switchMode('TRACKPOINT'); }
    function tpSelNone() { const cf = _curFolder(); if (!cf) return; cf.folder.pts.forEach(p => p.show = false); _tpSave('tpFolders', cf.f); _tpRenderMapPoints(); switchMode('TRACKPOINT'); }
    function _tpSelCount() { const cf = _curFolder(); return cf ? cf.folder.pts.filter(p => p.show).length : 0; }

    // ── GPX/KML 빌더 ──
    function _xmlEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _gpxPts(pts) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FlightSimulator" xmlns="http://www.topografix.com/GPX/1/1">\n` +
        pts.map(p => `<wpt lat="${p.lat}" lon="${p.lon}"><name>${_xmlEsc(p.name)}</name></wpt>`).join('\n') + `\n</gpx>`;
    }
    function _kmlPts(pts, docName) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document><name>${_xmlEsc(docName||'Points')}</name>\n` +
        pts.map(p => `<Placemark><name>${_xmlEsc(p.name)}</name><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`).join('\n') + `\n</Document></kml>`;
    }
    function _gpxTrack(t) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FlightSimulator" xmlns="http://www.topografix.com/GPX/1/1">\n<rte><name>${_xmlEsc(t.name)}</name>\n` +
        t.pts.map(p => `<rtept lat="${p.lat}" lon="${p.lon}"><name>${_xmlEsc(p.ident||'')}</name></rtept>`).join('\n') + `\n</rte>\n</gpx>`;
    }
    function _kmlTrack(t) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document><name>${_xmlEsc(t.name)}</name>\n<Placemark><name>${_xmlEsc(t.name)}</name><LineString><coordinates>\n` +
        t.pts.map(p => `${p.lon},${p.lat},0`).join(' ') + `\n</coordinates></LineString></Placemark>\n</Document></kml>`;
    }
    // ── 포인트 내보내기(선택 또는 전체) ──
    function tpExportPoints(fmt) {
      const cf = _curFolder(); if (!cf) return;
      const shown = cf.folder.pts.filter(p => p.show);
      const pts = shown.length ? shown : cf.folder.pts;
      if (!pts.length) { uiAlert('내보낼 포인트가 없습니다.'); return; }
      const base = cf.folder.name.replace(/[^\w가-힣]+/g, '_');
      if (fmt === 'gpx') _trkDownload(base + '.gpx', _gpxPts(pts), 'application/gpx+xml');
      else _trkDownload(base + '.kml', _kmlPts(pts, cf.folder.name), 'application/vnd.google-earth.kml+xml');
    }
    // ── 파일 파서 ──
    function _parsePointsFile(text) {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const out = [];
      Array.from(doc.getElementsByTagNameNS('*', 'wpt')).forEach(w => {
        const lat = parseFloat(w.getAttribute('lat')), lon = parseFloat(w.getAttribute('lon'));
        if (isNaN(lat)) return;
        const nm = w.getElementsByTagNameNS('*', 'name')[0];
        out.push({ name: (nm && nm.textContent.trim()) || 'PT', lat: +lat.toFixed(6), lon: +lon.toFixed(6) });
      });
      Array.from(doc.getElementsByTagNameNS('*', 'Placemark')).forEach(pm => {
        const pt = pm.getElementsByTagNameNS('*', 'Point')[0]; if (!pt) return;
        const co = pt.getElementsByTagNameNS('*', 'coordinates')[0]; if (!co) return;
        const [lon, lat] = co.textContent.trim().split(',').map(Number);
        if (isNaN(lat)) return;
        const nm = pm.getElementsByTagNameNS('*', 'name')[0];
        out.push({ name: (nm && nm.textContent.trim()) || 'PT', lat: +lat.toFixed(6), lon: +lon.toFixed(6) });
      });
      return out;
    }
    function _parseTrackFile(text) {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      let pts = [];
      // GPX rtept/trkpt — 고도(ele)·시간(time) 포함
      ['rtept', 'trkpt'].forEach(tag => Array.from(doc.getElementsByTagNameNS('*', tag)).forEach(p => {
        const lat = parseFloat(p.getAttribute('lat')), lon = parseFloat(p.getAttribute('lon'));
        if (isNaN(lat)) return;
        const nm = p.getElementsByTagNameNS('*', 'name')[0];
        const el = p.getElementsByTagNameNS('*', 'ele')[0];
        const tm = p.getElementsByTagNameNS('*', 'time')[0];
        const o = { ident: (nm && nm.textContent.trim()) || undefined, lat, lon };
        if (el) o.altM = parseFloat(el.textContent);
        if (tm) { const ms = Date.parse(tm.textContent); if (!isNaN(ms)) o.t = ms; }
        pts.push(o);
      }));
      // KML gx:Track (when + gx:coord) — 고도·시간
      if (!pts.length) {
        const whens = Array.from(doc.getElementsByTagNameNS('*', 'when'));
        const coords = Array.from(doc.getElementsByTagNameNS('*', 'coord'));
        if (coords.length) coords.forEach((c, i) => {
          const [lon, lat, alt] = c.textContent.trim().split(/\s+/).map(Number);
          if (isNaN(lat)) return;
          const o = { lat, lon };
          if (!isNaN(alt)) o.altM = alt;
          if (whens[i]) { const ms = Date.parse(whens[i].textContent); if (!isNaN(ms)) o.t = ms; }
          pts.push(o);
        });
      }
      // KML LineString coordinates (lon,lat[,alt])
      if (!pts.length) {
        const ls = doc.getElementsByTagNameNS('*', 'LineString')[0];
        const co = ls && ls.getElementsByTagNameNS('*', 'coordinates')[0];
        if (co) co.textContent.trim().split(/\s+/).forEach(c => {
          const [lon, lat, alt] = c.split(',').map(Number);
          if (isNaN(lat)) return;
          const o = { lat, lon };
          if (!isNaN(alt) && alt !== 0) o.altM = alt;
          pts.push(o);
        });
      }
      // 시간 정보가 있으면 구간 속도(kt) 계산
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].t != null && pts[i-1].t != null) {
          const dtH = (pts[i].t - pts[i-1].t) / 3600000;
          if (dtH > 0) pts[i].spdKt = +(distance(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon) / dtH).toFixed(1);
        }
      }
      return pts;
    }
    function _tpPickFile(cb) {
      const inp = document.createElement('input');
      inp.type = 'file';
      // iOS 파일앱은 accept의 UTI가 안 맞으면 GPX/KML을 선택 불가(회색)로 처리 →
      // 제한을 두지 않아 모든 파일을 고를 수 있게 하고, 파서가 GPX/KML을 판별한다.
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = () => {
        const f = inp.files[0];
        if (f) { const r = new FileReader(); r.onload = e => cb(e.target.result, f.name); r.readAsText(f); }
        inp.remove();
      };
      inp.click();
    }
    function tpImportPoints() {
      const cf = _curFolder(); if (!cf) return;
      _tpPickFile((text) => {
        let pts = []; try { pts = _parsePointsFile(text); } catch(e) { _swallow(e); }
        if (!pts.length) { uiAlert('파일에서 포인트를 찾지 못했습니다.\n(GPX wpt / KML Placemark Point 지원)'); return; }
        cf.folder.pts.push(...pts); _tpSave('tpFolders', cf.f);
        uiAlert(`${pts.length}개 포인트를 "${cf.folder.name}" 폴더에 가져왔습니다.`);
        switchMode('TRACKPOINT');
      });
    }

    // ── 저장소(GitHub Pages)의 공용 포인트 불러오기 (points/index.json) ──
    let _tpRepoView = false, _tpRepoList = null;
    async function tpRepoOpen() {
      try {
        const r = await fetch('points/index.json?_=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const list = await r.json();
        if (!Array.isArray(list) || !list.length) { uiAlert('저장소에 등록된 포인트가 없습니다.\n(points/index.json 에 목록 추가)'); return; }
        _tpRepoList = list; _tpRepoView = true; switchMode('TRACKPOINT');
      } catch(e) { uiAlert('저장소 목록을 불러오지 못했습니다.\n' + e.message + '\n(points/index.json 확인)'); }
    }
    function tpRepoBack() { _tpRepoView = false; switchMode('TRACKPOINT'); }
    async function tpRepoImport(i) {
      const e = _tpRepoList && _tpRepoList[i]; if (!e || !e.file) return;
      try {
        const r = await fetch('points/' + e.file + '?_=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text();
        const pts = _parsePointsFile(text);
        if (!pts.length) { uiAlert('파일에서 포인트를 찾지 못했습니다: ' + e.file); return; }
        const fname = String(e.folder || e.name || e.file);
        const f = tpFolders();
        let fd = f.find(x => x.name === fname);
        if (!fd) { fd = { name: fname, pts: [] }; if (e.icon) fd.icon = e.icon; f.push(fd); }
        fd.pts.push(...pts); _tpSave('tpFolders', f); _tpRenderMapPoints();
        uiAlert(`${pts.length}개 포인트를 "${fname}" 폴더로 가져왔습니다.`);
        _tpRepoView = false; tpFolderIdx = null; switchMode('TRACKPOINT');
      } catch(err) { uiAlert('가져오기 실패: ' + err.message); }
    }

    // ── 트랙 ──
    async function tpSaveTrackFromFP() {
      if (!S.wps.length) { uiAlert('저장할 비행계획(웨이포인트)이 없습니다.\nFlight Plan에서 웨이포인트를 먼저 입력하세요.'); return; }
      const arr = tpTracks();
      const name = (await uiPrompt('트랙 이름', 'TRK' + (arr.length + 1)) || '').trim() || ('TRK' + (arr.length + 1));
      arr.push({ name, pts: S.wps.map(w => ({ ident: w.ident, lat: w.lat, lon: w.lon })) });
      _tpSave('tpTracks', arr); switchMode('TRACKPOINT');
    }
    function tpDelTrack(i) { if (_tpTrackShownIdx === i) tpHideTrack(); const a = tpTracks(); a.splice(i, 1); _tpSave('tpTracks', a); switchMode('TRACKPOINT'); }
    async function tpLoadTrack(i) {
      const t = tpTracks()[i]; if (!t || !t.pts.length) return;
      if (S.wps.length && !await uiConfirm('현재 비행계획을 이 트랙으로 대체할까요?',
            { okText: '대체', cancelText: '취소' })) return;
      S.wps = t.pts.map((p, k) => ({ ident: p.ident || ('WP' + (k + 1)), lat: p.lat, lon: p.lon }));
      S.awp = -1; S.fwp = -1;
      selectWP(0);
      try { cduOpenMap(); } catch(e) { _swallow(e); }
    }
    // 트랙 선 색상(선택 가능, 저장)
    const TRK_COLORS = ['#00e5ff', '#ff5252', '#ffd54f', '#00e07a', '#e040fb', '#ffffff', '#ff9800'];
    let trkColor = '#00e5ff';
    try { const c = localStorage.getItem('trkColor'); if (c && TRK_COLORS.includes(c)) trkColor = c; } catch(e) { _swallow(e); }
    function tpSetColor(c) {
      trkColor = c; try { localStorage.setItem('trkColor', c); } catch(e) { _swallow(e); }
      if (_tpTrackShownIdx !== null) { const i = _tpTrackShownIdx; tpShowTrack(i); }   // 표시 중이면 즉시 반영
      switchMode('TRACKPOINT');
    }

    // 트랙을 지도에 단순 선으로 표시(포인트 마커 없음). 선을 탭하면 가장 가까운 지점 정보 팝업.
    let _tpTrackLayer = null, _tpTrackShownIdx = null;
    function tpHideTrack() { if (_tpTrackLayer) { leafMap.removeLayer(_tpTrackLayer); _tpTrackLayer = null; } _tpTrackShownIdx = null; }
    function tpShowTrack(i) {
      const t = tpTracks()[i]; if (!t || !t.pts.length) return;
      tpHideTrack();
      const latlngs = t.pts.map(p => [p.lat, p.lon]);
      const g = L.layerGroup();
      if (latlngs.length > 1) {
        const pl = L.polyline(latlngs, { color: trkColor, weight: 3, opacity: 0.95 });
        pl.on('click', (e) => {
          let best = null, bd = Infinity;
          t.pts.forEach((p, k) => { const d = distance(e.latlng.lat, e.latlng.lng, p.lat, p.lon); if (d < bd) { bd = d; best = { p, k }; } });
          if (!best) return;
          const p = best.p, name = p.ident || ('P' + (best.k + 1));
          const rows = [
            `<div style="color:#0077aa;font-weight:bold;font-size:12px;margin-bottom:3px;">📍 ${name}</div>`,
            `<div>위치: ${_tpDMS(p.lat, true)} ${_tpDMS(p.lon, false)}</div>`,
          ];
          if (p.altM != null) rows.push(`<div>고도: ${Math.round(p.altM * 3.28084)} ft</div>`);
          if (p.spdKt != null) rows.push(`<div>속도: ${Math.round(p.spdKt)} kt</div>`);
          L.popup().setLatLng([p.lat, p.lon])
            .setContent(`<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:11px;color:#333;line-height:1.5;">${rows.join('')}</div>`)
            .openOn(leafMap);
        });
        pl.addTo(g);
      }
      _tpTrackLayer = g.addTo(leafMap);
      _tpTrackShownIdx = i;
      try { if (latlngs.length > 1) leafMap.fitBounds(latlngs, { padding: [40, 40], maxZoom: 13 }); else leafMap.setView(latlngs[0], 13); } catch(e) { _swallow(e); }
      try { cduOpenMap(); } catch(e) { _swallow(e); }
    }
    function tpExportTrack(i, fmt) {
      const t = tpTracks()[i]; if (!t) return;
      const base = t.name.replace(/[^\w가-힣]+/g, '_');
      if (fmt === 'gpx') _trkDownload(base + '.gpx', _gpxTrack(t), 'application/gpx+xml');
      else _trkDownload(base + '.kml', _kmlTrack(t), 'application/vnd.google-earth.kml+xml');
    }
    function tpImportTrack() {
      _tpPickFile(async (text) => {
        let pts = []; try { pts = _parseTrackFile(text); } catch(e) { _swallow(e); }
        if (pts.length < 2) { uiAlert('파일에서 트랙(경로)을 찾지 못했습니다.\n(GPX rte/trk / KML LineString 지원)'); return; }
        const arr = tpTracks();
        const name = (await uiPrompt('트랙 이름', 'TRK' + (arr.length + 1)) || '').trim() || ('TRK' + (arr.length + 1));
        arr.push({ name, pts: pts.map((p, k) => ({ ident: p.ident || ('WP' + (k + 1)), lat: p.lat, lon: p.lon })) });
        _tpSave('tpTracks', arr);
        uiAlert(`트랙 "${name}"(${pts.length}개 지점)을 가져왔습니다.`);
        switchMode('TRACKPOINT');
      });
    }

    function renderTrackPointScreen(container, footer, title) {
      title.innerText = 'Track & Point';
      const tabBtn = (id, label) => {
        const on = tpTab === id;
        return `<button data-act="tpSetTab" data-arg='["${id}"]' style="flex:1;padding:6px 2px;font-size:11px;font-weight:bold;cursor:pointer;` +
          `border-radius:4px;background:${on ? '#002733' : '#111'};color:${on ? '#00e5ff' : '#556'};` +
          `border:1px solid ${on ? '#00e5ff' : '#2a2a2a'};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">${label}</button>`;
      };
      const tabs = `<div style="display:flex;gap:5px;margin-bottom:8px;">${tabBtn('POINT','● POINT')}${tabBtn('TRACK','━ TRACK')}</div>`;
      const btnC = (attrs, label, col) =>
        `<div ${attrs} style="flex:1;min-width:0;text-align:center;padding:7px 4px;border:1px solid ${col||'#2a4a5a'};border-radius:4px;` +
        `background:#0a1620;color:${col||'#00cfff'};font-size:10px;font-weight:bold;cursor:pointer;white-space:nowrap;">${label}</div>`;
      let body = '';

      // 저장소 포인트 목록(오버레이)
      if (_tpRepoView) {
        const list = _tpRepoList || [];
        body = `<div data-act="tpRepoBack" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;margin-bottom:8px;` +
          `border:1px solid #2a4a5a;border-radius:4px;background:#0a1620;color:#00cfff;font-size:10px;font-weight:bold;cursor:pointer;">☰ 뒤로</div>` +
          `<div style="color:#00cfff;font-size:12px;font-weight:bold;margin-bottom:6px;">☁ 저장소 포인트</div>` +
          list.map((e, i) =>
            `<div data-act="tpRepoImport" data-arg='[${i}]' style="display:flex;align-items:center;gap:6px;padding:9px 8px;margin-bottom:4px;border:1px solid #1e2630;border-radius:4px;background:#0a1116;cursor:pointer;">` +
              `<span style="font-size:18px;">${e.icon || '📥'}</span>` +
              `<div style="flex:1;min-width:0;"><div style="color:#cdd6df;font-size:11px;font-weight:bold;">${e.name || e.file}</div>` +
              `<div style="color:#667;font-size:9px;">${e.file}${e.folder ? ' → ' + e.folder + ' 폴더' : ''}</div></div>` +
              `<span style="color:#00e5ff;font-size:10px;font-weight:bold;">가져오기 ›</span></div>`
          ).join('');
        container.innerHTML = body;
        footer.innerHTML = cduFooter(tpRepoBack);
        return;
      }

      // 아이콘 선택 화면(오버레이)
      if (_tpIconPick) {
        const isF = _tpIconPick.type === 'folder';
        body = `<div style="color:#00cfff;font-size:12px;font-weight:bold;margin-bottom:2px;">${isF ? '폴더' : '포인트'} 아이콘 선택</div>` +
          (isF ? `<div style="color:#667;font-size:9px;margin-bottom:8px;">이 폴더의 모든 포인트에 적용됩니다</div>` : `<div style="margin-bottom:8px;"></div>`) +
          `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;">` +
          TP_ICONS.map(e => `<div data-act="tpApplyIcon" data-arg='["${e}"]' style="text-align:center;font-size:26px;padding:10px 0;border:1px solid #1e2630;border-radius:6px;background:#0a1116;cursor:pointer;">${e}</div>`).join('') +
          `</div>` +
          `<div data-act="tpIconCancel" style="text-align:center;padding:8px;border:1px solid #5a2a2a;border-radius:4px;color:#ff8877;font-size:11px;font-weight:bold;cursor:pointer;">취소</div>`;
        container.innerHTML = body;
        footer.innerHTML = cduFooter(tpIconCancel);
        return;
      }

      if (tpTab === 'POINT') {
        if (tpFolderIdx === null) {
          // 폴더 목록
          const folders = tpFolders();
          body += `<div style="display:flex;gap:5px;margin-bottom:8px;">` + btnC(act('tpFolderAdd'), '＋ 새 폴더') + btnC(act('tpRepoOpen'), '☁ 저장소에서 불러오기', '#8ac6ff') + `</div>`;
          body += folders.length ? folders.map((fd, i) =>
            `<div style="display:flex;align-items:center;gap:6px;padding:9px 8px;margin-bottom:4px;border:1px solid #1e2630;border-radius:4px;background:#0a1116;">` +
              `<span data-act="tpPickIcon" data-arg='["folder",${i}]' style="font-size:20px;cursor:pointer;flex:0 0 auto;" title="아이콘">${fd.icon || '📁'}</span>` +
              `<div data-act="tpFolderOpen" data-arg='[${i}]' style="flex:1;min-width:0;cursor:pointer;">` +
                `<div style="color:#00cfff;font-size:12px;font-weight:bold;">${fd.name}</div>` +
                `<div style="color:#667;font-size:9px;">${fd.pts.length}개 포인트 · 표시 ${(fd.pts||[]).filter(p=>p.show).length}</div></div>` +
              `<span data-act="tpFolderRename" data-arg='[${i}]' style="cursor:pointer;color:#889;border:1px solid #333;border-radius:3px;padding:3px 7px;font-size:10px;">이름</span>` +
              `<span data-act="tpFolderDel" data-arg='[${i}]' style="cursor:pointer;color:#ff8877;border:1px solid #5a2a2a;border-radius:3px;padding:3px 7px;font-size:10px;">✕</span>` +
              `<span data-act="tpFolderOpen" data-arg='[${i}]' style="cursor:pointer;color:#00cfffaa;font-size:14px;">›</span></div>`
          ).join('') : `<div style="color:#556;font-size:10px;padding:8px 2px;">폴더가 없습니다. "＋ 새 폴더"로 만드세요.</div>`;
        } else {
          // 폴더 내부
          const cf = _curFolder();
          if (!cf) { tpFolderIdx = null; return renderTrackPointScreen(container, footer, title); }
          const pts = cf.folder.pts, selN = _tpSelCount();
          body += `<div data-act="tpFolderBack" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;margin-bottom:7px;` +
            `border:1px solid #2a4a5a;border-radius:4px;background:#0a1620;color:#00cfff;font-size:10px;font-weight:bold;cursor:pointer;">☰ 폴더 목록</div>` +
            `<div style="color:#00cfff;font-size:12px;font-weight:bold;margin-bottom:2px;">` +
              `<span data-act="tpPickIcon" data-arg='["folder",${tpFolderIdx}]' style="cursor:pointer;" title="폴더 아이콘(전체 적용)">${cf.folder.icon || '📁'}</span> ${cf.folder.name}` +
              `<span data-act="tpPickIcon" data-arg='["folder",${tpFolderIdx}]' style="margin-left:8px;font-size:9px;color:#8ac6ff;border:1px solid #2a4a6a;border-radius:3px;padding:2px 7px;cursor:pointer;font-weight:normal;">폴더 아이콘</span></div>` +
            `<div style="color:#667;font-size:9px;margin-bottom:6px;">✓ 체크한 포인트가 지도에 표시됩니다 · 폴더 아이콘은 전체 포인트에 적용</div>`;
          body += `<div style="display:flex;gap:5px;margin-bottom:6px;">` +
            btnC(act('tpAddPoint','pos'), '＋ 현재위치') + btnC(act('tpAddPoint','cross'), '＋ 지도중심') + btnC(act('tpAddPoint','manual'), '＋ 좌표입력') + `</div>`;
          body += `<div style="display:flex;gap:5px;margin-bottom:8px;">` +
            btnC(act('tpSelAll'), `전체표시`) + btnC(act('tpSelNone'), '전체숨김') +
            btnC(act('tpExportPoints','gpx'), `GPX${selN?'('+selN+')':''}`, '#8ac6ff') +
            btnC(act('tpExportPoints','kml'), `KML${selN?'('+selN+')':''}`, '#8bc34a') +
            btnC(act('tpImportPoints'), '가져오기', '#ffcc44') + `</div>`;
          body += pts.length ? pts.map((p, i) => {
            const sel = !!p.show, emoji = p.icon || cf.folder.icon || '📍';
            return `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;margin-bottom:4px;border:1px solid ${sel?'#00e5ff':'#1e2630'};border-radius:4px;background:${sel?'#001e28':'#0a1116'};">` +
              `<div data-act="tpSelToggle" data-arg='[${i}]' style="flex:0 0 18px;width:18px;height:18px;border-radius:3px;border:1.5px solid ${sel?'#00e5ff':'#3a4653'};display:flex;align-items:center;justify-content:center;color:#00e5ff;font-size:12px;font-weight:bold;cursor:pointer;">${sel?'✓':''}</div>` +
              `<span data-act="tpPickIcon" data-arg='["point",${tpFolderIdx},${i}]' style="font-size:18px;cursor:pointer;flex:0 0 auto;" title="아이콘">${emoji}</span>` +
              `<div style="flex:1;min-width:0;"><div style="color:#cdd6df;font-size:11px;font-weight:bold;">${p.name}</div>` +
              `<div style="color:#667;font-size:9px;">${_tpDMS(p.lat,true)} ${_tpDMS(p.lon,false)}</div></div>` +
              `<span data-act="tpNavPoint" data-arg='[${i}]' style="cursor:pointer;color:#00e5ff;border:1px solid #00e5ff66;border-radius:3px;padding:3px 6px;font-size:10px;font-weight:bold;">→ 항법</span>` +
              `<span data-act="tpDelPoint" data-arg='[${i}]' style="cursor:pointer;color:#ff8877;border:1px solid #5a2a2a;border-radius:3px;padding:3px 6px;font-size:10px;">✕</span></div>`;
          }).join('') : `<div style="color:#556;font-size:10px;padding:8px 2px;">이 폴더에 포인트가 없습니다.</div>`;
        }
      } else {
        const trks = tpTracks();
        body += `<div style="display:flex;gap:5px;margin-bottom:8px;">` +
          btnC(act('tpSaveTrackFromFP'), '＋ 비행계획을 트랙으로') + btnC(act('tpImportTrack'), '가져오기', '#ffcc44') + `</div>`;
        // 선 색상 선택
        body += `<div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;padding:6px 8px;border:1px solid #1e2630;border-radius:4px;background:#0a1116;">` +
          `<span style="color:#889;font-size:10px;">선 색상</span>` +
          TRK_COLORS.map(c => `<span data-act="tpSetColor" data-arg='["${c}"]' style="width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;` +
            `border:2px solid ${trkColor === c ? '#fff' : 'transparent'};box-shadow:${trkColor===c?'0 0 5px '+c:'none'};"></span>`).join('') + `</div>`;
        body += trks.length ? trks.map((t, i) => {
          const shown = _tpTrackShownIdx === i;
          return `<div style="padding:7px 8px;margin-bottom:4px;border:1px solid ${shown?'#00e5ff':'#1e2630'};border-radius:4px;background:${shown?'#001e28':'#0a1116'};">` +
            `<div style="display:flex;align-items:center;gap:6px;">` +
              `<div style="flex:1;min-width:0;"><div style="color:#cdd6df;font-size:11px;font-weight:bold;">━ ${t.name}</div>` +
              `<div style="color:#667;font-size:9px;">${t.pts.length}개 지점</div></div>` +
              (shown
                ? `<span data-act="tpHideTrackAndBack" style="cursor:pointer;color:#ffcc44;border:1px solid #6a5a2a;border-radius:3px;padding:3px 7px;font-size:10px;font-weight:bold;">숨김</span>`
                : `<span data-act="tpShowTrack" data-arg='[${i}]' style="cursor:pointer;color:#00e5ff;border:1px solid #00e5ff66;border-radius:3px;padding:3px 7px;font-size:10px;font-weight:bold;">지도 표시</span>`) +
              `<span data-act="tpDelTrack" data-arg='[${i}]' style="cursor:pointer;color:#ff8877;border:1px solid #5a2a2a;border-radius:3px;padding:3px 7px;font-size:10px;">✕</span></div>` +
            `<div style="display:flex;gap:5px;margin-top:5px;">` +
              btnC(act('tpLoadTrack', i), '비행계획으로', '#00cfff') +
              btnC(act('tpExportTrack', i, 'gpx'), 'GPX', '#8ac6ff') + btnC(act('tpExportTrack', i, 'kml'), 'KML', '#8bc34a') + `</div></div>`;
        }).join('') : `<div style="color:#556;font-size:10px;padding:8px 2px;">저장된 트랙이 없습니다.</div>`;
      }
      container.innerHTML = tabs + body;
      footer.innerHTML = cduFooter("switchMode('HOME')");
    }

    // --- Main Content Renderer Route ---
    function renderContent() {
        window._cduRenderContent = renderContent; // 전역 노출 (Charts 기능에서 참조)
        const container = document.getElementById('mainContentArea');
        const footer = document.getElementById('footerNav');
        const title = document.getElementById('modeTitle');
        container.innerHTML = '';

        switch(currentMode) {
            case 'HOME': renderHomeScreen(container, footer, title); break;
            case 'PERF': renderPerfScreen(container, footer, title); break;
            case 'PERF_INPUT': renderPerfInputScreen(container, footer, title); break;
            case 'AUDIO': renderAudioScreen(container, footer, title); break;
            case 'INTERCOM': renderIntercomScreen(container, footer, title); break;
            case 'SELCAL_INPUT': renderSelcalInputScreen(container, footer, title); break;
            case 'VOX_MODE': renderVoxModeScreen(container, footer, title); break;
            case 'HF_CONTROL': renderHfControlScreen(container, footer, title); break;
            case 'COM_INPUT': renderComInputScreen(container, footer, title); break;
            case 'NAV_SEL': renderNavSelectScreen(container, footer, title); break;
            case 'AIRFIELD': renderAirfieldScreen(container, footer, title); break;
            case 'CCTV': renderCctvScreen(container, footer, title); break;
            case 'AIRFIELD_DETAIL': renderAirfieldDetailScreen(container, footer, title); break;
            case 'XPDR_MODE': renderXpdrModeScreen(container, footer, title); break;
            case 'XPDR_CODE': renderXpdrCodeScreen(container, footer, title); break;
            case 'UTIL': renderUtilScreen(container, footer, title); break;
            case 'CHECKLIST': renderChecklistScreen(container, footer, title); break;
            case 'SETTINGS': renderSettingsScreen(container, footer, title); break;
            case 'TRACKPOINT': renderTrackPointScreen(container, footer, title); break;
            case 'CHARTS': renderChartsScreen(container, footer, title); break;
        }

        updateHeaderUI();
    }

    // --- Render Helpers ---
    function renderAudioRow(label, id) {
        let isMicOn = (micSelected === label);
        let freqBoxHTML = id === 'uvhf' 
            ? `<div></div>` 
            : `<div class="freq-display-box" data-act="switchMode" data-arg='["COM_INPUT","${id}"]'>
                <div style="color:white; font-size:10px; font-weight:bold;">${freqs[id].act}</div>
                <div style="color:var(--text-cyan); font-size:8px;">${freqs[id].stb}</div>
               </div>`;

        return `<div class="volume-row">
            <div class="item-btn ${monStates[id]?'on':''}" data-act="toggleMon" data-arg='["${id}"]'>${label}<div class="status-line"></div></div>
            <div class="item-btn ${isMicOn?'on':''}" data-act="setMic" data-arg='["${label}"]'>MIC<div class="status-line"></div></div>
            <div class="wedge-slider" data-act="handleVol" data-on="pointerdown" data-arg='["${id}","$event","$el"]'>
                <span class="wedge-text">${volumes[id]}%</span>
                <div class="wedge-fill" style="width:${volumes[id]}%"></div>
            </div>
            ${freqBoxHTML}
        </div>`;
    }

    function renderNavRow(label, id) {
        return `<div style="display: grid; grid-template-columns: 60px 1fr 80px; align-items: center; margin-bottom: 7px; gap: 6px;">
            <div class="item-btn ${monStates[id]?'on':''}" data-act="toggleMon" data-arg='["${id}"]'>${label}<div class="status-line"></div></div>
            <div class="wedge-slider" data-act="handleVol" data-on="pointerdown" data-arg='["${id}","$event","$el"]'>
                <span class="wedge-text">${volumes[id]}%</span>
                <div class="wedge-fill" style="width:${volumes[id]}%"></div>
            </div>
            <div class="freq-display-box" style="align-items:center; padding:0; justify-content:center; cursor:pointer;" data-act="openNavSel" data-arg='["${id}"]'>
                <div style="display:flex; gap:4px; font-size:12px; font-weight:bold; margin-bottom:2px;">
                    <span style="color:var(--text-green);">${freqs[id].act}</span>
                    <span style="color:white;">${freqs[id].id}</span>
                </div>
                <div style="color:var(--text-cyan); font-size:9px; font-weight:bold;">▾ VOR 선택</div>
            </div>
        </div>`;
    }

    // ── NAV1/NAV2 VOR 튜닝 화면 ──
    let _navSelTarget = 'nav1';   // 현재 튜닝 대상 무선
    function openNavSel(id) { _navSelTarget = id; switchMode('NAV_SEL'); }
    function renderNavSelectScreen(container, footer, title) {
        title.innerText = (_navSelTarget === 'nav1' ? 'NAV1' : 'NAV2') + ' — VOR 선택';
        const cur = freqs[_navSelTarget];
        const rows = (typeof ENR_VORS !== 'undefined' ? ENR_VORS : []).filter(v => v.freq).map(v => {
            const sel = (v.id === cur.id) ? 'border-color:#00e5ff;background:#03202a;' : '';
            return `<div data-act="pickNavVor" data-arg='["${v.id}"]' style="display:grid;grid-template-columns:56px 1fr 64px;align-items:center;gap:8px;
                padding:9px 10px;margin-bottom:6px;border:1px solid #234;border-radius:6px;cursor:pointer;${sel}">
                <span style="color:#fff;font-weight:bold;font-size:13px;">${v.id}</span>
                <span style="color:#9fb4c8;font-size:11px;">${v.name}</span>
                <span style="color:#00e5ff;font-weight:bold;font-size:12px;text-align:right;">${v.freq}</span>
            </div>`;
        }).join('');
        container.innerHTML = `<div style="padding:8px 6px;overflow-y:auto;height:100%;">
            <div style="color:#9fb4c8;font-size:10px;margin-bottom:8px;">현재: <b style="color:#00e5ff;">${cur.id||'----'} ${cur.act||''}</b>
                &nbsp;·&nbsp;VOR 명칭을 선택하거나 아래 버튼으로 주파수를 직접 입력하세요.</div>
            <div data-act="switchMode" data-arg='["COM_INPUT","${_navSelTarget}"]' style="text-align:center;padding:9px;margin-bottom:10px;
                border:1px solid #b8860b;border-radius:6px;color:#facc15;font-weight:bold;font-size:12px;cursor:pointer;">⌨ 직접 주파수 입력</div>
            ${rows}
        </div>`;
        footer.innerHTML = cduFooter("switchMode('AUDIO')");
    }
    // VOR 명칭 선택 → 무선 튜닝 + PFD 연동
    function pickNavVor(vorId) {
        const v = (typeof ENR_VORS !== 'undefined' ? ENR_VORS : []).find(x => x.id === vorId);
        if (!v) return;
        freqs[_navSelTarget].act = v.freq;
        freqs[_navSelTarget].id  = v.id;
        try { setNavRadio(_navSelTarget === 'nav1' ? 'NAV1' : 'NAV2', v.freq, v.id); } catch(e) { _swallow(e); }
        switchMode('AUDIO');
    }

    // ── 비행장 정보 화면 ──
    let _afldIdx = null;
    let _afldUnlocked = false;   // 군공항 포함 전체 공개 여부(보안)
    // 2자리 표준 코드는 ICAO(RK__)로 표기, 그 외(G515 등)는 원본 유지
    // icao 필드가 있으면 그것을 쓰고, 없으면 2자리 코드에서 'RK'+code로 파생한다.
    // (군 비행장 일부는 파생 규칙이 실제 ICAO와 다를 수 있어 데이터로 덮어쓸 수 있게 둔다)
    function _afldIcao(a) { return a.icao || ((a.code && a.code.length === 2) ? 'RK' + a.code : a.code); }
    let _afldMsg = '';   // 튜닝 결과 안내(상세 화면 상단)
    function openAirfield(i) { _afldIdx = i; _afldMsg = ''; _afldPending = null; switchMode('AIRFIELD_DETAIL'); }
    let _afldPending = null;   // 튜닝 대상 선택 대기: { freq, type:'COM'|'NAV' }
    // 주파수 문자열에서 VHF(COM)·NAV(VOR/LLZ) 주파수를 탭 가능한 링크로 변환(UHF/기타는 평문)
    function _afldFreqHtml(str) {
        if (!str) return '-';
        return String(str).replace(/\d{2,3}\.\d{1,3}/g, (m) => {
            const f = parseFloat(m);
            if (f >= 108 && f < 118)  return `<span data-act="afldPick" data-arg='["${m}","NAV"]' style="color:#9fd0ff;text-decoration:underline;cursor:pointer;">${m}</span>`;
            if (f >= 118 && f < 137)  return `<span data-act="afldPick" data-arg='["${m}","COM"]' style="color:#8fe6c8;text-decoration:underline;cursor:pointer;">${m}</span>`;
            return m;   // UHF(225~400)·기타(HF/CH)는 평문
        });
    }
    // 주파수 탭 → 어느 라디오에 넣을지 선택 대기
    function afldPick(freq, type) { _afldPending = { freq, type }; _afldMsg = ''; switchMode('AIRFIELD_DETAIL'); }
    function afldCancelPick() { _afldPending = null; switchMode('AIRFIELD_DETAIL'); }
    // VHF/ATIS → 선택한 COM(STBY)
    function afldPutCom(freq, id) {   // id: 'com1' | 'com2'
        freqs[id].stb = freq;
        _afldMsg = `${id.toUpperCase()} STBY ← ${freq}`;
        _afldPending = null;
        switchMode('AIRFIELD_DETAIL');
    }
    // NAV/LLZ → 선택한 NAV + VOR 매칭 + PFD 연동
    function afldPutNav(freq, id) {    // id: 'nav1' | 'nav2'
        freqs[id].act = freq;
        const m = (typeof ENR_VORS !== 'undefined' ? ENR_VORS : []).find(x => x.freq && Math.abs(parseFloat(x.freq) - parseFloat(freq)) < 0.001);
        freqs[id].id = m ? m.id : '';
        try { setNavRadio(id === 'nav1' ? 'NAV1' : 'NAV2', freq, m ? m.id : null); } catch(e) { _swallow(e); }
        _afldMsg = `${id.toUpperCase()} ← ${freq}${m ? ' (' + m.id + ')' : ''}`;
        _afldPending = null;
        switchMode('AIRFIELD_DETAIL');
    }
    // 상단 ALL 버튼 — 코드 입력 시 전체(군공항 포함) 공개, 실패 시 AIP 공개 공항만
    async function afldToggleAll() {
        if (_afldUnlocked) { _afldUnlocked = false; switchMode('AIRFIELD'); return; }
        const p = await uiPrompt('전체 비행장 보기\n접근 코드를 입력하세요:', '', { password: true });
        if (p === 'thdenfl') { _afldUnlocked = true; }
        else { _afldUnlocked = false; if (p !== null) uiAlert('코드가 올바르지 않습니다.\nAIP 공개 공항만 표시됩니다.'); }
        switchMode('AIRFIELD');
    }
    // ── CCTV 선택 화면 (BADA / Park → 외부 사이트) ──
    function renderCctvScreen(container, footer, title) {
        title.innerText = 'CCTV';
        const item = (label, url, desc) => `<a href="${url}" target="_blank" style="text-decoration:none;display:block;">` +
            `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 12px;margin-bottom:9px;border:1px solid #1e3a4a;border-radius:6px;background:#0a1620;">` +
            `<div><div style="color:#00cfff;font-size:14px;font-weight:bold;">${label}</div>` +
            `<div style="color:#567;font-size:10px;margin-top:2px;">${desc}</div></div>` +
            `<div style="color:#0090b0;font-size:16px;">↗</div></div></a>`;
        container.innerHTML = `<div style="padding:10px 6px;">` +
            `<div style="color:#556;font-size:10px;letter-spacing:1px;margin-bottom:8px;">CCTV를 선택하세요 (외부 사이트)</div>` +
            item('BADA CCTV', 'https://www.badatime.com/cctv', '연안·해상 CCTV') +
            item('Park CCTV', 'https://m.knps.or.kr/main/menuctrl.do?menuNo=10', '국립공원 CCTV') +
            item('독도/울릉도', 'https://www.ulleung.go.kr/live/index.do', '울릉군 실시간 CCTV') +
            item('한라산', 'https://www.jeju.go.kr/tool/halla/cctv.html', '한라산 실시간 CCTV') +
            `</div>`;
        footer.innerHTML = cduFooter("switchMode('HOME')");
    }
    function renderAirfieldScreen(container, footer, title) {
        title.innerText = '비행장 정보';
        const list = (typeof AIRFIELD_INFO !== 'undefined' ? AIRFIELD_INFO : []);
        // 원래 인덱스를 유지한 채 이름 가나다순 정렬
        const rows = list
          .map((a, i) => ({ a, i }))
          .filter(o => _afldUnlocked || o.a.pub)      // 잠금 시 군공항 숨김
          .sort((x, y) => x.a.name.localeCompare(y.a.name, 'ko'))
          .map(({ a, i }) => {
            const mil = a.pub ? '' : ` <span style="color:#ff8a65;font-size:9px;">군</span>`;
            return `
            <div data-act="openAirfield" data-arg='[${i}]' style="display:grid;grid-template-columns:1fr 52px 64px;align-items:center;gap:6px;
                padding:9px 10px;margin-bottom:5px;border:1px solid #234;border-radius:6px;cursor:pointer;">
              <span style="color:#fff;font-weight:bold;font-size:13px;">${a.name}${a.code ? ` <span style="color:#7fe0c0;font-size:10px;">(${_afldIcao(a)})</span>` : ''}${mil}</span>
              <span style="color:#00e5ff;font-size:11px;text-align:right;">${a.elev != null ? uAlt(a.elev) : '-'}</span>
              <span style="color:#9fb4c8;font-size:10px;text-align:right;">${(a.rwy || '').split(' ')[0]}</span>
            </div>`;
        }).join('');
        const allBtn = `<div data-act="afldToggleAll" style="cursor:pointer;padding:6px 14px;border-radius:6px;font-weight:bold;font-size:12px;
            border:1px solid ${_afldUnlocked ? '#ff8a65' : '#4a90d9'};color:${_afldUnlocked ? '#ff8a65' : '#7ab8f5'};">${_afldUnlocked ? 'ALL ✓' : 'ALL'}</div>`;
        container.innerHTML = `<div style="padding:8px 6px;overflow-y:auto;height:100%;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">
              <div style="color:#9fb4c8;font-size:10px;">국내 비행장 주파수 · VOR · ILS · RWY · 표고 (2022.1)${_afldUnlocked ? '' : ' · <span style="color:#ffab91;">AIP 공개 공항만</span>'}</div>
              ${allBtn}
            </div>
            ${rows}</div>`;
        footer.innerHTML = cduFooter("switchMode('HOME')");
    }
    function renderAirfieldDetailScreen(container, footer, title) {
        const list = (typeof AIRFIELD_INFO !== 'undefined' ? AIRFIELD_INFO : []);
        const a = list[_afldIdx];
        if (!a || (!_afldUnlocked && !a.pub)) { switchMode('AIRFIELD'); return; }
        title.innerText = a.name + (a.code ? ` (${_afldIcao(a)})` : '');
        const row = (lbl, val, color) => `<div style="display:grid;grid-template-columns:74px 1fr;gap:8px;padding:7px 4px;border-bottom:1px solid #1a2a38;">
            <span style="color:#7a90a4;font-size:11px;font-weight:bold;">${lbl}</span>
            <span style="color:${color || '#e6eef6'};font-size:12px;line-height:1.45;word-break:break-all;">${val || '-'}</span></div>`;
        // 주파수 필드는 탭 튜닝 링크로 변환
        const frow = (lbl, val, color) => row(lbl, _afldFreqHtml(val), color);
        // 라디오 선택 대기 배너(COM1/COM2 또는 NAV1/NAV2)
        let msg;
        if (_afldPending) {
            const f = _afldPending.freq, isCom = _afldPending.type === 'COM';
            const btn = (id, label, col) => `<span ${act(isCom ? 'afldPutCom' : 'afldPutNav', f, id)} style="cursor:pointer;padding:6px 14px;border-radius:5px;font-weight:bold;font-size:12px;border:1px solid ${col};color:${col};">${label}</span>`;
            msg = `<div style="background:#0a1626;border:1px solid #2a4a7a;border-radius:6px;padding:8px;margin-bottom:8px;">
                <div style="color:#cfe0f0;font-size:11px;margin-bottom:7px;"><b style="color:${isCom ? '#8fe6c8' : '#9fd0ff'};">${f}</b> — 어느 라디오에 넣을까요?</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    ${isCom ? btn('com1','COM1','#8fe6c8') + btn('com2','COM2','#8fe6c8') : btn('nav1','NAV1','#9fd0ff') + btn('nav2','NAV2','#9fd0ff')}
                    <span data-act="afldCancelPick" style="cursor:pointer;padding:6px 12px;border-radius:5px;font-size:12px;border:1px solid #555;color:#aaa;">취소</span>
                </div></div>`;
        } else if (_afldMsg) {
            msg = `<div style="background:#062a1c;border:1px solid #0a6;border-radius:5px;color:#4ade80;font-size:11px;font-weight:bold;padding:6px 8px;margin-bottom:8px;">✓ ${_afldMsg} 튜닝됨</div>`;
        } else {
            msg = `<div style="color:#7a90a4;font-size:10px;margin-bottom:8px;">파란(NAV)/초록(COM) 주파수를 누르면 넣을 라디오(1/2)를 선택합니다 (UHF 제외).</div>`;
        }
        container.innerHTML = `<div style="padding:8px 8px;overflow-y:auto;height:100%;">
            ${msg}
            ${row('표고', a.elev != null ? uAlt(a.elev) : '-', '#00e5ff')}
            ${row('RWY', a.rwy)}
            ${frow('TWR', a.twr, '#8fe6c8')}
            ${frow('APP', a.app)}
            ${frow('GND', a.gnd)}
            ${frow('VOR/ATIS', a.vor, '#ffd54f')}
            ${frow('ILS(LLZ)', a.ils, '#9fd0ff')}
            ${a.note ? row('비고', a.note, '#c8b0ff') : ''}
        </div>`;
        footer.innerHTML = cduFooter("switchMode('AIRFIELD')");
    }

    function renderMissionRow(label, id) {
        let isMicOn = (micSelected === label);
        let rightBox = '';
        
        if (id === 'vhffm') {
            rightBox = `<div style="background:black; border:0.7px solid #444; border-radius:4px; height:35px;"></div>`;
        } else if (id === 'hf') {
            rightBox = `<div class="freq-display-box" style="align-items:flex-start; justify-content:center; padding:2px 6px; cursor:pointer;" data-act="switchMode" data-arg='["HF_CONTROL"]'>
                            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                                <div style="color:white; font-size:14px; font-weight:bold;">${freqs.hf.act}</div>
                                <div style="color:var(--text-cyan); font-size:8px; font-weight:bold; margin-top:2px;">${hfState.sql}</div>
                            </div>
                            <div style="color:var(--text-cyan); font-size:8px; font-weight:bold; text-align:left; margin-top:2px;">${hfState.emission}</div>
                        </div>`;
        }
        
        return `<div class="volume-row" style="margin-bottom:0;">
            <div class="item-btn ${monStates[id]?'on':''}" data-act="toggleMon" data-arg='["${id}"]'>${label}<div class="status-line"></div></div>
            <div class="item-btn ${isMicOn?'on':''}" data-act="setMic" data-arg='["${label}"]'>MIC<div class="status-line"></div></div>
            <div class="wedge-slider" data-act="handleVol" data-on="pointerdown" data-arg='["${id}","$event","$el"]'>
                <span class="wedge-text">${volumes[id]}%</span>
                <div class="wedge-fill" style="width:${volumes[id]}%"></div>
            </div>
            ${rightBox}
        </div>`;
    }

    // --- Control Logics ---
    function toggleHfTuning() { hfState.tuning = hfState.tuning === 'Simplex' ? 'Duplex' : 'Simplex'; renderContent(); }
    function toggleHfEmission() {
        const modes = ['LSB V', 'USB V', 'AM'];
        hfState.emission = modes[(modes.indexOf(hfState.emission) + 1) % modes.length]; renderContent();
    }
    function toggleHfSql() {
        const sqls = ['SQ0', 'SQ1', 'SQ2', 'SQ3'];
        hfState.sql = sqls[(sqls.indexOf(hfState.sql) + 1) % sqls.length]; renderContent();
    }
    function toggleHfPwr() {
        const pwrs = ['Low', 'Mid', 'High'];
        hfState.pwr = pwrs[(pwrs.indexOf(hfState.pwr) + 1) % pwrs.length]; renderContent();
    }

    function setXpdrMode(m) { xpdrState.mode = m; renderContent(); }
    function toggleAdsb() { xpdrState.adsb = !xpdrState.adsb; renderContent(); }
    
    function addXpdrInput(num) {
        if (!hasStartedTyping) { xpdrInput = num; hasStartedTyping = true; }
        else if (xpdrInput.length < 4) { xpdrInput += num; }
        renderContent();
    }
    function backspaceXpdr() {
        if (!hasStartedTyping) { hasStartedTyping = true; }
        xpdrInput = xpdrInput.slice(0, -1); renderContent();
    }
    function setXpdrPreset(code) { xpdrInput = code; hasStartedTyping = true; renderContent(); }
    function flashIdent() { renderContent(); }
    function confirmXpdr() {
        if(hasStartedTyping && xpdrInput.length === 4) { xpdrState.code = xpdrInput; }
        switchMode('XPDR_MODE');
    }

    function toggleIsolate() {
        icStates.Isolate = !icStates.Isolate;
        if (icStates.Isolate) {
            icStates.CoPilot = true; icStates.Pilot = true;
            icStates.Crew1 = false; icStates.Pass = false; icStates.Crew2 = false; icStates.wICS = false;
            icStates.Loop1 = false; icStates.Loop2 = false; icStates.Loop5 = false;
        }
        renderContent();
    }

    function toggleIC(name) { 
        icStates[name] = !icStates[name]; 
        if (name === 'Loop1' && icStates.Loop1) { icStates.Crew1 = true; icStates.Crew2 = true; icStates.Isolate = false; } 
        else if (name === 'Loop2' && icStates.Loop2) { icStates.Pass = true; icStates.Isolate = false; } 
        else if (name === 'Loop5' && icStates.Loop5) {
            icStates.CoPilot = true; icStates.Pilot = true; icStates.Crew1 = true;
            icStates.Pass = true; icStates.Crew2 = true; icStates.wICS = true;
            icStates.Isolate = false;
        }
        if (['Crew1', 'Pass', 'Crew2', 'wICS'].includes(name) && icStates[name]) { icStates.Isolate = false; }
        renderContent(); 
    }

    function setMic(label) { 
        if (micSelected === label) { micSelected = 'OFF'; } else { micSelected = label; }
        renderContent(); 
    }
    function toggleMon(id) { monStates[id] = !monStates[id]; renderContent(); }

    function updateHeaderUI() {
        const topMic = document.getElementById('top-mic-val');
        if(topMic) {
            if (micSelected === 'OFF' || !micSelected) { topMic.innerText = ''; } 
            else { topMic.innerText = micSelected; }
        }
        
        let monArr = [];
        if(monStates.com1) monArr.push("1"); 
        if(monStates.com2) monArr.push("2"); 
        if(monStates.uvhf) monArr.push("M");
        let monText = monArr.length ? monArr.join('/') : 'OFF';
        if(monStates.vhffm && audioTab === 'Mission') { monText = "VHF-FM"; }

        const topMon = document.getElementById('top-mon-val');
        if(topMon) topMon.innerText = monText;

        if(document.getElementById('h-com1-act')){
            document.getElementById('h-com1-act').innerText = freqs.com1.act;
            document.getElementById('h-com1-stb').innerText = freqs.com1.stb;
            document.getElementById('h-com2-act').innerText = freqs.com2.act;
            document.getElementById('h-com2-stb').innerText = freqs.com2.stb;
        }

        const xpdrModeElem = document.getElementById('top-xpdr-mode');
        if(xpdrModeElem) {
            let shortMode = xpdrState.mode.toUpperCase();
            if(shortMode === 'ALTITUDE REPORTING') shortMode = 'ALT';
            if(shortMode === 'TA ONLY') shortMode = 'TA';
            xpdrModeElem.innerText = shortMode;
        }
        const xpdrCodeElem = document.getElementById('top-xpdr-code');
        if(xpdrCodeElem) xpdrCodeElem.innerText = xpdrState.code;
    }

    function handleVol(id, e, el) {
        const s = el || e.currentTarget;   // 위임에서는 currentTarget이 #cdu-wrap이므로 요소를 직접 받는다
        s.setPointerCapture(e.pointerId);
        const update = (pe) => {
            const r = s.getBoundingClientRect();
            volumes[id] = Math.round(Math.max(0, Math.min(100, (pe.clientX - r.left) / r.width * 100)));
            s.querySelector('.wedge-fill').style.width = volumes[id] + '%';
            if(s.querySelector('.wedge-text')) s.querySelector('.wedge-text').innerText = volumes[id] + '%';
        };
        update(e); s.onpointermove = update; s.onpointerup = () => s.onpointermove = null;
    }

    function swapFreq(id) { 
        if(!freqs[id]) return;
        [freqs[id].act, freqs[id].stb] = [freqs[id].stb, freqs[id].act];
        renderContent();
    }

    // --- Input Handling Logic ---
    function addInput(num) {
        if (!hasStartedTyping) {
            currentInput = num;
            hasStartedTyping = true;
        } else if (currentMode === 'PERF_INPUT') {
            if (num === '-' && currentInput.length > 0) return;
            if (currentInput.length < 6) currentInput += num;
        } else if (currentInput.length < 7) {
            currentInput += num;
        }
        renderContent();
    }

    function backspaceInput() {
        if (!hasStartedTyping) {
            hasStartedTyping = true;
            if(currentMode === 'PERF_INPUT') currentInput = String(perfData[inputTarget] ?? '0');
        }
        currentInput = currentInput.slice(0, -1);
        renderContent();
    }

    function confirmPerfInput() { 
        if (hasStartedTyping && currentInput !== "" && currentInput !== "-") {
            perfData[inputTarget] = currentInput;
        }
        switchMode('PERF');
    }

    // --- SELCAL Input Logic ---
    function addSelcalInput(char) {
        if (!hasStartedTyping) {
            selcalInput = "";
            hasStartedTyping = true;
        }
        if (selcalInput.length >= 4) return;
        if (selcalInput.includes(char)) return; 

        if (selcalInput.length === 1 && char <= selcalInput[0]) return;
        if (selcalInput.length === 3 && char <= selcalInput[2]) return;

        selcalInput += char;
        renderContent();
    }

    function backspaceSelcal() {
        if (!hasStartedTyping) {
            hasStartedTyping = true;
            selcalInput = selcalCode;
        }
        selcalInput = selcalInput.slice(0, -1);
        renderContent();
    }

    function confirmSelcal() {
        if (hasStartedTyping && selcalInput.length === 4) {
            selcalCode = selcalInput;
        }
        switchMode('AUDIO');
        switchAudioTab('Mission');
    }

    function saveInputAndReturn() {
        if (hasStartedTyping && currentInput.length >= 3) {
            let v = currentInput;
            if (inputTarget === 'hf') {
                if (!v.includes('.') && v.length > 2) v = v.slice(0, 2) + "." + v.slice(2);
            } else {
                if (!v.includes('.') && v.length > 3) v = v.slice(0, 3) + "." + v.slice(3);
            }
            // NAV1/NAV2는 입력 주파수를 즉시 활성(ACT)으로 튜닝 + VOR 자동 매칭 + PFD 연동
            if (inputTarget === 'nav1' || inputTarget === 'nav2') {
                freqs[inputTarget].act = v;
                let match = (typeof ENR_VORS !== 'undefined' ? ENR_VORS : []).find(x => x.freq && Math.abs(parseFloat(x.freq) - parseFloat(v)) < 0.001);
                freqs[inputTarget].id = match ? match.id : '';
                try { setNavRadio(inputTarget === 'nav1' ? 'NAV1' : 'NAV2', v, match ? match.id : null); } catch(e) { _swallow(e); }
            } else {
                freqs[inputTarget].stb = v;
            }
        }
        let backMode = inputTarget === 'hf' ? 'HF_CONTROL' : 'AUDIO';
        switchMode(backMode, inputTarget);
    }

    function handleInputXfer() {
        saveInputAndReturn();
        swapFreq(inputTarget);
    }

    function confirmInput() { 
        saveInputAndReturn();
    }


switchMode('HOME');

    // ── CDU 액션 등록 ───────────────────────────────────────────────
    // data-act 이름 → 실제 함수. 여기 없는 이름을 쓰면 콘솔에 경고가 찍히므로,
    // 예전처럼 버튼이 조용히 죽지 않는다. 복합 동작은 아래에서 합성 액션으로 만든다.
    cduRegister({
      _setToggle,
      addInput,
      addSelcalInput,
      addXpdrInput,
      afldCancelPick,
      afldPick,
      afldPutCom,
      afldPutNav,
      afldToggleAll,
      backspaceInput,
      backspaceSelcal,
      backspaceXpdr,
      cduOpenMap,
      clInto,
      clOpen,
      clResetLeaf,
      clSibling,
      clToggle,
      confirmInput,
      confirmPerfInput,
      confirmSelcal,
      confirmXpdr,
      flashIdent,
      handleInputXfer,
      handleVol,
      openAirfield,
      openAudioCom: () => { switchMode('AUDIO'); switchAudioTab('COM'); },
      openFlightPlan,
      openNavSel,
      openProc: () => { setPage(1); fpGo('IFR'); },
      openUbikais,
      pickNavVor,
      prefetchTiles,
      pwaInstall,
      setMic,
      setUnit,
      setVoxMode,
      setXpdrMode,
      setXpdrPreset,
      showHelpOverlay: () => { document.getElementById('help-overlay').style.display = 'flex'; },
      swapFreq,
      switchAudioTab,
      switchMode,
      toggleAdsb,
      toggleClicks,
      toggleHfEmission,
      toggleHfPwr,
      toggleHfSql,
      toggleHfTuning,
      toggleIC,
      toggleIsolate,
      toggleMon,
      tpAddPoint,
      tpApplyIcon,
      tpDelPoint,
      tpDelTrack,
      tpExportPoints,
      tpExportTrack,
      tpFolderAdd,
      tpFolderBack,
      tpFolderDel,
      tpFolderOpen,
      tpFolderRename,
      tpHideTrackAndBack: () => { tpHideTrack(); switchMode('TRACKPOINT'); },
      tpIconCancel,
      tpImportPoints,
      tpImportTrack,
      tpLoadTrack,
      tpNavPoint,
      tpPickIcon,
      tpRepoBack,
      tpRepoImport,
      tpRepoOpen,
      tpSaveTrackFromFP,
      tpSelAll,
      tpSelNone,
      tpSelToggle,
      tpSetColor,
      tpSetTab,
      tpShowTrack,
      utilFocus,
      utilFuelDensity,
      utilNumKey,
      utilOpen,
      utilTasHere,
      utilSunHere,
    });

    // ── 밖으로 공개하는 이름 ───────────────────────────────────────
    // 함수: CDU 밖 JS 또는 위임이 닿지 않는 인라인 핸들러(지도 팝업)에서 호출
    window.switchMode        = switchMode;         // 앱 각처 + cduFooter의 인라인 문자열
    window.openAirfield      = openAirfield;       // 지도 공항 팝업 → INFO 열기
    window._afldIcao         = _afldIcao;          // 지도 ↔ INFO 매칭
    window._tpRenderMapPoints= _tpRenderMapPoints; // 시작 시 저장된 지도 포인트 복원
    window.tpMapHide         = tpMapHide;          // 지도 포인트 팝업(#cdu-wrap 밖)
    window.tpMapAddFpl       = tpMapAddFpl;
    window.tpMapDirect       = tpMapDirect;
    // 상태 변수: 밖에서 '현재 값'을 읽으므로 접근자로 공개(스냅샷이면 갱신이 안 됨)
    Object.defineProperties(window, {
      currentMode:    { get: () => currentMode,    configurable: true },
      utilTab:        { get: () => utilTab,        configurable: true },
      _afldUnlocked:  { get: () => _afldUnlocked,  configurable: true },
    });
})();

// ── Startup: place aircraft at current GPS position, fallback to Songdo ──
(function _initStartPos() {
  const SONGDO = { lat: 37.3895, lon: 126.6550 };

  function _applyStartPos(lat, lon) {
    S.lat = lat; S.lon = lon;
    leafMap.setView([lat, lon], 12, { animate: false });
    updateAcOnMap();
  }

  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      pos => _applyStartPos(pos.coords.latitude, pos.coords.longitude),
      ()  => _applyStartPos(SONGDO.lat, SONGDO.lon),
      { timeout: 5000, maximumAge: 30000 }
    );
  } else {
    _applyStartPos(SONGDO.lat, SONGDO.lon);
  }
})();


