// ─────────────────────────────────────────────────────────────
// 06-nav.js — 항법 · 비행계획 · 홀딩 · 사용자 SID
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
function updateNav(){
  // BRG1: FMS = active WP, VOR/LOC = selected navaid
  if (navSrc === 'FMS') {
    if (S.awp>=0&&S.awp<S.wps.length) {
      const wp=S.wps[S.awp];
      S.brg = bearing(S.lat,S.lon,wp.lat,wp.lon);
      S.dtw = distance(S.lat,S.lon,wp.lat,wp.lon);
      // Direct To 로 잡은 구간의 코스는 '지금 있는 자리에서 그 지점으로' 다 —
      // 항공기가 움직이면 같이 움직인다. S.fwp < 0 만으로는 가릴 수 없다.
      // 그 상태는 '활성 WP 를 지나는 고정 코스(FCP CRS·OBS 해제 등)' 와 같기
      // 때문이다. 그쪽은 코스를 정해 두고 인터셉트하는 것이라 굳어 있어야 한다.
      if (S.dtoLive && !obsOn && !holdOn && S.fwp < 0 && !Number.isFinite(wp.inCrs))
        S.crs = S.brg;
      S.xtk = courseXtk(activeCourseLine());   // CDI·지도·AP와 같은 기준선
    } else { S.brg=0; S.dtw=0; S.xtk=0; }
  } else {
    // VOR / LOC — BRG1 points to the selected navaid station
    if (navLat !== null) {
      S.brg = bearing(S.lat,S.lon,navLat,navLon);
      S.dtw = distance(S.lat,S.lon,navLat,navLon);
    } else { S.brg=0; S.dtw=0; }
    S.xtk = 0;
  }


  updateCrsLine();
  updateBrgLines();
}

// ══════════════════════════════════════════════════════
// FLIGHT PLAN STATE MACHINE
// ══════════════════════════════════════════════════════
let fpMode = 'LIST'; // 'LIST'|'ADD'|'IDENT'|'LAT'|'LON'|'IFR'|'SIDNEW'|'HOLD'|'WPT'
let fpWptIdx  = -1;    // 상세 화면을 연 웨이포인트
let fpEditIdx = -1;    // 이름·좌표를 '새로 추가' 가 아니라 '고치는' 대상
let fpNumFld  = null;  // 상세 화면의 숫자 입력 대상 ('VALT' | 'VOFS')
let fpInputBuf = '';
let fpTempLat = null;
let fpIfrPhase = 'dep';

function fpGo(mode) { fpMode = mode; if(mode==='IDENT'||mode==='LAT'||mode==='LON') fpInputBuf=''; fpRender(); }

// FPL 자동 저장 — 새로고침해도 비행계획 유지
function _fplPersist() {
  try { localStorage.setItem('fplSave', JSON.stringify({ wps: S.wps, awp: S.awp })); } catch(e) { _swallow(e); }
}
function _fplRestore() {
  try {
    const s = JSON.parse(localStorage.getItem('fplSave') || 'null');
    if (s && Array.isArray(s.wps) && s.wps.length) {
      S.wps = s.wps;
      S.awp = (typeof s.awp === 'number' && s.awp < s.wps.length) ? s.awp : -1;
      updateWpMarkers(); updateNav();
    }
  } catch(e) { _swallow(e); }
}

function fpRender() {
  const area   = document.getElementById('fp-content-area');
  const title  = document.getElementById('fp-mode-title');
  const footer = document.getElementById('fp-footer-nav');
  _fplPersist();   // FPL 변경 경로마다 호출되므로 여기서 자동 저장
  if (!area) return;
  switch(fpMode) {
    case 'LIST':  fpRenderList(area, title, footer);  break;
    case 'ADD':   fpRenderAdd(area, title, footer);   break;
    case 'IDENT': fpRenderIdent(area, title, footer); break;
    case 'LAT':   fpRenderCoord(area, title, footer, 'LAT'); break;
    case 'LON':   fpRenderCoord(area, title, footer, 'LON'); break;
    case 'IFR':   fpRenderIfr(area, title, footer);  break;
    case 'SIDNEW': fpRenderSidNew(area, title, footer); break;
    case 'HOLD':  fpRenderHold(area, title, footer);  break;
    case 'WPT':   fpRenderWpt(area, title, footer);   break;
    case 'RB':    fpRenderRadial(area, title, footer); break;
    case 'RR':    fpRenderRadial(area, title, footer); break;
    case 'REFPICK': fpRenderRefPick(area, title, footer); break;
  }
}

// ══════════════════════════════════════════════════════
// 참조점 기준 좌표 산출 (BRG/DIST · BRG/BRG)
// ══════════════════════════════════════════════════════
// 두 대권(참조점 + 방위)의 교점. 방위는 모두 진북 기준.
// (movable-type.co.uk/scripts/latlong.html 의 intersection 공식)
function radialIntersect(la1, lo1, brg13, la2, lo2, brg23) {
  const f1 = la1 * D2R, l1 = lo1 * D2R, f2 = la2 * D2R, l2 = lo2 * D2R;
  const t13 = brg13 * D2R, t23 = brg23 * D2R;
  const df = f2 - f1, dl = l2 - l1;
  const d12 = 2 * Math.asin(Math.sqrt(Math.sin(df/2)**2 +
              Math.cos(f1) * Math.cos(f2) * Math.sin(dl/2)**2));
  if (Math.abs(d12) < 1e-12) return null;                 // 같은 지점
  let ca = (Math.sin(f2) - Math.sin(f1) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(f1));
  let cb = (Math.sin(f1) - Math.sin(f2) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(f2));
  const ta = Math.acos(Math.min(1, Math.max(-1, ca)));
  const tb = Math.acos(Math.min(1, Math.max(-1, cb)));
  const t12 = Math.sin(dl) > 0 ? ta : 2 * Math.PI - ta;
  const t21 = Math.sin(dl) > 0 ? 2 * Math.PI - tb : tb;
  const a1 = t13 - t12, a2 = t21 - t23;
  if (Math.sin(a1) === 0 && Math.sin(a2) === 0) return null;   // 무수히 많음
  if (Math.sin(a1) * Math.sin(a2) < 0) return null;            // 교점이 대척점 쪽
  const a3 = Math.acos(Math.min(1, Math.max(-1,
             -Math.cos(a1) * Math.cos(a2) + Math.sin(a1) * Math.sin(a2) * Math.cos(d12))));
  const d13 = Math.atan2(Math.sin(d12) * Math.sin(a1) * Math.sin(a2),
                         Math.cos(a2) + Math.cos(a1) * Math.cos(a3));
  const f3 = Math.asin(Math.min(1, Math.max(-1,
             Math.sin(f1) * Math.cos(d13) + Math.cos(f1) * Math.sin(d13) * Math.cos(t13))));
  const dl13 = Math.atan2(Math.sin(t13) * Math.sin(d13) * Math.cos(f1),
                          Math.cos(d13) - Math.sin(f1) * Math.sin(f3));
  const l3 = l1 + dl13;
  return [f3 / D2R, normA((l3 / D2R) + 540) - 180];
}

let fpRefMode = 'RB';            // 'RB' = 참조점+방위+거리, 'RR' = 두 방위 교점
let fpRefSlot = 1;               // 참조점 선택 중인 슬롯(1·2)
let fpRefQ = '';                 // 참조점 검색어
let fpRefCat = 'ALL';            // ALL | VOR | FIX | APT | FPL
let fpRef = { r1: null, b1: 360, d1: 10, r2: null, b2: 360 };

function fpRefOpen(mode) {
  fpRefMode = mode;
  if (!fpRef.r1) fpRefQ = '';
  // 숫자판은 늘 펴 둔다 — 값 칸과 함께 보이는 게 이 화면의 요점이다
  fpRefNumFld = 'b1'; fpInputBuf = '';
  fpGo(mode);
}
// 참조점 후보 — 비행계획 WP · VOR · 공항 · AIP 픽스
function fpRefCandidates() {
  const out = [], seen = new Set();
  const vorIds = new Set(ENR_VORS.map(v => v.id));
  const add = (ident, lat, lon, cat, name) => {
    if (!ident || lat == null || lon == null) return;
    const k = cat + ':' + ident;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ident, lat, lon, cat, name: name || '' });
  };
  S.wps.forEach(w => add(w.ident, w.lat, w.lon, 'FPL'));
  ENR_VORS.forEach(v => add(v.id, v.lat, v.lon, 'VOR', v.name + ' · ' + v.freq));
  AIRPORTS.forEach(a => add(a.ident, a.lat, a.lon, 'APT', a.name));
  Object.entries(IFR_FIXES).forEach(([k, v]) => {
    if (!vorIds.has(k)) add(k, v.lat, v.lon, 'FIX');
  });
  return out;
}
function fpRefPick(slot) { fpRefSlot = slot; fpRefQ = ''; fpGo('REFPICK'); }
function fpRefChoose(cat, ident) {
  const c = fpRefCandidates().find(x => x.cat === cat && x.ident === ident);
  if (c) fpRef[fpRefSlot === 2 ? 'r2' : 'r1'] = { ident: c.ident, lat: c.lat, lon: c.lon, cat: c.cat };
  fpGo(fpRefMode);
}
function fpRefType(ch) { if (fpRefQ.length < 6) { fpRefQ += ch; fpRender(); } }
function fpRefBksp()   { fpRefQ = fpRefQ.slice(0, -1); fpRender(); }
function fpRefSetCat(c) { fpRefCat = c; fpRender(); }
// 화면 안에 함께 놓는 숫자판. 값 칸을 누르면 그 칸이 '입력 중' 이 되고,
// 바로 아래 숫자판으로 친다. 숫자판만 있는 화면으로 넘어갔다 돌아오지 않는다 —
// 넘어가면 방금 넣은 값과 나머지 칸을 같이 볼 수가 없다.
function _padHtml(entAct) {
  const k = (label, act, arg, cls) =>
    `<div class="fp-pad-key${cls ? ' ' + cls : ''}" data-act="${act}"` +
    `${arg !== undefined ? ` data-arg='${arg}'` : ''}>${label}</div>`;
  const num = n => k(n, 'fpType', `["${n}"]`);
  return `<div class="fp-pad5">` +
    [1,2,3,4,5].map(num).join('') +
    [6,7,8,9,0].map(num).join('') +
    k('.', 'fpType', '["."]') +
    k('⬅', 'fpBksp') +
    k('CLR', 'fpPadClr', undefined, 'clr') +
    k('ENT', entAct, undefined, 'ent wide') +
    `</div>`;
}
function fpPadClr() { fpInputBuf = ''; fpRender(); }

// 방위·거리도 좌표와 같은 방식으로 넣는다 — 화살표로 한 칸씩 밀지 않고,
// 값을 눌러 숫자판에 직접 친다. 입력 방식이 화면마다 다르면 손이 헷갈린다.
let fpRefNumFld = null;   // 'b1' | 'd1' | 'b2'
function fpRefNum(fld) {
  fpRefNumFld = fld; fpInputBuf = '';
  fpRender();
}

const FP_REF_NUM = {
  b1: { lbl: '방위 (RADIAL)',    unit: '°M', hint: '참조점에서 바깥으로 향하는 자북 방위. 0 ~ 360',
        min: 0, max: 360 },
  b2: { lbl: '방위 #2 (RADIAL)', unit: '°M', hint: '참조점 #2 에서 바깥으로 향하는 자북 방위. 0 ~ 360',
        min: 0, max: 360 },
  d1: { lbl: '거리 (DISTANCE)',  unit: 'NM', hint: '참조점에서 그 방위로 나아갈 거리. 0.1 ~ 400 NM',
        min: 0.1, max: 400 },
};
function fpConfirmRefNum() {
  const c = FP_REF_NUM[fpRefNumFld];
  if (!c) { fpGo(fpRefMode); return; }
  const v = parseFloat(fpInputBuf);
  if (isNaN(v)) { uiAlert('숫자를 입력하세요'); return; }
  if (v < c.min || v > c.max) { uiAlert(`${c.lbl} 범위: ${c.min} ~ ${c.max}${c.unit}`); return; }
  // 방위는 정수 1~360 으로 보관한다(0 은 360 과 같은 각이다)
  fpRef[fpRefNumFld] = (fpRefNumFld === 'd1')
    ? Math.round(v * 10) / 10
    : ((Math.round(v) + 359) % 360) + 1;
  // 다음 칸으로 옮겨 준다 — 방위 다음은 거리(RAD/RAD 는 방위 #2), 그 다음은 처음으로.
  // 숫자판을 닫지 않는다: 닫으면 화면이 다시 텅 비고 손이 위아래로 오간다.
  const next = { b1: fpRefMode === 'RB' ? 'd1' : 'b2', d1: 'b1', b2: 'b1' };
  fpInputBuf = ''; fpRefNumFld = next[fpRefNumFld] || 'b1';
  fpRender();
}
// 현재 입력으로 산출되는 좌표 — { lat, lon, ident } 또는 { err }
function fpRefSolve() {
  const r1 = fpRef.r1;
  if (!r1) return { err: '참조점 #1 을 고르세요' };
  if (fpRefMode === 'RB') {
    if (!(fpRef.d1 > 0)) return { err: '거리를 입력하세요' };
    const p = destPoint(r1.lat, r1.lon, toTrue(fpRef.b1), fpRef.d1);
    return { lat: p[0], lon: p[1],
             ident: `${r1.ident}${String(fpRef.b1).padStart(3,'0')}/${fpRef.d1}` };
  }
  const r2 = fpRef.r2;
  if (!r2) return { err: '참조점 #2 를 고르세요' };
  if (distance(r1.lat, r1.lon, r2.lat, r2.lon) < 0.05) return { err: '두 참조점이 같습니다' };
  const t1 = toTrue(fpRef.b1), t2 = toTrue(fpRef.b2);
  const p = radialIntersect(r1.lat, r1.lon, t1, r2.lat, r2.lon, t2);
  if (!p) return { err: '두 방위선이 만나지 않습니다 (평행하거나 같은 대권)' };
  // 대권은 지구 반대편에서도 만난다. 입력한 방위 쪽(전방)에 있고 실용 범위 안인
  // 교점만 받아들인다.
  const d1 = distance(r1.lat, r1.lon, p[0], p[1]);
  const d2 = distance(r2.lat, r2.lon, p[0], p[1]);
  const f1 = Math.abs(normAS(bearing(r1.lat, r1.lon, p[0], p[1]) - t1));
  const f2 = Math.abs(normAS(bearing(r2.lat, r2.lon, p[0], p[1]) - t2));
  if (f1 > 1 || f2 > 1)
    return { err: '두 방위선이 입력한 방향 앞쪽에서 만나지 않습니다 (반대편 교점)' };
  if (d1 > 600 || d2 > 600)
    return { err: `교점이 너무 멉니다 (${Math.round(Math.max(d1,d2))}NM) — 방위를 확인하세요` };
  // 교차각(cut angle) — 얕으면 좌표 오차가 크게 튄다
  const cut = Math.abs(normAS(bearing(p[0], p[1], r1.lat, r1.lon) -
                              bearing(p[0], p[1], r2.lat, r2.lon)));
  const cutA = Math.min(cut, 180 - cut);
  if (cutA < 10)
    return { err: `두 방위선의 교차각이 ${cutA.toFixed(0)}° 로 너무 얕습니다 (10° 이상 필요)` };
  return { lat: p[0], lon: p[1], ident: `${r1.ident}/${r2.ident}`,
           cut: cutA,
           warn: cutA < 30 ? `교차각 ${cutA.toFixed(0)}° — 얕은 각도라 좌표 오차가 커질 수 있습니다` : '' };
}
function fpRefApply() {
  const s = fpRefSolve();
  if (s.err) { uiAlert(s.err); return; }
  fpMode = 'LIST';
  pushWP({ ident: s.ident, lat: +s.lat.toFixed(6), lon: +s.lon.toFixed(6) });
  fpRender();
}

function _refBtnHtml(slot) {
  const r = slot === 2 ? fpRef.r2 : fpRef.r1;
  return `<div class="hold-btn${r ? ' on' : ''}" style="text-align:left;padding-left:8px;"
            onclick="fpRefPick(${slot})">${r ? r.cat + ' · ' + r.ident : '▸ 참조점 선택'}</div>`;
}
// 값 칸 — 누르면 숫자판이 열린다(참조점 고르는 칸과 같은 생김새)
function _refNumHtml(key) {
  const act = fpRefNumFld === key;
  const v = fpRef[key];
  const txt = act && fpInputBuf ? fpInputBuf
            : key === 'd1' ? (Math.round(v*10)/10).toFixed(1) + ' NM'
                           : String(Math.round(v)).padStart(3,'0') + '°M';
  return `<div class="hold-btn${act ? '' : ' on'}" data-act="fpRefNum" data-arg='["${key}"]'
            style="text-align:left;padding-left:8px;flex:1;font-size:13px;` +
    (act ? 'border-color:#00e5ff;color:#00e5ff;background:#001e28;' : '') + `">` +
    `${txt}${act ? '<span class="fp-disp-cursor">|</span>' : ''}</div>`;
}

function fpRenderRadial(area, title, footer) {
  const rb = fpRefMode === 'RB';
  title.textContent = rb ? 'WPT — 방위/거리' : 'WPT — 방위/방위 교점';
  const s = fpRefSolve();
  const okHtml = s.err
    ? `<div style="color:#e8a;font-size:11px;padding:6px 2px;">⚠ ${s.err}</div>`
    : `<div style="color:#0f8;font-size:11px;padding:6px 2px;line-height:1.7;">
         <b style="color:#ffcc44;font-size:13px;">${s.ident}</b><br>
         ${decToDMS(s.lat, true)} ${decToDMS(s.lon, false)}<br>
         <span style="color:#678;">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</span><br>
         <span style="color:#678;">현 위치에서 ${fmtA(toMag(bearing(S.lat,S.lon,s.lat,s.lon)))}°M ·
         ${distance(S.lat,S.lon,s.lat,s.lon).toFixed(1)}NM${s.cut ? ' · 교차각 ' + s.cut.toFixed(0) + '°' : ''}</span>
         ${s.warn ? `<br><span style="color:#e8a;">⚠ ${s.warn}</span>` : ''}
       </div>`;
  area.innerHTML = `
    <div class="fp-panel-border" style="padding:8px;">
      <div class="hold-row"><div class="hold-lbl">REF ${rb ? '' : '#1'}</div>${_refBtnHtml(1)}</div>
      <div class="hold-row"><div class="hold-lbl">BRG ${rb ? '' : '#1'}</div>${_refNumHtml('b1')}</div>
      ${rb ? `<div class="hold-row"><div class="hold-lbl">DIST</div>${_refNumHtml('d1')}</div>`
          : `<div class="hold-row"><div class="hold-lbl">REF #2</div>${_refBtnHtml(2)}</div>
             <div class="hold-row"><div class="hold-lbl">BRG #2</div>${_refNumHtml('b2')}</div>`}
      <div style="border-top:1px solid #1a2a3a;margin-top:6px;">${okHtml}</div>
      <div style="color:#00cfff;font-size:9px;letter-spacing:0.5px;margin-top:2px;">
        ${FP_REF_NUM[fpRefNumFld] ? FP_REF_NUM[fpRefNumFld].lbl + ' 입력 중 · ' + FP_REF_NUM[fpRefNumFld].hint
                                  : '값 칸을 눌러 고른 뒤 아래 숫자판으로 칩니다'}</div>
      ${_padHtml('fpConfirmRefNum')}
    </div>`;
  footer.innerHTML = `
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["ADD"]'><span>↩</span>Back</div>
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>📋</span>FP</div>
    <div class="fp-nav-btn fp-nav-enter" data-act="fpRefApply"><span>↩</span>Enter</div>`;
}

function fpRenderRefPick(area, title, footer) {
  title.textContent = `참조점 선택 ${fpRefMode === 'RR' ? '#' + fpRefSlot : ''}`;
  const q = fpRefQ.toUpperCase();
  let list = fpRefCandidates()
    .filter(c => (fpRefCat === 'ALL' || c.cat === fpRefCat) && (!q || c.ident.indexOf(q) === 0));
  list.forEach(c => c._d = distance(S.lat, S.lon, c.lat, c.lon));
  list.sort((a, b) => a._d - b._d);
  const shown = list.slice(0, 40);
  const cats = ['ALL','VOR','FIX','APT','FPL'];
  const rows = shown.map(c => `
    <div class="fp-wp-row" style="grid-template-columns:34px 1fr 60px;"
         onclick="fpRefChoose('${c.cat}','${c.ident}')">
      <span style="font-size:8px;color:#87ceeb;">${c.cat}</span>
      <span class="fp-wp-ident">${c.ident}<span style="color:#567;font-size:9px;font-weight:normal;">
        ${c.name ? ' · ' + c.name : ''}</span></span>
      <span class="fp-wp-dist">${c._d.toFixed(0)}NM</span>
    </div>`).join('') ||
    `<div style="color:#678;font-size:10px;padding:10px 4px;">일치하는 참조점이 없습니다.</div>`;
  area.innerHTML = `
    <div style="display:flex;gap:4px;margin-bottom:5px;">
      ${cats.map(c => `<div class="hold-btn${fpRefCat===c?' on':''}"
         onclick="fpRefSetCat('${c}')">${c}</div>`).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
      <div class="fp-disp-box" style="flex:1;">${fpRefQ || '<span style="color:#222">검색</span>'}</div>
      <div class="fp-bksp-btn" data-act="fpRefBksp">⬅</div>
    </div>
    <div class="fp-key-grid" style="grid-template-columns:repeat(9,1fr);gap:3px;">
      ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map(k =>
        `<div class="fp-key" style="height:26px;font-size:11px;" onclick="fpRefType('${k}')">${k}</div>`).join('')}
    </div>
    <div class="fp-panel-border" style="padding:0;margin-top:5px;max-height:230px;overflow-y:auto;">
      ${rows}
    </div>
    <div style="color:#567;font-size:9px;padding:3px 2px;">${list.length}개 중 가까운 순 ${shown.length}개</div>`;
  footer.innerHTML = `
    <div class="fp-nav-btn" onclick="fpGo('${fpRefMode}')"><span>↩</span>Back</div>`;
}

// ══════════════════════════════════════════════════════
// 홀딩 패턴 설정 (비행계획 웨이포인트별)
// ══════════════════════════════════════════════════════
let fpHoldIdx = -1;
let fpHoldDraft = null;    // { dir, crsM, legType, legVal }

function fpHoldOpen(i) {
  if (i < 0 || i >= S.wps.length) return;
  const h = S.wps[i].hold;
  fpHoldIdx = i;
  fpHoldDraft = h
    ? { dir: h.dir === 'L' ? 'L' : 'R', crsM: Math.round(toMag(h.crs)),
        legType: h.legType === 'DIST' ? 'DIST' : 'TIME',
        legVal: h.legVal || (h.legType === 'DIST' ? 5 : 60) }
    : { dir: 'R', crsM: holdDefaultCrsMag(i), legType: 'TIME', legVal: 60 };
  fpHoldNumFld = 'crs'; fpInputBuf = '';
  fpGo('HOLD');
}
function fpHoldSet(k, v) {
  if (!fpHoldDraft) return;
  if (k === 'legType') {
    fpHoldDraft.legType = v;
    fpHoldDraft.legVal = (v === 'DIST') ? 5 : 60;   // 기본값으로 되돌린다
    fpInputBuf = '';                                 // 초와 NM 은 자릿수가 다르다
  } else fpHoldDraft[k] = v;
  fpRender();
}
// 코스·레그도 다른 화면과 같이 숫자판으로 넣는다. 종전에는 ≪ ◄ ► ≫ 와
// ▼ ▲ 로 밀어야 했고, 시간은 정해진 여섯 값(30·60·90·120·150·180초)만
// 고를 수 있어 45초 같은 값은 아예 넣을 수 없었다.
let fpHoldNumFld = 'crs';   // 'crs' | 'leg'
function fpHoldNum(fld) { fpHoldNumFld = fld; fpInputBuf = ''; fpRender(); }
function _holdNumCfg() {
  if (fpHoldNumFld === 'crs')
    return { lbl: '인바운드 코스', unit: '°M', min: 1, max: 360,
             hint: '픽스로 들어오는 자북 코스. 1 ~ 360' };
  if (fpHoldDraft && fpHoldDraft.legType === 'DIST')
    return { lbl: '아웃바운드 거리', unit: 'NM', min: 0.5, max: 20,
             hint: '아웃바운드 레그 길이(NM). 0.5 ~ 20' };
  return { lbl: '아웃바운드 시간', unit: 's', min: 10, max: 600,
           hint: '아웃바운드 레그 시간을 초로. 60 = 1:00 (10 ~ 600)' };
}
function fpConfirmHoldNum() {
  if (!fpHoldDraft) return;
  const c = _holdNumCfg();
  const v = parseFloat(fpInputBuf);
  if (isNaN(v)) { uiAlert('숫자를 입력하세요'); return; }
  if (v < c.min || v > c.max) { uiAlert(`${c.lbl} 범위: ${c.min} ~ ${c.max}${c.unit}`); return; }
  if (fpHoldNumFld === 'crs') fpHoldDraft.crsM = ((Math.round(v) + 359) % 360) + 1;
  else fpHoldDraft.legVal = (fpHoldDraft.legType === 'DIST')
    ? Math.round(v * 10) / 10 : Math.round(v);
  fpInputBuf = '';
  // 코스를 넣으면 레그 칸으로 넘겨 준다 — 손이 위아래로 오가지 않게
  if (fpHoldNumFld === 'crs') fpHoldNumFld = 'leg';
  fpRender();
}
// 값 칸 — 누르면 그 칸으로 입력이 옮겨 간다(아래 숫자판은 늘 펴져 있다)
function _holdNumHtml(fld, txt) {
  const act = fpHoldNumFld === fld;
  return `<div class="hold-btn${act ? '' : ' on'}" data-act="fpHoldNum" data-arg='["${fld}"]'
            style="text-align:center;font-size:15px;` +
    (act ? 'border-color:#00e5ff;color:#00e5ff;background:#001e28;' : '') + `">` +
    `${act && fpInputBuf ? fpInputBuf + '<span class="fp-disp-cursor">|</span>' : txt}</div>`;
}
function fpHoldApply() {
  if (fpHoldIdx < 0 || fpHoldIdx >= S.wps.length || !fpHoldDraft) { fpGo('LIST'); return; }
  S.wps[fpHoldIdx].hold = {
    dir: fpHoldDraft.dir,
    crs: toTrue(fpHoldDraft.crsM),          // 입력은 자북, 저장은 진북
    legType: fpHoldDraft.legType,
    legVal: fpHoldDraft.legVal,
  };
  holdExit();                                // 새 설정으로 다시 무장되게 초기화
  try { updateHoldLine(); updateNav(); } catch(e) { _swallow(e); }
  fpGo('LIST');
}
function fpHoldRemove() {
  if (fpHoldIdx >= 0 && fpHoldIdx < S.wps.length) delete S.wps[fpHoldIdx].hold;
  holdExit();
  try { updateHoldLine(); updateNav(); } catch(e) { _swallow(e); }
  fpGo('LIST');
}

function fpRenderHold(area, title, footer) {
  const wp = S.wps[fpHoldIdx];
  if (!wp || !fpHoldDraft) { fpGo('LIST'); return; }
  const d = fpHoldDraft;
  title.textContent = 'HOLDING — ' + (wp.ident || 'WPT');
  const legTxt = d.legType === 'DIST' ? d.legVal + ' NM'
                                      : (d.legVal >= 60 ? (d.legVal / 60) + ':' + String(d.legVal % 60).padStart(2,'0')
                                                        : d.legVal + 's');
  // 예상 패턴 크기 — 현재 속도 기준
  const R = navTurnRadiusNM();
  const legNM = d.legType === 'DIST' ? d.legVal : Math.max(20, groundSpdKt()) / 3600 * d.legVal;
  area.innerHTML = `
    <div class="fp-panel-border" style="padding:8px;">
      <div class="hold-row">
        <div class="hold-lbl">TURN</div>
        <div class="hold-seg">
          <div class="hold-btn${d.dir==='L'?' on':''}" data-act="fpHoldSet" data-arg='["dir", "L"]'>◄ LEFT</div>
          <div class="hold-btn${d.dir==='R'?' on':''}" data-act="fpHoldSet" data-arg='["dir", "R"]'>RIGHT ►</div>
        </div>
      </div>
      <div class="hold-row">
        <div class="hold-lbl">INBD CRS</div>
        ${_holdNumHtml('crs', String(d.crsM).padStart(3,'0') + '°M')}
      </div>
      <div class="hold-row">
        <div class="hold-lbl">LEG</div>
        <div class="hold-seg">
          <div class="hold-btn${d.legType==='TIME'?' on':''}" data-act="fpHoldSet" data-arg='["legType", "TIME"]'>TIME</div>
          <div class="hold-btn${d.legType==='DIST'?' on':''}" data-act="fpHoldSet" data-arg='["legType", "DIST"]'>DIST</div>
        </div>
      </div>
      <div class="hold-row">
        <div class="hold-lbl">${d.legType==='DIST'?'거리':'시간'}</div>
        ${_holdNumHtml('leg', legTxt)}
      </div>
      <div style="color:#567;font-size:9px;line-height:1.5;margin-top:6px;border-top:1px solid #1a2a3a;padding-top:5px;">
        선회반경 ${R.toFixed(2)}NM · 아웃바운드 ${legNM.toFixed(1)}NM · 패턴 폭 ${(2*R).toFixed(2)}NM
        (지상속도 ${Math.round(groundSpdKt())}kt 기준)
      </div>
      <div style="color:#00cfff;font-size:9px;letter-spacing:0.5px;margin-top:4px;">
        ${_holdNumCfg().lbl} 입력 중 · ${_holdNumCfg().hint}</div>
      ${_padHtml('fpConfirmHoldNum')}
    </div>`;
  footer.innerHTML = `
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>↩</span>Cancel</div>
    ${wp.hold ? `<div class="fp-nav-btn" data-act="fpHoldRemove"><span>✕</span>Del Hold</div>` : ''}
    <div class="fp-nav-btn fp-nav-enter" data-act="fpHoldApply"><span>↩</span>Enter</div>`;
}

// ══════════════════════════════════════════════════════
// 비행계획 순서 바꾸기 (손잡이 ≡ 를 끌어서)
// ══════════════════════════════════════════════════════
// 순서는 인덱스가 아니라 '어느 웨이포인트냐' 로 유지한다. 활성 WP(S.awp)·
// 이전 WP(S.fwp) 를 인덱스로 들고 있으면 순서를 바꾸는 순간
// 엉뚱한 지점을 가리킨다 — 객체를 기억했다가 새 자리에서 다시 찾는다.
//   order: 새 순서대로 늘어놓은 '옛 인덱스' 배열
function fpReorder(order) {
  const n = S.wps.length;
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Set(order);
  if (seen.size !== n || order.some(i => !(i >= 0 && i < n))) return false;
  if (order.every((v, i) => v === i)) { fpRender(); return false; }
  const keepA = S.wps[S.awp], keepF = S.wps[S.fwp];
  S.wps = order.map(i => S.wps[i]);
  S.awp    = keepA ? S.wps.indexOf(keepA) : -1;
  S.fwp    = keepF ? S.wps.indexOf(keepF) : -1;
  // 이전 WP 가 활성 WP 뒤로 가면 그 구간(leg)은 더 이상 말이 되지 않는다.
  // 이럴 때는 활성 WP 를 지나는 코스선(Direct-To)으로 돌린다.
  if (S.fwp >= 0 && S.awp >= 0 && S.fwp >= S.awp) S.fwp = S.awp - 1;
  try { updateNav(); } catch(e) { _swallow(e); }
  try { updateWpMarkers(); } catch(e) { _swallow(e); }
  try { updateHoldLine(); } catch(e) { _swallow(e); }
  fpRender();
  return true;
}
// i 번째를 j 자리로 옮긴다(드래그의 결과와 같다 — 시험·외부 호출용)
function fpMoveWp(from, to) {
  const n = S.wps.length;
  if (!(from >= 0 && from < n && to >= 0 && to < n) || from === to) return false;
  const order = S.wps.map((_, i) => i);
  order.splice(to, 0, order.splice(from, 1)[0]);
  return fpReorder(order);
}

// 손잡이 끌기 — 포인터 이벤트 하나로 마우스·터치를 함께 받는다.
// (HTML5 드래그앤드롭은 터치에서 동작하지 않아 태블릿에서 쓸 수 없다)
let _fpDrag = null;
function _fpDragRows(box) { return Array.from(box.querySelectorAll('.fp-wp-row')); }
document.addEventListener('pointerdown', ev => {
  const grip = ev.target && ev.target.closest && ev.target.closest('.fp-wp-grip');
  if (!grip) return;
  const row = grip.closest('.fp-wp-row');
  if (!row || !row.parentElement) return;
  ev.preventDefault();
  _fpDrag = { row, box: row.parentElement, pid: ev.pointerId };
  row.classList.add('fp-dragging');
  try { grip.setPointerCapture(ev.pointerId); } catch(e) { _swallow(e); }
});
document.addEventListener('pointermove', ev => {
  const D = _fpDrag;
  if (!D || ev.pointerId !== D.pid) return;
  // 끌고 있는 행을 뺀 나머지의 중간선을 세어 '몇 번째 자리인가' 를 바로 구한다.
  // 이웃과 한 칸씩 맞바꾸면 한 번에 크게 끌었을 때 한 칸밖에 못 따라온다.
  const rows = _fpDragRows(D.box).filter(r => r !== D.row);
  let k = 0;
  while (k < rows.length) {
    const b = rows[k].getBoundingClientRect();
    if (ev.clientY < b.top + b.height / 2) break;
    k++;
  }
  // 맨 끝자리는 마지막 행 '다음' — 목록 끝의 Destination 머리글 앞이다
  const anchor = rows[k] || (rows.length ? rows[rows.length - 1].nextSibling : null);
  if (anchor !== D.row) D.box.insertBefore(D.row, anchor);
});
let _fpDragJustEnded = false;
function _fpDragEnd(ev) {
  const D = _fpDrag;
  if (!D || (ev && ev.pointerId !== D.pid)) return;
  _fpDrag = null;
  D.row.classList.remove('fp-dragging');
  // 손잡이에서 손을 떼면 그 자리에서 click 이 한 번 더 난다. 그대로 두면
  // 순서만 바꿨는데 웨이포인트 상세 카드가 열린다 — 그 한 번만 삼킨다.
  _fpDragJustEnded = true;
  setTimeout(() => { _fpDragJustEnded = false; }, 400);
  fpReorder(_fpDragRows(D.box).map(r => +r.dataset.i));
}
document.addEventListener('click', ev => {
  if (!_fpDragJustEnded) return;
  if (!(ev.target && ev.target.closest && ev.target.closest('.fp-wp-row'))) return;
  _fpDragJustEnded = false;
  ev.stopPropagation(); ev.preventDefault();
}, true);
document.addEventListener('pointerup', _fpDragEnd);
document.addEventListener('pointercancel', _fpDragEnd);

function fpRenderList(area, title, footer) {
  title.textContent = 'ACTIVE FLIGHT PLAN';
  if (S.wps.length === 0) {
    area.innerHTML = `<div class="fp-empty-state">
      <div class="fp-empty-label">FLIGHT PLAN EMPTY</div>
      <button class="fp-empty-btn" data-act="fpGo" data-arg='["ADD"]'>＋ Add Origin</button>
      <button class="fp-empty-btn" data-act="fpGo" data-arg='["ADD"]'>＋ Add Enroute Waypoint</button>
      <button class="fp-empty-btn" data-act="fpGo" data-arg='["ADD"]'>＋ Add Destination</button>
    </div>`;
  } else {
    let html = `<div class="fp-panel-border" style="padding:0;overflow-y:auto;">`;
    html += `<div class="fp-section-hdr"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.5" fill="none" stroke="#87ceeb" stroke-width="1.2"/></svg>Origin – ${S.wps[0].ident}</div>`;
    S.wps.forEach((wp,i)=>{
      const isA=i===S.awp;
      let cls='fp-wp-row'+(isA?' active-wp':'');
      const d=distance(S.lat,S.lon,wp.lat,wp.lon), b=bearing(S.lat,S.lon,wp.lat,wp.lon);
      const badge=wp.phase?`<span class="fp-phase-badge badge-${wp.phase.toLowerCase()}">${wp.phase}</span>`:'';
      html+=`<div class="${cls}" data-act="fpWptOpen" data-arg='[${i}]' data-i="${i}">
        <span class="fp-wp-grip" title="끌어서 순서 변경">≡</span>
        <span class="fp-wp-seq">${i+1}</span>
        <span class="fp-wp-ident">${badge}${wp.ident}</span>
        <span class="fp-wp-hdg">${fmtA(toMag(b))}°</span>
        <span class="fp-wp-dist">${d.toFixed(0)}NM</span>
        <button class="fp-wp-hold${wp.hold?' active':''}" onclick="event.stopPropagation();fpHoldOpen(${i})" title="홀딩 패턴">HOLD</button>
        <button class="fp-wp-del" onclick="event.stopPropagation();removeWP(${i})">✕</button>
      </div>`;
    });
    if(S.wps.length>1) html+=`<div class="fp-section-hdr"><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,1 9,9 1,9" fill="none" stroke="#87ceeb" stroke-width="1.2"/></svg>Destination – ${S.wps[S.wps.length-1].ident}</div>`;
    html+=`</div>`;
    area.innerHTML = html;
  }
  const fullBtn = _soloActive
    ? `<div class="fp-nav-btn" data-act="exitSolo"><span>✥</span>Half</div>`
    : `<div class="fp-nav-btn" data-act="planFullScreen"><span>✥</span>Full</div>`;
  footer.innerHTML = `
    <div class="fp-nav-btn" data-act="fpGoCduHome"><span>🏠</span>Home</div>
    ${fullBtn}
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["ADD"]'><span>＋</span>Add WPT</div>
    <div class="fp-nav-btn" data-act="clearFP"><span>✕</span>Clr</div>
    <div class="fp-nav-btn" data-act="resetSim"><span>⟳</span>Rst</div>
    <div class="fp-nav-btn" data-act="fpBackToCdu"><span>↩</span>Back</div>`;
}

// ══════════════════════════════════════════════════════
// 웨이포인트 상세 (목록에서 항목을 누르면 열린다)
// ══════════════════════════════════════════════════════
// 종전에는 항목을 누르면 곧바로 활성 웨이포인트가 됐다. 되돌릴 방법도 없고,
// 이름·좌표를 고치거나 VNAV 를 걸 자리도 없었다. 한 번 눌러 카드를 펴고,
// 거기서 고르게 한다 — Direct To 도 그 카드 안의 버튼 하나다.
function fpWptOpen(i) {
  if (i < 0 || i >= S.wps.length) return;
  fpWptIdx = i;
  fpGo('WPT');
}

function fpRenderWpt(area, title, footer) {
  const i = fpWptIdx, wp = S.wps[i];
  if (!wp) { fpGo('LIST'); return; }
  title.textContent = 'WAYPOINT — ' + (wp.ident || 'WPT');

  const b = bearing(S.lat, S.lon, wp.lat, wp.lon);
  const d = distance(S.lat, S.lon, wp.lat, wp.lon);
  const isA = i === S.awp;
  // 이 지점으로 들어오는 레그 코스.
  // 활성 지점이면 '실제로 나는 코스선' 에서 읽는다 — 카드가 딴소리를 하면 안 된다.
  // Direct To 로 잡은 구간은 그 선이 현재 위치에서 시작하므로, 항공기가 움직이면
  // 이 값도 따라 움직인다(아래 fpWptLiveTick 이 카드를 되그린다).
  const _L = isA ? activeCourseLine() : null;
  const legCrs = _L ? fmtA(toMag(courseCrsHere(_L)))
                    : fmtA(toMag(bearing((i > 0 ? S.wps[i - 1] : S).lat,
                                         (i > 0 ? S.wps[i - 1] : S).lon, wp.lat, wp.lon)));
  // 그 코스가 '현재 위치에서 그 지점으로' 인 경우에는 그렇다고 적어 준다
  const legLbl = (isA && S.dtoLive && !obsOn && S.fwp < 0 && !Number.isFinite(wp.inCrs) && !holdOn)
    ? '레그 코스 · 현 위치' : '레그 코스';
  const hold = wp.hold;
  const holdTxt = hold
    ? `${String(Math.round(toMag(hold.crs))).padStart(3,'0')}° ${hold.dir === 'L' ? '좌' : '우'}`
    : '— — —';
  let vAlt = Number.isFinite(wp.vnavAlt) ? Math.round(wp.vnavAlt).toLocaleString() + ' FT' : '— — —';
  let vOfs = Number.isFinite(wp.vnavOfs) && wp.vnavOfs ? wp.vnavOfs.toFixed(1) + ' NM' : '0 NM';
  // 지정 진입 코스 — 이 지점을 '어느 방위로 향해' 들어갈지(OBS 모드처럼).
  // 비워 두면 앞 지점에서 이어지는 레그 코스를 그대로 쓴다.
  let inCrs = Number.isFinite(wp.inCrs)
    ? String(Math.round(wp.inCrs)).padStart(3, '0') + '°M' : '— — —';
  const cur = fpInputBuf + '<span class="fp-disp-cursor">|</span>';
  if (fpNumFld === 'VALT') vAlt = cur;
  if (fpNumFld === 'VOFS') vOfs = cur;
  if (fpNumFld === 'ICRS') inCrs = cur;

  // 카드 안의 버튼 — 위 라벨(작게) + 아래 값(크게)
  const CARD = (lbl, val, act, arg, on) =>
    `<div data-act="${act}"${arg !== undefined ? ` data-arg='${arg}'` : ''} style="` +
    `padding:6px 4px;border:1px solid ${on ? '#00cfff' : '#2a3a4a'};border-radius:5px;` +
    `background:${on ? '#00252e' : '#0a1218'};cursor:pointer;text-align:center;">` +
    `<div style="color:#6a8494;font-size:8px;letter-spacing:0.5px;">${lbl}</div>` +
    `<div style="color:${on ? '#00e5ff' : '#dfeaf2'};font-size:12px;font-weight:bold;margin-top:2px;">${val}</div>` +
    `</div>`;

  area.innerHTML =
    `<div class="fp-panel-border" style="padding:8px;">` +
      // ── 이름·좌표 ──
      `<div data-act="fpWptRename" style="cursor:pointer;display:flex;align-items:baseline;gap:6px;">` +
        `<span style="color:#fff;font-size:20px;font-weight:bold;letter-spacing:1px;">${wp.ident || 'WPT'}</span>` +
        `<span style="color:#00cfff;font-size:9px;">✎ 이름</span>` +
        (wp.phase ? `<span class="fp-phase-badge badge-${wp.phase.toLowerCase()}">${wp.phase}</span>` : '') +
      `</div>` +
      `<div data-act="fpWptCoord" style="cursor:pointer;color:#8fb8bf;font-size:10px;margin-top:3px;">` +
        `${decToDMS(wp.lat, true)} ${decToDMS(wp.lon, false)} <span style="color:#00cfff;">✎</span></div>` +
      `<div style="color:#6a8494;font-size:10px;margin-top:5px;">` +
        `현재 위치에서 <b style="color:#c8ff00;">${fmtA(toMag(b))}°</b>` +
        ` · <b style="color:#00ffff;">${uDist(d)}</b></div>` +

      // ── 설정 ──
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:9px;">` +
        CARD('VNAV 고도', vAlt, 'fpWptNum', '["VALT"]', fpNumFld === 'VALT' || Number.isFinite(wp.vnavAlt)) +
        CARD('VNAV 오프셋', vOfs, 'fpWptNum', '["VOFS"]', fpNumFld === 'VOFS' || !!wp.vnavOfs) +
        CARD(legLbl, legCrs + '°M', 'fpWptNoop') +
        CARD('HOLD', holdTxt, 'fpHoldOpen', `[${i}]`, !!hold) +
      `</div>` +

      // ── 동작: 왼쪽 진입 코스 · 오른쪽 Direct To ──
      // 왼쪽은 OBS 처럼 '어느 방위로 향해 들어갈지' 를 정하고, 오른쪽은 종전대로
      // 지금 자리에서 곧장 그 지점으로 간다.
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:9px;">` +
        `<div data-act="fpWptNum" data-arg='["ICRS"]' style="padding:6px 4px;border-radius:5px;cursor:pointer;` +
          `text-align:center;border:1px solid ${fpNumFld === 'ICRS' || Number.isFinite(wp.inCrs) ? '#00cfff' : '#2a6a8a'};` +
          `background:${fpNumFld === 'ICRS' || Number.isFinite(wp.inCrs) ? '#00252e' : '#0e2233'};">` +
          `<div style="color:#6a8494;font-size:8px;letter-spacing:0.5px;">➟ 진입 코스</div>` +
          `<div style="color:${Number.isFinite(wp.inCrs) ? '#00e5ff' : '#7ac6f5'};font-size:13px;` +
            `font-weight:bold;margin-top:2px;">${inCrs}</div></div>` +
        `<div data-act="fpWptDirect" style="padding:6px 4px;border-radius:5px;cursor:pointer;` +
          `text-align:center;display:flex;align-items:center;justify-content:center;` +
          `background:${isA ? '#0e2e0e' : '#0e2233'};border:1px solid ${isA ? '#44cc44' : '#2a6a8a'};">` +
          `<div style="color:${isA ? '#7fe07f' : '#7ac6f5'};font-size:12px;font-weight:bold;letter-spacing:0.5px;">` +
          (isA ? `✔ 활성 — ${wp.ident || 'WPT'}` : `➤ Direct To ${wp.ident || 'WPT'}`) + `</div></div>` +
      `</div>` +
      `<div style="margin-top:5px;">` +
        `<div data-act="fpWptDel" style="padding:6px 4px;border:1px solid #663333;border-radius:5px;` +
          `background:#1a0a0a;cursor:pointer;text-align:center;">` +
          `<div style="color:#8a6a6a;font-size:8px;letter-spacing:0.5px;">비행계획에서</div>` +
          `<div style="color:#ff6666;font-size:12px;font-weight:bold;margin-top:2px;">✕ 삭제</div></div>` +
      `</div>` +

      // ── 아래 빈 자리에 숫자판 ──
      // 값 칸은 그대로 보인 채 아래에서 친다. 숫자판만 있는 화면으로 넘어가면
      // 방금 넣은 값과 나머지 칸을 같이 볼 수가 없다.
      (fpNumFld ? (
        `<div style="color:#00cfff;font-size:9px;letter-spacing:0.5px;margin-top:8px;">` +
        (fpNumFld === 'VALT'
          ? 'VNAV 고도 입력 중 · 비우고 ENT 하면 해제됩니다 (-1000 ~ 45000 ft)'
          : fpNumFld === 'VOFS'
          ? 'VNAV 오프셋 입력 중 · 지점보다 몇 NM 앞에서 그 고도에 닿을지 (0 ~ 50 NM)'
          : '진입 코스(자북) 입력 중 · 비우고 ENT 하면 해제됩니다 (001 ~ 360°M)') +
        `</div>` + _padHtml('fpConfirmWptNum')
      ) : (
      `<div style="color:#445;font-size:8px;line-height:1.6;margin-top:8px;border-top:1px solid #1a2a30;padding-top:6px;">` +
        `<b>진입 코스</b>를 넣으면 이 지점을 그 방위로 향해 들어갑니다(OBS 처럼) —` +
        ` CDI·지도 코스선·NAV 오토파일럿이 모두 그 선을 씁니다. 비우면 앞 지점에서 이어지는 레그를 씁니다.<br>` +
        `<b>VNAV 고도</b>를 넣으면 이 지점이 활성일 때 그 고도를 목표로 강하선을 그립니다.` +
        ` 오프셋은 <b>지점보다 몇 NM 앞에서</b> 그 고도에 닿을지입니다.</div>`
      )) +
    `</div>`;

  footer.innerHTML =
    `<div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>📋</span>FP List</div>` +
    `<div class="fp-nav-btn" data-act="fpGo" data-arg='["ADD"]'><span>＋</span>Add WPT</div>` +
    `<div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>↩</span>Back</div>`;
}

function fpWptNoop() { /* 레그 코스는 읽기 전용 — 앞뒤 지점에서 저절로 정해진다 */ }

// Direct To — 지금 있는 자리에서 그 지점으로.
// 이미 활성인 지점에도 다시 걸 수 있어야 한다. 코스에서 한참 밀려난 뒤
// "여기서 다시 곧장" 이 필요한 순간이 그때이기 때문이다.
// selectWP 를 쓰지 않는 이유: 그 함수는 S.fwp 에 '직전 활성 WP' 를 넣는데,
// 이미 활성인 지점을 다시 누르면 자기 자신이 들어가 구간이 한 점이 된다.
function fpWptDirect() {
  const i = fpWptIdx;
  if (i < 0 || i >= S.wps.length) return;
  const wp = S.wps[i];
  delete wp.inCrs;               // 지정 진입 코스와는 양자택일이다
  S.awp = i;
  S.fwp = -1;                    // 앞 구간이 아니라 '현재 위치에서' 가 기준
  S.dtoLive = true;              // 그 코스는 항공기를 따라 계속 다시 잡힌다
  if (!obsOn) S.crs = bearing(S.lat, S.lon, wp.lat, wp.lon);
  if (holdOn) holdExit();        // 홀딩 중이면 그 코스가 우선이라 Direct 가 묻힌다
  updateWpMarkers(); updateNav(); _fplPersist();
  fpGo('LIST');
}

// 카드가 열려 있는 동안 값이 굳지 않게 되그린다.
// Direct To 구간의 레그 코스·거리는 항공기가 움직이면 같이 움직인다.
// 입력(숫자판) 중에는 건드리지 않는다 — 치던 값이 지워진다.
let _fpWptTick = 0;
function fpWptLiveTick(nowMs) {
  if (fpMode !== 'WPT' || fpNumFld) return;
  if (nowMs - _fpWptTick < 500) return;
  _fpWptTick = nowMs;
  fpRender();
}
async function fpWptDel() {
  const wp = S.wps[fpWptIdx];
  if (!wp) return;
  if (!await uiConfirm(`${wp.ident || 'WPT'} 을(를) 비행계획에서 지웁니다.`,
                       { okText: '삭제', cancelText: '취소' })) return;
  removeWP(fpWptIdx);
  fpWptIdx = -1;
  fpGo('LIST');
}
function fpWptRename() {
  if (fpWptIdx < 0) return;
  fpEditIdx = fpWptIdx; fpInputBuf = '';
  fpGo('IDENT');
}
function fpWptCoord() {
  if (fpWptIdx < 0) return;
  fpEditIdx = fpWptIdx; fpInputBuf = ''; fpTempLat = null;
  fpGo('LAT');
}

// ── VNAV 고도·오프셋 입력 ──
function fpWptNum(fld) {
  fpNumFld = (fpNumFld === fld) ? null : fld;   // 한 번 더 누르면 닫는다
  fpInputBuf = '';
  fpRender();
}
function fpConfirmWptNum() {
  const wp = S.wps[fpWptIdx];
  if (!wp) { fpGo('LIST'); return; }
  const txt = fpInputBuf.trim();
  const v = parseFloat(txt);
  if (fpNumFld === 'ICRS') {
    // 진입 코스(자북). 비우고 ENTER = 해제 → 앞 지점에서 이어지는 레그로 돌아간다.
    if (txt === '') delete wp.inCrs;
    else if (isNaN(v) || v < 0 || v > 360) { uiAlert('코스 범위: 001 ~ 360°M'); return; }
    else wp.inCrs = (normA(v) === 0) ? 360 : normA(v);
    // 넣은 그 자리에서 바로 쓰이도록 이 지점을 활성으로 잡는다(Direct To 와 같다).
    // 코스만 정해 두고 활성이 아니면 아무 일도 일어나지 않아 넣은 보람이 없다.
    if (fpWptIdx !== S.awp) selectWP(fpWptIdx);
    S.dtoLive = false;                       // 정해 둔 코스로 들어간다
    if (Number.isFinite(wp.inCrs)) S.crs = toTrue(wp.inCrs);
  } else if (fpNumFld === 'VALT') {
    // 비우고 ENTER = 해제. 없는 값을 0 으로 남겨 두면 "해면으로 강하" 가 된다.
    if (txt === '') delete wp.vnavAlt;
    else if (isNaN(v) || v < -1000 || v > 45000) { uiAlert('고도 범위: -1000 ~ 45000 ft'); return; }
    else { wp.vnavAlt = v; vnavActive = true; }
  } else {
    if (txt === '') delete wp.vnavOfs;
    else if (isNaN(v) || v < 0 || v > 50) { uiAlert('오프셋 범위: 0 ~ 50 NM'); return; }
    else wp.vnavOfs = v;
  }
  fpInputBuf = ''; fpNumFld = null;
  _fplPersist();
  try { updateNav(); } catch(e) { _swallow(e); }
  try { updateTerrainCut(); } catch(e) { _swallow(e); }
  fpRender();
}

// 입력 방법을 먼저 고르고, 그 다음에 값을 넣는다.
// 종전에는 여섯 가지 버튼이 한 줄에 섞여 있어 "좌표로 넣을지 방위로 넣을지"를
// 고르는 일과 "어느 공항인지" 고르는 일이 같은 무게로 보였다. 넷으로 갈라 둔다.
const FP_ADD_MODES = [
  { id:'LATLON', act:'fpGo',      arg:'["LAT"]',  icon:'📍', name:'LAT/LON',
    sub:'좌표를 직접 넣는다' },
  { id:'RADDIS', act:'fpRefOpen', arg:'["RB"]',   icon:'⌖',  name:'RAD/DIS',
    sub:'기준점 · 방위 · 거리' },
  { id:'RADRAD', act:'fpRefOpen', arg:'["RR"]',   icon:'✛',  name:'RAD/RAD',
    sub:'두 기준점 방위의 교점' },
  { id:'PPOS',   act:'fpAddPP',   arg:undefined,  icon:'✈',  name:'P.POS',
    sub:'지금 있는 자리' },
];

function fpRenderAdd(area, title, footer) {
  title.textContent = 'ADD WAYPOINT';
  const mode = m =>
    `<div data-act="${m.act}"${m.arg ? ` data-arg='${m.arg}'` : ''} style="` +
    `display:flex;flex-direction:column;align-items:center;gap:2px;` +
    `padding:9px 4px;border:1px solid #2a5a7a;border-radius:5px;background:#0a1620;cursor:pointer;">` +
    `<div style="font-size:19px;line-height:1;color:#87ceeb;">${m.icon}</div>` +
    `<div style="color:#00cfff;font-size:12px;font-weight:bold;letter-spacing:0.5px;">${m.name}</div>` +
    `<div style="color:#5a7484;font-size:8px;">${m.sub}</div>` +
    `</div>`;
  const apBtns = FP_PRESETS.map(a =>
    `<button class="fp-ap-btn" data-act="fpAddPreset" data-arg='["${a.ident}"]' title="${a.name}">${a.ident}</button>`).join('');
  area.innerHTML = `
    <div style="color:#87ceeb;font-size:9px;font-weight:bold;letter-spacing:1px;margin-bottom:5px;">입력 방법</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      ${FP_ADD_MODES.map(mode).join('')}
    </div>
    <div style="color:#87ceeb;font-size:9px;font-weight:bold;letter-spacing:1px;margin:10px 0 5px;">그 밖의 방법</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <div class="fp-input-type-btn fp-cyan" data-act="fpGo" data-arg='["IDENT"]'>
        <span style="font-size:18px;">⌨</span><span>IDENT</span>
      </div>
      <div class="fp-input-type-btn" data-act="fpGo" data-arg='["IFR"]'>
        <span style="font-size:16px;">✈</span><span>IFR 절차</span>
      </div>
    </div>
    <div style="color:#87ceeb;font-size:9px;font-weight:bold;letter-spacing:1px;margin:10px 0 5px;">국내 공항</div>
    <div class="fp-ap-grid">${apBtns}</div>`;
  footer.innerHTML = `
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>📋</span>FP List</div>
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>↩</span>Back</div>`;
}

// P.POS — 지금 있는 자리를 그대로 웨이포인트로. 넣자마자 상세 카드를 열어
// 이름·좌표를 다듬을 수 있게 한다(지도의 'PP 현재위치' 와 이름 규칙을 맞춘다).
function fpAddPP() {
  const n = S.wps.filter(w => /^PP\d*$/.test(w.ident)).length + 1;
  pushWP({ ident: 'PP' + n, lat: S.lat, lon: S.lon });
  fpWptOpen(S.wps.length - 1);
}

function fpAddPreset(ident) {
  const a = AIRPORTS.find(x=>x.ident===ident);
  if(a){ fpMode='LIST'; pushWP({ident:a.ident,lat:a.lat,lon:a.lon}); }
}

function fpRenderIdent(area, title, footer) {
  title.textContent = 'IDENT ENTRY';
  const disp = fpInputBuf || '';
  area.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <div class="fp-disp-box">${disp||'<span style="color:#222">——</span>'}<span class="fp-disp-cursor">|</span></div>
      <div class="fp-bksp-btn" data-act="fpBksp">⬅<br><span style="font-size:8px;">BKSP</span></div>
    </div>
    <div class="fp-key-grid">
      ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map(k=>`<div class="fp-key" onclick="fpType('${k}')">${k}</div>`).join('')}
    </div>`;
  footer.innerHTML = `
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["ADD"]'><span>↩</span>Cancel</div>
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>📋</span>FP</div>
    <div class="fp-nav-btn fp-nav-enter" data-act="fpConfirmIdent"><span>↩</span>Enter</div>`;
}

function fpRenderCoord(area, title, footer, field) {
  title.textContent = field==='LAT' ? 'LATITUDE ENTRY' : 'LONGITUDE ENTRY';
  const hint = field==='LAT' ? '예: 37.4602 (또는 지도 탭)' : '예: 126.4407';
  const disp = fpInputBuf || '';
  area.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;padding-top:4px;">
      <div style="font-size:8px;color:#87ceeb;">${hint}</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="fp-disp-box">${disp||'<span style="color:#222">——</span>'}<span class="fp-disp-cursor">|</span></div>
        <div class="fp-bksp-btn" data-act="fpBksp">⬅<br><span style="font-size:8px;">BKSP</span></div>
      </div>
      <div class="fp-numpad-grid">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<div class="fp-num-circ" onclick="fpType('${n}')">${n}</div>`).join('')}
        <div class="fp-num-circ" data-act="fpType" data-arg='["."]'>.</div>
        <div class="fp-num-circ" data-act="fpType" data-arg='["0"]'>0</div>
        <div class="fp-num-circ" data-act="fpType" data-arg='["-"]'>−</div>
      </div>
    </div>`;
  footer.innerHTML = `
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["ADD"]'><span>↩</span>Cancel</div>
    <div class="fp-nav-btn fp-nav-enter" onclick="fpConfirmCoord('${field}')"><span>↩</span>Enter</div>`;
}

function fpRenderIfr(area, title, footer) {
  title.textContent = 'IFR PROCEDURES';
  const tabs = ['DEP','ENR','APP'];
  const tabsHtml = tabs.map(t=>`<div class="fp-ifr-tab${fpIfrPhase===t.toLowerCase()?' active':''}" onclick="fpSetIfrPhase('${t.toLowerCase()}')">${t}</div>`).join('');
  let panelHtml = '';
  if(fpIfrPhase==='dep'){
    panelHtml=
      `<div class="fp-ifr-lbl">Departure Airport</div>` +
      `<select class="fp-ifr-sel" id="dep-icao" onchange="loadSids()"></select>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">` +
        `<div><div class="fp-ifr-lbl">RWY 필터</div><select class="fp-ifr-sel" id="dep-rwy" onchange="loadSids()"></select></div>` +
        `<div><div class="fp-ifr-lbl">추가 방식</div><select class="fp-ifr-sel" id="dep-mode">` +
          `<option value="append">현재 플랜 뒤에</option><option value="replace">플랜 비우고</option></select></div>` +
      `</div>` +
      `<div class="fp-ifr-lbl">SID Procedure</div>` +
      `<select class="fp-ifr-sel" id="dep-sid" onchange="onSidSelect()"></select>` +
      `<div id="sid-detail"></div>` +
      `<button class="fp-ifr-add" data-act="addSidWps">＋ ADD SID TO PLAN</button>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:4px;">` +
        `<div class="fp-ifr-add" style="margin:0;font-size:9px;" data-act="sidShowOnMap">🗺 지도</div>` +
        `<div class="fp-ifr-add" style="margin:0;font-size:9px;" data-act="fpGo" data-arg='["SIDNEW"]'>＋ 사용자 SID</div>` +
        `<div class="fp-ifr-add" style="margin:0;font-size:9px;" data-act="deleteUserSid">🗑 삭제</div>` +
      `</div>`;
  } else if(fpIfrPhase==='enr'){
    panelHtml=`<div class="fp-ifr-lbl">Airway</div><select class="fp-ifr-sel" id="enr-airway" onchange="loadAirwayFixes()"></select><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;"><div><div class="fp-ifr-lbl">Entry Fix</div><select class="fp-ifr-sel" id="enr-entry"></select></div><div><div class="fp-ifr-lbl">Exit Fix</div><select class="fp-ifr-sel" id="enr-exit"></select></div></div><button class="fp-ifr-add" data-act="addAirwaySegment">＋ ADD AIRWAY SEG</button><div class="fp-ifr-lbl" style="border-top:1px solid #152515;padding-top:5px;margin-top:5px;">Single Fix</div><select class="fp-ifr-sel" id="enr-fix"></select><button class="fp-ifr-add" data-act="addSingleFix">＋ ADD FIX</button>`;
  } else {
    panelHtml=`
      <div class="fp-ifr-lbl">Arrival Airport</div>
      <select class="fp-ifr-sel" id="app-icao" onchange="loadStars();loadApproaches()"></select>
      <div class="fp-ifr-lbl">STAR Procedure</div>
      <select class="fp-ifr-sel" id="app-star"></select>
      <button class="fp-ifr-add" data-act="addStarWps">＋ ADD STAR</button>
      <div style="border-top:1px solid #152515;margin:5px 0;"></div>
      <div class="fp-ifr-lbl">Approach Procedure</div>
      <select class="fp-ifr-sel" id="app-proc"></select>
      <button class="fp-ifr-add" data-act="addAppWps">＋ ADD APPROACH</button>`;
  }
  area.innerHTML = `<div class="fp-ifr-tab-row">${tabsHtml}</div><div class="fp-panel-border" style="overflow-y:auto;">${panelHtml}</div>`;
  // Populate selects dynamically
  if(fpIfrPhase==='dep'){
    const s=document.getElementById('dep-icao');
    // AIP 공개 공항 전체를 대상으로 한다(절차 미등록 공항도 사용자 SID 저장 가능)
    if(s&&s.options.length===0){
      aipAirportList().forEach(a=>{
        const has=(IFR_DB[a.icao]&&IFR_DB[a.icao].sids||[]).length + ((customSids()[a.icao]||[]).length);
        const o=document.createElement('option');o.value=a.icao;
        o.textContent=a.icao+' – '+a.name+(has?'':' (절차 없음)');
        s.appendChild(o);
      });
      loadSids();
    }
  } else if(fpIfrPhase==='enr'){
    const aw=document.getElementById('enr-airway');
    if(aw&&aw.options.length===0){
      Object.keys(IFR_AIRWAYS).forEach(k=>{const o=document.createElement('option');o.value=k;o.textContent=k;aw.appendChild(o);});
      const fx=document.getElementById('enr-fix');
      Object.keys(IFR_FIXES).sort().forEach(k=>{const o=document.createElement('option');o.value=k;o.textContent=k;fx.appendChild(o);});
      loadAirwayFixes();
    }
  } else {
    const s=document.getElementById('app-icao');
    if(s&&s.options.length===0){Object.keys(IFR_DB).forEach(k=>{const o=document.createElement('option');o.value=k;o.textContent=k+' – '+IFR_DB[k].name;s.appendChild(o);});loadStars();loadApproaches();}
  }
  footer.innerHTML = `
    <div class="fp-nav-btn" data-act="fpGoCduHome"><span>🏠</span>Home</div>
    ${fpFullBtn()}
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>📋</span>FP</div>
    <div class="fp-nav-btn" data-act="fpGo" data-arg='["ADD"]'><span>↩</span>Back</div>`;
}

// ══════════════════════════════════════════════════════
// 사용자 정의 SID 만들기 (AIP 절차가 없는 공항도 사용 가능)
// ══════════════════════════════════════════════════════
let _sidNew = { icao:'', name:'', rwy:'', wps:[] };
function sidNewAddFix() {
  const f = document.getElementById('sn-fix')?.value;
  if (!f || !IFR_FIXES[f]) return;
  _sidNew.wps.push(f);
  fpRender();
}
function sidNewDelFix(i) { _sidNew.wps.splice(i, 1); fpRender(); }
function sidNewSave() {
  const icao = document.getElementById('sn-icao')?.value || '';
  const name = (document.getElementById('sn-name')?.value || '').trim().toUpperCase();
  const rwy  = (document.getElementById('sn-rwy')?.value || '').trim().toUpperCase();
  if (!icao)            { uiAlert('공항을 선택하세요.'); return; }
  if (!name)            { uiAlert('절차 이름을 입력하세요.'); return; }
  if (!_sidNew.wps.length) { uiAlert('경유점을 1개 이상 추가하세요.'); return; }
  const all = customSids();
  if (!all[icao]) all[icao] = [];
  all[icao].push({ name, rwy: rwy || '-', wps: _sidNew.wps.map(id => ({ ident:id })) });
  saveCustomSids(all);
  _sidNew = { icao:'', name:'', rwy:'', wps:[] };
  fpIfrPhase = 'dep';
  fpGo('IFR');
}
function fpRenderSidNew(area, title, footer) {
  title.textContent = '사용자 SID 만들기';
  // 직전 DEP 탭에서 고른 공항을 기본값으로
  if (!_sidNew.icao) _sidNew.icao = document.getElementById('dep-icao')?.value || '';
  const aptOpts = aipAirportList().map(a =>
    `<option value="${a.icao}"${a.icao === _sidNew.icao ? ' selected' : ''}>${a.icao} – ${a.name}</option>`).join('');
  const fixOpts = Object.keys(IFR_FIXES).sort().map(k => `<option value="${k}">${k}</option>`).join('');
  const chain = _sidNew.wps.length
    ? _sidNew.wps.map((id, i) =>
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;margin-bottom:3px;` +
        `border:1px solid #1e3a2a;border-radius:4px;background:#08140e;">` +
        `<span style="color:#9fe6c0;font-size:11px;font-weight:bold;">${i+1}. ${id}</span>` +
        `<span onclick="sidNewDelFix(${i})" style="color:#ff8a65;font-size:12px;cursor:pointer;padding:0 4px;">✕</span></div>`).join('')
    : `<div style="color:#567;font-size:10px;padding:6px 2px;">아래에서 픽스를 골라 순서대로 추가하세요.</div>`;
  area.innerHTML =
    `<div class="fp-panel-border" style="overflow-y:auto;">` +
      `<div class="fp-ifr-lbl">공항</div><select class="fp-ifr-sel" id="sn-icao">${aptOpts}</select>` +
      `<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:4px;">` +
        `<div><div class="fp-ifr-lbl">절차 이름</div>` +
          `<input id="sn-name" placeholder="예: BOPTA1D" style="width:100%;box-sizing:border-box;background:#08140e;` +
          `border:1px solid #2a4a3a;border-radius:3px;color:#9fe6c0;font-size:12px;font-weight:bold;padding:5px 6px;"></div>` +
        `<div><div class="fp-ifr-lbl">RWY</div>` +
          `<input id="sn-rwy" placeholder="06L/06R" style="width:100%;box-sizing:border-box;background:#08140e;` +
          `border:1px solid #2a4a3a;border-radius:3px;color:#9fe6c0;font-size:12px;font-weight:bold;padding:5px 6px;"></div>` +
      `</div>` +
      `<div class="fp-ifr-lbl" style="margin-top:6px;">경유점 순서 (${_sidNew.wps.length})</div>` +
      chain +
      `<div style="display:grid;grid-template-columns:1fr auto;gap:4px;margin-top:4px;">` +
        `<select class="fp-ifr-sel" id="sn-fix" style="margin:0;">${fixOpts}</select>` +
        `<div class="fp-ifr-add" style="margin:0;padding:6px 12px;" data-act="sidNewAddFix">＋</div>` +
      `</div>` +
      `<button class="fp-ifr-add" style="margin-top:8px;" data-act="sidNewSave">💾 절차 저장</button>` +
      `<div style="color:#4a6274;font-size:9px;margin-top:5px;line-height:1.4;">` +
        `저장한 절차는 SID 목록에 <b>★</b> 표시로 나타나며 기기에 보관됩니다.<br>` +
        `좌표는 픽스 이름으로 자동 해석되므로 따로 입력할 필요가 없습니다.</div>` +
    `</div>`;
  footer.innerHTML =
    `<div class="fp-nav-btn" data-act="fpGoCduHome"><span>🏠</span>Home</div>` +
    fpFullBtn() +
    `<div class="fp-nav-btn" data-act="fpGo" data-arg='["LIST"]'><span>📋</span>FP</div>` +
    `<div class="fp-nav-btn" data-act="fpGo" data-arg='["IFR"]'><span>↩</span>Back</div>`;
}

function fpSetIfrPhase(phase) {
  fpIfrPhase = phase;
  const area=document.getElementById('fp-content-area'), title=document.getElementById('fp-mode-title'), footer=document.getElementById('fp-footer-nav');
  fpRenderIfr(area, title, footer);
}

function fpType(k) { if(fpInputBuf.length<12) fpInputBuf+=k; fpRender(); }
function fpBksp() { fpInputBuf=fpInputBuf.slice(0,-1); fpRender(); }

function fpConfirmIdent() {
  const v = fpInputBuf.trim().toUpperCase();
  if(!v) return;
  // 이름 고치기 — 좌표는 그대로 두고 부르는 이름만 바꾼다.
  // (공항 목록에 없는 이름도 허용한다. 지도에서 찍은 지점에 이름을 붙이는 자리다)
  if (fpEditIdx >= 0 && fpEditIdx < S.wps.length) {
    S.wps[fpEditIdx].ident = v;
    fpInputBuf=''; fpEditIdx=-1;
    updateWpMarkers(); updateNav(); _fplPersist();
    fpGo('WPT');
    return;
  }
  // 빈 계획이면 이 지점이 ORIGIN 이 된다 — pushWP 안에서 항공기를 옮긴다
  const f = AIRPORTS.find(a=>a.ident===v);
  if(f){ fpMode='LIST'; fpInputBuf=''; pushWP({ident:f.ident,lat:f.lat,lon:f.lon}); }
  else uiAlert(`"${v}" not found.\nAvailable: ${AIRPORTS.map(a=>a.ident).join(', ')}`);
}

function fpConfirmCoord(field) {
  const val = parseDegrees(fpInputBuf);
  if(isNaN(val)){ uiAlert('유효한 값을 입력하세요'); return; }
  if(field==='LAT'){
    if(val<-90||val>90){ uiAlert('위도 범위: -90 ~ 90'); return; }
    fpTempLat=val; fpInputBuf=''; fpGo('LON');
  } else {
    if(val<-180||val>180){ uiAlert('경도 범위: -180 ~ 180'); return; }
    const lat=fpTempLat, lon=val;
    if (fpEditIdx >= 0 && fpEditIdx < S.wps.length) {
      const w = S.wps[fpEditIdx];
      const wasOrigin = fpEditIdx === 0;
      w.lat = lat; w.lon = lon;
      fpTempLat=null; fpInputBuf=''; fpEditIdx=-1;
      updateWpMarkers(); updateNav(); updateHoldLine(); _fplPersist();
      fpGo('WPT');
      if (wasOrigin) _fpOriginMoveAircraft(w);   // 출발지를 옮겼으면 항공기도 따라간다
      return;
    }
    const name='WP'+(S.wps.length+1);
    fpMode='LIST'; fpTempLat=null; fpInputBuf='';
    pushWP({ident:name,lat,lon});
  }
}

// Parses decimal degrees OR DMS: 37.4602 / 37°27'36.7"N / 37 27 36.7 N / N37-27-36.7
function parseDegrees(str) {
  if (!str) return NaN;
  str = str.trim();
  if (!str) return NaN;
  // Pure decimal (possibly negative)
  if (/^-?[\d.]+$/.test(str)) return parseFloat(str);
  // Extract sign from N/S/E/W
  let sign = 1;
  if (/[Ss Ww]/.test(str.replace(/\s/g,''))) sign = -1;
  // Strip direction letters and degree/minute/second symbols
  const clean = str.replace(/[NSEWnsew°'"′″´`]/g, ' ').trim();
  const parts = clean.match(/[\d]+(?:[.,][\d]+)?/g);
  if (!parts || parts.length === 0) return NaN;
  const d = parseFloat(parts[0]) || 0;
  const m = parts.length > 1 ? parseFloat(parts[1]) || 0 : 0;
  const s = parts.length > 2 ? parseFloat(parts[2]) || 0 : 0;
  return sign * (d + m / 60 + s / 3600);
}

// ORIGIN(첫 웨이포인트)을 넣거나 고치면 항공기를 그 자리로 옮긴다.
//
// 시작 위치는 앱을 켤 때 GPS(또는 송도)로 한 번 잡히고 그만이었다. 그래서
// "김포에서 출발" 을 해 보려면 지도를 끌어다 항공기를 손으로 옮겨야 했다.
// 출발지는 비행계획의 첫 줄에 이미 적는 것이니, 그걸 적으면 거기 서 있게 한다.
//
//   · GPS 모드에서는 옮기지 않는다 — 위치는 수신기가 정한다.
//   · 비행 중(FLY)이면 되묻는다 — 날고 있는 기체를 말없이 순간이동시키지 않는다.
//   · 옮기면 항적을 지운다. 안 지우면 옛 자리에서 새 자리까지 선이 하나 그어진다.
async function _fpOriginMoveAircraft(wp) {
  if (!wp || typeof gpsMode !== 'undefined' && gpsMode) return;
  const d = distance(S.lat, S.lon, wp.lat, wp.lon);
  if (d < 0.05) return;                       // 이미 그 자리다
  if (S.running) {
    const ok = await uiConfirm(
      `출발지를 ${wp.ident || 'ORIGIN'} 으로 넣었습니다.\n` +
      `비행 중입니다 — 항공기를 그 자리(${uDist(d)} 떨어짐)로 옮길까요?`,
      { okText: '옮기기', cancelText: '그대로' });
    if (!ok) return;
  }
  S.lat = wp.lat; S.lon = wp.lon;
  S.trail = []; try { updateTrail(); } catch(e) { _swallow(e); }
  S.lastT = null;                              // 옮긴 만큼을 속도로 적분하지 않게
  try { leafMap.setView([S.lat, S.lon], leafMap.getZoom(), { animate: false }); } catch(e) { _swallow(e); }
  try { updateAcOnMap(); updateNav(); updateCenterCoord(); } catch(e) { _swallow(e); }
  uiToast(`항공기를 출발지 ${wp.ident || ''} 로 옮겼습니다.`);
}

function pushWP(wp, phase){
  if(phase) wp.phase=phase;
  const wasEmpty = S.wps.length === 0;
  S.wps.push(wp);
  if(S.awp<0) selectWP(0);
  else{updateWpMarkers();fpRender();updateNav();}
  // 빈 계획에 처음 넣은 지점이 곧 ORIGIN 이다
  if (wasEmpty) _fpOriginMoveAircraft(S.wps[0]);
}
function removeWP(i){
  S.wps.splice(i,1);
  if(S.awp===i)    S.awp=Math.max(-1,i-1); else if(S.awp>i)    S.awp--;
  if(S.fwp===i)    S.fwp=-1;               else if(S.fwp>i)    S.fwp--;
  updateWpMarkers();fpRender();updateNav();
}
function selectWP(i){
  S.fwp=S.awp;S.awp=i;
  S.dtoLive=false;   // 구간을 따라간다 — Direct To 의 '현 위치 기준' 은 여기서 끝난다
  if (!obsOn) {
    // 지정 진입 코스가 있으면 CRS 도 그 값이다 — 계기와 나는 길이 달라선 안 된다
    S.crs = Number.isFinite(S.wps[i].inCrs)
      ? toTrue(S.wps[i].inCrs)
      : bearing(S.lat,S.lon,S.wps[i].lat,S.wps[i].lon);
  }
  updateWpMarkers();fpRender();updateNav();
}
function clearFP(){
  S.wps=[];S.awp=-1;S.fwp=-1;S.dtoLive=false;
  fpMode='LIST';
  updateWpMarkers();fpRender();updateNav();
}

