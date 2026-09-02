// ─────────────────────────────────────────────────────────────
// 07-sim.js — 조종 입력 · 시뮬레이션 루프 · 초기화 · 측정자 · 솔로모드
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// CONTROLS  — pitch & bank are AUTO; no manual buttons
// ══════════════════════════════════════════════════════
function applyDelta(field, d){
  switch(field){
    case 'spd':
      S.spd = Math.max(0, Math.min(320, S.spd + d));
      S.pit = pitchFromSpd(S.spd);   // auto pitch from speed
      break;
    case 'hdg':
      // GSPD(호버) 중에는 HDG 화살표와 기수를 분리 — 요 조작은 ANTI-TORQUE PEDAL로만
      if (gspdOn) break;
      // 기수를 즉시 돌리지 않고 선택 헤딩(HDG bug)만 이동 → AFCS가 표준선회로 추종
      selHdg = ((Math.round(selHdg + d) + 359) % 360) + 1;   // 1–360
      hdgSelOn = true;
      rollApOn = true;
      break;
    case 'yaw':
      // ANTI-TORQUE PEDAL — 뱅크 없이 기수만 즉시 회전(홀드 시 약 12°/s)
      S.hdg = normA(S.hdg + d);
      selHdg = ((Math.round(S.hdg) + 359) % 360) + 1;   // HDG SEL이 되돌리지 않도록 동기
      break;
    case 'crs':
      if (navSrc !== 'FMS') {
        vorObsCrs = normA(vorObsCrs + d); updateNav();
      } else if (obsOn) {
        S.crs = normA(S.crs + d); updateNav();
      }
      break;
    case 'vs':
      if (altHoldOn) {
        // Hold mode active: VS ▲/▼ adjusts the convergence rate preselect.
        selVS = Math.max(50, Math.min(3000, selVS + d));
      } else {
        S.vs = Math.max(-3000, Math.min(3000, S.vs + d));
      }
      break;
    case 'alt':
      // ALT +/- now adjusts the AFCS target (selAlt). Auto-engages ALT hold so
      // S.alt converges to the new target at selVS rate.
      selAlt    = Math.max(0, Math.min(45000, selAlt + d));
      altHoldOn = true;
      updateHoverBtns();
      break;
    case 'wdir': windDir = normA(windDir + d); break;
    case 'wspd': windSpd = Math.max(0, Math.min(150, windSpd + d));    break;
  }
}

// FCP 라벨(IAS/HDG/CRS) 누름: 해당 상위모드 인게이지 + 현재값 동기화
// - IAS: 속도 프리셀렉트(selSpd)를 현재 속도로
// - HDG: 헤딩 프리셀렉트(selHdg)를 현재 기수방위로 + 현재 헤딩 유지(롤 AP)
// - CRS: 현재 위치에서 NAV 소스(VOR/LOC 국·FMS 활성 웨이포인트)로의 코스 세팅(Direct-To)
function fcpSync(which) {
  if (which === 'ias') {
    selSpd = Math.max(0, Math.round(S.spd));
  } else if (which === 'hdg') {
    selHdg = ((Math.round(S.hdg) + 359) % 360) + 1;   // 1–360
    hdgSelOn = true; bankTarget = 0; rollApOn = true;  // 현재 헤딩 유지
  } else if (which === 'crs') {
    S.dtoLive = false;   // 코스를 손으로 정하는 순간 '현 위치 기준' 은 끝난다
    // 코스선은 '그 지점을 지나고, 그 지점에서의 방위가 CRS 인 대권' 이다.
    // 그래서 지금 자리를 지나게 하려면 '지점에서 본 항공기 방위의 반대' 를 넣어야
    // 한다. 항공기에서 본 지점 방위를 그대로 넣으면 대권의 방위가 양 끝에서
    // 다른 만큼(수렴각) 어긋나, 먼 거리에서는 코스선이 항공기를 비켜 간다
    // (82NM 에서 1° ≈ 1.4NM — 지도에서 눈에 띄게 벌어진다).
    // 반올림도 하지 않는다. 1° 를 버리면 그 거리에서 0.7NM 이 다시 벌어진다.
    if ((navSrc !== 'FMS') && navLat !== null) {
      vorObsCrs = normA(bearing(navLat, navLon, S.lat, S.lon) + 180);
      updateNav();
    } else if (navSrc === 'FMS' && S.awp >= 0) {
      const _w = S.wps[S.awp];
      S.crs = normA(bearing(_w.lat, _w.lon, S.lat, S.lon) + 180);
      S.fwp = -1;   // 이전 leg 대신 활성 WP 를 지나는 S.crs 선을 추적
      updateNav();
    } else {
      return;   // 세팅할 NAV 소스 없음 → 피드백 없이 무시
    }
  }
  // 시각 피드백(짧은 초록 플래시)
  const el = document.getElementById(which === 'ias' ? 'ias-lbl-btn' : which === 'hdg' ? 'hdg-lbl-btn' : 'crs-lbl-btn');
  if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 350); }
}

// ── 키보드 매핑 (FCP 조작) ──
// 1/2: IAS ∓1 · 3/4: HDG 좌/우 1° · 5/6: CRS 좌/우 1°
// 7/8: VS ∓10fpm · 9/0: ALT ∓10ft
// 키를 누르고 있으면 OS 키 반복으로 연속 조작. 입력창 포커스 중에는 무시.
const _keyMap = {
  '1': ['spd', -1],  '2': ['spd', 1],
  '3': ['hdg', -1],  '4': ['hdg', 1],
  '5': ['crs', -1],  '6': ['crs', 1],
  '7': ['vs', -10],  '8': ['vs', 10],
  '9': ['alt', -10], '0': ['alt', 10],
};
// 물리 키보드 단축키(DeX·데스크톱에서 오작동 시 설정에서 끌 수 있음)
let kbdShortcuts = true;
try { kbdShortcuts = localStorage.getItem('kbdShortcuts') !== '0'; } catch(e) { _swallow(e); }
function toggleKbdShortcuts() {
  kbdShortcuts = !kbdShortcuts;
  try { localStorage.setItem('kbdShortcuts', kbdShortcuts ? '1' : '0'); } catch(e) { _swallow(e); }
  stopAllHolds();
}
// 항법 보조 모드에서는 조종 필드를 키보드로도 건드리지 못하게 한다.
// 화면에서 버튼만 내리고 키는 살려 두면, 물리 키보드를 붙인 기기(DeX·데스크톱)
// 에서 숫자 키가 계기를 움직여 "왜 값이 바뀌지" 가 된다. CRS 는 코스 선택이라 남긴다.
const _NAV_KEY_FIELDS = ['crs'];
function _keyFieldAllowed(field) {
  if (typeof simPanelOn !== 'undefined' && simPanelOn) return true;
  return _NAV_KEY_FIELDS.includes(field);
}
document.addEventListener('keydown', e => {
  if (!kbdShortcuts) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const m = _keyMap[e.key];
  if (!m) return;
  if (!_keyFieldAllowed(m[0])) return;
  e.preventDefault();
  applyDelta(m[0], m[1]);
});
// Enter: Force Trim Release · 우측 Shift: GSPD 토글 · 방향키: 트림(←→↑↓)
const _keyTrimMap = { 'ArrowLeft': 'L', 'ArrowRight': 'R', 'ArrowUp': 'F', 'ArrowDown': 'A' };
document.addEventListener('keydown', e => {
  if (!kbdShortcuts) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  // 트림·FLY·GSPD 는 전부 조종이다 — 항법 보조 모드에서는 키도 듣지 않는다
  if (!_keyFieldAllowed('trim')) return;
  if (e.key === 'Enter') { e.preventDefault(); forceTrim(); return; }
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();                        // 페이지 스크롤 방지
    if (!e.repeat) toggleSim();                // FLY ⇄ PAUSE
    return;
  }
  if (e.key === 'Shift' && e.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT && !e.repeat) {
    e.preventDefault(); toggleGspd(); return;
  }
  const dir = _keyTrimMap[e.key];
  if (dir) {
    e.preventDefault();
    if (!e.repeat) startTrimHold(dir);   // 버튼 홀드와 동일(자체 반복 타이머 사용)
  }
});
document.addEventListener('keyup', e => {
  // HDG 키(3/4)를 떼면 버튼과 동일하게 뱅크 목표 해제(수평 복귀)
  if (_keyTrimMap[e.key]) stopTrimHold();
});

const btnMap={
  'spd-dn':['spd',-1],'spd-up':['spd',1],
  'hdg-dn':['hdg',-1],'hdg-up':['hdg',1],
  'ped-l':['yaw',-1],'ped-r':['yaw',1],
  'crs-dn':['crs',-1],'crs-up':['crs',1],
  'vs-dn':['vs',-100],'vs-up':['vs',100],
  // COLLECTIVE TRIM — 현재는 VS ▲▼와 동일 동작.
  // 상위모드(AFCS) 해제 기능이 들어가면 파워(출력) 직접 제어로 바꾼다.
  'coll-up':['vs',100],'coll-dn':['vs',-100],
  'alt-dn':['alt',-100],'alt-up':['alt',100],
  'wdir-dn':['wdir',-5],'wdir-up':['wdir',5],
  'wspd-dn':['wspd',-1],'wspd-up':['wspd',1],
};
// Per-button independent hold state using PointerEvent.
// Each button owns its timer/interval — simultaneous touches no longer bleed
// into each other (fixes the multi-touch "stuck button" bug).
// ── 홀드(연속 조작) 안전 장치 ──
// DeX·데스크톱처럼 창 포커스가 바뀌는 환경에서는 pointerup/keyup을 놓칠 수 있고,
// 그러면 반복 타이머가 살아남아 속도가 0으로 수렴하거나 계속 증가한다.
// 활성 홀드만 등록해 두고 전역 이벤트에서 일괄 해제한다.
const _holdStops = new Set();
const HOLD_MAX_MS = 20000;      // 어떤 홀드도 20초를 넘기지 않음(런어웨이 방지)
function stopAllHolds() {
  Array.from(_holdStops).forEach(fn => { try { fn(); } catch(e) { _swallow(e); } });
  try { stopTrimHold(); } catch(e) { _swallow(e); }
}
window.addEventListener('blur', stopAllHolds);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAllHolds(); });
document.addEventListener('pointerup', stopAllHolds);
document.addEventListener('pointercancel', stopAllHolds);

Object.entries(btnMap).forEach(([id,[f,d]])=>{
  const el=document.getElementById(id);
  let timer=null, interval=null, guard=null;
  function start(e){
    e.preventDefault();
    if(timer||interval) return;
    applyDelta(f,d);
    _holdStops.add(stop);
    guard = setTimeout(stop, HOLD_MAX_MS);          // 런어웨이 방지
    timer=setTimeout(()=>{interval=setInterval(()=>applyDelta(f,d),80);},350);
  }
  function stop(){
    clearTimeout(timer); timer=null;
    clearInterval(interval); interval=null;
    clearTimeout(guard); guard=null;
    _holdStops.delete(stop);
  }
  el.addEventListener('pointerdown',start);
  el.addEventListener('pointerup',stop);
  el.addEventListener('pointercancel',stop);
  el.addEventListener('pointerleave',stop);
});

// Trim cells: hold-to-repeat (initial gspdTrim + 1 kt/sec after delay)
['trim-l','trim-r','trim-fwd','trim-aft'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  const dir = el.getAttribute('data-trim-dir');
  el.addEventListener('mousedown',  () => startTrimHold(dir));
  el.addEventListener('touchstart', e => { e.preventDefault(); startTrimHold(dir); }, {passive:false});
});
document.addEventListener('mouseup',     stopTrimHold);
document.addEventListener('touchend',    stopTrimHold);
document.addEventListener('touchcancel', stopTrimHold);

// CRS button initial state (OBS off, FMS mode → disabled)
updateCrsButtons();
// 인터셉트 각도 버튼 초기 표기
updateInterceptBtn();
// Hover/GSPD/trim initial state
updateHoverBtns();

// ══════════════════════════════════════════════════════
// SIMULATION
// ══════════════════════════════════════════════════════
function updateFlyBtns(){
  const txt = S.running ? '⏸ PAUSE' : '▶ FLY';
  ['fly-btn','map-fly-btn'].forEach(id=>{
    const b=document.getElementById(id);
    if(!b) return;
    b.textContent=txt;
    b.classList.toggle('on',S.running);
  });
}
function toggleSim(){
  S.running=!S.running;
  updateFlyBtns();
  S.lastT=null;
  if(S.running&&S.trail.length===0) S.trail.push([S.lat,S.lon]);
}
// ── 배속 ───────────────────────────────────────────────────────────
// 홀딩 한 바퀴가 4분, 절차 하나가 20분씩 걸린다. 그 시간을 실시간으로
// 앉아 기다리게 하지 않는다. 시뮬 시간만 빨리 흐르게 하고 계산은 그대로다
// (프레임 간격을 늘리는 게 아니라 한 프레임에 흐를 시간을 늘린다).
const SIM_SPEEDS = [1, 2, 4, 8];
function setSimSpeed(v) {
  simSpeed = SIM_SPEEDS.includes(v) ? v : 1;
  updateSimSpeedBtns();
}
function updateSimSpeedBtns() {
  SIM_SPEEDS.forEach(v => {
    const el = document.getElementById('simspd-' + v);
    if (el) el.classList.toggle('active', simSpeed === v);
  });
}

let _swPrevTs = null;   // 스톱워치에 시간을 흘려 넣기 위한 직전 프레임 시각
let _simLastTick = 0;   // 렌더 루프 생존 감시용
let _pfdDrawLast = 0;   // GPS 모드 PFD 10fps 제한용
function simStep(ts){
  _simLastTick = performance.now();
  try {
  if(S.running && !gpsMode && S.lastT!==null){
    const _raw=(ts-S.lastT)/1000;
    // 배속: 한 프레임에 흐르게 할 시뮬 시간 = 실제 경과시간 × simSpeed.
    // 한 번에 몰아 적분하면 큰 dt 에서 오차가 커지므로(선회 중 특히) 0.2초를
    // 넘지 않게 쪼갠다. 60fps·8배속이면 0.133초라 그대로 한 번에 돈다 —
    // 프레임이 튀었을 때만 나뉜다.
    const _tot=_raw>0&&_raw<0.5 ? _raw*simSpeed : 0;
    const _n=Math.max(1, Math.ceil(_tot/0.2));
    for(let _sub=0;_sub<_n;_sub++){
    const dt=_tot/_n;
    if(dt>0&&dt<0.5){
      // smooth bank toward target — GSPD 중에는 ADI 자세 변화 없음(수평 유지)
      const bt = gspdOn ? 0 : bankTarget;
      const bankDiff=bt-S.bnk;
      if ((hdgSelOn || navApOn) && !gspdOn) {
        // AFCS 선회: 롤 각가속도 제한(사다리꼴 프로파일).
        // 목표 롤율은 남은 뱅크차로 감속거리를 계산해 정하므로 오버슛 없이 수렴한다.
        const want = Math.sign(bankDiff) *
                     Math.min(ROLL_RATE_MAX, Math.sqrt(2 * ROLL_ACC_MAX * Math.abs(bankDiff)));
        const dR = Math.max(-ROLL_ACC_MAX * dt, Math.min(ROLL_ACC_MAX * dt, want - _rollRate));
        _rollRate += dR;
        S.bnk += _rollRate * dt;
        if (Math.abs(bt - S.bnk) < 0.05 && Math.abs(_rollRate) < 0.3) { S.bnk = bt; _rollRate = 0; }
      } else {
        _rollRate = 0;
        S.bnk+=Math.sign(bankDiff)*Math.min(Math.abs(bankDiff),50*dt);
        if(Math.abs(bt-S.bnk)<0.3) S.bnk=bt;
      }
      // GSPD 중 피치도 수평(0°)으로 수렴 — 지상속도 제어라 자세 지시 없음
      if (gspdOn && Math.abs(S.pit) > 0.05) {
        S.pit -= Math.sign(S.pit) * Math.min(Math.abs(S.pit), 15 * dt);
      }

      if (!acDragging) {
        let gsN, gsE;
        if (gspdOn || gspdCoasting) {
          // Body-frame motion. Convergence runs only while GSPD is
          // engaged; in coasting state we keep integrating at constant
          // body velocity until the next engagement.
          if (gspdOn) {
            // Rate is scaled by current actual speed magnitude so that
            // the last few kt slew at ~1 kt/sec for a smooth arrival.
            if (gspdRefLat !== null) {
              const dLat = gspdRefLat - gspdActLat;
              const rLat = gspdSlewRate(gspdActLat);
              gspdActLat += Math.sign(dLat) * Math.min(Math.abs(dLat), rLat * dt);
              if (Math.abs(gspdRefLat - gspdActLat) < 0.05) gspdActLat = gspdRefLat;
            }
            if (gspdRefFwd !== null) {
              const dFwd = gspdRefFwd - gspdActFwd;
              const rFwd = gspdSlewRate(gspdActFwd);
              gspdActFwd += Math.sign(dFwd) * Math.min(Math.abs(dFwd), rFwd * dt);
              if (Math.abs(gspdRefFwd - gspdActFwd) < 0.05) gspdActFwd = gspdRefFwd;
            }
          }
          // Body frame → ground frame (ignores wind; this is direct
          // ground-speed control)
          const ch = Math.cos(S.hdg * D2R), sh = Math.sin(S.hdg * D2R);
          gsN =  gspdActFwd * ch - gspdActLat * sh;
          gsE =  gspdActFwd * sh + gspdActLat * ch;
          // Keep S.spd in sync for the speed tape
          S.spd = Math.sqrt(gspdActFwd*gspdActFwd + gspdActLat*gspdActLat);
          // While coasting, bleed lateral velocity toward zero so the exit
          // condition (|gspdActLat| < 0.5) can eventually be reached without
          // re-engaging GSPD.
          if (gspdCoasting) {
            gspdActLat -= Math.sign(gspdActLat) * Math.min(Math.abs(gspdActLat), GSPD_RATE_SLOW * dt);
          }
          // Exit coasting once motion is representable in the base model
          // (no lateral, no aft). Hand off forward component to S.spd.
          if (gspdCoasting && Math.abs(gspdActLat) < 0.5 && gspdActFwd >= 0) {
            gspdCoasting = false;
            S.spd = Math.max(0, gspdActFwd);
          }
        } else {
          // Ground velocity = TAS vector + (effective) wind vector. The
          // effect factor is 0 in hover/low-speed regime (basic stabilization
          // holds heading) and ramps to 1 as IAS pushes into cruise, so the
          // helicopter only starts drifting once it is no longer in hover.
          const wt = normA(windDir + 180) * D2R;
          const wEff = effectiveWindSpd();
          gsN = S.spd * Math.cos(S.hdg * D2R) + wEff * Math.cos(wt);
          gsE = S.spd * Math.sin(S.hdg * D2R) + wEff * Math.sin(wt);
        }
        const sc = 1852/3600 * dt / 111320;
        S.lat += gsN * sc;
        S.lon += gsE * sc / Math.cos(S.lat * D2R);
        // Altitude update — hold modes override manual VS while engaged
        // G/S 를 잡고 있으면 고도는 강하선이 정한다(ALT 유지보다 앞선다).
        try { gsCaptureCheck(); } catch(e) { _swallow(e); }
        const _gs = gsOn ? gsDeviation() : null;
        if (_gs) {
          // 강하선 고도로 수렴시킨다. 기본 강하율은 지상속도와 강하각으로 정해지고
          // (3°·120kt ≈ 640fpm), 벗어난 만큼만 더 얹어 부드럽게 되돌아온다.
          const gsKt = Math.max(20, groundSpdKt());
          const base = gsKt * Math.tan(_gs.angle * D2R) * FT_PER_NM / 60;   // fpm
          const diff = _gs.path - S.alt;                                    // + = 더 올라야
          const corr = Math.max(-400, Math.min(400, diff * 0.5));           // fpm
          const vs = Math.max(-2000, Math.min(500, -base + corr));
          const step = vs / 60 * dt;
          S.alt = Math.max(0, Math.min(45000, S.alt + step));
          S.vs = vs;
        } else if (altHoldOn) {
          // ALT hold: converge S.alt → selAlt at the pilot-set selVS rate.
          // Sign of climb/descent is determined automatically from the
          // current altitude relative to the target.
          const diff = selAlt - S.alt;
          if (Math.abs(diff) < 0.5) { S.alt = selAlt; S.vs = 0; }
          else {
            const rate = Math.max(50, Math.abs(selVS));   // fpm magnitude
            const step = Math.sign(diff) * Math.min(Math.abs(diff), rate / 60 * dt);
            S.alt = Math.max(0, Math.min(45000, S.alt + step));
            S.vs  = Math.sign(diff) * rate;
          }
        } else if (S.vs !== 0) {
          S.alt = Math.max(0, Math.min(45000, S.alt + S.vs / 60 * dt));
        }

        // Coordinated turn: bank angle drives heading change (g·tan(bank)/V).
        if (Math.abs(S.bnk) > 0.5 && !gspdOn && !gspdCoasting) {
          const V_ms = Math.max(10, S.spd) * 0.5144;
          const turnRate = 9.81 * Math.tan(S.bnk * D2R) / V_ms / D2R;  // °/s
          S.hdg = normA(S.hdg + turnRate * dt);
        }

        // Update body-frame actual readout while hover page is on. Skip when
        // GSPD is engaged or coasting — both already integrate the body
        // velocity directly. The readout shows controlled body-frame intent
        // (S.spd along heading), so wind drift is intentionally absent from
        // the Actual display — the helicopter is still drifting in the
        // base motion model, but the readout reflects only what is being
        // commanded, not transient wind effects.
        if (hoverPageOn && !gspdOn && !gspdCoasting) {
          gspdActLat = 0;
          gspdActFwd = S.spd;
        }

        const last=S.trail[S.trail.length-1];
        if(!last||distance(last[0],last[1],S.lat,S.lon)>0.04){
          S.trail.push([S.lat,S.lon]);
          if(S.trail.length>600) S.trail.shift();
          updateTrail();
        }
      }
      updateAcOnMap();updateNav();

      // FMS waypoint sequencing (fly-by when NAV AP active)
      // 활성 웨이포인트에 홀딩이 걸려 있으면(아직 진입 전이라도) 시퀀싱하지 않는다.
      // TOFIX 상태만 제외하면, 픽스 통과 프레임에서 진입 판정보다 시퀀싱이 먼저
      // 돌아 "마지막 WP 통과" 로 NAV 가 해제되고 HDG 모드로 떨어진다.
      // SUSP 가 걸려 있으면 지나가도 넘어가지 않는다(홀딩이면 저절로 걸린다).
      if (S.awp >= 0 && !obsOn && !navSuspended()) {
        if (navApOn && navSrc === 'FMS' && S.awp + 1 < S.wps.length) {
          // Fly-by: anticipate turn toward next leg before reaching WP
          const nextLegCrs = bearing(S.wps[S.awp].lat, S.wps[S.awp].lon,
                                     S.wps[S.awp + 1].lat, S.wps[S.awp + 1].lon);
          // 현재 레그 코스는 활성 코스선의 WP 도달 시점 방위(대권 보정 포함)
          const _cl = activeCourseLine();
          const curLegCrs = _cl ? normA(bearing(_cl.to[0], _cl.to[1], _cl.from[0], _cl.from[1]) + 180)
                                : activeCrs();
          const anticipateDist = flyByAnticipationDist(nextLegCrs, curLegCrs);
          if (S.dtw < anticipateDist) { selectWP(S.awp + 1); }
        } else if (S.dtw < 0.25) {
          if (S.awp + 1 < S.wps.length) {
            selectWP(S.awp + 1);
          } else if (navApOn && navSrc === 'FMS' && !obsOn) {
            // Last WP passed in NAV AP mode — revert to HDG hold
            navApOn = false;
            document.getElementById('nav-ap-btn').classList.remove('on');
            bankTarget = 0;
            selHdg = ((Math.round(S.hdg) + 359) % 360) + 1; hdgSelOn = true;
          }
        }
      }

      // HDG SEL: 선택 헤딩까지 표준선회(속도의 16% 뱅크). NAV AP·GSPD가 우선.
      if (hdgSelOn && rollApOn && !navApOn && !gspdOn && !gspdCoasting) {
        const err  = normAS(selHdg - S.hdg);            // -180 ~ +180
        const bMax = stdRateBank(S.spd);
        const aErr = Math.abs(err);
        if (aErr < 0.5) { bankTarget = 0; S.hdg = normA(selHdg); }
        else {
          // 롤아웃 구간에서도 최소 뱅크를 유지 — 비행모델이 |bank|<=0.5°를 무시하므로
          // 그 아래로 떨어지면 선회가 멈춘 채 오차가 남는다(저속에서 발생)
          const b = aErr >= HDG_ROLLOUT_DEG ? bMax : Math.max(1.2, bMax * aErr / HDG_ROLLOUT_DEG);
          bankTarget = Math.sign(err) * b;
        }
      }

      // NAV AP: drive bankTarget for course tracking
      if (navApOn) {
        if (navSrc === 'FMS' && !obsOn && S.awp < 0) {
          // No active WP — disengage NAV AP
          navApOn = false;
          document.getElementById('nav-ap-btn').classList.remove('on');
          bankTarget = 0;
          selHdg = ((Math.round(S.hdg) + 359) % 360) + 1; hdgSelOn = true;
        } else {
          holdSyncFromWp();                  // 활성 WP 에 홀딩이 있으면 자동 무장
          const hb = holdBankTarget(dt);     // 홀딩 중이면 홀딩 로직이 우선
          bankTarget = (hb === null) ? navApBankTarget() : hb;
        }
      }

      // Update speed trend (6s extrapolation, smoothed)
      {
        const acc = (S.spd - _spdPrev) / dt;
        spdTrend += (acc * 6 - spdTrend) * Math.min(1, dt * 2);
        _spdPrev = S.spd;
      }
    }
    }
  } else if(!S.running){
    // bank snaps back to level even when not flying
    const bankDiff=bankTarget-S.bnk;
    if(Math.abs(bankDiff)>0.2) S.bnk+=Math.sign(bankDiff)*Math.min(Math.abs(bankDiff),60/60);
    else S.bnk=bankTarget;
  }

  S.lastT=ts;
  updateHoverBtns();
  try { updateSuspBtn(); } catch(e) { _swallow(e); }
  try { updateGsBtn(); } catch(e) { _swallow(e); }
  try { fpWptLiveTick(ts); } catch(e) { _swallow(e); }
  // 스톱워치에 흘려 넣을 시간 — 기체가 겪는 시간과 같아야 한다.
  // 배속이 걸리면 그만큼 빨리, 시뮬이 멈춰 있으면 함께 멈춘다.
  // GPS 모드는 실제 비행이므로 실시간으로 간다(여기서 멈추면 안 된다).
  if (_swPrevTs !== null) {
    const _swReal = ts - _swPrevTs;
    if (_swReal > 0 && _swReal < 2000) {
      swAddMs(gpsMode ? _swReal
            : S.running ? _swReal * simSpeed : 0);
    }
  }
  _swPrevTs = ts;
  swRender();
  // 발열 저감: GPS 모드(데이터 3초 주기)에서는 PFD를 10fps로 제한.
  // 시뮬 비행은 기존 60fps 유지.
  if (!gpsMode || performance.now() - _pfdDrawLast >= 100) {
    _pfdDrawLast = performance.now();
    // 자가치유: PFD가 보이는데 캔버스 크기가 표시영역과 어긋나면 재조정.
    // (풀스크린→분할 복귀 시 레이아웃이 늦게 잡혀 캔버스가 0크기로 남아
    //  PFD가 검게 되는 경우를 감지해 자동 복구)
    {
      // (PFD가 좌/우 어느 패널에 있든 clientHeight>0 이면 표시 중)
      const _pw = document.getElementById('pfd-wrap');
      if (_pw && _pw.clientHeight > 0 &&
          (cvs.width !== _pw.clientWidth || cvs.height !== _pw.clientHeight)) {
        resizePFD();
      }
    }
    drawPFD();
  }
  } catch(e) {
    // 한 프레임의 예외로 rAF 체인이 끊겨 PFD가 검게 멈추는 것을 방지
    console.warn('simStep error:', e);
  }
  requestAnimationFrame(simStep);
}
// 이중 안전장치: 루프가 어떤 이유로든 3초 이상 멈추면 재기동
// (백그라운드 탭에서는 rAF가 원래 멈추므로 visible일 때만, 중복 기동 방지 포함)
setInterval(() => {
  if (document.visibilityState === 'visible' && performance.now() - _simLastTick > 3000) {
    console.warn('simStep watchdog: 렌더 루프 재기동');
    _simLastTick = performance.now();
    requestAnimationFrame(simStep);
  }
}, 2000);

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
let currentPage = 0;
let leftPage = 0;
// 354×567 규격의 화면(CDU · Flight Plan)을 패널 크기에 맞춰 축소·중앙정렬
// CDU 화면(354×567 규격)이 패널 안에서 실제로 차지하는 사각형.
// 패널이 넓으면 좌우가, 높으면 위아래가 남는다(레터박스).
// CDU 화면들은 이 사각형 안에 그린다 — 차트 뷰어만 예외로 패널 전체를 쓴다.
function cduFrameRect(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return null;
  void wrap.offsetWidth;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return null;
  const s = Math.min(w / 354, h / 567);
  return { left: (w - 354*s)/2, top: (h - 567*s)/2, w: 354*s, h: 567*s, scale: s };
}
function _scaleFrame(wrapId, scalerId) {
  const scaler = document.getElementById(scalerId);
  const r = cduFrameRect(wrapId);
  if (!scaler || !r) return;
  scaler.style.transform = `translate(${r.left}px,${r.top}px) scale(${r.scale})`;
}
function scaleCdu() {
  _scaleFrame('cdu-wrap', 'cdu-scaler');
  _scaleFrame('fp-wrap',  'fp-scaler');   // Flight Plan도 같은 규격
}

// ── 화면 선택 — 한 번에 한 창만 띄운다 ────────────────────────────
// 이 앱은 폰·패드를 세로로 들고 쓴다. 그 폭에 창을 둘·셋 세우면 계기가
// 손바닥만 해져 읽을 수가 없다. 그래서 분할(2·3분할)을 두지 않는다 —
// PC 에서 열어도 마찬가지다.
//
// pfd-wrap / map-wrap / cdu-wrap 은 각 하나뿐이라, 고른 창을 보이는 패널로
// 옮기고 나머지는 접는다. 좌·우 두 패널이 남아 있는 것은 마크업 구조 때문이며
// (PFD·MAP 은 좌측, CDU·PLAN 은 우측), 동시에 보이는 일은 없다.
let leftSel = 'pfd', rightSel = 'map';   // 옛 호출부가 읽는 값(호환용)

function selectPanel(side, sel, force) {
  // 어느 쪽을 말하든 결국 그 창 하나를 띄운다(side 는 옛 호출부 호환용)
  setSolo(sel);
}

// 보이는 창에 맞춰 wrap 들을 제자리로 옮긴다
function applyPanels() {
  const L = document.getElementById('left-panel');
  const R = document.getElementById('right-panel');
  if (!L || !R) return;
  const cur = _soloCurrent || 'map';
  const wrapIds = { pfd: 'pfd-wrap', map: 'map-wrap', cdu: 'cdu-wrap' };
  ['pfd', 'map', 'cdu'].forEach(k => {
    const el = document.getElementById(wrapIds[k]);
    if (!el) return;
    const host = (k === 'cdu') ? R : L;
    if (el.parentElement !== host) host.appendChild(el);
    el.classList.toggle('page-hidden', k !== cur);
  });
  const fp = document.getElementById('fp-wrap');
  if (fp) fp.classList.toggle('page-hidden', cur !== 'plan');

  // 레거시 상태 동기화(옛 호출부가 읽는다)
  leftSel  = (cur === 'map') ? 'map' : 'pfd';
  rightSel = (cur === 'cdu' || cur === 'plan') ? cur : 'map';
  leftPage = cur === 'map' ? 1 : 0;
  currentPage = cur === 'map' ? 0 : cur === 'plan' ? 1 : cur === 'cdu' ? 2 : 0;

  requestAnimationFrame(() => { resizePFD(); drawPFD(); scaleCdu(); });
  setTimeout(() => {
    try { leafMap.invalidateSize(); } catch(e) { _swallow(e); }
    try { if (_ml3d) _ml3d.resize(); } catch(e) { _swallow(e); }
    scaleCdu();
  }, 60);
}

// 레거시 래퍼 — 기존 호출부(CDU 버튼 등) 호환
function setLeftPage(n) { setSolo(n === 0 ? 'pfd' : 'map'); }
function setPage(n) { setSolo(['map', 'plan', 'cdu'][n] || 'map'); }


// CDU 홈의 MAP 버튼 — MAP 창으로 갈아 끼운다.
function cduOpenMap() { setSolo('map'); }


// ══════════════════════════════════════════════════════
// RULER — 지도에서 두 점 이상을 찍어 거리·방위 측정
// ══════════════════════════════════════════════════════
let _rulerOn = false, _rulerPts = [], _rulerLayer = null;
// RULER_VAR(자기편차)는 HOVER PAGE 판독에서도 쓰이므로 D2R 옆(상단)에 선언한다.

function toggleRuler() {
  _rulerOn = !_rulerOn;
  const b = document.getElementById('map-ruler-btn');
  if (b) b.classList.toggle('ruler-active', _rulerOn);
  if (_rulerOn) {
    leafMap.on('click', _rulerClick);
    try { leafMap.getContainer().style.cursor = 'crosshair'; } catch(e) { _swallow(e); }
    _rulerRender();
  } else {
    leafMap.off('click', _rulerClick);
    try { leafMap.getContainer().style.cursor = ''; } catch(e) { _swallow(e); }
    _rulerClearAll();
  }
}
function _rulerClick(e) { _rulerPts.push([e.latlng.lat, e.latlng.lng]); _rulerRender(); }
function _rulerUndo() { _rulerPts.pop(); _rulerRender(); }
function _rulerReset() { _rulerPts = []; _rulerRender(); }
function _rulerClearAll() {
  _rulerPts = [];
  if (_rulerLayer) { try { leafMap.removeLayer(_rulerLayer); } catch(e) { _swallow(e); } _rulerLayer = null; }
  const el = document.getElementById('ruler-readout');
  if (el) el.style.display = 'none';
}
function _rulerRender() {
  if (_rulerLayer) { try { leafMap.removeLayer(_rulerLayer); } catch(e) { _swallow(e); } _rulerLayer = null; }
  const g = L.layerGroup();
  const P = _rulerPts;
  // 점 표시
  P.forEach((p, i) => {
    L.circleMarker(p, { radius: 4, color: '#ffd54f', weight: 2, fillColor: '#000', fillOpacity: 1, interactive: false }).addTo(g);
    if (i === 0) L.marker(p, { interactive: false, icon: L.divIcon({ className:'', iconSize:[0,0],
      html:`<div style="transform:translate(6px,-16px);color:#ffd54f;font-size:9px;font-weight:bold;text-shadow:1px 1px 2px #000;">START</div>` }) }).addTo(g);
  });
  let total = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i-1], b = P[i];
    const d = distance(a[0], a[1], b[0], b[1]);
    const brg = bearing(a[0], a[1], b[0], b[1]);
    total += d;
    L.polyline([a, b], { color: '#ffd54f', weight: 2, opacity: 0.95, dashArray: '6 4', interactive: false }).addTo(g);
    // 구간 라벨(중점)
    const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
    L.marker(mid, { interactive: false, icon: L.divIcon({ className:'', iconSize:[0,0],
      html:`<div style="transform:translate(-50%,-50%);background:rgba(8,10,14,0.85);border:1px solid #ffd54f88;border-radius:3px;` +
           `padding:1px 4px;color:#ffd54f;font-size:9px;font-weight:bold;white-space:nowrap;">` +
           `${fmtA(toMag(brg))}° · ${d.toFixed(1)}NM</div>` }) }).addTo(g);
  }
  _rulerLayer = g.addTo(leafMap);

  // 판독창
  const el = document.getElementById('ruler-readout');
  if (!el) return;
  if (!_rulerOn) { el.style.display = 'none'; return; }
  const R = (l, v) => `<div class="rr-row"><span class="rr-lbl">${l}</span><span class="rr-val">${v}</span></div>`;
  let html = '';
  if (P.length < 2) {
    html = `<div style="color:#8a9aa8;font-size:10px;line-height:1.5;">지도를 탭해 점을 찍으세요.<br>두 점 이상이면 거리·방위가 표시됩니다.</div>`;
  } else {
    const a = P[P.length-2], b = P[P.length-1];
    const legD = distance(a[0], a[1], b[0], b[1]);
    const legB = bearing(a[0], a[1], b[0], b[1]);
    const magB = ((Math.round(legB - RULER_VAR) % 360) + 360) % 360;
    html = R('구간 방위', `${String(Math.round(legB)).padStart(3,'0')}°T / ${String(magB).padStart(3,'0')}°M`)
         + R('구간 거리', `${legD.toFixed(2)} NM`)
         + R('합계', `${total.toFixed(2)} NM · ${(total*1.852).toFixed(2)} km`);
    if (P.length > 2) {
      const dd = distance(P[0][0], P[0][1], b[0], b[1]);
      html += R('직선(시작→끝)', `${dd.toFixed(2)} NM`);
    }
  }
  html += `<div class="rr-btns"><button data-act="_rulerUndo">⟲ 취소</button>` +
          `<button data-act="_rulerReset">↺ 초기화</button>` +
          `<button data-act="toggleRuler">✕ 닫기</button></div>`;
  el.innerHTML = html;
  el.style.display = 'block';
}

// 창 전환 뒤에 딸려 오는 일들 — 종전 updateSoloBtn 이 하던 자리다.
// 분할이 없어져 '단독 ⇄ 분할' 버튼은 사라졌지만, 창이 바뀔 때마다 해야 하는
// 일은 그대로 남는다(상단 탭 표시 갱신, 지도 라인 셀렉터 다시 재기).
function updateSoloBtn() {
  try { if (typeof updateNavBar === 'function') updateNavBar(); } catch(e) { _swallow(e); }
  // 지도가 새로 자리를 잡으면 라인 셀렉터 칸도 다시 잰다(접혀 있을 때는 못 잰다)
  try { if (typeof layoutMapLsk === 'function') setTimeout(layoutMapLsk, 80); } catch(e) { _swallow(e); }
}

// Flight Plan 하단 Home 버튼 — CDU 홈 화면으로 전환
function fpGoCduHome() {
  setSolo('cdu');
  try { switchMode('HOME'); } catch(e) { _swallow(e); }
}

// PLAN 버튼 — Flight Plan 화면 열기
function openFlightPlan() {
  // 직전에 PROC(IFR) 등을 열어 fpMode가 남아있으면 플랜 목록으로 되돌림
  try { fpMode = 'LIST'; fpRender(); } catch(e) { _swallow(e); }
  setSolo('plan');
}
// Flight Plan 화면의 BACK — CDU(직전 화면)로 복귀
function fpBackToCdu() { setSolo('cdu'); }
// 표준 CDU 푸터: HOME · FULL/HALF · PLAN · BACK (+ 필요 시 Enter 등 extra)
// backOnclick이 비어있으면 BACK 버튼은 생략(예: HOME 화면)
// back 인자는 두 가지를 받는다.
//   · 문자열 : 인라인 onclick 으로 그대로 넣는다(전역 함수만 가능).
//   · 함수   : data-act 위임으로 실행한다. CDU 캡슐화 IIFE 안의 함수(clBack 등)는
//             전역에 없어 인라인 onclick 으로는 "not defined" 가 나므로 이쪽을 써야 한다.
let _cduBackFn = null;
function cduFooter(back, extra) {
  // FULL/HALF 자리는 없앴다 — 화면은 늘 하나뿐이라 오갈 곳이 없다
  let h = `<div class="nav-btn" data-act="switchMode" data-arg='["HOME"]'><span>🏠</span>Home</div>`
        + `<div class="nav-btn" data-act="switchMode" data-arg='["SETTINGS"]'><span>⚙</span>Setting</div>`;
  if (extra) h += extra;
  // BACK은 항상 제일 우측
  if (typeof back === 'function') {
    _cduBackFn = back;
    h += `<div class="nav-btn" data-act="cduBack"><span>↩</span>Back</div>`;
  } else if (back) {
    h += `<div class="nav-btn" onclick="${back}"><span>↩</span>Back</div>`;
  }
  return h;
}

// ══════════════════════════════════════════════════════
// 화면 전환 — 한 번에 한 창
// ══════════════════════════════════════════════════════
// 분할이 없으므로 '단독' 이라는 별도 상태가 없다. 늘 한 창만 떠 있고,
// setSolo(screen) 이 그 창을 갈아 끼운다. _soloActive 는 늘 참이다 —
// 옛 호출부가 이 값을 보고 갈래를 나누던 자리가 아직 남아 있어 그대로 둔다.
const _soloActive = true;
let _soloCurrent = 'map';

function setSolo(screen) {
  _soloCurrent = screen;
  const leftPanel  = document.getElementById('left-panel');
  const rightPanel = document.getElementById('right-panel');
  if (!leftPanel || !rightPanel) return;

  // PFD·MAP 은 좌측 패널, CDU·PLAN 은 우측 패널에 들어 있다. 쓰는 쪽만 펴고
  // 나머지는 접는다(마크업이 그렇게 짜여 있을 뿐, 나란히 보이는 일은 없다).
  const useRight = (screen === 'cdu' || screen === 'plan');
  const show = useRight ? rightPanel : leftPanel;
  const hide = useRight ? leftPanel  : rightPanel;
  hide.classList.remove('solo-panel-visible');
  hide.style.display = 'none';
  show.style.display = '';
  show.classList.add('solo-panel-visible');
  document.body.classList.add('solo-mode');

  applyPanels();

  if (screen === 'pfd') {
    void leftPanel.offsetHeight;
    resizePFD();
  } else if (screen === 'map') {
    setTimeout(() => { try { leafMap.invalidateSize(); } catch (e) { _swallow(e); } }, 80);
  } else {
    setTimeout(() => { try { scaleCdu(); } catch (e) { _swallow(e); } }, 80);
  }
  updateSoloBtn();
  _refreshCduFooters();
}

// 창이 바뀌면 CDU·Flight Plan 푸터를 다시 그린다
function _refreshCduFooters() {
  try { renderCduContent(); } catch (e) { _swallow(e); }
  try { if (typeof fpRender === 'function') fpRender(); } catch (e) { _swallow(e); }
}

