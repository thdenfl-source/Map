// ─────────────────────────────────────────────────────────────
// 14-navaid.js — 보조 항법장치(NAV AID) 모드
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
//
// 이 앱의 성격을 정하는 자리다. 종전에는 시뮬레이터(비행 물리를 돌려 기체를
// 조종)가 본체였고 GPS 는 곁다리 기능이었다. 지금은 반대다.
//
//   · 켜면 GPS 가 먼저 붙는다. 화면의 위치·속도·고도는 실제 측정값이다.
//   · 신호가 끊기면 마지막 대지속도·침로로 위치를 이어 그린다(추측항법 · DR).
//   · 기체를 조종하는 조작부(FCP·AFCS·트림·배속)는 화면에서 내린다.
//     코드는 남겨 두되 ?sim=1 로만 다시 꺼낼 수 있다(개발·회귀시험용).
//   · 기본 화면은 스마트폰이다. 한 창(MAP)만 띄우고 하단 탭으로 옮겨 다닌다.
//     태블릿·데스크톱은 종전대로 2·3분할을 쓴다.
//
// 이 파일이 마지막에 로드되는 이유: 07-sim.js 가 파일 끝에서 applyPanels() 로
// 태블릿 기준 배치를 이미 그려 놓기 때문이다. 폰 배치는 그 위에 덮어야 한다.
// ─────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════
// 앱 성격 — 항법 보조(기본) · 시뮬 조작부(숨김)
// ══════════════════════════════════════════════════════
// 조작부를 다시 꺼내는 길은 둘뿐이다. 일반 사용자는 마주칠 일이 없다.
//   · 주소에 ?sim=1
//   · localStorage.setItem('simPanel','1')
let simPanelOn = false;
try {
  simPanelOn = /[?&]sim=1/.test(location.search) || localStorage.getItem('simPanel') === '1';
} catch (e) { _swallow(e); }
if (simPanelOn) { try { localStorage.setItem('simPanel', '1'); } catch (e) { _swallow(e); } }
document.body.classList.toggle('navaid', !simPanelOn);

// ══════════════════════════════════════════════════════
// 화면 배치 — 늘 한 창
// ══════════════════════════════════════════════════════
// 이 앱은 폰·패드를 세로로 들고 쓰는 물건이다. 그 폭에 창을 둘·셋 세우면
// 계기가 손바닥만 해져 읽을 수가 없다. 분할은 두지 않는다 — PC 에서 열어도
// 마찬가지다. 창은 상단 탭으로 갈아 끼운다.
const PHONE_SCREENS = ['map', 'pfd', 'plan', 'cdu'];

// 마지막으로 보던 창 — 다시 켜면 그 자리에서 시작한다
function phoneStartScreen() {
  let v = null;
  try { v = localStorage.getItem('phoneScreen'); } catch (e) { _swallow(e); }
  return PHONE_SCREENS.includes(v) ? v : 'map';
}

// 상단 탭 — 창을 통째로 갈아 끼운다
function navGo(screen) {
  if (!PHONE_SCREENS.includes(screen)) screen = 'map';
  try { localStorage.setItem('phoneScreen', screen); } catch (e) { _swallow(e); }
  setSolo(screen);
  updateNavBar();
  try { fitAppViewport(); } catch (e) { _swallow(e); }
}

function updateNavBar() {
  const bar = document.getElementById('phone-bar');
  if (!bar) return;
  bar.querySelectorAll('[data-nav]').forEach(b =>
    b.classList.toggle('active', _soloCurrent === b.dataset.nav));
}

// 계기 글씨 배율 — 좁은 화면에서는 테이프 폭이 최소값에 걸려 글씨도 하한에
// 붙는다. 그냥 두면 읽히지 않아 배율을 걸어 준다. 넓게 열면 되돌린다.
const PHONE_FONT_SCALE = 1.25;
const NARROW_MAX = 900;         // 이보다 좁으면 글씨를 키운다
function applyDeviceLayout() {
  // 화면은 늘 한 창이다. phone-mode 는 '좁은 화면 배치' 라는 뜻으로 남는다 —
  // 이 앱은 항상 그 배치를 쓰므로 늘 켜 둔다.
  document.body.classList.add('phone-mode');
  const narrow = Math.min(window.innerWidth, window.innerHeight) < NARROW_MAX;
  try { setPfdFontScale(narrow ? PHONE_FONT_SCALE : 1); } catch (e) { _swallow(e); }
  if (!_soloCurrent) setSolo(phoneStartScreen());
  updateNavBar();
}

// ── 화면을 실제 보이는 높이에 맞춘다 ─────────────────────────────
// html·body 를 height:100% 로 두면 기준이 흔들린다. 모바일 브라우저는 주소창을
// 접었다 폈다 하는데, 그때마다 100% 가 가리키는 높이가 달라진다. 처음 켤 때
// 특히 어긋나서 계기가 화면을 다 채우지 못했다(기기 세로 길이에 따라 다르게
// 보였던 것이 이 때문이다).
//
// 그래서 두 값을 재서 넣는다.
//   --app-h        지금 실제로 보이는 높이(visualViewport 가 있으면 그쪽이 정확하다)
//   --phone-bar-h  폰 탭바가 실제로 차지한 높이(글꼴·안전영역에 따라 달라진다)
// 재서 넣지 않고 px 로 못 박으면 기기마다 아래가 잘리거나 검은 띠가 남는다.
// ── PFD 조작부의 REC — 자리가 있을 때만 세운다 ────────────────────
// 계기는 (패널 높이 − 조작부 높이) 안에 그려진다(03-pfd.js drawPFD). 조작부가
// 버튼 하나 때문에 한 줄 늘면 계기가 그만큼 눌린다 — 나침반을 몇 %씩 키워 온
// 자리라 그 대가는 크다. 그렇다고 폭이 넉넉한 기기에서까지 버튼을 안 둘 이유도
// 없다. 그래서 폭을 재서 정한다(기기 폭을 미리 못 박지 않는다 — 글꼴·안전영역·
// 배속 버튼 유무에 따라 같은 폭에서도 줄이 달라진다).
//   ① 'REC' 글자 그대로 들어가면 그대로 둔다
//   ② 줄이 늘면 ● 만 남겨 좁혀 본다
//   ③ 그래도 늘면 세우지 않는다 — 지도 아래 REC 은 그대로 있다
function fitPfdRecBtn() {
  const g = document.querySelector('.rec-group');
  const bar = document.querySelector('.ctrl-bar');
  const btn = document.getElementById('pfd-rec-btn');
  if (!g || !bar || !btn) return;
  const H = () => bar.getBoundingClientRect().height;
  g.style.display = 'none';
  btn.classList.remove('rec-compact');
  const base = H();                       // 이 버튼이 없을 때의 조작부 높이
  if (!base) { g.style.display = ''; return; }   // 아직 안 보이는 화면이면 그대로 둔다
  g.style.display = '';
  if (H() <= base + 0.5) return;          // ① 글자째로 들어간다
  btn.classList.add('rec-compact');
  if (H() <= base + 0.5) return;          // ② ● 만이면 들어간다
  g.style.display = 'none';               // ③ 어느 쪽도 안 되면 내린다
}

function fitAppViewport() {
  const vv = window.visualViewport;
  const h = Math.round((vv && vv.height) || window.innerHeight || 0);
  if (h > 0) document.documentElement.style.setProperty('--app-h', h + 'px');

  const bar = document.getElementById('phone-bar');
  const barH = (bar && getComputedStyle(bar).display !== 'none')
    ? Math.round(bar.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--phone-bar-h', barH + 'px');

  // 조작부 높이가 정해져야 계기 높이가 정해진다 — REC 자리부터 가린다
  try { fitPfdRecBtn(); } catch (e) { _swallow(e); }

  // 계기·지도는 자기 상자 크기를 따로 들고 있다 — 상자가 바뀌었으니 다시 잡는다
  try { resizePFD(); drawPFD(); } catch (e) { _swallow(e); }
  try { if (typeof leafMap === 'object' && leafMap) leafMap.invalidateSize(); } catch (e) { _swallow(e); }
  try { if (typeof _ml3d !== 'undefined' && _ml3d) _ml3d.resize(); } catch (e) { _swallow(e); }
  try { scaleCdu(); } catch (e) { _swallow(e); }
}
// 주소창이 접히거나 키보드가 올라오면 visualViewport 만 바뀐다(resize 가 안 온다)
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fitAppViewport);
  window.visualViewport.addEventListener('scroll', fitAppViewport);
}

// 회전 직후에는 innerWidth/innerHeight 가 아직 옛값인 기기가 있어 한 박자 늦춘다
let _layoutTimer = null;
function _relayoutSoon() {
  clearTimeout(_layoutTimer);
  _layoutTimer = setTimeout(() => { applyDeviceLayout(); fitAppViewport(); }, 180);
}
window.addEventListener('resize', _relayoutSoon);
window.addEventListener('orientationchange', _relayoutSoon);

// ══════════════════════════════════════════════════════
// 추측항법 (DR — Dead Reckoning)
// ══════════════════════════════════════════════════════
// 골짜기·터널·건물 그늘에서 GPS 는 흔히 몇 초에서 몇 분씩 끊긴다. 그때 화면이
// 마지막 위치에 얼어붙어 있으면 "지금 어디쯤인가" 를 읽을 수 없다. 마지막으로
// 확인된 대지속도와 침로가 그대로 유지된다고 보고 위치를 이어 그린다.
//
// 이것은 추정이지 측정이 아니다. 그래서
//   · 화면에 DR 임을 크게 알리고, 끊긴 지 얼마나 됐는지 함께 보여 준다
//   · DR_MAX_MS 를 넘기면 이어 그리기를 멈춘다(그 이상은 믿을 값이 못 된다)
//   · 새 측정값이 하나라도 들어오면 즉시 DR 을 걷는다
const DR_START_MS = 8000;      // 마지막 측정 이후 이만큼 지나면 DR 로 넘어간다
const DR_MAX_MS   = 300000;    // 5분 — 이 너머는 위치 상실로 본다
const DR_TICK_MS  = 1000;

let drActive = false;          // 지금 위치를 추측으로 이어 그리는 중인가
let drLost   = false;          // 추측조차 믿을 수 없는 상태(DR_MAX_MS 초과)
let _drLastMs = 0;             // DR 로 위치를 마지막으로 전진시킨 시각
let _drAnchor = null;          // DR 시작 시점의 속도·침로(그 뒤로는 고정)

function drReset() {
  drActive = false; drLost = false; _drLastMs = 0; _drAnchor = null;
}

// 한 틱만큼 위치를 전진시킨다. nowMs 를 인자로 받는 것은 시험에서 시계를
// 마음대로 돌리기 위해서다(실행 중에는 Date.now()).
function drStep(nowMs) {
  if (!_drAnchor || !_drLastMs) return false;
  const dtH = (nowMs - _drLastMs) / 3600000;
  if (dtH <= 0) return false;
  _drLastMs = nowMs;
  const gs = _drAnchor.gs;
  if (gs <= 0) return false;                    // 서 있었다면 그 자리 그대로다
  const [lat, lon] = destPoint(S.lat, S.lon, _drAnchor.trk, gs * dtH);
  S.lat = lat; S.lon = lon;
  return true;
}

// 표시 갱신 — GPS 상태줄에 DR 임을 알린다
function drRender(sinceMs) {
  const el = document.getElementById('gps-status');
  if (!el) return;
  const sec = Math.round(sinceMs / 1000);
  const age = sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
  el.style.display = 'block';
  el.style.borderColor = drLost ? '#aa3322' : '#b4632a';
  el.style.color       = drLost ? '#ff7766' : '#ffb066';
  // 덩이를 묶어 둔다 — 접히더라도 좌표 한 벌은 붙어 있어야 읽힌다(_gsPart)
  el.innerHTML = drLost
    ? `✖ 위치 상실 — GPS 두절 ${_gsPart(age)} · 표시 위치를 믿지 마십시오`
    : `⚠ DR 추측항법 — GPS 두절 ${_gsPart(age)} · ` +
      `${_gsPart(decToDMS(S.lat, true) + ' ' + decToDMS(S.lon, false))} · ` +
      `${_gsPart(uSpd(Math.round(_drAnchor ? _drAnchor.gs : 0)))} · ` +
      `${_gsPart(fmtA(toMag(_drAnchor ? _drAnchor.trk : S.hdg)) + '°')}`;
}

function drTick() {
  // GPS 를 쓰지 않는 동안에는 관여하지 않는다
  if (!gpsMode) {
    if (drActive || drLost) { drReset(); try { updateGpsBtn(); } catch (e) { _swallow(e); } }
    return;
  }
  // 아직 첫 측정 전이면 DR 로 넘어갈 근거가 없다(05-gps.js 가 '위치 확인 중'을 띄운다)
  if (!lastGpsMs) return;

  const now = Date.now();
  const since = now - lastGpsMs;

  if (since < DR_START_MS) {                    // 신호가 살아 있다
    if (drActive || drLost) drReset();
    return;
  }
  if (!drActive && !drLost) {                   // DR 진입 — 그 순간의 속도·침로를 붙든다
    drActive = true;
    _drAnchor = { gs: Math.max(0, S.spd), trk: normA(S.hdg) };
    _drLastMs = lastGpsMs;
    // 고도는 이어 그리지 않는다(수직 정보를 추정할 근거가 없다). 그러니 승강률도
    // 0 으로 내린다 — 고도가 멈춰 있는데 바늘만 올라가 있으면 읽는 사람이 속는다.
    S.vs = 0;
  }
  if (since > DR_MAX_MS) {                      // 더는 이어 그리지 않는다
    if (!drLost) { drLost = true; drActive = false; }
    drRender(since);
    return;
  }
  if (drStep(now)) {
    try {
      const last = S.trail[S.trail.length - 1];
      if (!last || distance(last[0], last[1], S.lat, S.lon) > 0.01) {
        S.trail.push([S.lat, S.lon]);
        if (S.trail.length > 600) S.trail.shift();
        updateTrail();
      }
      leafMap.setView([S.lat, S.lon]);
      updateAcOnMap();
      updateNav();
    } catch (e) { _swallow(e); }
  }
  drRender(since);
}
setInterval(drTick, DR_TICK_MS);

// ══════════════════════════════════════════════════════
// GPS 자동 연결
// ══════════════════════════════════════════════════════
// 보조 항법장치는 켜자마자 자기 위치를 알아야 한다. 사용자가 GPS 버튼을 따로
// 누르게 두지 않는다. 다만 두 가지를 조심한다.
//   · 위치 권한을 거부해 둔 사용자에게 매번 조르지 않는다(거부 기록을 남긴다).
//   · 나침반(DeviceOrientation)은 iOS 에서 사용자 제스처 없이는 권한을 못 받는다.
//     그래서 첫 터치가 오면 그때 한 번 더 붙인다.
let _gpsAutoTried = false;
function navAutoGps() {
  if (_gpsAutoTried || gpsMode) return;
  _gpsAutoTried = true;
  if (!('geolocation' in navigator)) return;
  let denied = null;
  try { denied = localStorage.getItem('gpsDenied'); } catch (e) { _swallow(e); }
  if (denied === '1') return;
  try { startGPS(); } catch (e) { _swallow(e); }
}

// iOS 나침반 권한 — 첫 사용자 제스처에서 다시 시도한다(자동 시작 때는 거절된다).
// 실제로 붙을 때까지 계속 듣는다 — GPS 가 붙기 전에 화면을 한 번 만졌다고 해서
// 기회를 날리면, 그 뒤로는 저속 헤딩이 영영 나침반을 못 쓴다.
function _armCompassOnGesture() {
  const h = () => {
    if (!gpsMode) return;
    try { startDevOrientation(); } catch (e) { _swallow(e); }
    if (typeof _devHdgBound !== 'undefined' && _devHdgBound) {
      window.removeEventListener('pointerdown', h);
    }
  };
  window.addEventListener('pointerdown', h);
}

// ══════════════════════════════════════════════════════
// 기동
// ══════════════════════════════════════════════════════
// 07-sim.js 끝의 applyPanels() 로 태블릿 배치가 먼저 그려진다. 폰 배치는
// 그 뒤에 덮어야 하므로 여기서 다시 잡는다.
(function initNavAid() {
  try { setSolo(phoneStartScreen()); } catch (e) { _swallow(e); }
  try { applyDeviceLayout(); } catch (e) { _swallow(e); }
  // 처음 켤 때가 가장 잘 어긋난다 — 글꼴이 늦게 오거나 주소창이 뒤늦게 접힌다.
  // 한 번으로는 모자라 몇 박자에 걸쳐 다시 잰다.
  [0, 120, 400, 1000].forEach(ms =>
    setTimeout(() => { try { fitAppViewport(); } catch (e) { _swallow(e); } }, ms));
  try { _armCompassOnGesture(); } catch (e) { _swallow(e); }
  // 지도·PFD 가 자리를 잡은 뒤 위치를 요청한다(권한 창이 로딩 중에 뜨지 않도록)
  setTimeout(() => { try { navAutoGps(); } catch (e) { _swallow(e); } }, 800);
})();

appRegister({ navGo });
