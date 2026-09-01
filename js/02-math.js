// ─────────────────────────────────────────────────────────────
// 02-math.js — 수학 유틸·표시 단위
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// MATH
// ══════════════════════════════════════════════════════
const D2R = Math.PI / 180;
// 한국 자기편차 — 현행 AIP AD 2 차트 기준 9°W (MAG = TRUE − VAR).
// 울진·청주·김해 차트에 'MAG VAR 8°W → 9°W' 개정 이력이 명시되어 있다.
// HOVER PAGE 판독(drawHsiHoverPage)에서도 참조하므로 여기서 선언해 TDZ를 피한다.
const RULER_VAR = -9;
// 표시는 자북(°M), 내부 계산·좌표는 진북(대권) 기준을 유지한다.
// 지도의 선·거리는 진북 기하로 그려야 정확하므로 상태값은 바꾸지 않고,
// 화면에 숫자로 보여줄 때와 사용자가 절대 방위를 입력할 때만 변환한다.
const toMag  = t => normA(t - RULER_VAR);   // 진북 → 자북
const toTrue = m => normA(m + RULER_VAR);   // 자북 → 진북
const R_NM = 3440.065;

// ══════════════════════════════════════════════════════
// 표시 단위 설정 (정보 표시용) — PFD 계기는 항공 표준대로 ft/kt/NM 고정
// ══════════════════════════════════════════════════════
let unitAlt = 'ft', unitDist = 'NM', unitSpd = 'kt', unitTemp = 'C';
try {
  unitAlt  = localStorage.getItem('unitAlt')  || 'ft';
  unitDist = localStorage.getItem('unitDist') || 'NM';
  unitSpd  = localStorage.getItem('unitSpd')  || 'kt';
  unitTemp = localStorage.getItem('unitTemp') || 'C';
} catch(e) { _swallow(e); }
// ── 계기(PFD)용 원시 변환·라벨 헬퍼 (숫자만 반환) ──
const A_CV = () => unitAlt  === 'm'   ? 0.3048  : 1;        // ft → 표시
const S_CV = () => unitSpd  === 'kmh' ? 1.852   : 1;        // kt → 표시
const D_CV = () => unitDist === 'km'  ? 1.852   : 1;        // NM → 표시
const A_LBL = () => unitAlt  === 'm'   ? 'M'    : 'FT';
const S_LBL = () => unitSpd  === 'kmh' ? 'KM/H' : 'KT';
const D_LBL = () => unitDist === 'km'  ? 'km'   : 'NM';
const T_LBL = () => unitTemp === 'F'   ? '°F'   : '°C';
const tempCv = c => unitTemp === 'F' ? c * 9/5 + 32 : c;    // °C → 표시
function uTemp(c, dec) {
  if (c === null || c === undefined || isNaN(c)) return '---';
  return tempCv(c).toFixed(dec ?? 0) + T_LBL();
}
// 고도(ft 입력) → 설정 단위 문자열
function uAlt(ft, dec) {
  if (ft === null || ft === undefined || isNaN(ft)) return '---';
  return unitAlt === 'm' ? (ft * 0.3048).toFixed(dec ?? 0) + ' m' : Math.round(ft) + ' ft';
}
// 거리(NM 입력) → 설정 단위 문자열
function uDist(nm, dec) {
  if (nm === null || nm === undefined || isNaN(nm)) return '---';
  return unitDist === 'km' ? (nm * 1.852).toFixed(dec ?? 1) + ' km' : nm.toFixed(dec ?? 1) + ' NM';
}
// 속도(kt 입력) → 설정 단위 문자열
function uSpd(kt, dec) {
  if (kt === null || kt === undefined || isNaN(kt)) return '---';
  return unitSpd === 'kmh' ? Math.round(kt * 1.852) + ' km/h' : Math.round(kt) + ' kt';
}
function setUnit(kind, val) {
  if (kind === 'alt')  { unitAlt  = val; try { localStorage.setItem('unitAlt',  val); } catch(e) { _swallow(e); } }
  if (kind === 'dist') { unitDist = val; try { localStorage.setItem('unitDist', val); } catch(e) { _swallow(e); } }
  if (kind === 'spd')  { unitSpd  = val; try { localStorage.setItem('unitSpd',  val); } catch(e) { _swallow(e); } }
  if (kind === 'temp') { unitTemp = val; try { localStorage.setItem('unitTemp', val); } catch(e) { _swallow(e); } }
  try { drawPFD(); } catch(e) { _swallow(e); }
  try { updateNav(); } catch(e) { _swallow(e); }
  try { updateTerrainCut(); } catch(e) { _swallow(e); }
  try { if (rangeRingsOn) _updateRangeRings(); } catch(e) { _swallow(e); }
}
function normA(a)  { return ((a % 360) + 360) % 360; }
function normAS(a) { a = normA(a); return a > 180 ? a - 360 : a; }
function fmtA(a)   { return normA(Math.round(a)).toString().padStart(3,'0'); }

function bearing(la1,lo1,la2,lo2) {
  const f1=la1*D2R, f2=la2*D2R, dl=(lo2-lo1)*D2R;
  return normA(Math.atan2(Math.sin(dl)*Math.cos(f2),
    Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl))*(180/Math.PI));
}
function distance(la1,lo1,la2,lo2) {
  const f1=la1*D2R,f2=la2*D2R,df=(la2-la1)*D2R,dl=(lo2-lo1)*D2R;
  const a=Math.sin(df/2)**2+Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)**2;
  return R_NM*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function destPoint(lat, lon, brg, distNM) {
  const d = distNM / R_NM;
  const b = brg * D2R;
  const φ1 = lat * D2R, λ1 = lon * D2R;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(d) + Math.cos(φ1)*Math.sin(d)*Math.cos(b));
  const λ2 = λ1 + Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(φ1), Math.cos(d)-Math.sin(φ1)*Math.sin(φ2));
  return [φ2/D2R, λ2/D2R];
}
// ── 일출·일몰·시민박명 (NOAA sunrise equation) ──
// lat/lon(십진도), date(대상 날짜) → {rise,set,dawn,dusk} Date | null(백야·극야)
function _sunTimes(lat, lon, date) {
  const dayMs = 86400000, R2D = 180 / Math.PI;
  const jdate = Math.floor(date.getTime() / dayMs) + 2440587.5;   // 해당 날짜 00:00 UTC
  const n = Math.ceil(jdate - 2451545.0 + 0.0008);
  const Jstar = n + (-lon) / 360;                                  // lw = -lon(서경 +)
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148*Math.sin(M*D2R) + 0.0200*Math.sin(2*M*D2R) + 0.0003*Math.sin(3*M*D2R);
  const lam = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545.0 + Jstar + 0.0053*Math.sin(M*D2R) - 0.0069*Math.sin(2*lam*D2R);
  const sinDec = Math.sin(lam*D2R) * Math.sin(23.44*D2R);
  const dec = Math.asin(sinDec);
  const ev = altDeg => {
    const cosW = (Math.sin(altDeg*D2R) - Math.sin(lat*D2R)*sinDec) / (Math.cos(lat*D2R)*Math.cos(dec));
    if (cosW > 1 || cosW < -1) return null;
    const w = Math.acos(cosW) * R2D;
    return { rise: Jt - w/360, set: Jt + w/360 };
  };
  const toDate = J => new Date((J - 2440587.5) * dayMs);
  const sun = ev(-0.833), civ = ev(-6);
  return {
    rise: sun ? toDate(sun.rise) : null,
    set:  sun ? toDate(sun.set)  : null,
    dawn: civ ? toDate(civ.rise) : null,
    dusk: civ ? toDate(civ.set)  : null,
  };
}
function arcPoints(fromLat, fromLon, toLat, toLon, clat, clon, dir, n) {
  n = n || 32;
  const bFrom = bearing(clat, clon, fromLat, fromLon);
  const bTo   = bearing(clat, clon, toLat,   toLon);
  const r     = (distance(clat, clon, fromLat, fromLon) + distance(clat, clon, toLat, toLon)) / 2;
  if (r < 0.1) return [[toLat, toLon]];
  let sweep = bTo - bFrom;
  if (dir === 'R') { if (sweep <= 0) sweep += 360; }
  else             { if (sweep >= 0) sweep -= 360; }
  const pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push(destPoint(clat, clon, normA(bFrom + sweep * (i / n)), r));
  }
  return pts;
}
function crossTrack(la1,lo1,la2,lo2,laA,loA) {
  const d13=distance(la1,lo1,laA,loA);
  const t12=bearing(la1,lo1,la2,lo2)*D2R;
  const t13=bearing(la1,lo1,laA,loA)*D2R;
  return Math.asin(Math.sin(d13/R_NM)*Math.sin(t13-t12))*R_NM;
}

