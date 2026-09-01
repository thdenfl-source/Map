// ─────────────────────────────────────────────────────────────
// 12-joystick.js — 조종 장치(조이스틱 · 게임패드) 연동
//
// 브라우저 Gamepad API 로 물리 버튼을 시뮬레이터 동작에 잇는다.
// 조이스틱마다 버튼 번호가 제각각이라 '기본 배치' 를 고집하지 않는다 —
// 설정 화면에서 동작을 고르고 원하는 버튼을 누르면 그 자리에서 잡힌다.
// (표준 배치[mapping='standard'] 로 올라오는 패드에 한해 첫 연결 때만
//  흔한 배치를 미리 넣어 준다. 사용자가 한 번이라도 바꾸면 그 값을 쓴다.)
//
// 햇(HAT) 스위치는 기종에 따라 버튼으로도, 축으로도 올라온다. 그래서
// 축도 ±방향을 따로 다뤄 버튼과 똑같이 배정할 수 있게 했다.
// 축 중립값은 기종마다 0 이 아닐 수 있어(정지 상태 -1 인 햇 등) 연결
// 시점의 값을 중립으로 잡고 거기서 벗어난 양으로 판정한다.
// ─────────────────────────────────────────────────────────────

// 눌림 판정 문턱 — 아날로그 트리거(버튼 value)와 축에 같이 쓴다
const JOY_ON = 0.6, JOY_OFF = 0.35;   // 히스테리시스(떨림 방지)
const JOY_REPEAT_DELAY = 350, JOY_REPEAT_INT = 80;   // 화면 버튼 홀드와 같은 값

// kind — press: 누를 때 한 번 · hold: 누르는 동안 · repeat: 누른 뒤 연속
const JOY_ACTIONS = [
  { id: 'sim',    grp: '운항',   label: 'FLY / PAUSE',   kind: 'press',
    run: () => toggleSim() },
  { id: 'ftr',    grp: '운항',   label: 'FORCE TRIM',    kind: 'press',
    run: () => forceTrim() },
  { id: 'gspd',   grp: '운항',   label: 'GSPD (호버)',    kind: 'press',
    run: () => toggleGspd() },
  { id: 'hovpos', grp: '운항',   label: 'HOVER POSITION', kind: 'press',
    run: () => toggleHoverPosition() },
  { id: 'hovpage', grp: '운항', label: 'HOVER PAGE (호버 화면)', kind: 'press',
    run: () => toggleHoverPage() },

  { id: 'trimF',  grp: '트림',   label: '트림 ▲ (전/증속)', kind: 'hold',
    on: () => startTrimHold('F'), off: () => stopTrimHold() },
  { id: 'trimA',  grp: '트림',   label: '트림 ▼ (후/감속)', kind: 'hold',
    on: () => startTrimHold('A'), off: () => stopTrimHold() },
  { id: 'trimL',  grp: '트림',   label: '트림 ◀ (좌)',     kind: 'hold',
    on: () => startTrimHold('L'), off: () => stopTrimHold() },
  { id: 'trimR',  grp: '트림',   label: '트림 ▶ (우)',     kind: 'hold',
    on: () => startTrimHold('R'), off: () => stopTrimHold() },
  { id: 'pedL',   grp: '트림',   label: '페달 ◀ (좌)',     kind: 'repeat',
    run: () => applyDelta('yaw', -1) },
  { id: 'pedR',   grp: '트림',   label: '페달 ▶ (우)',     kind: 'repeat',
    run: () => applyDelta('yaw', 1) },

  { id: 'hdgDn',  grp: 'FCP',    label: 'HDG −',  kind: 'repeat', run: () => applyDelta('hdg', -1) },
  { id: 'hdgUp',  grp: 'FCP',    label: 'HDG +',  kind: 'repeat', run: () => applyDelta('hdg', 1) },
  { id: 'spdDn',  grp: 'FCP',    label: 'IAS −',  kind: 'repeat', run: () => applyDelta('spd', -1) },
  { id: 'spdUp',  grp: 'FCP',    label: 'IAS +',  kind: 'repeat', run: () => applyDelta('spd', 1) },
  { id: 'altDn',  grp: 'FCP',    label: 'ALT −',  kind: 'repeat', run: () => applyDelta('alt', -100) },
  { id: 'altUp',  grp: 'FCP',    label: 'ALT +',  kind: 'repeat', run: () => applyDelta('alt', 100) },
  { id: 'crhtDn', grp: 'FCP',    label: 'CRHT −', kind: 'repeat', run: () => applyDelta('crht', -10) },
  { id: 'crhtUp', grp: 'FCP',    label: 'CRHT +', kind: 'repeat', run: () => applyDelta('crht', 10) },
  { id: 'vsDn',   grp: 'FCP',    label: 'VS −',   kind: 'repeat', run: () => applyDelta('vs', -100) },
  { id: 'vsUp',   grp: 'FCP',    label: 'VS +',   kind: 'repeat', run: () => applyDelta('vs', 100) },
  { id: 'crsDn',  grp: 'FCP',    label: 'CRS −',  kind: 'repeat', run: () => applyDelta('crs', -1) },
  { id: 'crsUp',  grp: 'FCP',    label: 'CRS +',  kind: 'repeat', run: () => applyDelta('crs', 1) },

  { id: 'altHold', grp: 'AFCS',  label: 'ALT 유지',  kind: 'press', run: () => toggleAltHold() },
  { id: 'crht',    grp: 'AFCS',  label: 'CRHT 유지', kind: 'press', run: () => toggleCrht() },
  { id: 'navap',   grp: 'AFCS',  label: 'NAV (AP)',  kind: 'press', run: () => toggleNavAp() },
  { id: 'gs',      grp: 'AFCS',  label: 'G/S',       kind: 'press', run: () => toggleGs() },
  { id: 'susp',    grp: 'AFCS',  label: 'SUSP',      kind: 'press', run: () => toggleSusp() },
  { id: 'obs',     grp: 'AFCS',  label: 'OBS',       kind: 'press', run: () => toggleObs() },

  { id: 'follow',  grp: '지도',  label: '지도 추종',   kind: 'press', run: () => toggleFollow() },
  { id: 'orient',  grp: '지도',  label: 'HDG↑ / N↑',  kind: 'press', run: () => toggleMapOrient() },
  { id: 'zoomIn',  grp: '지도',  label: '확대',       kind: 'repeat', run: () => joyZoom(1) },
  { id: 'zoomOut', grp: '지도',  label: '축소',       kind: 'repeat', run: () => joyZoom(-1) },
];
const JOY_ACT_BY_ID = {};
JOY_ACTIONS.forEach(a => { JOY_ACT_BY_ID[a.id] = a; });

// ── 8방향 햇(HAT) 축 풀이 ──
// 축 하나에 여덟 방향이 실려 오는 기종(대개 축 9)의 표준 배열이다.
//   -1=▲ · -5/7=▲▶ · -3/7=▶ · -1/7=▼▶ · 1/7=▼ · 3/7=◀▼ · 5/7=◀ · 1=◀▲
// 즉 (v+1)×3.5 가 0…7 의 방향 번호가 된다. 쉬는 자리는 1 밖(3.2857 등)이다.
// 대각은 이웃한 두 방향을 함께 누른 것으로 다룬다 — 네 방향만 배정해 두면
// 대각에서 자연스럽게 두 동작이 함께 걸린다(실물 햇과 같은 느낌).
const JOY_HAT_DIRS = ['N', 'E', 'S', 'W'];
const JOY_HAT_LBL  = { N: '▲', E: '▶', S: '▼', W: '◀' };
const JOY_HAT_MAP  = [['N'], ['N', 'E'], ['E'], ['E', 'S'], ['S'], ['S', 'W'], ['W'], ['W', 'N']];
// 8등분 격자에만 나오는 값(±1/7 · ±3/7 · ±5/7)이 오면 그 축은 햇이다.
// 쉬는 자리를 1 밖으로 보내지 않는 기종(0 에서 쉬는 햇)을 이것으로 가려낸다.
// ±1 은 보통의 아날로그 축도 내는 값이라 판정 근거로 쓰지 않는다.
const JOY_HAT_ODD = [1 / 7, 3 / 7, 5 / 7];
function joyIsHatValue(v) {
  if (!Number.isFinite(v)) return false;
  if (Math.abs(v) > 1.05) return true;             // 쉬는 자리가 범위 밖(3.2857 등)
  return JOY_HAT_ODD.some(k => Math.abs(Math.abs(v) - k) < 0.02);
}
function joyHatDirs(v) {
  if (!Number.isFinite(v) || Math.abs(v) > 1.05) return [];
  const i = Math.round((v + 1) * 3.5);
  if (i < 0 || i > 7) return [];
  // 격자에서 많이 벗어난 값(아날로그 축)은 방향으로 보지 않는다
  if (Math.abs(v - (i / 3.5 - 1)) > 0.08) return [];
  return JOY_HAT_MAP[i];
}

function joyZoom(d) {
  try { if (typeof leafMap !== 'undefined' && leafMap) leafMap.setZoom(leafMap.getZoom() + d); }
  catch (e) { _swallow(e); }
}

// 표준 배치 패드용 첫 배정(사용자가 바꾸면 저장값이 이긴다)
const JOY_STD_BINDS = {
  b0: 'ftr',  b1: 'gspd', b2: 'altHold', b3: 'navap',
  b4: 'crsDn', b5: 'crsUp', b6: 'spdDn', b7: 'spdUp',
  b9: 'sim',
  b12: 'trimF', b13: 'trimA', b14: 'trimL', b15: 'trimR',
};

let joyOn = true;
try { joyOn = localStorage.getItem('joyOn') !== '0'; } catch (e) { _swallow(e); }
let joyBinds = {};
try { joyBinds = JSON.parse(localStorage.getItem('joyBinds') || 'null') || {}; } catch (e) { joyBinds = {}; }
let joyBindsSaved = false;
try { joyBindsSaved = localStorage.getItem('joyBinds') !== null; } catch (e) { _swallow(e); }

let joyPadName = '';          // 연결된 장치 이름(설정 화면 표시용)
let joyActiveIdx = -1;        // 지금 쓰고 있는 패드 번호(여러 대가 올라올 때)
let joyLastCode = '';         // 마지막으로 눌린 입력(설정 화면 표시용)
let joyCapture = null;        // 배정 대기 중인 동작 id
const _joyDown = {};          // code → { since, next }
const _joyNeutral = {};       // padIndex → 축 중립값 배열
const _joyHat = {};           // padIndex → { 축번호: true } 햇으로 판정된 축
let _joyRaf = null;

function joySave() {
  try { localStorage.setItem('joyBinds', JSON.stringify(joyBinds)); joyBindsSaved = true; }
  catch (e) { _swallow(e); }
}
function joyBindOf(actId) {
  for (const c in joyBinds) if (joyBinds[c] === actId) return c;
  return '';
}
function joyCodeLabel(code) {
  if (!code) return '';
  if (code[0] === 'b') return `버튼 ${code.slice(1)}`;
  if (code[0] === 'k') return `키 ${code.slice(1)}`;
  if (code[0] === 'h') {
    const d = code.replace(/^h\d+/, '');
    return `햇 ${code.slice(1, code.length - d.length)} ${JOY_HAT_LBL[d] || d}`;
  }
  return `축 ${code.slice(1, -1)} ${code.slice(-1)}`;
}
// 한 동작에는 입력 하나 — 같은 입력이 두 동작을 겸하지 않게 정리한다
function joySetBind(code, actId) {
  const old = joyBindOf(actId);
  if (old) delete joyBinds[old];
  if (code) joyBinds[code] = actId;
  joySave();
}
function joyClearBind(actId) {
  const c = joyBindOf(actId);
  if (c) { delete joyBinds[c]; joySave(); }
}
function joyBeginCapture(actId) { joyCapture = actId; joyLastCode = ''; }
function joyCancelCapture() { joyCapture = null; }
function toggleJoy() {
  joyOn = !joyOn;
  try { localStorage.setItem('joyOn', joyOn ? '1' : '0'); } catch (e) { _swallow(e); }
  if (!joyOn) joyReleaseAll();
}

// 연결이 끊기거나 기능을 끌 때 — 누르고 있던 동작을 반드시 놓는다
function joyReleaseAll() {
  try { Object.keys(_joyKeys).forEach(c => delete _joyKeys[c]); } catch (e) { _swallow(e); }
  Object.keys(_joyDown).forEach(code => {
    const a = JOY_ACT_BY_ID[joyBinds[code]];
    if (a && a.kind === 'hold' && a.off) { try { a.off(); } catch (e) { _swallow(e); } }
    delete _joyDown[code];
  });
}

function joyPads() {
  try {
    // 구형 사파리는 webkit 접두사만 있다
    const fn = navigator.getGamepads || navigator.webkitGetGamepads;
    if (!fn) return [];
    const g = fn.call(navigator);
    const list = Array.prototype.slice.call(g || []).filter(Boolean);
    // WebHID 로 직접 연 장치도 같은 패드로 취급한다(13-joyhid.js)
    try { const h = (typeof joyHidPad === 'function') ? joyHidPad() : null; if (h) list.push(h); }
    catch (e) { _swallow(e); }
    return list;
  } catch (e) { return []; }
}
function joyApiSupported() {
  return !!(navigator.getGamepads || navigator.webkitGetGamepads);
}
// 브라우저가 장치를 못 보여 주는 흔한 사정을 한 줄로 알려 준다.
// (연결은 됐는데 아무 반응이 없을 때 어디를 봐야 하는지가 늘 문제다)
function joyWhyNoPad() {
  if (!joyApiSupported()) return 'API_NONE';
  if (!window.isSecureContext) return 'INSECURE';
  if (!document.hasFocus()) return 'BLUR';
  return 'NO_INPUT';
}
// 그 패드에서 지금 무언가 움직이고 있는가(장치 고르기·진단에 쓴다)
function joyPadActive(p) {
  const neu = _joyNeutral[p.index] || [];
  const btn = (p.buttons || []).some(b => {
    const v = (typeof b === 'object') ? (b.value != null ? b.value : (b.pressed ? 1 : 0)) : b;
    return v >= JOY_ON;
  });
  if (btn) return true;
  return (p.axes || []).some((v, i) => {
    if (!Number.isFinite(v)) return false;
    const hat = (_joyHat[p.index] || {})[i];
    if (hat) return joyHatDirs(v).length > 0;
    return Math.abs(v - (Number.isFinite(neu[i]) ? neu[i] : 0)) >= JOY_ON;
  });
}

// 한 입력의 눌림/뗌을 처리한다. 배정 대기 중이면 동작 대신 배정으로 간다.
function _joyEdge(code, pressed, now) {
  const wasDown = !!_joyDown[code];
  if (pressed && !wasDown) {
    joyLastCode = code;
    if (joyCapture) { joySetBind(code, joyCapture); joyCapture = null; _joyDown[code] = { since: now, next: Infinity }; return; }
    const a = JOY_ACT_BY_ID[joyBinds[code]];
    _joyDown[code] = { since: now, next: now + JOY_REPEAT_DELAY };
    if (!a) return;
    try {
      if (a.kind === 'hold') a.on();
      else a.run();
    } catch (e) { _swallow(e); }
  } else if (!pressed && wasDown) {
    delete _joyDown[code];
    const a = JOY_ACT_BY_ID[joyBinds[code]];
    if (a && a.kind === 'hold' && a.off) { try { a.off(); } catch (e) { _swallow(e); } }
  } else if (pressed && wasDown) {
    const a = JOY_ACT_BY_ID[joyBinds[code]];
    if (!a || a.kind !== 'repeat') return;
    const st = _joyDown[code];
    if (now >= st.next) { st.next = now + JOY_REPEAT_INT; try { a.run(); } catch (e) { _swallow(e); } }
  }
}

// ── 키 이벤트로 올라오는 버튼(안드로이드) ──
// 안드로이드는 조종 장치의 버튼을 게임패드 버튼이 아니라 '키' 로 넘겨 주는
// 기종이 많다(축·햇만 Gamepad API 로 오고 버튼은 조용한 증상). 그래서 키도
// 같은 입력으로 받아 배정할 수 있게 한다. 배정한 키만 듣는다(배정 대기 제외).
const _joyKeys = {};              // code → true (지금 눌려 있는 키)
function joyKeyCode(e) { return 'k' + (e.code || e.keyCode); }
function _joyKeyTyping(t) {
  return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}
document.addEventListener('keydown', e => {
  if (!joyOn || e.repeat || _joyKeyTyping(e.target)) return;
  const code = joyKeyCode(e);
  if (!joyCapture && !joyBinds[code]) return;   // 배정하지 않은 키는 건드리지 않는다
  e.preventDefault();
  _joyKeys[code] = true;
  _joyEdge(code, true, (typeof performance !== 'undefined') ? performance.now() : 0);
});
document.addEventListener('keyup', e => {
  const code = joyKeyCode(e);
  if (!_joyKeys[code]) return;
  delete _joyKeys[code];
  _joyEdge(code, false, (typeof performance !== 'undefined') ? performance.now() : 0);
});

// 한 프레임분 폴링. 테스트에서 직접 부를 수 있게 시각을 인자로 받는다.
function joyPoll(now) {
  // 눌려 있는 키의 연속 동작(repeat)도 여기서 돈다 — 장치가 없어도 듣는다
  Object.keys(_joyKeys).forEach(code => _joyEdge(code, true, now));
  const pads = joyPads();
  if (!pads.length) { joyPadName = ''; joyActiveIdx = -1; joyReleaseAll(); return; }
  // 축 중립은 패드마다 따로 — 나중에 고르는 패드도 제 중립을 갖고 있어야 한다
  pads.forEach(q => {
    if (!_joyNeutral[q.index]) _joyNeutral[q.index] = Array.prototype.slice.call(q.axes || []);
  });
  // ── 쓸 패드 고르기 ──
  // 조종 장치 하나가 여러 대로 올라오는 기종이 있다(허브·복합 장치). 그때
  // 첫 번째가 아무 값도 내지 않는 껍데기면 종전에는 영영 조용했다.
  // 그래서 '지금 움직이고 있는' 패드로 옮겨 붙는다.
  let sel = pads.find(q => q.index === joyActiveIdx) || null;
  const live = pads.find(q => joyPadActive(q));
  if (live && (!sel || (live.index !== sel.index && !joyPadActive(sel)))) sel = live;
  if (!sel) sel = pads[0];
  if (sel.index !== joyActiveIdx) { joyReleaseAll(); joyActiveIdx = sel.index; }
  joyPadName = sel.id || '조종 장치';
  if (!joyOn) return;
  const p = sel;
  const neu = _joyNeutral[p.index];

  (p.buttons || []).forEach((b, i) => {
    const v = (typeof b === 'object') ? (b.value != null ? b.value : (b.pressed ? 1 : 0)) : b;
    const code = 'b' + i;
    const on = _joyDown[code] ? (v > JOY_OFF) : (v >= JOY_ON);
    _joyEdge(code, on, now);
  });
  const hat = _joyHat[p.index] || (_joyHat[p.index] = {});
  (p.axes || []).forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    // ── 8방향 햇이 축 하나로 올라오는 기종 ──
    // 쉬는 자리를 1 밖(대개 3.2857)으로 보내고, 눌린 방향은 -1…1 을 8등분해
    // 실어 보낸다. 그래서 ± 두 방향으로는 여덟 방향을 가릴 수 없다.
    // 한 번이라도 1 밖의 값이 오면 그 축은 햇으로 보고 방향으로 푼다.
    if (!hat[i] && joyIsHatValue(v)) {
      hat[i] = true;
      // 햇으로 판정되기 전에 ± 로 눌려 있었다면 그 자리에서 놓아 준다
      _joyEdge('a' + i + '+', false, now);
      _joyEdge('a' + i + '-', false, now);
    }
    if (hat[i]) {
      const dirs = joyHatDirs(v);
      JOY_HAT_DIRS.forEach(d => _joyEdge('h' + i + d, dirs.indexOf(d) >= 0, now));
      return;
    }
    const d = v - (Number.isFinite(neu[i]) ? neu[i] : 0);
    ['+', '-'].forEach(sgn => {
      const code = 'a' + i + sgn;
      const m = sgn === '+' ? d : -d;
      const on = _joyDown[code] ? (m > JOY_OFF) : (m >= JOY_ON);
      _joyEdge(code, on, now);
    });
  });
}

// ── 입력 진단 ──
// "왜 이 버튼이 안 잡히지" 를 눈으로 확인하려고 둔다. 지금 연결된 장치의
// 버튼/축 원값을 그대로 보여 주므로, 배정이 안 되는 입력이 무엇으로
// 올라오는지(어느 축에 어떤 값으로) 바로 알 수 있다.
function joyMonitor() {
  const pads = joyPads();
  if (!pads.length) {
    return { none: true, why: joyWhyNoPad(),
             api: joyApiSupported(), secure: !!window.isSecureContext, focus: document.hasFocus() };
  }
  const p = pads.find(q => q.index === joyActiveIdx) || pads[0];
  const hat = _joyHat[p.index] || {};
  const btns = [];
  (p.buttons || []).forEach((b, i) => {
    const v = (typeof b === 'object') ? (b.value != null ? b.value : (b.pressed ? 1 : 0)) : b;
    if (v > 0.2) btns.push({ i, v });
  });
  const axes = (p.axes || []).map((v, i) => ({ i, v, hat: !!hat[i] }));
  return { id: p.id || '', mapping: p.mapping || '', btns, axes, index: p.index,
           pads: pads.map(q => ({ index: q.index, id: q.id || '', act: joyPadActive(q) })) };
}

function _joyLoop() {
  try { joyPoll(performance.now()); } catch (e) { _swallow(e); }
  _joyRaf = requestAnimationFrame(_joyLoop);
}
function joyStart() { if (_joyRaf == null) _joyLoop(); }
function joyStop() { if (_joyRaf != null) { cancelAnimationFrame(_joyRaf); _joyRaf = null; } joyReleaseAll(); }

window.addEventListener('gamepadconnected', e => {
  try {
    const p = e.gamepad;
    delete _joyNeutral[p.index];
    delete _joyHat[p.index];
    // 표준 배치 패드이고 사용자가 아직 손대지 않았으면 흔한 배치를 넣어 준다
    if (!joyBindsSaved && p.mapping === 'standard') { joyBinds = Object.assign({}, JOY_STD_BINDS); joySave(); }
  } catch (err) { _swallow(err); }
  joyStart();
});
window.addEventListener('gamepaddisconnected', () => { joyReleaseAll(); });
// 이미 붙어 있는 장치도 있으므로(연결 이벤트는 첫 입력 뒤에 오는 브라우저가 있다)
// 처음부터 폴링을 돌린다 — 장치가 없으면 아무 일도 하지 않는다.
joyStart();
window.addEventListener('blur', joyReleaseAll);
