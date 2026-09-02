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
  // 좌우 기둥(속도·고도 테이프와 승강계)은 걷어냈다. 폭이 가로의 8.2% 로 묶여
  // 있어 그 안에서는 숫자를 키울 수가 없었고, 정확한 값은 맨 윗줄 상자(GS·ALT·VS)
  // 에서 읽는다. 그만큼 자세계와 나침반이 화면 폭을 통째로 쓴다.
  const aiX = 0, aiW = W;
  // 나침반 칸은 비율이 아니라 실제로 차지할 높이로 잡는다. 위·아래 두 띠에
  // 모서리 글자판(FMS·NAV1·NAV2·TAS/GS/OAT)이 들어가고 그 사이가 나침반이다.
  const bandH   = hsiBandH();
  const hsiR    = aiW * 0.34;                            // 폭에 걸릴 때의 반지름
  const hsiWant = Math.round(hsiR * 2 + bandH * 2 + 10);
  // 절반을 넘기지 않는다. 나침반 칸은 위·아래 띠에 글자판을 이고 있어 그냥
  // 두면 자세계보다 커진다 — "갈색이 너무 넓다" 던 자리로 되돌아간다.
  const hsiH = Math.max(Math.round(usableH * 0.34),
                        Math.min(Math.round(usableH * 0.50), hsiWant));
  const aiH  = usableH - hsiH;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // 자세계와 나침반 사이 경계선
  ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, aiH); ctx.lineTo(W, aiH); ctx.stroke();

  drawAI(aiX, 0, aiW, aiH);
  drawHSI(aiX, aiH, aiW, hsiH);
}

// 나침반 위·아래에 두는 글자판 띠의 높이(두 줄)
function hsiBandH() { return Math.round(38 * pfdFontScale); }

// ────────────────────────────────────────
// 맨 윗줄 — 지금 값 세 가지 (GS · ALT · VS)
// ────────────────────────────────────────
// 종전에는 여기가 FMA(오토파일럿 모드 표시줄)였다. ALT | HDG | IAS 세 칸에
// 어느 축을 자동조종이 잡고 있는지 적었는데, 이 앱에는 자동조종이 없다 —
// 조작부(FCP)를 내린 뒤로는 늘 같은 글자가 떠 있는 자리였다.
//
// 그 자리에 지금 값을 큼직하게 적는다. 좌우 테이프는 폭이 좁아(56~76px)
// 숫자를 더 키울 수가 없다. 테이프는 '흐름'(오르는 중인가·빠라지는 중인가)을
// 보는 것이고, 정확한 숫자는 여기서 읽는다.
//
// 왼쪽은 GS(대지속도)다. IAS 가 아니다 — 이 앱에는 대기속도계가 없고 이
// 숫자는 GPS 가 준 대지속도다. 계기에 IAS 라 적으면 없는 센서를 있는 것처럼
// 보이게 한다(바람 표시를 내린 것과 같은 이유다).
//
// ── 칸 크기 (drawAI 와 CDU 의 터치 판정이 함께 쓴다) ──
const FMA_MARGIN = 2;
const FMA_GAP    = 3;
// HDG·CRS 상자와 같은 규격으로 읽는다(라벨 22 · 값 26). 계기에서 가장 자주
// 읽는 숫자들이 서로 다른 크기로 서 있으면 눈이 그때마다 다시 맞춘다.
const FMA_LBL_H  = 26;                    // 이름표 줄
const FMA_VAL_H  = 34;                    // 값 상자
const FMA_BOX_H  = FMA_LBL_H + FMA_VAL_H; // 배율 1 일 때의 줄 높이
// 글씨가 배율을 따라 커지므로(pfdFontScale) 칸도 함께 커져야 한다.
// 종전에는 높이만 20px 로 못 박아 두어, 폰에서 글씨가 상자를 넘었다.
function fmaStripH() { return Math.round(FMA_BOX_H * pfdFontScale); }

function drawTopReadout(x, y, w) {
  const MARGIN = FMA_MARGIN, GAP = FMA_GAP;
  const cellW = Math.floor((w - MARGIN * 2 - GAP * 2) / 3);
  const lblH  = Math.round(FMA_LBL_H * pfdFontScale);
  const valH  = Math.round(FMA_VAL_H * pfdFontScale);
  const Y0    = y + MARGIN;

  const met = unitAlt === 'm';
  const vsShown = met ? S.vs * 0.00508 : S.vs;
  // 승강계 바늘과 같은 색 규칙 — 오르면 초록, 내리면 빨강, 그 사이는 회색
  const vsCol = S.vs > 50 ? '#00cc44' : S.vs < -50 ? '#ff6644' : '#bbbbbb';
  const vsTxt = met ? vsShown.toFixed(1)
                    : String(Math.round(vsShown / 10) * 10);   // fpm 은 10 단위로 — 1 단위는 떨림만 보인다
  const cells = [
    { lbl: 'GS',  unit: S_LBL(), val: String(Math.round(S.spd * S_CV())), col: '#00e07a' },
    { lbl: 'ALT', unit: A_LBL(), val: String(Math.round(S.alt * A_CV())), col: '#ffffff' },
    { lbl: 'VS',  unit: met ? 'M/S' : 'FPM',
      val: (Math.abs(S.vs) < 10 ? '0' : (S.vs > 0 ? '+' : '') + vsTxt), col: vsCol },
  ];

  ctx.save();
  ctx.textBaseline = 'middle';

  // 글씨는 칸에 들어갈 만큼만 키운다. 좁은 폰에서는 칸이 45px 밖에 안 되는데
  // 다섯 자리 고도(12500)를 설계 크기로 적으면 66px 이라 옆 칸을 침범한다.
  // 가장 넓은 값을 재서, 넘칠 때만 그 비율로 줄인다.
  const FONT = 'Helvetica Neue, Arial, sans-serif';
  const fit = (want, texts, room, min) => {
    ctx.font = `bold ${want}px ${FONT}`;
    const wide = Math.max(...texts.map(tx => ctx.measureText(tx).width));
    return wide <= room ? want : Math.max(min, Math.floor(want * room / wide));
  };
  // HDG·CRS 와 같은 크기(라벨 22 · 값 26)를 목표로 잡고, 칸에 안 들어가면
  // 그만큼만 줄인다. 단위(KT·FT·FPM)는 이름표보다 한 단계 작게 둔다.
  const valFs  = fit(26, cells.map(c => c.val), cellW - 6, 11);
  const lblFs  = fit(22, cells.map(c => c.lbl + ' ' + c.unit), cellW - 4, 8);
  const unitFs = Math.max(7, Math.round(lblFs * 0.72));

  for (let i = 0; i < 3; i++) {
    const bx = x + MARGIN + i * (cellW + GAP);

    // 이름표 — 값보다 작게, 단위를 옆에 붙여 적는다
    ctx.textAlign = 'center';
    const c = cells[i];
    ctx.font = `bold ${lblFs}px Helvetica Neue, Arial, sans-serif`;
    const w1 = ctx.measureText(c.lbl).width;
    ctx.font = `${unitFs}px Helvetica Neue, Arial, sans-serif`;
    const w2 = ctx.measureText(c.unit).width;
    const gap2 = 3;
    let px = bx + (cellW - (w1 + gap2 + w2)) / 2;
    const ly = Y0 + lblH / 2;
    ctx.textAlign = 'left';
    ctx.font = `bold ${lblFs}px Helvetica Neue, Arial, sans-serif`;
    ctx.fillStyle = '#8fa3b8';
    ctx.fillText(c.lbl, px, ly);
    ctx.font = `${unitFs}px Helvetica Neue, Arial, sans-serif`;
    ctx.fillStyle = '#5a6a7a';
    ctx.fillText(c.unit, px + w1 + gap2, ly);

    // 값 상자
    const by = Y0 + lblH;
    ctx.fillStyle = '#000';
    ctx.fillRect(bx, by, cellW, valH);
    ctx.strokeStyle = '#446688'; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, cellW - 1, valH - 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = c.col;
    ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
    ctx.fillText(c.val, bx + cellW / 2, by + valH / 2 + 1);
  }
  ctx.restore();
}

// ────────────────────────────────────────
// ATTITUDE INDICATOR
// ────────────────────────────────────────
function drawAI(x, y, w, h) {
  const FMA_H = FMA_MARGIN + fmaStripH();   // 맨 윗줄(GS·ALT·VS)이 차지하는 높이
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


  // ── 비행경로 벡터(FPV)는 내렸다 ──────────────────────────────
  // 자세계 한가운데 녹색 원으로 '지금 가고 있는 방향'(편류·경로각)을 그렸다.
  // 편류는 항적과 기수방위의 차이인데, 지금 기수방위는 나침반을 GPS 항적으로
  // 맞춰 쓰므로(HYBRID) 둘의 차이가 센서 보정 잔차에 가깝다 — 바람이 만든
  // 편류가 아니다. 경로각도 대기속도가 없어 대지속도로 대신 낸 값이다.
  // 자세를 보는 자리 한복판에서 그런 값이 떠다니면 읽기만 방해한다.
  ctx.restore();  // end inner clip (AI content area)

  // AFCS strip drawn last in outer clip — sky/horizon cannot overwrite it
  drawTopReadout(x, y, w);
  drawGlidePath(x, aiY, w, aiH);

  ctx.restore();
}


// ── 글라이드 패스 지시(ILS) — 자세계 오른쪽 끝 ────────────────────
// 종전에는 승강계 왼편에 있었다. 승강계를 걷어내면서 함께 사라질 뻔했는데,
// 이것은 자동조종이 아니라 항법 표시다 — ILS 를 맞춰 두면 강하선 대비 어디에
// 있는지 보여야 한다. 실제 PFD 들이 그러듯 자세계 오른쪽 끝에 세로 눈금으로
// 세운다. ILS 를 잡았을 때만 뜬다.
function drawGlidePath(x, y, w, h) {
  let gsv = null;
  try { gsv = (typeof gsDeviation === 'function') ? gsDeviation() : null; } catch (e) { _swallow(e); }
  if (!gsv) return;
  ctx.save();
  const gx   = x + w - Math.max(10, Math.round(12 * pfdFontScale));   // 눈금 중심선
  const cy   = y + h * 0.5;
  const span = h * 0.34;                 // 최대편위(2점)까지의 길이
  const capt = (typeof gsOn !== 'undefined' && gsOn);
  // 눈금: 가운데 기준선 + 위아래 1·2점
  ctx.strokeStyle = '#cfd8e0'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(gx - 5, cy); ctx.lineTo(gx + 5, cy); ctx.stroke();
  ctx.fillStyle = '#cfd8e0';
  [-2, -1, 1, 2].forEach(n => {
    const dy = cy - n * span / 2;
    if (dy < y + 8 || dy > y + h - 8) return;
    ctx.beginPath(); ctx.arc(gx, dy, 2.2, 0, Math.PI * 2); ctx.fill();
  });
  // 마름모 — 최대편위를 넘으면 끝에 붙이고 속을 비운다(신뢰 구간 밖)
  const dots = Math.max(-2.4, Math.min(2.4, gsv.dots));
  const py2  = Math.max(y + 8, Math.min(y + h - 8, cy - dots * span / 2));
  const col  = capt ? '#ff44ff' : '#dd88ff';
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.8;
  const r2 = Math.max(5, Math.round(6 * pfdFontScale));
  ctx.beginPath();
  ctx.moveTo(gx, py2 - r2); ctx.lineTo(gx + r2, py2);
  ctx.lineTo(gx, py2 + r2); ctx.lineTo(gx - r2, py2); ctx.closePath();
  if (Math.abs(gsv.dots) > 2) ctx.stroke(); else ctx.fill();
  // 머리글 G/S — 붙잡았으면 밝게
  ctx.fillStyle = capt ? '#ff88ff' : '#bb99cc';
  ctx.font = 'bold 10px Helvetica Neue, Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('G/S', gx, cy - span / 2 - 12);
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
  // 위·아래 한 띠씩을 모서리 글자판(FMS·NAV1 / TAS·GS·OAT·NAV2)에 내준다.
  // 나침반은 그 사이를 쓴다 — 좌우 기둥을 걷어내 폭이 넉넉해진 만큼,
  // 이제 나침반 크기를 정하는 것은 폭이 아니라 남은 높이인 경우가 많다.
  const bandH  = hsiBandH();
  const availH = h - bandH * 2;
  const r    = Math.max(24, Math.min(w * 0.36, availH * 0.47));
  const cy   = y + bandH + availH / 2;
  const arrowR = r * 0.84;

  // 네 모서리 글자판 — 나침반보다 먼저 그려 눈금이 위로 오게 한다
  drawHsiCorners(x, y, w, h, bandH);

  // ── Hover Page mode: simplified HSI + GPS speed readouts ──
  if (hoverPageOn) {
    drawHsiHoverPage(x, y, w, h, cx, cy, r);
    ctx.restore();   // 위의 outer save와 짝 — 없으면 캔버스 상태 스택이 프레임마다 쌓여 시현이 깨진다
    return;
  }

  // ── BRG1·BRG2 좌우 패널은 아래 NAV SOURCE 3줄이 대신한다 ──
  // 그 3줄에 FMS·NAV1·NAV2 의 식별자·방위·거리가 이미 다 있어서, 좌측 BRG1
  // 패널은 같은 값을 한 번 더 적는 자리였다. 나침반의 BRG1·BRG2 니들은
  // brg1Visible·brg2Visible 토글로 그대로 유지된다 — 지우는 것은 숫자판뿐이다.

  // ── 바람 표시는 내렸다 ──────────────────────────────────────
  // 종전에는 HSI 왼쪽 위에 풍향/풍속(279°/00kt)을 적었다. 그런데 이 앱에는
  // 대기속도(IAS)가 없다 — 바람은 대기속도 벡터와 대지속도 벡터의 차로
  // 나오므로, 잴 방법이 없다. windDir·windSpd 는 시뮬레이터 시절의 조작부
  // (WDIR·WSPD)로만 바뀌던 값이고 그 버튼은 이미 화면에서 내렸다. 그래서
  // 늘 처음 값(270°/0kt)이 그대로 떠 있었다 — 재지 않은 것을 잰 것처럼
  // 내보이는 자리라, 없느니만 못했다.
  // (지도의 공항별 바람 표시는 실제 관측·예보라 그대로 둔다)

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
    // 숫자는 적지 않는다. 종전에는 컴퍼스 왼쪽 위에 선택 헤딩을 회색으로
    // 적었는데, 바로 위 HDG 상자와 같은 자리를 두고 다투는 숫자였다 —
    // 둘이 나란히 뜨면 어느 쪽이 지금 기수방위인지 한눈에 안 잡힌다.
    // 노치(청록 표식)는 남긴다. 그것은 링 위의 '어느 방향' 이라 겹치지 않고,
    // CDU 의 HDG preselect 로 세운 값이 어디인지 보여 준다.
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
  // 글씨를 두 배로 키운다 — 라벨 11→22, 값 13→26. 비행 중 가장 자주 읽는 두
  // 숫자인데 나침반 눈금 글자보다도 작았다.
  //
  // 다만 두 상자는 HSI 폭(속도·고도 테이프 사이) 안에 서야 한다. 좁은 화면에서는
  // 두 배 크기가 그 폭을 넘으므로 들어갈 만큼만 줄인다. 줄이더라도 종전 크기
  // 아래로는 내려가지 않는다 — 키우려다 되레 작아지면 고친 뜻이 없다.
  // (실제로 한 번 그랬다: 320px 화면에서 값이 13.75px 로 종전 16.25px 보다 작아졌다)
  //
  // 상자 폭도 글자를 재서 정한다. px 로 못 박아 두면 글씨를 키운 순간
  // 라벨(HDG)과 값(009°)이 겹친다.
  const FONT = 'Helvetica Neue, Arial, sans-serif';
  const LBL_MAX = 22, VAL_MAX = 26, LBL_MIN = 11, VAL_MIN = 13;
  const gap = 4;
  // 라벨·값·여백을 합쳐 상자 하나에 필요한 폭(그려질 실제 px — font 배율이 함께 걸린다)
  const needW = (l, v) => {
    ctx.font = `bold ${l}px ${FONT}`;
    const wl = ctx.measureText('HDG').width;
    ctx.font = `bold ${v}px ${FONT}`;
    // 여백 세 몫(왼쪽·가운데·오른쪽) + 3px 여유 — 여유가 없으면 반올림 탓에
    // 라벨과 값이 1px 씩 맞닿는다
    return wl + ctx.measureText('000°').width + Math.max(3, Math.round(6 * l / LBL_MAX)) * 3 + 3;
  };
  const room = Math.floor((w - gap) / 2);
  const k = Math.max(LBL_MIN / LBL_MAX,
                     Math.min(1, room / Math.max(1, needW(LBL_MAX, VAL_MAX))));
  const lblFs = Math.max(LBL_MIN, Math.round(LBL_MAX * k));
  const valFs = Math.max(VAL_MIN, Math.round(VAL_MAX * k));
  const pad   = Math.max(3, Math.round(6 * k));
  // 아주 좁은 화면에서는 가장 작은 글씨조차 HSI 폭에 안 들어간다. 그때는
  // 글자를 자르는 대신 상자가 몇 px 넘어서게 둔다 — 종전에도 그랬다.
  const bw = Math.max(40, Math.ceil(needW(LBL_MIN, VAL_MIN)),
                      Math.min(room, Math.ceil(needW(lblFs, valFs))));
  const bh = Math.round(Math.max(20, 36 * k) * pfdFontScale);
  const boxY = y - bh;                                 // 박스 아랫변 = HSI 윗 테두리
  const txtY = boxY + Math.round(bh * 0.74);           // 텍스트 베이스라인
  const hdgX = cx - bw - gap/2;
  const crsX = cx + gap/2;
  const lblFont = `bold ${lblFs}px ${FONT}`;
  const valFont = `bold ${valFs}px ${FONT}`;
  ctx.lineWidth=1;
  // HDG box
  ctx.fillStyle='#000'; ctx.strokeStyle='#555';
  ctx.fillRect(hdgX,boxY,bw,bh); ctx.strokeRect(hdgX,boxY,bw,bh);
  ctx.textAlign='left';
  ctx.fillStyle='#00cfff'; ctx.font=lblFont;
  ctx.fillText('HDG', hdgX+pad, txtY);
  ctx.fillStyle='#fff'; ctx.font=valFont; ctx.textAlign='right';
  ctx.fillText(fmtA(toMag(S.hdg))+'°', hdgX+bw-pad, txtY);
  // CRS box
  ctx.fillStyle='#000'; ctx.strokeStyle='#555';
  ctx.fillRect(crsX,boxY,bw,bh); ctx.strokeRect(crsX,boxY,bw,bh);
  ctx.textAlign='left';
  ctx.fillStyle='#00cfff'; ctx.font=lblFont;
  ctx.fillText('CRS', crsX+pad, txtY);
  ctx.fillStyle='#fff'; ctx.font=valFont; ctx.textAlign='right';
  ctx.fillText(fmtA(toMag(activeCrs()))+'°', crsX+bw-pad, txtY);
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
// 계기 값 — 나침반 네 모서리에 적고, 고르는 버튼만 조작부에 둔다
// ══════════════════════════════════════════════════════
// 값이 놓인 자리가 세 번 옮겨 다녔다. 처음에는 나침반 좌·우 여백에 캔버스로
// 그렸고(그러느라 나침반이 폭의 38% 로 눌렸다), 다음에는 조작부 맨 윗줄로
// 옮겨 HTML 로 그렸다(나침반은 커졌지만 조작부가 넉 줄로 늘었다).
//
// 이제 좌우 기둥(속도·고도 테이프·승강계)을 걷어내 화면 폭이 통째로 남았다.
// 값은 나침반 네 모서리로 돌아간다 — 나침반을 보는 눈이 그대로 읽을 수 있고,
// 조작부에는 고르는 버튼 한 줄만 남는다.
//
//   왼쪽 위  FMS        오른쪽 위  NAV1
//   왼쪽 아래 TAS·GS·OAT 오른쪽 아래 NAV2

// TAS · GS — 계산은 종전 그대로다
function airInfo() {
  // TAS — 표시속도를 고도로 보정(1000ft 당 약 +2%)
  const tas = S.spd * (1 + 0.02 * S.alt / 1000);
  // GS — TAS 벡터 + 유효 바람 벡터(저속에서는 바람 영향이 0 으로 줄어든다)
  const wto  = normA(windDir + 180) * D2R;
  const wEff = effectiveWindSpd();
  const gsN  = tas * Math.cos(S.hdg * D2R) + wEff * Math.cos(wto);
  const gsE  = tas * Math.sin(S.hdg * D2R) + wEff * Math.sin(wto);
  return { tas, gs: Math.sqrt(gsN * gsN + gsE * gsE), oat: oatNow() };
}

// NAV 소스 세 가지 — FMS(활성 웨이포인트) · NAV1 · NAV2
// 각 줄에 이름·방위·래디얼·거리를 담아 돌려준다.
function navInfoRows() {
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
  return rows.map(rw => {
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
    return { ...rw, has, brg, rad, dst: has ? uDist(dNM, 1) : '--.-',
             sel: navSrc === rw.src };
  });
}

// ── 조작부에 남는 것 — 소스를 고르는 버튼 한 줄 ──────────────────
// 프레임마다 DOM 을 건드리지 않는다. 고른 소스가 바뀔 때만 다시 쓴다.
let _piLast = '';
function updatePfdInfo() {
  const nav = document.getElementById('pi-nav');
  if (!nav) return;
  const html = ['FMS', 'NAV1', 'NAV2'].map(src =>
    `<button class="pi-sel${navSrc === src ? ' on' : ''}" data-act="setNavSrc" ` +
    `data-arg='["${src}"]' title="${src} 를 항법 소스로">${src}</button>`).join('');
  if (html === _piLast) return;
  _piLast = html;
  nav.innerHTML = html;
}

// ── 나침반 네 모서리 글자판 ──────────────────────────────────────
// 위 띠는 나침반 위, 아래 띠는 나침반 아래다. 왼쪽은 왼쪽 끝에, 오른쪽은
// 오른쪽 끝에 붙여 네 덩이가 서로 멀리 떨어지게 한다 — 가운데로 모으면
// 나침반 눈금과 겹친다.
function drawHsiCorners(x, y, w, h, bandH) {
  const rows = navInfoRows();
  const air  = airInfo();

  // 글씨를 1.3 배로 키웠다 — 나침반을 보는 눈이 고개를 돌리지 않고 읽는 값이다
  const lblFs = Math.round(11 * 1.3);                  // 이름표 (11 → 14)
  const valFs = Math.round(16 * 1.3);                  // 값     (16 → 21)
  const pad   = 6;
  const l1 = bandH * 0.40, l2 = bandH * 0.82;          // 두 줄의 베이스라인

  // 한 덩이 = 이름표 + 값 두 줄. align 은 'left' | 'right'.
  const block = (bx, by, align, head, headCol, parts) => {
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    // 1줄: 이름표 + 식별자
    ctx.font = `bold ${lblFs}px Helvetica Neue, Arial, sans-serif`;
    const hw = ctx.measureText(head).width;
    ctx.fillStyle = headCol;
    ctx.fillText(head, bx, by + l1);
    if (parts.ident !== undefined) {
      ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(parts.ident, align === 'left' ? bx + hw + 6 : bx - hw - 6, by + l1);
    }
    // 2줄: 이어 붙인 조각들(색이 저마다다) — align 에 맞춰 왼쪽부터 쌓는다
    ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
    const gap = 6;
    const widths = parts.line2.map(p => ctx.measureText(p.t).width);
    const total  = widths.reduce((a, b) => a + b, 0) + gap * (parts.line2.length - 1);
    let cx2 = align === 'left' ? bx : bx - total;
    ctx.textAlign = 'left';
    parts.line2.forEach((p, i) => {
      ctx.fillStyle = p.c;
      ctx.fillText(p.t, cx2, by + l2);
      cx2 += widths[i] + gap;
    });
  };

  const navBlock = (rw, bx, by, align) => {
    // 고른 소스는 옅은 바탕을 깔아 한눈에 보이게 한다. 상자는 글자를 재서
    // 그만큼만 — 넉넉히 잡으면 빈 회색 띠가 나침반 옆에 덩그러니 남는다.
    if (rw.sel) {
      ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
      const w2 = ctx.measureText(`${rw.brg} ${rw.dst}`).width + 8;
      ctx.font = `bold ${lblFs}px Helvetica Neue, Arial, sans-serif`;
      const w1 = ctx.measureText(rw.src).width + 6;
      ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
      const wBox = Math.max(w1 + ctx.measureText(rw.ident).width, w2) + 8;
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(align === 'left' ? bx - 4 : bx - wBox + 4, by + 1, wBox, bandH - 2);
    }
    // 래디얼(R###)은 뺐다. 방위의 반대편이라 한쪽만 읽으면 나머지는 머릿속에서
    // 나오고, 글씨를 키운 지금은 세 값이 한 줄에 서면 모서리를 넘는다.
    block(bx, by, align, rw.src, rw.has ? rw.color : '#667', {
      ident: rw.ident,
      line2: [{ t: rw.brg, c: rw.has ? rw.color : '#667' },
              { t: rw.dst, c: rw.has ? '#cccc66' : '#667' }],
    });
  };

  ctx.save();
  navBlock(rows[0], x + pad,     y,             'left');   // 왼쪽 위 — FMS
  navBlock(rows[1], x + w - pad, y,             'right');  // 오른쪽 위 — NAV1
  navBlock(rows[2], x + w - pad, y + h - bandH, 'right');  // 오른쪽 아래 — NAV2

  // 왼쪽 아래 — OAT 하나.
  // TAS·GS 는 뺐다. 맨 윗줄에 GS 가 이미 크게 서 있고, TAS 는 대기속도계가
  // 없는 이 앱에서는 대지속도에 고도 보정을 먹인 값이라 GS 와 거의 같은
  // 숫자가 나란히 뜬다 — 어느 쪽이 실제인지 헷갈리기만 했다.
  //
  // OAT 는 지금 고도의 기온이다. 받아 둔 지면 기온(기상청 격자 → METAR)에
  // 표준 감률(1000ft 당 2°C)을 먹여 낸다 — oatNow(). 자료가 없으면 '---' 로
  // 비운다. 누르면 어디서 온 값인지 알려 준다(09-cdu.js 의 onPfdTap).
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const by = y + h - bandH, bx = x + pad;
  ctx.font = `bold ${lblFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillStyle = '#8fa3b8'; ctx.fillText('OAT', bx, by + l2);
  const ow = ctx.measureText('OAT').width;
  ctx.font = `bold ${valFs}px Helvetica Neue, Arial, sans-serif`;
  ctx.fillStyle = air.oat.c === null ? '#777' : '#ffd54f';
  ctx.fillText(uTemp(air.oat.c), bx + ow + 5, by + l2);
  ctx.restore();
}
