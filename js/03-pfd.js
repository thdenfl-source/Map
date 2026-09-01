// ─────────────────────────────────────────────────────────────
// 03-pfd.js — PFD 캔버스(자세·속도·고도·HSI)
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// PFD CANVAS
// ══════════════════════════════════════════════════════
const cvs = document.getElementById('pfd');
const ctx = cvs.getContext('2d');

// ── 계기 글씨 배율 ────────────────────────────────────────────────
// 폰에서는 계기 글씨가 너무 작다. 속도·고도 테이프는 폭이 최소값(56px)에 걸려
// 있어서 글씨도 Math.max(...) 하한에 붙어 버리기 때문이다.
//
// 글꼴을 지정하는 자리가 예순 곳이 넘는다. 하나씩 고치면 반드시 어딘가를
// 빠뜨리고, 나중에 새로 그리는 곳이 생기면 또 어긋난다. 그래서 이 캔버스의
// font 지정 자체를 한자리에서 가로채 배율을 곱한다. 이 캔버스에만 건다 —
// CanvasRenderingContext2D.prototype 을 건드리면 지도·차트까지 함께 커진다.
let pfdFontScale = 1;
(function installPfdFontScale() {
  const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
  if (!d || !d.set) return;                    // 지원하지 않는 브라우저면 배율 없이 간다
  Object.defineProperty(ctx, 'font', {
    configurable: true,
    get() { return d.get.call(this); },
    set(v) {
      d.set.call(this, (pfdFontScale === 1) ? v
        : String(v).replace(/(\d*\.?\d+)px/, (m, n) => (parseFloat(n) * pfdFontScale).toFixed(2) + 'px'));
    },
  });
})();
// 배율을 바꾸면 곧바로 다시 그린다(설정을 바꾸고 화면을 기다리게 하지 않는다)
function setPfdFontScale(s) {
  const v = Math.max(1, Math.min(1.6, Number(s) || 1));
  if (v === pfdFontScale) return;
  pfdFontScale = v;
  try { drawPFD(); } catch (e) { _swallow(e); }
}

function resizePFD() {
  const el = document.getElementById('pfd-wrap');
  cvs.width  = el.clientWidth;
  cvs.height = el.clientHeight;
}

function drawPFD() {
  const W = cvs.width, H = cvs.height;
  // 패널이 접혀 있거나(전체화면 MAP·분할 전환 직후) 아직 레이아웃 전이면 W·H 가
  // 0 이 되고, usableH = H - 조작부높이 가 음수가 되어 계기 반지름까지 음수로
  // 내려간다. 그러면 ctx.arc 가 예외를 던지며 그 프레임의 계기 그리기가 통째로
  // 중단된다. 그릴 수 없는 크기면 조용히 건너뛴다.
  if (!(W >= 80) || !(H >= 80)) return;
  const ctrlEl = document.querySelector('.ctrl-bar');
  const CTRL_H = ctrlEl ? ctrlEl.offsetHeight : 80;
  const usableH = H - CTRL_H;
  // 테이프 폭도 글씨 배율을 따라 넓힌다. 테이프 안의 글씨는 대부분 폭(w)에
  // 비례해 정해지므로, 폭을 그대로 두고 글씨만 키우면 숫자가 상자를 넘는다.
  const tapW = Math.max(56 * pfdFontScale, Math.min(76 * pfdFontScale, W * 0.082));
  const vsiW = Math.max(28 * pfdFontScale, Math.min(38 * pfdFontScale, W * 0.046));
  const aiX  = tapW, aiW = W - tapW * 2 - vsiW;
  // 아래 칸(나침반)은 비율이 아니라 나침반이 실제로 차지할 높이로 잡는다.
  // 폰처럼 가로가 좁으면 나침반 크기는 폭에 걸려 더 못 커진다. 그런데 칸을
  // 비율(0.48 등)로 잘라 두면 남는 높이가 전부 갈색으로 남는다 — 사용자가
  // "갈색이 너무 넓다" 고 한 자리다. 남는 높이는 자세계가 가져간다.
  const hsiR    = aiW * 0.44;                    // drawHSI 반지름(폭에 걸릴 때)
  const hsiWant = Math.round(hsiR * 2 + 56);     // 나침반 + 위 바람표시 + 아래 여백
  const hsiH = Math.max(Math.round(usableH * 0.32),
                        Math.min(Math.round(usableH * 0.50), hsiWant));
  const aiH  = usableH - hsiH;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  drawSpeedTape(0, 0, tapW, usableH);
  // 오른쪽 기둥 — 고도 테이프와 VSI 가 위아래를 통째로 쓴다.
  // 종전에는 아래 절반을 CRHT(호버 기준고도) 표시가 차지했다. 보조 항법장치에는
  // 기압고도계 하나면 충분하고, 그 조작부(CRHT ▲▼·CRHT 홀드)는 이미 없앴다 —
  // 조작할 수 없는 값을 계기에만 남겨 두면 읽는 사람이 헷갈린다.
  drawAltTape(W - tapW - vsiW, 0, tapW, usableH);
  drawVSI(W - vsiW, 0, vsiW, usableH);

  // Dividers
  ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tapW, 0);             ctx.lineTo(tapW, usableH);          ctx.stroke();
  // 고도 테이프 왼쪽 모서리 · VSI 오른쪽 모서리 — 둘 다 위아래 끝까지
  ctx.beginPath(); ctx.moveTo(W-tapW-vsiW, 0);      ctx.lineTo(W-tapW-vsiW, usableH);   ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-vsiW, 0);           ctx.lineTo(W-vsiW, usableH);        ctx.stroke();
  // 가운데 자세계와 나침반 사이
  ctx.beginPath(); ctx.moveTo(tapW, aiH);           ctx.lineTo(W-tapW-vsiW, aiH);       ctx.stroke();

  drawAI(aiX, 0, aiW, aiH);
  drawHSI(aiX, aiH, aiW, hsiH);
}

// ────────────────────────────────────────
// FLIGHT MODE ANNUNCIATOR (FMA)
// Three rectangular boxes at top of AI:  Left=Collective | Mid=Yaw/Roll | Right=Pitch
// ────────────────────────────────────────
// ── FMA geometry constants (used by drawFMA + click handler) ──
// FMA shows axis engagement state only; per-axis target values are drawn
// inside the right-column ALT tape header instead.
const FMA_BOX_H  = 20;
const FMA_MARGIN = 2;
const FMA_GAP    = 3;

// ────────────────────────────────────────
// FLIGHT MODE ANNUNCIATOR  (mode labels only)
// ────────────────────────────────────────
function drawFMA(x, y, w) {
  const MARGIN = FMA_MARGIN, GAP = FMA_GAP, BOX_H = FMA_BOX_H;
  const cellW  = Math.floor((w - MARGIN * 2 - GAP * 2) / 3);
  const Y0     = y + MARGIN;
  // Determine active mode per axis.  Default ALT | HDG | IAS — each axis
  // gets its own distinct label, never duplicating ALT on two axes.
  //   Left   (collective): ALT (홀드가 꺼져 있으면 흐리게)
  //   Middle (yaw/roll)  : HDG or GS when GSPD
  //   Right  (pitch)     : IAS — or GS when GSPD engaged
  let left, leftOn,
      mid = navApOn
        ? (holdOn && _holdPhase !== 'TOFIX'
             ? 'HOLD ' + (_holdEntry ? _holdEntry[0] : '')     // D=직진 P=평행 T=눈물방울
             : (holdOn ? 'HOLD ARM' : (_navDirectTo ? 'NAV DIR' : 'NAV')))
        : (hdgSelOn ? 'HDG SEL' : 'HDG'),
      midOn = rollApOn || navApOn, right, rightOn;

  if (gspdOn) {
    // GSPD engaged: both yaw/roll (mid) and pitch (right) are driven by
    // body-frame ground speed; capture GS on both axes.
    left   = 'ALT'; leftOn = true;
    // GSPD 는 요/롤 축을 가져간다. NAV·HDG SEL 이 켜져 있어도 조향하지 못하므로
    // 켜진 채 방치하지 말고 "대기"임을 분명히 적는다.
    // (버튼은 초록인데 기체가 안 도는 상황을 화면만 보고 알 수 있어야 한다)
    mid    = navApOn ? 'GS/NAV' : (hdgSelOn ? 'GS/HDG' : 'GS');
    midOn  = true;
    right  = 'GS'; rightOn = true;
  } else {
    left   = 'ALT';
    leftOn = altHoldOn;
    right  = 'IAS';
    rightOn = true;
  }

  // ── G/S (ILS 강하선) ──
  // 세로축을 잡으면 그 칸의 주 모드가 G/S 가 된다(승강계 마름모·버튼과 같은 자홍색).
  // 아직 무장만 한 상태는 실제 FMA 처럼 '흰 글씨로 옆에' 적어 둔다 —
  // 지금 잡고 있는 모드와 곧 잡을 모드를 한눈에 갈라 보기 위해서다.
  let leftArm = '';
  if (typeof gsOn !== 'undefined' && gsOn) { left = 'G/S'; leftOn = true; }
  else if (typeof gsArmed !== 'undefined' && gsArmed) { leftArm = 'G/S'; }

  const modes  = [left,   mid,    right  ];
  const active = [leftOn, midOn,  rightOn];
  const armed  = [leftArm, '',    ''      ];

  const modeColor = (lbl, on) => {
    if (!on) return '#3a3a3a';
    // GS/NAV · GS/HDG = GSPD 가 축을 잡고 있어 NAV·HDG 가 조향하지 못하는 대기 상태.
    // 초록(정상 작동)과 구분되게 호박색으로 표시한다.
    // G/S 도 빗금이 있으므로 대기 상태(GS/NAV)보다 먼저 가려낸다.
    if (lbl === 'G/S') return '#ff66ff';   // 강하선을 잡은 상태 — 승강계 마름모와 같은 색
    if (lbl.indexOf('/') >= 0) return '#ffb74d';
    return '#00ff88';  // all active AFCS modes in green
  };

  ctx.save();
  ctx.font = `bold ${Math.max(8, Math.min(11, w * 0.030))}px 'Helvetica Neue', 'Arial', sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  for (let i = 0; i < 3; i++) {
    const bx = x + MARGIN + i * (cellW + GAP);
    const on = active[i];
    ctx.strokeStyle = on ? '#446688' : '#1a1a1a';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx + 0.5, Y0 + 0.5, cellW - 1, BOX_H - 1);
    if (on) {
      ctx.fillStyle = 'rgba(0,25,50,0.85)';
      ctx.fillRect(bx + 1, Y0 + 1, cellW - 2, BOX_H - 2);
    }
    const ty = Y0 + BOX_H / 2 + 0.5;
    if (armed[i]) {
      // 주 모드 + 무장 모드를 한 칸에 나란히. 둘을 합친 폭을 재어 가운데 맞춘다.
      const mainF = ctx.font;
      const smallF = `bold ${Math.max(7, Math.min(9, w * 0.024))}px 'Helvetica Neue', 'Arial', sans-serif`;
      ctx.font = mainF;  const w1 = ctx.measureText(modes[i]).width;
      ctx.font = smallF; const w2 = ctx.measureText(armed[i]).width;
      const gap2 = 4, total = w1 + gap2 + w2;
      let px = bx + (cellW - total) / 2;
      ctx.textAlign = 'left';
      ctx.font = mainF;  ctx.fillStyle = modeColor(modes[i], on);
      ctx.fillText(modes[i], px, ty);
      px += w1 + gap2;
      // 무장은 흰색 — 아직 잡지 않았다는 뜻이다
      ctx.font = smallF; ctx.fillStyle = '#ffffff';
      ctx.fillText(armed[i], px, ty);
      ctx.font = mainF; ctx.textAlign = 'center';
    } else {
      ctx.fillStyle = modeColor(modes[i], on);
      ctx.fillText(modes[i], bx + cellW / 2, ty);
    }
  }
  ctx.restore();
}

// ────────────────────────────────────────
// ATTITUDE INDICATOR
// ────────────────────────────────────────
function drawAI(x, y, w, h) {
  const FMA_H = FMA_MARGIN + FMA_BOX_H;  // AFCS strip height
  const aiY   = y + FMA_H;               // AI content starts below AFCS strip
  const aiH   = h - FMA_H;
  const cx = x + w/2, cy = aiY + aiH * 0.47;
  const ppd = aiH / 28;

  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();

  // Inner clip: restrict all sky/horizon/bank-scale drawing to below the AFCS strip.
  // Without this the sky fillRect paints over the AFCS strip area.
  ctx.save();
  ctx.beginPath(); ctx.rect(x, aiY, w, aiH); ctx.clip();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-S.bnk * D2R);
  const skyY = S.pit * ppd;
  const sg = ctx.createLinearGradient(0,-h,0,0);
  sg.addColorStop(0,'#1e5f9e'); sg.addColorStop(1,'#4a90c8');
  ctx.fillStyle = sg;
  ctx.fillRect(-w*2,-h*2,w*4,h*2+skyY);
  const gg = ctx.createLinearGradient(0,skyY,0,skyY+h);
  gg.addColorStop(0,'#654321'); gg.addColorStop(1,'#654321');
  ctx.fillStyle = gg;
  ctx.fillRect(-w*2,skyY,w*4,h*2);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(-w*2,skyY); ctx.lineTo(w*2,skyY); ctx.stroke();

  ctx.font=`${Math.max(8,w*0.022)}px Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign='center'; ctx.fillStyle='#fff';
  // 2.5° minor ticks (drawn first, thinner)
  for (let p=-25;p<=25;p+=2.5) {
    if (Math.round(p*10)%50===0) continue; // skip multiples of 5°
    const py=skyY-p*ppd;
    if (Math.abs(py)>h*1.1) continue;
    const lw=w*0.05;
    ctx.strokeStyle='#aaa'; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(-lw/2,py); ctx.lineTo(lw/2,py); ctx.stroke();
  }
  for (let p=-25;p<=25;p+=5) {
    if (p===0) continue;
    const py=skyY-p*ppd;
    if (Math.abs(py)>h*1.1) continue;
    const lw=(p%10===0)?w*0.17:w*0.09;
    ctx.strokeStyle='#fff'; ctx.lineWidth=p%10===0?1.5:1;
    ctx.beginPath(); ctx.moveTo(-lw/2,py); ctx.lineTo(lw/2,py); ctx.stroke();
    if (p%10===0) {
      ctx.fillText(Math.abs(p),-lw/2-15,py+4);
      ctx.fillText(Math.abs(p), lw/2+15,py+4);
    }
  }
  ctx.restore();

  // Bank/roll scale — arc centre sits BELOW the panel top edge so the arc
  // appears within the clip region (old y+br*0.13+4 placed centre above clip,
  // making all tick marks and the pointer invisible).
  const br=Math.min(w,aiH)*0.44;
  const arcR=br*0.88;
  ctx.save(); ctx.translate(cx, aiY + arcR + 4);
  ctx.strokeStyle='#bbb'; ctx.lineWidth=1;
  for (const a of [-60,-45,-30,-20,-10,0,10,20,30,45,60]) {
    const r=(a-90)*D2R;
    const r2=arcR*(Math.abs(a)%30===0?0.84:0.91);
    ctx.beginPath(); ctx.moveTo(Math.cos(r)*arcR,Math.sin(r)*arcR);
    ctx.lineTo(Math.cos(r)*r2,Math.sin(r)*r2); ctx.stroke();
  }
  // Fixed roll reference index at 0° bank (cyan, does not rotate — aircraft reference)
  ctx.fillStyle='#00cfff';
  ctx.beginPath();
  ctx.moveTo(0,-arcR+1); ctx.lineTo(-4,-arcR+9); ctx.lineTo(4,-arcR+9);
  ctx.closePath(); ctx.fill();
  // Rotating bank pointer (white, moves with aircraft bank)
  ctx.save(); ctx.rotate(-S.bnk*D2R);
  ctx.fillStyle='#fff'; ctx.beginPath();
  ctx.moveTo(0,-arcR); ctx.lineTo(-6,-arcR+11); ctx.lineTo(6,-arcR+11);
  ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.restore();

  ctx.save(); ctx.translate(cx,cy);
  const ws=w*0.14;
  ctx.strokeStyle='#fff'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(-ws,0); ctx.lineTo(-ws*0.35,0); ctx.lineTo(-ws*0.12,ws*0.22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( ws,0); ctx.lineTo( ws*0.35,0); ctx.lineTo( ws*0.12,ws*0.22); ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
  ctx.restore();


  // ── Flight Path Vector (FPV) ──
  {
    const driftDeg = normAS(computeTrack() - S.hdg);
    const fpaDeg = Math.atan2(-S.vs / 60, Math.max(5, S.spd) * 1.6878) / D2R;
    const fpvX = cx + driftDeg * ppd;
    const fpvY = cy - fpaDeg * ppd;
    const fr = Math.max(7, w * 0.038);
    if (fpvX > x + fr + 2 && fpvX < x + w - fr - 2 &&
        fpvY > aiY + fr && fpvY < aiY + aiH - fr - 10) {
      ctx.save();
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fpvX, fpvY, fr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fpvX - fr * 2.3, fpvY); ctx.lineTo(fpvX - fr, fpvY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fpvX + fr, fpvY); ctx.lineTo(fpvX + fr * 2.3, fpvY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fpvX, fpvY - fr); ctx.lineTo(fpvX, fpvY - fr * 1.7); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();  // end inner clip (AI content area)

  // AFCS strip drawn last in outer clip — sky/horizon cannot overwrite it
  drawFMA(x, y, w);

  ctx.restore();
}

// ────────────────────────────────────────
// SPEED TAPE
// ────────────────────────────────────────
function drawSpeedTape(x, y, w, h) {
  ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
  ctx.fillStyle='#0d0d0d'; ctx.fillRect(x,y,w,h);
  const cy=y+h/2, ppk=h/80;
  // Existing V-speed bands (right edge) — structural airspeed limits.
  const bands=[[0,65,'rgba(255,255,255,0.1)'],[65,125,'rgba(0,180,0,0.18)'],
    [125,165,'rgba(0,180,0,0.12)'],[165,200,'rgba(255,210,0,0.17)'],[200,250,'rgba(255,50,50,0.22)']];
  for(const[f,t,c]of bands){
    const y1=cy-(t-S.spd)*ppk,y2=cy-(f-S.spd)*ppk;
    ctx.fillStyle=c; ctx.fillRect(x+w-6,Math.max(y,y1),5,Math.min(h,y2-y1));
  }
  // ASE/wind reference bands (left edge) — show where motion is ASE-protected
  // (hover) and where wind starts to drift the aircraft (transition). Above
  // WIND_HI the helicopter is in full cruise (no band).
  const aseBands = [
    [0,        WIND_LO,  'rgba(180,100,220,0.28)'], // hover: ASE on
    [WIND_LO,  WIND_HI,  'rgba(255,200,0,0.25)' ],  // transition: wind ramps in
  ];
  for (const [f, t, c] of aseBands) {
    const y1 = cy - (t - S.spd) * ppk;
    const y2 = cy - (f - S.spd) * ppk;
    ctx.fillStyle = c;
    ctx.fillRect(x + 1, Math.max(y, y1), 5, Math.min(h, y2 - y1));
  }
  // Boundary tick marks at WIND_LO and WIND_HI (small notches on left edge)
  ctx.strokeStyle = 'rgba(200,200,200,0.6)';
  ctx.lineWidth = 1;
  for (const sBound of [WIND_LO, WIND_HI]) {
    const ty = cy - (sBound - S.spd) * ppk;
    if (ty < y + 1 || ty > y + h - 1) continue;
    ctx.beginPath(); ctx.moveTo(x + 1, ty); ctx.lineTo(x + 8, ty); ctx.stroke();
  }
  // 눈금은 표시 단위(kt 또는 km/h) 기준의 라운드 값으로 그린다
  const scv = S_CV(), sMin = unitSpd === 'kmh' ? 10 : 5, sMaj = unitSpd === 'kmh' ? 20 : 10;
  const dSpd = S.spd * scv;                       // 현재 속도(표시 단위)
  const d0 = Math.floor((dSpd - 44 * scv) / sMin) * sMin;
  for (let d = d0; d <= dSpd + 52 * scv; d += sMin) {
    if (d < 0) continue;
    const ty = cy - (d / scv - S.spd) * ppk;      // 위치는 내부(kt) 기준 유지
    if (ty < y || ty > y + h) continue;
    const maj = Math.abs(d % sMaj) < 1e-6;
    ctx.strokeStyle = maj ? '#fff' : '#555'; ctx.lineWidth = maj ? 1.5 : 0.8;
    ctx.beginPath(); ctx.moveTo(x+w-6,ty); ctx.lineTo(x+w-(maj?15:10),ty); ctx.stroke();
    if (maj) {
      ctx.fillStyle='#fff'; ctx.font=`${Math.max(9,w*0.17)}px Helvetica Neue, Arial, sans-serif`;
      ctx.textAlign='right'; ctx.fillText(Math.round(d),x+w-17,ty+4);
    }
  }
  const bh=22;
  ctx.fillStyle='#000'; ctx.fillRect(x,cy-bh/2,w,bh);
  ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.strokeRect(x,cy-bh/2,w,bh);
  ctx.fillStyle='#fff'; ctx.font=`bold ${Math.max(13,w*0.2)}px Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign='center'; ctx.fillText(Math.round(S.spd*scv),x+w/2,cy+6);
  ctx.fillStyle='#aaa'; ctx.font='bold 8px Helvetica Neue, Arial, sans-serif';
  ctx.fillText(S_LBL(),x+w/2,y+11);
  // Speed trend vector (magenta, 6-second extrapolation)
  if (Math.abs(spdTrend) > 0.5) {
    const trendY = cy - spdTrend * ppk;
    const clampedY = Math.max(y + 2, Math.min(y + h - 2, trendY));
    ctx.strokeStyle = '#ff44ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + w - 22, cy); ctx.lineTo(x + w - 22, clampedY); ctx.stroke();
    const arrowDir = spdTrend > 0 ? -1 : 1;
    ctx.fillStyle = '#ff44ff';
    ctx.beginPath();
    ctx.moveTo(x + w - 22, clampedY);
    ctx.lineTo(x + w - 26, clampedY + arrowDir * 6);
    ctx.lineTo(x + w - 18, clampedY + arrowDir * 6);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// ────────────────────────────────────────
// ALTITUDE TAPE
// ────────────────────────────────────────
function drawAltTape(x, y, w, h) {
  ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
  ctx.fillStyle='#0d0d0d'; ctx.fillRect(x,y,w,h);

  // ── Target/VS box at the top — shows the AFCS ALT setting + change rate ──
  // Height is reserved at the top of the tape so the moving scale starts below it.
  // 머리글 높이와 두 줄의 베이스라인도 글씨 배율을 따른다 — px 로 두면
  // 키운 두 번째 줄(VS)이 머리글 밖으로 나가 눈금 라벨과 겹친다.
  const HEAD_H = Math.round(26 * pfdFontScale);
  const hL1 = Math.round(11 * pfdFontScale), hL2 = Math.round(22 * pfdFontScale);
  const tapeY  = y + HEAD_H;
  const tapeH  = h - HEAD_H;
  const cy     = tapeY + tapeH / 2;
  const pp100  = tapeH / 20;

  // Tape ticks within the moving-scale region only (표시 단위 기준 라운드 눈금)
  const acv = A_CV(), aMin = unitAlt === 'm' ? 50 : 100, aMaj = unitAlt === 'm' ? 100 : 500;
  const dAlt = S.alt * acv;
  const d0 = Math.floor((dAlt - 1100 * acv) / aMin) * aMin;
  for (let d = d0; d <= dAlt + 1200 * acv; d += aMin) {
    const ty = cy - (d / acv - S.alt) * pp100 / 100;
    if (ty < tapeY || ty > tapeY + tapeH) continue;
    const maj = Math.abs(d % aMaj) < 1e-6;
    ctx.strokeStyle = maj ? '#fff' : '#555'; ctx.lineWidth = maj ? 1.5 : 0.8;
    ctx.beginPath(); ctx.moveTo(x + 7, ty); ctx.lineTo(x + (maj ? 16 : 10), ty); ctx.stroke();
    if (maj) {
      ctx.fillStyle = '#fff'; ctx.font = `${Math.max(9, w * 0.16)}px Helvetica Neue, Arial, sans-serif`;
      ctx.textAlign = 'left'; ctx.fillText(Math.round(d), x + 18, ty + 4);
    }
  }

  // selAlt target bug — cyan triangle on left edge when ALT hold active
  if (altHoldOn) {
    const tay = cy - (selAlt - S.alt) * pp100 / 100;
    if (tay >= tapeY + 3 && tay <= tapeY + tapeH - 3) {
      ctx.fillStyle = '#00cfff';
      ctx.beginPath();
      ctx.moveTo(x + 1, tay);
      ctx.lineTo(x + 7, tay - 5);
      ctx.lineTo(x + 7, tay + 5);
      ctx.closePath(); ctx.fill();
    }
  }

  // Current altitude readout (centre of moving scale)
  const bh = 22;
  ctx.fillStyle = '#000'; ctx.fillRect(x, cy - bh/2, w, bh);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x, cy - bh/2, w, bh);
  ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(12, w * 0.17)}px Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.fillText(Math.round(S.alt * acv), x + w/2, cy + 5);

  // ── ALT setting + change-rate box (top header) ──
  // Active when ALT hold is engaged; dim otherwise. Tappable for selAlt edit.
  const on = altHoldOn;
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 1, y + 1, w - 2, HEAD_H - 2);
  ctx.strokeStyle = on ? '#00cfff' : '#333';
  ctx.lineWidth   = on ? 1.5 : 1;
  ctx.strokeRect(x + 1, y + 1, w - 2, HEAD_H - 2);

  // Line 1: "ALT" label + selAlt value
  ctx.font      = `bold ${Math.max(9, w * 0.14)}px Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillStyle = on ? '#00cfff' : '#666';
  // 글씨를 키운 폰에서는 'ALT FT' 가 값과 겹친다 — 그때는 단위를 뺀다
  ctx.fillText(pfdFontScale > 1.05 ? 'ALT' : 'ALT ' + A_LBL(), x + 4, y + hL1);
  ctx.font      = `bold ${Math.max(10, w * 0.16)}px Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillStyle = on ? '#fff' : '#777';
  ctx.fillText(Math.round(selAlt * acv), x + w - 4, y + hL1);

  // Line 2: VS preselect (selVS) — pilot-settable rate for ALT hold mode.
  // When ALT hold is active, shows signed rate matching convergence direction.
  // When idle/off, shows the preselected magnitude (so the pilot can confirm
  // their setting before engaging). Tap the VS row to change selVS.
  let vsStr;
  if (on) {
    const d = selAlt - S.alt;
    vsStr = Math.abs(d) < 1 ? '0' : (d > 0 ? '+' : '−') + Math.abs(selVS);
  } else {
    vsStr = String(Math.abs(selVS));
  }
  ctx.font      = `${Math.max(8, w * 0.13)}px Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillStyle = on ? '#ffaa44' : '#665533';
  ctx.fillText('VS', x + 4, y + hL2);
  ctx.textAlign = 'right';
  ctx.fillStyle = on ? '#ffaa44' : '#665533';
  ctx.fillText(vsStr, x + w - 4, y + hL2);

  // Altitude trend vector (magenta, 6-second VS extrapolation)
  if (Math.abs(S.vs) > 10) {
    const altTrend6s = S.vs * 0.1;  // ft change in 6 seconds
    const trendY = cy - altTrend6s * pp100 / 100;
    const clampedY = Math.max(tapeY + 2, Math.min(tapeY + tapeH - 2, trendY));
    ctx.strokeStyle = '#ff44ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 2, cy); ctx.lineTo(x + 2, clampedY); ctx.stroke();
    const arrowDir = S.vs > 0 ? -1 : 1;
    ctx.fillStyle = '#ff44ff';
    ctx.beginPath();
    ctx.moveTo(x + 2, clampedY);
    ctx.lineTo(x - 2, clampedY + arrowDir * 6);
    ctx.lineTo(x + 6, clampedY + arrowDir * 6);
    ctx.closePath(); ctx.fill();
  }

  ctx.restore();
}

// ────────────────────────────────────────
// VSI (Vertical Speed Indicator)
// ────────────────────────────────────────
function drawVSI(x, y, w, h) {
  ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
  ctx.fillStyle='#0d0d0d'; ctx.fillRect(x,y,w,h);
  // 고도 단위가 m이면 수직속도는 m/s로 표시(눈금도 라운드 m/s 기준)
  const met = unitAlt === 'm';
  const vsRange = met ? 10 : 2000;              // 표시 단위 최대치 (m/s | fpm)
  const vsStep  = met ? 2.5 : 500;              // 눈금 간격
  const vsMaj   = met ? 5   : 1000;             // 큰 눈금
  const vsD     = fpm => met ? fpm * 0.00508 : fpm;   // fpm → 표시 단위
  const cy=y+h/2, ppm=(h*0.44)/vsRange;

  // scale ticks
  for(let v=-vsRange;v<=vsRange+1e-6;v+=vsStep){
    const ty=cy-v*ppm;
    if(ty<y+2||ty>y+h-2) continue;
    const maj=Math.abs(v)>1e-6 && Math.abs(v%vsMaj)<1e-6;
    ctx.strokeStyle=maj?'#888':'#444'; ctx.lineWidth=maj?1.5:0.8;
    const tw=maj?w*0.55:w*0.32;
    ctx.beginPath(); ctx.moveTo(x,ty); ctx.lineTo(x+tw,ty); ctx.stroke();
    if(maj){
      ctx.fillStyle='#ccc'; ctx.font=`${Math.max(7,w*0.17)}px Helvetica Neue, Arial, sans-serif`;
      ctx.textAlign='left'; ctx.fillText(met?Math.abs(v):Math.abs(v/1000),x+tw+1,ty+3);
    }
  }

  // zero line
  ctx.strokeStyle='#555'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(x,cy); ctx.lineTo(x+w*0.65,cy); ctx.stroke();

  // pointer triangle
  const vs=Math.max(-vsRange,Math.min(vsRange,vsD(S.vs)));
  const py=Math.max(y+8,Math.min(y+h-24,cy-vs*ppm));
  const pc=S.vs>50?'#00cc44':S.vs<-50?'#ff6644':'#aaa';
  ctx.fillStyle=pc;
  ctx.beginPath(); ctx.moveTo(x+w,py); ctx.lineTo(x+w-9,py-5); ctx.lineTo(x+w-9,py+5); ctx.closePath(); ctx.fill();

  // value box at bottom
  const bh=18;
  ctx.fillStyle='#000'; ctx.fillRect(x,y+h-bh,w,bh);
  ctx.strokeStyle='#333'; ctx.lineWidth=1; ctx.strokeRect(x,y+h-bh,w,bh);
  ctx.fillStyle=pc; ctx.font=`bold ${Math.max(9,w*0.2)}px Helvetica Neue, Arial, sans-serif`;
  ctx.textAlign='center'; ctx.fillText(met?vs.toFixed(1):Math.round(vs),x+w/2,y+h-4);

  // label at top
  ctx.fillStyle='#aaa'; ctx.font='bold 7px Helvetica Neue, Arial, sans-serif';
  ctx.fillText(met?'M/S':'FPM',x+w/2,y+9);

  // ── 글라이드 패스 지시(ILS) ──
  // ILS 를 잡았을 때만 승강계 왼편에 눈금과 마름모가 뜬다. 마름모가 가운데
  // 기준선 위에 있으면 강하선보다 높다는 뜻이다(계기와 같은 읽기).
  // 승강계 지시침은 오른쪽 끝을 쓰므로 왼쪽 끝에 두어 서로 가리지 않는다.
  let gsv = null;
  try { gsv = (typeof gsDeviation === 'function') ? gsDeviation() : null; } catch(e) { _swallow(e); }
  if (gsv) {
    const gx = x + 3.5;                    // 눈금 중심선
    const span = h * 0.30;                 // 최대편위(2점)까지의 길이
    const capt = (typeof gsOn !== 'undefined' && gsOn);
    // 눈금: 가운데 기준선 + 위아래 1·2점
    ctx.strokeStyle = '#7a7a7a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gx - 3, cy); ctx.lineTo(gx + 3, cy); ctx.stroke();
    ctx.fillStyle = '#9a9a9a';
    [-2, -1, 1, 2].forEach(n => {
      const dy = cy - n * span / 2;
      if (dy < y + 12 || dy > y + h - 22) return;
      ctx.beginPath(); ctx.arc(gx, dy, 1.6, 0, Math.PI * 2); ctx.fill();
    });
    // 마름모 — 최대편위를 넘으면 끝에 붙이고 속을 비운다(신뢰 구간 밖)
    const dots = Math.max(-2.4, Math.min(2.4, gsv.dots));
    const py2 = Math.max(y + 12, Math.min(y + h - 22, cy - dots * span / 2));
    const col = capt ? '#ff44ff' : '#dd88ff';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6;
    const r2 = 4.5;
    ctx.beginPath();
    ctx.moveTo(gx, py2 - r2); ctx.lineTo(gx + r2, py2);
    ctx.lineTo(gx, py2 + r2); ctx.lineTo(gx - r2, py2); ctx.closePath();
    if (Math.abs(gsv.dots) > 2) ctx.stroke(); else ctx.fill();
    // 머리글 G/S — 붙잡았으면 밝게
    ctx.fillStyle = capt ? '#ff88ff' : '#996699';
    ctx.font = 'bold 7px Helvetica Neue, Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('G/S', x + 1, y + 18);
  }
  ctx.restore();
}

// ────────────────────────────────────────
// HSI
// ────────────────────────────────────────
function drawHSI(x, y, w, h) {
  if (!(w >= 40) || !(h >= 40)) return;   // 반지름이 음수가 되는 것을 원천 차단
  ctx.save();  // outer save — ensure lineWidth/strokeStyle don't bleed into drawPFD
  ctx.fillStyle='#654321';
  ctx.fillRect(x,y,w,h);

  const cx   = x + w / 2;
  // 옆 글자판을 조작부로 내보낸 만큼 나침반을 키운다. 왼쪽에 바람 표시 하나만
  // 남았으므로 그 폭(sideW)만 남기면 된다 — 종전 0.38w 는 글자판 두 벌을
  // 재우던 값이라 지금은 나침반을 공연히 작게 만든다.
  const r    = Math.min(w * 0.44, h * 0.47);
  const cy   = y + h * 0.54;
  const arrowR = r * 0.84;

  // ── Hover Page mode: simplified HSI + GPS speed readouts ──
  if (hoverPageOn) {
    drawHsiHoverPage(x, y, w, h, cx, cy, r);
    ctx.restore();   // 위의 outer save와 짝 — 없으면 캔버스 상태 스택이 프레임마다 쌓여 시현이 깨진다
    return;
  }

  // ── side panel widths ──
  const sideW = (w - r * 2) / 2 - 8;  // 남은 여백(바람 표시가 쓴다)
  const leftX  = x + 4;

  // ── BRG1·BRG2 좌우 패널은 아래 NAV SOURCE 3줄이 대신한다 ──
  // 그 3줄에 FMS·NAV1·NAV2 의 식별자·방위·거리가 이미 다 있어서, 좌측 BRG1
  // 패널은 같은 값을 한 번 더 적는 자리였다. 나침반의 BRG1·BRG2 니들은
  // brg1Visible·brg2Visible 토글로 그대로 유지된다 — 지우는 것은 숫자판뿐이다.

  // ── Wind display (HSI top-left) ──
  {
    const wdirFmt = fmtA(toMag(windDir));   // 바람도 자북 기준으로 표기
    const wspdFmt = String(Math.round(windSpd)).padStart(2,'0');
    // 나침반을 키운 뒤로 옆 여백(sideW)이 거의 없다. 가운데 정렬로 두면
    // 글자가 왼쪽 속도 테이프 위로 넘어간다 — 왼쪽 끝에 붙여 쓰고, 화살표는
    // 글자 오른쪽에 세운다.
    const wdY = y + 3;
    const fs  = Math.max(9, r * 0.105);
    ctx.save();
    ctx.font = `bold ${fs}px Helvetica Neue, Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    const wTxt = `${wdirFmt}°/${wspdFmt}kt`;
    ctx.fillText(wTxt, leftX, wdY + fs);
    const wdX = leftX + ctx.measureText(wTxt).width + 10;

    // Wind arrow: points in direction wind is blowing TO (windDir + 180)
    const aLen = Math.min(Math.max(sideW, 20) * 0.32, 14);
    const wto  = normA(windDir + 180) * D2R;
    const ax   = Math.sin(wto) * aLen;
    const ay   = -Math.cos(wto) * aLen;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(wdX, wdY); ctx.lineTo(wdX + ax, wdY + ay); ctx.stroke();
    // arrowhead
    const hs = 4, ba = wto + Math.PI;
    ctx.beginPath();
    ctx.moveTo(wdX + ax, wdY + ay);
    ctx.lineTo(wdX + ax + Math.sin(ba + 0.45)*hs, wdY + ay - Math.cos(ba + 0.45)*hs);
    ctx.lineTo(wdX + ax + Math.sin(ba - 0.45)*hs, wdY + ay - Math.cos(ba - 0.45)*hs);
    ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
  }

  // ── 나침반 옆 글자판은 조작부로 옮겼다 ──
  // 종전에는 여기(HSI 좌·우 여백)에 TAS·OAT·GS 와 NAV 소스 3줄을 그렸다.
  // 그러느라 나침반을 폭의 38% 로 줄여야 했고, 아래쪽 갈색이 넓게 남았다.
  // 지금은 조작부 맨 윗줄(#pfd-info)이 같은 값을 HTML 로 보여 준다 —
  // 캔버스를 다시 그리지 않아도 되고, 글자도 기기 글꼴이라 훨씬 잘 읽힌다.
  // 계산은 updatePfdInfo() 에 있다(03-pfd.js 끝).

  // ── compass ──
  ctx.save(); ctx.translate(cx, cy);

  ctx.beginPath(); ctx.arc(0,0,r+3,0,Math.PI*2);
  ctx.strokeStyle='#1a0e04'; ctx.lineWidth=3; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fillStyle='#654321'; ctx.fill();

  // rotating rose
  ctx.save();
  ctx.rotate(-toMag(S.hdg) * D2R);   // 카드 눈금이 자북(°M)을 가리키게
  for (let a=0;a<360;a+=5) {
    const rad=a*D2R, is30=a%30===0, is10=a%10===0;
    const rOut=r*0.97, rIn=r*(is30?0.87:is10?0.915:0.955);
    ctx.strokeStyle=is30?'#bbb':is10?'#777':'#3a3a3a';
    ctx.lineWidth=is30?2:is10?1.5:0.8;
    ctx.beginPath();
    ctx.moveTo(Math.sin(rad)*rOut,-Math.cos(rad)*rOut);
    ctx.lineTo(Math.sin(rad)*rIn, -Math.cos(rad)*rIn);
    ctx.stroke();
  }
  const ROSE={0:'N',30:'3',60:'6',90:'E',120:'12',150:'15',180:'S',210:'21',240:'24',270:'W',300:'30',330:'33'};
  const fs=Math.max(9,r*0.115);
  for (const [ang,label] of Object.entries(ROSE)) {
    const a=Number(ang), rad=a*D2R, lr=r*0.82;
    ctx.save();
    ctx.translate(Math.sin(rad)*lr,-Math.cos(rad)*lr);
    ctx.rotate(rad);
    ctx.fillStyle=a===0?'#ff5555':'#ddd';
    ctx.font=`bold ${fs}px Helvetica Neue, Arial, sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(label,0,0);
    ctx.restore();
  }
  ctx.restore(); // end rose rotation

  // Ground track diamond (magenta, on compass ring)
  {
    const trk = computeTrack();
    const trkRelRad = normAS(trk - S.hdg) * D2R;
    const gtR = r * 0.97;
    const gtX = Math.sin(trkRelRad) * gtR;
    const gtY = -Math.cos(trkRelRad) * gtR;
    const gs2 = 6;
    ctx.fillStyle = '#ff44ff';
    ctx.beginPath();
    ctx.moveTo(gtX, gtY - gs2);
    ctx.lineTo(gtX + gs2 * 0.55, gtY);
    ctx.lineTo(gtX, gtY + gs2);
    ctx.lineTo(gtX - gs2 * 0.55, gtY);
    ctx.closePath(); ctx.fill();
  }

  // ── HDG bug (선택 헤딩) — 컴퍼스 링 위 청록 노치 ──
  {
    const bugRel = normAS(selHdg - S.hdg) * D2R;
    const bR = r * 0.99, bw = 5, bh = 7;
    ctx.save();
    ctx.rotate(bugRel);
    ctx.fillStyle = hdgSelOn ? '#00e5ff' : '#4a6a72';
    ctx.beginPath();
    ctx.moveTo(-bw, -bR);        ctx.lineTo(bw, -bR);
    ctx.lineTo(bw, -bR + bh);    ctx.lineTo(bw * 0.35, -bR + bh);
    ctx.lineTo(0, -bR + bh * 0.45);
    ctx.lineTo(-bw * 0.35, -bR + bh); ctx.lineTo(-bw, -bR + bh);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // 선택 헤딩 수치(컴퍼스 상단)
    ctx.fillStyle = hdgSelOn ? '#00e5ff' : '#4a6a72';
    ctx.font = `bold ${Math.max(9, r * 0.115)}px Helvetica Neue, Arial, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtA(toMag(selHdg)) + '°', -r + 2, -r + 6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  }

  // ── CRS arrow + CDB (Course Deviation Bar) ──
  const dotGap = r * 0.248;
  let cdiOff = 0, cdbActive = false, cdbWp = null;

  if (navSrc === 'FMS' && S.awp >= 0 && S.awp < S.wps.length) {
    // FMS: cross-track error from fwp→awp leg (positive = right of course)
    // CDI deflects opposite: right of course → needle left (negative cdiOff)
    cdbWp = S.wps[S.awp];
    const xtk = courseXtk(activeCourseLine());   // updateNav·지도·AP와 동일 기준선
    cdiOff = Math.max(-1, Math.min(1, -xtk / rnp)) * 2 * dotGap;
    cdbActive = true;
  } else if ((navSrc !== 'FMS') && navLat !== null && navLon !== null) {
    cdbWp = { lat: navLat, lon: navLon };
    const brgFromNav = bearing(navLat, navLon, S.lat, S.lon);
    const devDeg     = normAS(brgFromNav - normA(vorObsCrs + 180));
    const fullScale  = 15;   // NAV1/NAV2 = VOR full-scale
    cdiOff = Math.max(-1, Math.min(1,
      Math.sin(devDeg * D2R) / Math.sin(fullScale * D2R))) * 2 * dotGap;
    cdbActive = true;
  }
  const CG = '#ffffff';
  const dispCrs = activeCrs(); // 현재 navSrc 에 맞는 표시 코스

  ctx.save();
  ctx.rotate((dispCrs - S.hdg) * D2R);

  // CRS course arrow — 머리: 화살촉, 꼬리: 선만
  ctx.strokeStyle = CG; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, -r*0.23); ctx.lineTo(0, -arrowR+14); ctx.stroke();
  ctx.fillStyle = CG; ctx.beginPath();
  ctx.moveTo(0, -arrowR); ctx.lineTo(-6, -arrowR+14); ctx.lineTo(6, -arrowR+14);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, r*0.23); ctx.lineTo(0, arrowR); ctx.stroke();

  // Deviation scale dots ±1, ±2
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    ctx.beginPath(); ctx.arc(i * dotGap, 0, 3.5, 0, Math.PI*2);
    ctx.fillStyle = '#333'; ctx.fill();
    ctx.beginPath(); ctx.arc(i * dotGap, 0, 3.5, 0, Math.PI*2);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.stroke();
  }

  // CDB needle — vertical bar that moves laterally
  if (cdbActive) {
    ctx.strokeStyle = CG; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cdiOff, -r * 0.38);
    ctx.lineTo(cdiOff,  r * 0.38);
    ctx.stroke();
    // TO / FROM flag
    const brgRef = bearing(S.lat, S.lon, cdbWp.lat, cdbWp.lon);
    const diff = normA(brgRef - dispCrs);
    const toFlag = diff < 90 || diff > 270;
    ctx.fillStyle = CG;
    ctx.font = `bold ${Math.max(8, r*0.095)}px Helvetica Neue, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(toFlag ? 'TO' : 'FROM', 0, toFlag ? -r*0.34 : r*0.34);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();

  // ── BRG1 needle (VOR/ILS → 파란 단선, 머리 화살촉·꼬리 선) ──
  const _b1st = brg1Visible ? brg1Station() : null;
  if (_b1st) {
    const brg1 = bearing(S.lat, S.lon, _b1st.lat, _b1st.lon);
    ctx.save(); ctx.rotate((brg1 - S.hdg) * D2R);
    const C1 = '#44aaff';
    ctx.strokeStyle = C1; ctx.fillStyle = C1; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0,-r*0.23); ctx.lineTo(0,-arrowR+14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-arrowR); ctx.lineTo(-6,-arrowR+14); ctx.lineTo(6,-arrowR+14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0,r*0.23); ctx.lineTo(0,arrowR); ctx.stroke();
    ctx.restore();
  }

  // ── BRG2 needle (FMS active WP → 녹색 복선, 머리 화살촉·꼬리 선) ──
  if (brg2Visible && S.awp >= 0 && S.awp < S.wps.length) {
    const brg2fms = bearing(S.lat, S.lon, S.wps[S.awp].lat, S.wps[S.awp].lon);
    ctx.save(); ctx.rotate((brg2fms - S.hdg) * D2R);
    const C2 = '#00cc44', g = 5.5;
    ctx.strokeStyle = C2; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-g,-r*0.23); ctx.lineTo(-g,-arrowR+14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( g,-r*0.23); ctx.lineTo( g,-arrowR+14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-g,-arrowR+14); ctx.lineTo(0,-arrowR); ctx.lineTo(g,-arrowR+14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-g,r*0.23); ctx.lineTo(-g,arrowR); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( g,r*0.23); ctx.lineTo( g,arrowR); ctx.stroke();
    ctx.restore();
  }

  // ── Ground track indicator (purple diamond at compass edge) ──
  if (windSpd > 0) {
    const trk = computeTrack();
    ctx.save(); ctx.rotate((trk - S.hdg) * D2R);
    const dR = arrowR + 2;
    const ds = r * 0.07;
    ctx.beginPath();
    ctx.moveTo(0, -dR);        // top
    ctx.lineTo(ds, -dR + ds);  // right
    ctx.lineTo(0, -dR + ds*2); // bottom
    ctx.lineTo(-ds, -dR + ds); // left
    ctx.closePath();
    ctx.fillStyle = '#cc44cc'; ctx.fill();
    ctx.strokeStyle = '#000';  ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  // ── center aircraft ──
  const mw=r*0.12;
  ctx.strokeStyle='#fff'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(-mw,0); ctx.lineTo(-mw*0.35,0); ctx.lineTo(-mw*0.12,mw*0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( mw,0); ctx.lineTo( mw*0.35,0); ctx.lineTo( mw*0.12,mw*0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,-mw*0.85); ctx.lineTo(0,mw*0.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();

  // ── heading index ──
  ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.moveTo(0,-r-1); ctx.lineTo(-9,-r+13); ctx.lineTo(9,-r+13); ctx.closePath(); ctx.fill();

  ctx.restore(); // end translate cx,cy

  // ── HDG / CRS readout boxes (Garmin 스타일: 시안 라벨 + 흰 숫자) ──
  // HSI 윗 테두리(y)에 박스 아랫변이 맞닿도록 위로 올려 컴퍼스 로즈와 겹치지 않게 함
  // 상자 크기도 글씨 배율을 따른다 — px 로 못 박아 두면 글씨를 키운 순간
  // 라벨(HDG)과 값(009°)이 겹친다.
  const bw = Math.round(64 * pfdFontScale), bh = Math.round(20 * pfdFontScale), gap = 4;
  const boxY = y - bh;              // 박스 아랫변 = HSI 윗 테두리
  const txtY = boxY + Math.round(14 * pfdFontScale);   // 텍스트 베이스라인
  const hdgX = cx - bw - gap/2;
  const crsX = cx + gap/2;
  ctx.lineWidth=1;
  // HDG box
  ctx.fillStyle='#000'; ctx.strokeStyle='#555';
  ctx.fillRect(hdgX,boxY,bw,bh); ctx.strokeRect(hdgX,boxY,bw,bh);
  ctx.textAlign='left';
  ctx.fillStyle='#00cfff'; ctx.font='bold 11px Helvetica Neue, Arial, sans-serif';
  ctx.fillText('HDG', hdgX+4, txtY);
  ctx.fillStyle='#fff'; ctx.font='bold 13px Helvetica Neue, Arial, sans-serif'; ctx.textAlign='right';
  ctx.fillText(fmtA(toMag(S.hdg))+'°', hdgX+bw-4, txtY);
  // CRS box
  ctx.fillStyle='#000'; ctx.strokeStyle='#555';
  ctx.fillRect(crsX,boxY,bw,bh); ctx.strokeRect(crsX,boxY,bw,bh);
  ctx.textAlign='left';
  ctx.fillStyle='#00cfff'; ctx.font='bold 11px Helvetica Neue, Arial, sans-serif';
  ctx.fillText('CRS', crsX+4, txtY);
  ctx.fillStyle='#fff'; ctx.font='bold 13px Helvetica Neue, Arial, sans-serif'; ctx.textAlign='right';
  ctx.fillText(fmtA(toMag(activeCrs()))+'°', crsX+bw-4, txtY);
  ctx.restore();  // outer restore — matches save at function entry
}

// ── Hover Page HSI: Garmin-style compass rose + GPS speed readouts ──
// HOVER PAGE 전 반경(ft) — 위치 지시자·SHIP·WPT가 모두 이 축척을 공유한다
const HOVER_FT = 50;
// 어떤 좌표의 기체 기준(body frame) 상대 위치를 ft로 반환.
// HOVER PAGE의 세 지시자(호버 위치·SHIP·WPT)가 같은 계산을 각자 갖고 있던 것을 통합.
function bodyRelFt(lat, lon) {
  const M_PER_DEG = 111320, FT_PER_M = 3.28084;
  const relN = (lat - S.lat) * M_PER_DEG * FT_PER_M;
  const relE = (lon - S.lon) * M_PER_DEG * Math.cos(S.lat * D2R) * FT_PER_M;
  const c = Math.cos(S.hdg * D2R), sn = Math.sin(S.hdg * D2R);
  const fwd =  relN * c + relE * sn;
  const lt  = -relN * sn + relE * c;
  return { fwd, lat: lt, dist: Math.hypot(fwd, lt) };
}

function drawHsiHoverPage(x, y, w, h, cx, cy, rFull) {
  const r      = rFull;                        // same radius as normal HSI
  const sideW  = (w - r * 2) / 2 - 6;
  const leftX  = x + 4;
  const rightX = cx + r + 4;

  // ── Compass rose (same position/size as normal HSI) ──
  ctx.save();
  ctx.translate(cx, cy);

  // Dark-brown inner fill (Garmin style)
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fillStyle = '#654321'; ctx.fill();

  // Outer bezel
  ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI*2);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 5; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5; ctx.stroke();

  // ── Rotating rose (heading-up) ──
  ctx.save();
  ctx.rotate(-toMag(S.hdg) * D2R);   // 카드 눈금이 자북(°M)을 가리키게
  for (let a = 0; a < 360; a += 5) {
    const rad = a * D2R, is30 = a % 30 === 0, is10 = a % 10 === 0;
    const rOut = r * 0.97;
    const rIn  = r * (is30 ? 0.87 : is10 ? 0.915 : 0.955);
    ctx.strokeStyle = is30 ? '#ddd' : is10 ? '#888' : '#555';
    ctx.lineWidth   = is30 ? 2 : is10 ? 1.5 : 0.8;
    ctx.beginPath();
    ctx.moveTo(Math.sin(rad)*rOut, -Math.cos(rad)*rOut);
    ctx.lineTo(Math.sin(rad)*rIn,  -Math.cos(rad)*rIn);
    ctx.stroke();
  }
  // Garmin-style compass labels
  const ROSE_H = {'0':'N','30':'3','60':'6','90':'E','120':'12','150':'15',
                  '180':'S','210':'21','240':'24','270':'W','300':'30','330':'33'};
  const rosFs = Math.max(9, r * 0.115);
  for (const [ang, lbl] of Object.entries(ROSE_H)) {
    const a = Number(ang), rad = a * D2R, lr = r * 0.82;
    ctx.save();
    ctx.translate(Math.sin(rad)*lr, -Math.cos(rad)*lr);
    ctx.rotate(rad);
    ctx.fillStyle = a === 0 ? '#ff5555' : '#ddd';
    ctx.font = `bold ${rosFs}px Helvetica Neue, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lbl, 0, 0);
    ctx.restore();
  }
  ctx.restore(); // end rose rotation

  // Fixed heading index (top triangle)
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -r + 1); ctx.lineTo(-6, -r + 13); ctx.lineTo(6, -r + 13);
  ctx.closePath(); ctx.fill();

  // Center crosshair
  const ch = r * 0.11;
  ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-ch, 0); ctx.lineTo(ch, 0);
  ctx.moveTo(0, -ch); ctx.lineTo(0, ch);
  ctx.stroke();

  // ── Speed vector + position marker (clipped) ──
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, Math.PI*2); ctx.clip();

  const SCL_KT = 10;            // full radius = 10 kt
  const pxPerKt = r / SCL_KT;
  const vx = gspdActLat * pxPerKt;
  const vy = -gspdActFwd * pxPerKt;

  if (Math.hypot(vx, vy) > 1) {
    ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(vx, vy); ctx.stroke();
    const ang = Math.atan2(vy, vx), ah = 8;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx - ah*Math.cos(ang - Math.PI/7), vy - ah*Math.sin(ang - Math.PI/7));
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx - ah*Math.cos(ang + Math.PI/7), vy - ah*Math.sin(ang + Math.PI/7));
    ctx.stroke();
  }

  // Hover-position marker in body frame
  if (hoverPosOn && hoverPosLat !== null) {
    const b = bodyRelFt(hoverPosLat, hoverPosLon);
    const pxPerFt = r / HOVER_FT;
    const mX =  b.lat * pxPerFt;
    const mY = -b.fwd * pxPerFt;
    const sqSize = Math.max(10, r * 0.16);
    ctx.fillStyle   = 'rgba(255,204,0,0.2)';
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.rect(mX - sqSize/2, mY - sqSize/2, sqSize, sqSize);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore(); // end clip

  // ── SHIP 상대 위치 지시자 (지도 SHIP 기능 연동) ──
  // 로즈가 heading-up이므로 상대방위 = 화면 각도. 선박 방향으로 포인터를 그린다.
  let _shipRel = null, _shipDistNM = null, _shipBrgT = null, _shipDistFt = null, _shipNear = false;
  if (typeof shipVisible !== 'undefined' && shipVisible && shipLat !== null && shipLon !== null) {
    _shipDistNM = distance(S.lat, S.lon, shipLat, shipLon);
    _shipBrgT   = bearing(S.lat, S.lon, shipLat, shipLon);
    _shipRel    = normA(_shipBrgT - S.hdg);

    // 호버 위치 지시자와 동일 축척(전 반경 = HOVER_FT)으로 기체 기준 상대위치 산출
    const b = bodyRelFt(shipLat, shipLon);
    _shipDistFt = b.dist;
    _shipNear   = _shipDistFt <= HOVER_FT;

    // 선체 심볼(원점 기준, 이물이 -Y 방향)
    const hull = sz => {
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(sz * 0.55, sz * 0.35);
      ctx.lineTo(sz * 0.35, sz * 0.75);
      ctx.lineTo(-sz * 0.35, sz * 0.75);
      ctx.lineTo(-sz * 0.55, sz * 0.35);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,229,255,0.35)'; ctx.fill();
      ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.6; ctx.stroke();
    };

    if (_shipNear) {
      // ── 반경 내: 실제 축척 위치에 표시(호버 위치 지시자와 동일 축척) ──
      const pxPerFt = r / HOVER_FT;
      const sx =  b.lat * pxPerFt, sy = -b.fwd * pxPerFt;
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, Math.PI*2); ctx.clip();
      ctx.translate(sx, sy);
      ctx.rotate(normA(shipHdg - S.hdg) * D2R);   // 선박 침로 방향으로 정렬
      hull(Math.max(9, r * 0.13));
      ctx.restore();
    } else {
      // ── 반경 밖: 로즈 가장자리 니들 + 중심→선박 점선 ──
      const rad = _shipRel * D2R;
      const pr  = r * 0.70;
      const px  = Math.sin(rad) * pr, py = -Math.cos(rad) * pr;
      ctx.save();
      ctx.strokeStyle = 'rgba(0,229,255,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
      ctx.translate(px, py); ctx.rotate(rad);     // 바깥쪽(선박 방향)을 향함
      hull(Math.max(7, r * 0.10));
      ctx.restore();
    }
  }

  // ── 활성 비행계획 웨이포인트 상대 위치 (SHIP과 동일 방식, 빨간 삼각형) ──
  let _wpRel = null, _wpDistNM = null, _wpBrgT = null, _wpDistFt = null, _wpNear = false, _wpName = '';
  if (S.awp >= 0 && S.awp < S.wps.length) {
    const wp = S.wps[S.awp];
    _wpName   = wp.ident || 'WPT';
    _wpDistNM = distance(S.lat, S.lon, wp.lat, wp.lon);
    _wpBrgT   = bearing(S.lat, S.lon, wp.lat, wp.lon);
    _wpRel    = normA(_wpBrgT - S.hdg);

    const b = bodyRelFt(wp.lat, wp.lon);
    _wpDistFt = b.dist;
    _wpNear   = _wpDistFt <= HOVER_FT;

    const tri = sz => {   // 위(-Y)를 향한 삼각형
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(sz * 0.72, sz * 0.6);
      ctx.lineTo(-sz * 0.72, sz * 0.6);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,45,45,0.4)'; ctx.fill();
      ctx.strokeStyle = '#ff2d2d'; ctx.lineWidth = 1.6; ctx.stroke();
    };

    if (_wpNear) {
      // 반경 내: 호버 위치 지시자와 동일 축척으로 실제 상대위치에 표시
      const pxPerFt = r / HOVER_FT;
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, Math.PI*2); ctx.clip();
      ctx.translate(b.lat * pxPerFt, -b.fwd * pxPerFt);
      tri(Math.max(8, r * 0.12));
      ctx.restore();
    } else {
      // 반경 밖: 로즈 안쪽 니들 + 중심→웨이포인트 점선
      const rad = _wpRel * D2R, pr = r * 0.58;
      const px = Math.sin(rad) * pr, py = -Math.cos(rad) * pr;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,45,45,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
      ctx.translate(px, py); ctx.rotate(rad);   // 바깥쪽(웨이포인트 방향)을 향함
      tri(Math.max(7, r * 0.10));
      ctx.restore();
    }
  }

  ctx.restore(); // end translate(cx, cy)

  // ── 하단 WPT 판독: 상대방위 · 자방위 · 거리 ──
  if (_wpRel !== null) {
    const fs = Math.max(9, r * 0.115);
    const magB = ((Math.round(_wpBrgT - RULER_VAR) % 360) + 360) % 360;
    const relTxt = String(Math.round(_wpRel) % 360).padStart(3,'0');
    const distTxt = _wpNear ? uAlt(_wpDistFt) : uDist(_wpDistNM, 2);
    const txt = `${_wpName}  R${relTxt}°  ${String(magB % 360).padStart(3,'0')}°M  ${distTxt}`;
    ctx.save();
    ctx.font = `bold ${fs}px Helvetica Neue, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    // SHIP 판독이 함께 나오면 그 위 줄에 배치
    const shipShown = (typeof _shipRel !== 'undefined' && _shipRel !== null);
    const ty = Math.min(y + h - 3, cy + r + fs * 1.6) - (shipShown ? fs + 7 : 0);
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(20,0,0,0.75)';
    ctx.fillRect(cx - tw/2 - 5, ty - fs - 2, tw + 10, fs + 6);
    ctx.strokeStyle = '#ff2d2d66'; ctx.lineWidth = 1;
    ctx.strokeRect(cx - tw/2 - 5, ty - fs - 2, tw + 10, fs + 6);
    ctx.fillStyle = '#ff5a5a';
    ctx.fillText(txt, cx, ty);
    ctx.restore();
  }

  // ── 하단 SHIP 판독: 상대방위 · 자방위 · 거리 ──
  if (_shipRel !== null) {
    const fs = Math.max(9, r * 0.115);
    const magB = ((Math.round(_shipBrgT - RULER_VAR) % 360) + 360) % 360;
    const relTxt = String(Math.round(_shipRel) % 360).padStart(3,'0');   // 360 → 000
    // 근접(반경 내)에서는 NM 대신 ft/m로 표기
    const distTxt = _shipNear ? uAlt(_shipDistFt) : uDist(_shipDistNM, 2);
    const txt = `SHIP  R${relTxt}°  ${String(magB % 360).padStart(3,'0')}°M  ${distTxt}`;
    ctx.save();
    ctx.font = `bold ${fs}px Helvetica Neue, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const ty = Math.min(y + h - 3, cy + r + fs * 1.6);
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(0,10,16,0.75)';
    ctx.fillRect(cx - tw/2 - 5, ty - fs - 2, tw + 10, fs + 6);
    ctx.strokeStyle = '#00e5ff66'; ctx.lineWidth = 1;
    ctx.strokeRect(cx - tw/2 - 5, ty - fs - 2, tw + 10, fs + 6);
    ctx.fillStyle = '#00e5ff';
    ctx.fillText(txt, cx, ty);
    ctx.restore();
  }

  // ── Side panels: speed readouts left (actual) / right (reference) ──
  if (sideW < 20) return;

  const refColor = gspdOn ? '#cc44ff' : '#aa33cc';
  const latDir   = gspdActLat >= 0 ? '→' : '←';
  const fwdDir   = gspdActFwd >= 0 ? '↑' : '↓';
  const rLatDir  = (gspdRefLat || 0) >= 0 ? '→' : '←';
  const rFwdDir  = (gspdRefFwd || 0) >= 0 ? '↑' : '↓';
  const refLatTxt = gspdRefLat === null ? '--' : `${Math.round(Math.abs(gspdRefLat))}KT`;
  const refFwdTxt = gspdRefFwd === null ? '--' : `${Math.round(Math.abs(gspdRefFwd))}KT`;

  const valFs  = Math.max(11, sideW * 0.22);
  const lblFs  = Math.max(8,  sideW * 0.16);
  const baseY  = cy - valFs * 1.2;   // vertically centred around compass centre
  const row1Y  = baseY;
  const row2Y  = baseY + valFs * 1.6 + lblFs;

  ctx.save();
  ctx.textBaseline = 'middle';

  // ── Left panel: actual GS ──
  const lCx = leftX + sideW / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#aaa'; ctx.font = `bold ${lblFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText('GS', lCx, row1Y - lblFs * 1.1);
  // lateral
  ctx.fillStyle = '#00ff88'; ctx.font = `${lblFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText(latDir, lCx - valFs * 0.9, row1Y);
  ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText(`${Math.round(Math.abs(gspdActLat))}KT`, lCx + valFs * 0.2, row1Y);
  // forward
  ctx.font = `${lblFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText(fwdDir, lCx - valFs * 0.9, row2Y);
  ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText(`${Math.round(Math.abs(gspdActFwd))}KT`, lCx + valFs * 0.2, row2Y);

  // ── Right panel: reference GS ──
  const rCx = rightX + sideW / 2;
  ctx.fillStyle = '#aaa'; ctx.font = `bold ${lblFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText('REF', rCx, row1Y - lblFs * 1.1);
  // lateral
  ctx.fillStyle = refColor; ctx.font = `${lblFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText(rLatDir, rCx - valFs * 0.9, row1Y);
  ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText(refLatTxt, rCx + valFs * 0.2, row1Y);
  // forward
  ctx.font = `${lblFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText(rFwdDir, rCx - valFs * 0.9, row2Y);
  ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillText(refFwdTxt, rCx + valFs * 0.2, row2Y);

  ctx.restore();
}



// ══════════════════════════════════════════════════════
// 계기 글자판 — 조작부 맨 윗줄(#pfd-info)
// ══════════════════════════════════════════════════════
// 종전에는 나침반 좌·우 여백에 캔버스로 그렸다(TAS·OAT·GS 두 줄과
// NAV 소스 세 줄). 그 자리를 비워 나침반을 키우고 아래쪽 갈색을 줄였다.
// 계산은 그대로 옮겨 왔고, 그리는 곳만 HTML 로 바뀌었다.
//
// 프레임마다 DOM 을 건드리지 않는다 — 값이 실제로 바뀔 때만 쓴다.
// GPS 모드에서는 위치가 3초에 한 번 오므로 그보다 자주 그릴 이유도 없다.
let _piLast = '';
function updatePfdInfo() {
  const air = document.getElementById('pi-air');
  const nav = document.getElementById('pi-nav');
  if (!air || !nav) return;

  // TAS — 표시속도를 고도로 보정(1000ft 당 약 +2%)
  const tas = S.spd * (1 + 0.02 * S.alt / 1000);
  // GS — TAS 벡터 + 유효 바람 벡터(저속에서는 바람 영향이 0 으로 줄어든다)
  const wto  = normA(windDir + 180) * D2R;
  const wEff = effectiveWindSpd();
  const gsN  = tas * Math.cos(S.hdg * D2R) + wEff * Math.cos(wto);
  const gsE  = tas * Math.sin(S.hdg * D2R) + wEff * Math.sin(wto);
  const gs   = Math.sqrt(gsN * gsN + gsE * gsE);
  // OAT — 기상청 격자 기온(없으면 근처 METAR)에 감률을 먹인 지금 고도의 기온.
  // ISA 는 내렸다. 고도만 넣으면 나오는 표준대기 값이라 화면에서 읽을 것이
  // 없고, 옆의 OAT 와 비슷한 숫자가 나란히 서서 어느 쪽이 실제인지 헷갈렸다.
  // (ISA 편차가 필요한 계산은 CDU 의 DENSALT·TAS 가 그대로 해 준다)
  const oat  = oatNow();
  const sl   = S_LBL().toLowerCase();

  // NAV 소스 세 가지 — FMS(활성 웨이포인트) · NAV1 · NAV2
  const rows = [];
  {
    const ok = S.awp >= 0 && S.awp < S.wps.length;
    const wp = ok ? S.wps[S.awp] : null;
    rows.push({ src: 'FMS', ident: ok ? (wp.ident || 'WPT') : '----',
                lat: ok ? wp.lat : null, lon: ok ? wp.lon : null, color: '#00cc44' });
  }
  ['NAV1', 'NAV2'].forEach(id => {
    const rr = navRadios[id] || {};
    const ok = rr.lat !== null && rr.lat !== undefined && rr.lon !== null && rr.lon !== undefined;
    rows.push({ src: id, ident: ok ? (rr.id || '----') : '----',
                lat: ok ? rr.lat : null, lon: ok ? rr.lon : null, color: '#44aaff',
                dme: true, elev: rr.elev || 0 });
  });

  const airHtml =
      `<span class="pi"><i>TAS</i><b style="color:#88ccff">${Math.round(tas * S_CV())}${sl}</b></span>`
    + `<span class="pi"><i>GS</i><b style="color:#00cc44">${Math.round(gs * S_CV())}${sl}</b></span>`
    // 자료가 없으면 '---' 로 비운다 — 없는 값을 표준대기로 채워 내보이면
    // 조종사는 그것을 잰 값으로 읽는다
    + `<span class="pi"><i>OAT</i><b style="color:${oat.c === null ? '#777' : '#ffd54f'}">`
    + `${uTemp(oat.c)}</b></span>`;

  const navHtml = rows.map(rw => {
    const has = rw.lat !== null;
    // 방위(BRG) — 항공기에서 그 지점을 본 방향
    const brg = has ? fmtA(toMag(bearing(S.lat, S.lon, rw.lat, rw.lon))) + '°' : '---°';
    // 래디얼(R) — 그 지점에서 항공기를 본 방향. 관제에 위치를 알릴 때 쓰는 값이
    // 이쪽이다("OOO VOR 의 090 래디얼 12마일"). 방위의 반대편이지만 반대로
    // 뒤집어 쓰지 않고 곧장 낸다 — 먼 거리에서는 정확히 180° 가 아니다.
    const rad = has ? 'R' + fmtA(toMag(bearing(rw.lat, rw.lon, S.lat, S.lon))) : 'R---';
    // VOR/DME 는 경사거리(항공기↔국 직선거리), FMS 는 GPS 수평거리다
    const dNM = !has ? 0
              : rw.dme ? dmeDist(rw.lat, rw.lon, rw.elev)
              : distance(S.lat, S.lon, rw.lat, rw.lon);
    const dst = has ? uDist(dNM, 1) : '--.-';
    const sel = navSrc === rw.src;
    // 줄 앞의 버튼이 곧 소스 선택이다. 이름·방위·래디얼·거리를 보면서 고르는
    // 편이, 버튼만 따로 떼어 두는 것보다 손이 덜 간다.
    return `<span class="pi pi-src${sel ? ' on' : ''}${has ? '' : ' dim'}">`
         + `<button class="pi-sel${sel ? ' on' : ''}" data-act="setNavSrc" `
         + `data-arg='["${rw.src}"]' title="${rw.src} 를 항법 소스로">${rw.src}</button>`
         + `<span class="pi-id">${rw.ident}</span>`
         + `<span class="pi-brg" style="${has ? 'color:' + rw.color : ''}">${brg}</span>`
         + `<span class="pi-rad">${rad}</span>`
         + `<span class="pi-dst">${dst}</span></span>`;
  }).join('');

  // 바뀐 것이 없으면 손대지 않는다 — innerHTML 은 매번 다시 파싱된다
  const key = airHtml + navHtml;
  if (key === _piLast) return;
  _piLast = key;
  air.innerHTML = airHtml;
  nav.innerHTML = navHtml;
}
