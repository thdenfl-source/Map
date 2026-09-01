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
      if (altHoldOn || crhtOn) {
        // Hold mode active: VS ▲/▼ adjusts the convergence rate preselect.
        // altHoldOn uses selVS directly; crhtOn uses fixed 500 fpm but
        // pre-setting selVS here means it takes effect if ALT hold is engaged next.
        selVS = Math.max(50, Math.min(3000, selVS + d));
      } else {
        S.vs = Math.max(-3000, Math.min(3000, S.vs + d));
      }
      break;
    case 'alt':
      // ALT +/- now adjusts the AFCS target (selAlt). Auto-engages ALT hold so
      // S.alt converges to the new target at selVS rate. Disengages CRHT.
      selAlt    = Math.max(0, Math.min(45000, selAlt + d));
      altHoldOn = true;
      crhtOn    = false;
      updateHoverBtns();
      break;
    case 'crht':
      // CRHT +/- adjusts selCrht in fine 10 ft steps. Auto-engages CRHT hold.
      selCrht   = Math.max(0, Math.min(45000, selCrht + d));
      crhtOn    = true;
      altHoldOn = false;
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
// 7/8: VS ∓10fpm · 9/0: ALT ∓10ft · -/=: CRHT ∓10ft
// 키를 누르고 있으면 OS 키 반복으로 연속 조작. 입력창 포커스 중에는 무시.
const _keyMap = {
  '1': ['spd', -1],  '2': ['spd', 1],
  '3': ['hdg', -1],  '4': ['hdg', 1],
  '5': ['crs', -1],  '6': ['crs', 1],
  '7': ['vs', -10],  '8': ['vs', 10],
  '9': ['alt', -10], '0': ['alt', 10],
  '-': ['crht', -10], '=': ['crht', 10],
};
// 물리 키보드 단축키(DeX·데스크톱에서 오작동 시 설정에서 끌 수 있음)
let kbdShortcuts = true;
try { kbdShortcuts = localStorage.getItem('kbdShortcuts') !== '0'; } catch(e) { _swallow(e); }
function toggleKbdShortcuts() {
  kbdShortcuts = !kbdShortcuts;
  try { localStorage.setItem('kbdShortcuts', kbdShortcuts ? '1' : '0'); } catch(e) { _swallow(e); }
  stopAllHolds();
}
document.addEventListener('keydown', e => {
  if (!kbdShortcuts) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const m = _keyMap[e.key];
  if (!m) return;
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
  'crht-dn':['crht',-10],'crht-up':['crht',10],
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

function resetSim(){
  S.running=false;
  setSimSpeed(1);            // 리셋하면 실시간으로 돌아온다
  updateFlyBtns();
  S.trail=[];trailLine.setLatLngs([]);_update3dTrail();S.lastT=null;
  updateAcOnMap();
}

let _swPrevTs = null;   // 스톱워치에 시간을 흘려 넣기 위한 직전 프레임 시각
let _simLastTick = 0;   // 렌더 루프 생존 감시용
let _pfdDrawLast = 0;   // GPS 모드 PFD 10fps 제한용
function simStep(ts){
  _simLastTick = performance.now();
  try {
  if(S.running && !gpsMode && !_fdrPlaying && S.lastT!==null){
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
        if (altHoldOn) {
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
        } else if (crhtOn) {
          // CRHT hold: always 500 fpm — rate is NOT user-configurable.
          const diff = selCrht - S.alt;
          if (Math.abs(diff) < 0.5) { S.alt = selCrht; S.vs = 0; }
          else {
            const step = Math.sign(diff) * Math.min(Math.abs(diff), 500 / 60 * dt);
            S.alt = Math.max(0, Math.min(45000, S.alt + step));
            S.vs  = Math.sign(diff) * 500;
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
      if (S.awp >= 0 && !obsOn && !holdOn) {
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

  // Ship movement (wind-independent)
  if (shipVisible && shipMarker && shipSpd > 0 && S.lastT !== null) {
    const sdt = (ts - S.lastT) / 1000 * simSpeed;   // 배가 항공기와 같은 시간을 흐르게
    if (sdt > 0 && sdt < 0.5 * simSpeed) {
      const [nLat, nLon] = destPoint(shipLat, shipLon, shipHdg, shipSpd * sdt / 3600);
      shipLat = nLat; shipLon = nLon;
      if (!shipDragging) shipMarker.setLatLng([shipLat, shipLon]);
      const slast = shipTrail[shipTrail.length - 1];
      if (!slast || distance(slast[0], slast[1], shipLat, shipLon) > 0.01) {
        shipTrail.push([shipLat, shipLon]);
        if (shipTrail.length > 600) shipTrail.shift();
        updateShipTrail();
      }
    }
  }
  S.lastT=ts;
  updateHoverBtns();
  try { fpWptLiveTick(ts); } catch(e) { _swallow(e); }
  // 스톱워치에 흘려 넣을 시간 — 기체가 겪는 시간과 같아야 한다.
  // 배속이 걸리면 그만큼 빨리, 시뮬이 멈춰 있으면 함께 멈춘다.
  // GPS 모드는 실제 비행이므로 실시간으로 간다(여기서 멈추면 안 된다).
  if (_swPrevTs !== null) {
    const _swReal = ts - _swPrevTs;
    if (_swReal > 0 && _swReal < 2000) {
      swAddMs(gpsMode ? _swReal
            : (S.running && !_fdrPlaying) ? _swReal * simSpeed : 0);
    }
  }
  _swPrevTs = ts;
  swRender();
  // 발열 저감: GPS 모드(데이터 3초 주기)에서는 PFD를 10fps로 제한.
  // 시뮬 비행·FDR 리플레이는 기존 60fps 유지.
  let _lowFps = false;
  if (gpsMode) _lowFps = !_fdrPlaying;
  if (!_lowFps || performance.now() - _pfdDrawLast >= 100) {
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

// ── 패널 선택 시스템: 좌/우 각각 PFD·MAP·CDU 중 하나를 표시 ──
// pfd-wrap/map-wrap/cdu-wrap 은 각 1개뿐 → 선택된 패널로 DOM 이동.
// 양쪽에 같은 창은 불가(사용자 클릭은 거부 피드백, 프로그램 호출은 스왑).
let leftSel = 'pfd', rightSel = 'map';   // 'pfd' | 'map' | 'cdu' | (우측 한정 'plan')
let midSel  = 'map';                    // 3분할일 때만 사용하는 중앙 패널
let tripleMode = false;                 // 3분할(PFD·MAP·CDU) 여부
try { tripleMode = localStorage.getItem('tripleMode') === '1'; } catch(e) { _swallow(e); }

// 3분할 분할 비율 [좌%, 중%] — null 이면 기본 배분(PFD 호스트 1.4배)
const TRI_MIN = 12;                     // 한 창의 최소 비율(%)
let triRatio = null;
try {
  const s = JSON.parse(localStorage.getItem('triSplit') || 'null');
  if (Array.isArray(s) && s.length === 2 && s.every(v => typeof v === 'number')) triRatio = s;
} catch(e) { _swallow(e); }

// 기본 3분할 배분 — PFD 가 있는 창만 FCP 조작부가 다 보이도록 1.4배
function triDefaultRatio() {
  const w = [leftSel, midSel, rightSel].map(s => s === 'pfd' ? 1.4 : 1);
  const t = w[0] + w[1] + w[2];
  return [w[0] / t * 100, w[1] / t * 100];
}
function applyTriRatio() {
  const app = document.getElementById('app');
  if (!app) return;
  const [l, m] = triRatio || triDefaultRatio();
  app.style.setProperty('--tri-l', l.toFixed(3) + '%');
  app.style.setProperty('--tri-m', m.toFixed(3) + '%');
}
function saveTriRatio() {
  try { localStorage.setItem('triSplit', JSON.stringify(triRatio)); } catch(e) { _swallow(e); }
}

// 3분할 ⇄ 2분할 전환. 3분할 진입 시 PFD·MAP·CDU를 좌·중·우로 배치한다.
function toggleTriple(on) {
  tripleMode = (on === undefined) ? !tripleMode : !!on;
  try { localStorage.setItem('tripleMode', tripleMode ? '1' : '0'); } catch(e) { _swallow(e); }
  if (tripleMode) { leftSel = 'pfd'; midSel = 'map'; rightSel = 'cdu'; }
  else {
    // 2분할 복귀: 가운데 창을 우측으로 접는다(PFD·MAP·CDU → PFD·MAP)
    if (midSel && midSel !== leftSel) rightSel = midSel;
    if (rightSel === leftSel) rightSel = leftSel === 'map' ? 'cdu' : 'map';
  }
  applyPanels();
}

function selectPanel(side, sel, force) {
  const get = k => k === 'left' ? leftSel : k === 'mid' ? midSel : rightSel;
  const set = (k, v) => { if (k === 'left') leftSel = v; else if (k === 'mid') midSel = v; else rightSel = v; };
  const sides = tripleMode ? ['left', 'mid', 'right'] : ['left', 'right'];
  if (!sides.includes(side)) side = 'right';
  // 같은 창을 이미 다른 패널이 갖고 있으면 서로 맞바꾼다(창이 사라지지 않게)
  const holder = sides.find(k => k !== side && get(k) === sel);
  if (holder) set(holder, get(side));
  set(side, sel);
  applyPanels();
}

function applyPanels() {
  const L = document.getElementById('left-panel');
  const M = document.getElementById('mid-panel');
  const R = document.getElementById('right-panel');
  const app = document.getElementById('app');
  app.classList.toggle('triple', tripleMode);
  const btn = document.getElementById('split-toggle');
  if (btn) btn.textContent = tripleMode ? '⿰ 2분할' : '⿲ 3분할';

  const wrapIds = { pfd: 'pfd-wrap', map: 'map-wrap', cdu: 'cdu-wrap' };
  ['pfd', 'map', 'cdu'].forEach(k => {
    const el = document.getElementById(wrapIds[k]);
    const host = leftSel === k ? L : (tripleMode && midSel === k ? M : (rightSel === k ? R : null));
    if (host && el.parentElement !== host) host.appendChild(el);
    el.classList.toggle('page-hidden', !host);
  });
  // PLAN(fp-wrap)은 우측 전용 내부 페이지(CDU FPL 버튼 등으로 진입)
  document.getElementById('fp-wrap').classList.toggle('page-hidden', rightSel !== 'plan');

  // PFD 호스트 패널은 FCP 조작부가 다 보이도록 넓게(2분할 55% / 3분할 1.4배)
  L.classList.toggle('pfd-host', leftSel === 'pfd');
  M.classList.toggle('pfd-host', tripleMode && midSel === 'pfd');
  R.classList.toggle('pfd-host', rightSel === 'pfd');

  // 탭 활성 표시
  document.querySelectorAll('#left-tabs [data-sel]').forEach(b =>
    b.classList.toggle('active', b.dataset.sel === leftSel));
  document.querySelectorAll('#mid-tabs [data-sel]').forEach(b =>
    b.classList.toggle('active', b.dataset.sel === midSel));
  document.querySelectorAll('#page-tabs [data-sel]').forEach(b =>
    b.classList.toggle('active', b.dataset.sel === rightSel));

  // 레거시 상태 동기화(솔로 모드 진입 판단 등에서 사용)
  leftPage = leftSel === 'map' ? 1 : 0;
  currentPage = rightSel === 'map' ? 0 : rightSel === 'plan' ? 1 : rightSel === 'cdu' ? 2 : 0;

  // 3분할은 --tri-l/--tri-m 로 배분한다(2분할의 인라인 flex 는 무효화)
  if (tripleMode) { L.style.flex = ''; applyTriRatio(); }
  // 크기 재계산
  requestAnimationFrame(() => { resizePFD(); drawPFD(); scaleCdu(); });
  setTimeout(() => {
    try { leafMap.invalidateSize(); } catch(e) { _swallow(e); }
    try { if (_ml3d) _ml3d.resize(); } catch(e) { _swallow(e); }
    scaleCdu();
  }, 60);
}

// 레거시 래퍼 — 기존 호출부(CDU 버튼·솔로 모드 등) 호환
function setLeftPage(n) { selectPanel('left', n === 0 ? 'pfd' : 'map', true); }
function setPage(n) { selectPanel('right', ['map', 'plan', 'cdu'][n] || 'map', true); }

// ── 분할 비율 조절: 경계선 그립을 드래그(좌우/위아래) ──
// 2분할: 좌측 패널에 인라인 flex-basis를 지정(pfd-host 55% 규칙보다 우선)
// 3분할: 두 경계선을 각각 드래그. 인접한 두 창만 서로 크기를 주고받는다.
(function initDividerDrag() {
  const grip  = document.getElementById('divider-grip');
  const grip2 = document.getElementById('divider-grip-2');
  const app   = document.getElementById('app');
  const L     = document.getElementById('left-panel');
  if (!grip || !app || !L) return;

  // 좌측을 고정폭으로 두고, 우측은 남은 공간을 채우도록(split-custom) 전환
  const applyRatio = pct => { L.style.flex = `0 0 ${pct}%`; app.classList.add('split-custom'); };
  const afterResize = () => {
    requestAnimationFrame(() => { try { resizePFD(); drawPFD(); } catch(e) { _swallow(e); } });
    setTimeout(() => {
      try { leafMap.invalidateSize(); } catch(e) { _swallow(e); }
      try { if (_ml3d) _ml3d.resize(); } catch(e) { _swallow(e); }
      try { scaleCdu(); } catch(e) { _swallow(e); }
    }, 60);
  };

  // 저장된 비율 복원
  const saved = parseFloat(localStorage.getItem('splitRatio'));
  if (!isNaN(saved) && saved >= 25 && saved <= 75) applyRatio(saved);
  if (tripleMode) applyTriRatio();
  afterResize();

  // 포인터 위치를 앱 기준 0~100% 로
  const pctOf = e => {
    const r = app.getBoundingClientRect();
    return (r.width >= r.height)
      ? (e.clientX - r.left) / r.width * 100
      : (e.clientY - r.top) / r.height * 100;
  };

  // which: 1 = 좌|중 경계, 2 = 중|우 경계(3분할 전용)
  function bind(el, which) {
    if (!el) return;
    let dragging = false;
    el.addEventListener('pointerdown', e => {
      if (which === 2 && !tripleMode) return;
      e.preventDefault(); dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch(err) { _swallow(err); }
    });
    el.addEventListener('pointermove', e => {
      if (!dragging) return;
      const pct = pctOf(e);
      if (!tripleMode) {
        applyRatio(Math.max(25, Math.min(75, pct)));
      } else {
        const cur = triRatio || triDefaultRatio();
        let [l, m] = cur;
        if (which === 1) {
          // 좌|중 경계 — 좌·중이 서로 주고받고 우측 폭은 유지
          const edge = l + m;
          l = Math.max(TRI_MIN, Math.min(edge - TRI_MIN, pct));
          m = edge - l;
        } else {
          // 중|우 경계 — 중·우가 서로 주고받고 좌측 폭은 유지
          const edge = Math.max(l + TRI_MIN, Math.min(100 - TRI_MIN, pct));
          m = edge - l;
        }
        triRatio = [l, m];
        applyTriRatio();
      }
      try { resizePFD(); } catch(err) { _swallow(err); }
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (tripleMode) saveTriRatio();
      else {
        const mm = /0 0 ([\d.]+)%/.exec(L.style.flex || '');
        if (mm) try { localStorage.setItem('splitRatio', mm[1]); } catch(err) { _swallow(err); }
      }
      afterResize();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // 더블탭/더블클릭 → 기본 배분으로 되돌리기
    el.addEventListener('dblclick', () => {
      if (tripleMode) { triRatio = null; applyTriRatio(); saveTriRatio(); }
      else { L.style.flex = ''; app.classList.remove('split-custom');
             try { localStorage.removeItem('splitRatio'); } catch(err) { _swallow(err); } }
      afterResize();
    });
  }
  bind(grip, 1);
  bind(grip2, 2);
})();

// CDU 홈의 MAP 버튼 — 분할/전체화면 모두에서 MAP 창을 연다.
// 전체화면(solo)에서는 map-wrap이 숨겨진 좌측 패널에 있을 수 있어 setPage(0)로는
// 검은 화면이 되므로, solo 모드일 때는 solo MAP 화면으로 전환한다.
function cduOpenMap() {
  if (_soloActive) setSolo('map');
  else setPage(0);
}

// ══════════════════════════════════════════════════════
// 화면 터치 잠금 — 비행 중 오조작 방지 (길게 눌러 해제)
// ══════════════════════════════════════════════════════
const LOCK_HOLD_MS = 1200;
let _screenLocked = false;
function lockScreen() {
  _screenLocked = true;
  document.getElementById('lock-overlay').classList.add('on');
  const b = document.getElementById('lock-btn'); if (b) b.classList.add('locked');
  try { navigator.vibrate && navigator.vibrate(40); } catch(e) { _swallow(e); }
}
function unlockScreen() {
  _screenLocked = false;
  document.getElementById('lock-overlay').classList.remove('on');
  const b = document.getElementById('lock-btn'); if (b) b.classList.remove('locked');
  const f = document.getElementById('lock-unlock-fill'); if (f) f.style.width = '0%';
  const t = document.getElementById('lock-unlock-txt'); if (t) t.textContent = '길게 눌러 해제';
  try { navigator.vibrate && navigator.vibrate([40, 60, 40]); } catch(e) { _swallow(e); }
}
(function initScreenLock() {
  const btn  = document.getElementById('lock-unlock');
  const fill = document.getElementById('lock-unlock-fill');
  const txt  = document.getElementById('lock-unlock-txt');
  const ov   = document.getElementById('lock-overlay');
  if (!btn || !ov) return;
  let t0 = 0, raf = null;
  const stop = () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    t0 = 0; fill.style.width = '0%'; txt.textContent = '길게 눌러 해제';
  };
  const tick = () => {
    if (!t0) return;
    const el = performance.now() - t0;
    const p = Math.min(1, el / LOCK_HOLD_MS);
    fill.style.width = (p * 100) + '%';
    txt.textContent = p < 1 ? '해제 중…' : '해제';
    if (p >= 1) { stop(); unlockScreen(); return; }
    raf = requestAnimationFrame(tick);
  };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    try { btn.setPointerCapture(e.pointerId); } catch(err) { _swallow(err); }
    t0 = performance.now(); tick();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(ev =>
    btn.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); stop(); }));
  // 오버레이 자체는 모든 입력을 흡수(잠금 유지)
  ['pointerdown','pointerup','click','touchstart','touchmove','wheel'].forEach(ev =>
    ov.addEventListener(ev, e => { if (e.target === ov || e.target.id === 'lock-badge') { e.preventDefault(); e.stopPropagation(); } },
      { passive: false }));
})();

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

// MAP 상단 툴바의 FULL/HALF 토글 — 상황에 맞게 전체화면 진입/분할 복귀
function toggleMapFull() {
  if (_soloActive) { exitSolo(); return; }
  _soloActive = true;
  document.getElementById('solo-bar').style.display = 'flex';
  setSolo('map');
}

// Flight Plan 하단 Home 버튼 — CDU 홈 화면으로 전환
function fpGoCduHome() {
  if (_soloActive) setSolo('cdu');
  else setPage(2);
  try { switchMode('HOME'); } catch(e) { _swallow(e); }
}

// CDU 하단 Full 버튼 — 상단 Full Screen 탭과 동일하게 CDU 전체화면 진입
function cduFullScreen() {
  _soloActive = true;
  document.getElementById('solo-bar').style.display = 'flex';
  setSolo('cdu');
}

// ── CDU 하단 푸터 표준화 ──
// 전체화면(solo)일 땐 FULL → HALF(우측 상단 ✕와 동일: exitSolo)
function cduFullNavBtn() {
  return _soloActive
    ? `<div class="nav-btn" data-act="exitSolo"><span>✥</span>Half</div>`
    : `<div class="nav-btn" data-act="cduFullScreen"><span>✥</span>Full</div>`;
}
// PLAN 버튼 — Flight Plan 화면 열기(분할/전체화면 모두 대응)
function openFlightPlan() {
  // 직전에 PROC(IFR) 등을 열어 fpMode가 남아있으면 플랜 목록으로 되돌림
  try { fpMode = 'LIST'; fpRender(); } catch(e) { _swallow(e); }
  if (_soloActive) setSolo('plan'); else setPage(1);
}
// Flight Plan 화면의 FULL — 플랜을 전체화면으로
function planFullScreen() {
  _soloActive = true;
  document.getElementById('solo-bar').style.display = 'flex';
  setSolo('plan');
}
// Flight Plan 푸터용 FULL/HALF 버튼(solo 상태 반영)
function fpFullBtn() {
  return _soloActive
    ? `<div class="fp-nav-btn" data-act="exitSolo"><span>✥</span>Half</div>`
    : `<div class="fp-nav-btn" data-act="planFullScreen"><span>✥</span>Full</div>`;
}
// Flight Plan 화면의 BACK — CDU(직전 화면)로 복귀
function fpBackToCdu() {
  if (_soloActive) setSolo('cdu'); else setPage(2);
}
// 표준 CDU 푸터: HOME · FULL/HALF · PLAN · BACK (+ 필요 시 Enter 등 extra)
// backOnclick이 비어있으면 BACK 버튼은 생략(예: HOME 화면)
// back 인자는 두 가지를 받는다.
//   · 문자열 : 인라인 onclick 으로 그대로 넣는다(전역 함수만 가능).
//   · 함수   : data-act 위임으로 실행한다. CDU 캡슐화 IIFE 안의 함수(clBack 등)는
//             전역에 없어 인라인 onclick 으로는 "not defined" 가 나므로 이쪽을 써야 한다.
let _cduBackFn = null;
function cduFooter(back, extra) {
  let h = `<div class="nav-btn" data-act="switchMode" data-arg='["HOME"]'><span>🏠</span>Home</div>`
        + cduFullNavBtn()
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
// SOLO (단일화면) 모드
// ══════════════════════════════════════════════════════
let _soloActive = false;
let _soloCurrent = null;

function setSolo(screen) {
  _soloCurrent = screen;
  const leftPanel  = document.getElementById('left-panel');
  const rightPanel = document.getElementById('right-panel');
  const divider    = document.getElementById('panel-divider');

  // 모든 패널 숨기기
  leftPanel.classList.remove('solo-panel-visible');
  rightPanel.classList.remove('solo-panel-visible');
  leftPanel.style.display  = 'none';
  rightPanel.style.display = 'none';
  divider.style.display = 'none';
  document.body.classList.add('solo-mode');

  // solo-bar 버튼 강조
  document.querySelectorAll('#solo-bar button:not(.solo-exit)').forEach(b => {
    b.classList.toggle('solo-active', b.textContent.trim().toLowerCase() === screen);
  });

  if (screen === 'pfd') {
    // PFD = left-panel, leftPage=0
    leftPanel.style.display = '';
    leftPanel.classList.add('solo-panel-visible');
    setLeftPage(0);
    void leftPanel.offsetHeight;
    resizePFD();
  } else if (screen === 'map') {
    // MAP: left-panel에 배치 (setLeftPage(1) 방식)
    leftPanel.style.display = '';
    leftPanel.classList.add('solo-panel-visible');
    setLeftPage(1);
    setTimeout(() => leafMap.invalidateSize(), 80);
  } else if (screen === 'plan') {
    rightPanel.style.display = '';
    rightPanel.classList.add('solo-panel-visible');
    setPage(1);
    setTimeout(() => scaleCdu(), 80);   // Flight Plan도 354×567 규격이라 재스케일 필요
  } else if (screen === 'cdu') {
    rightPanel.style.display = '';
    rightPanel.classList.add('solo-panel-visible');
    setPage(2);
    setTimeout(() => scaleCdu(), 80);
  }
  // PFD 전체화면은 하단 푸터가 없으므로 떠 있는 HALF 버튼 표시
  // (MAP은 상단 툴바의 FULL/HALF 버튼 사용)
  const halfBtn = document.getElementById('solo-half-btn');
  if (halfBtn) halfBtn.classList.toggle('show', screen === 'pfd');
  // MAP 상단 툴바 버튼 라벨: 전체화면(map)일 때 HALF, 그 외 FULL
  const mapFullBtn = document.getElementById('map-full-btn');
  if (mapFullBtn) mapFullBtn.textContent = (screen === 'map') ? 'HALF' : 'FULL';
  _refreshCduFooters();   // FULL⇄HALF 라벨 갱신
}

// solo 상태 변화 시 CDU/Flight Plan 푸터를 다시 그려 FULL⇄HALF 반영
function _refreshCduFooters() {
  try { renderCduContent(); } catch (e) { _swallow(e); }
  try { if (typeof fpRender === 'function') fpRender(); } catch (e) { _swallow(e); }
}

function exitSolo() {
  _soloActive = false;
  _soloCurrent = null;
  document.getElementById('solo-bar').style.display = 'none';
  const halfBtn = document.getElementById('solo-half-btn');
  if (halfBtn) halfBtn.classList.remove('show');
  const mapFullBtn = document.getElementById('map-full-btn');
  if (mapFullBtn) mapFullBtn.textContent = 'FULL';
  document.body.classList.remove('solo-mode');

  const leftPanel  = document.getElementById('left-panel');
  const rightPanel = document.getElementById('right-panel');
  const divider    = document.getElementById('panel-divider');

  leftPanel.classList.remove('solo-panel-visible');
  rightPanel.classList.remove('solo-panel-visible');
  leftPanel.style.display  = '';
  rightPanel.style.display = '';
  divider.style.display = '';

  // 분할 화면 복귀 시 기본 배치: 좌측 PFD, 우측 MAP
  setLeftPage(0);
  setPage(0);
  _refreshCduFooters();   // FULL⇄HALF 라벨 갱신
  setTimeout(() => {
    leafMap.invalidateSize();
    resizePFD();
    scaleCdu();
  }, 80);
}

