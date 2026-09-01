// IFR_FIXES 는 js/data/ifr-fixes.js 로 분리했다(로드 순서상 이 파일보다 먼저 실행된다).

// 항로망은 AIP ENR 3.1/3.2 기반 ENR_ROUTES(53개)로 런타임에 채워진다.
// (syncIfrDbFromAip에서 이 객체를 비우고 다시 채우므로 초기값은 비어 있어야 한다)
const IFR_AIRWAYS = {};

// IFR_DB 는 js/data/ifr-procedures.js 로 분리했다(로드 순서상 이 파일보다 먼저 실행된다).

// ── Korean airports providing METAR/TAF (single source of truth) ─────────────
// Used for: always-visible map weather icons, background METAR refresh, and the
// WX panel quick-select buttons. Covers civil airports plus military/joint-use
// air bases (Osan, Gunsan, Seoul, Suwon, Pyeongtaek, Yecheon, Wonju) which
// report METAR/TAF to aviationweather.gov / NOAA.
// 마스터 데이터에서 파생
const WX_AIRPORTS = AIRPORTS_KR.map(a => ({ icao: a.icao, name: a.name, lat: a.lat, lon: a.lon }));
const APT_LATLNG  = Object.fromEntries(AIRPORTS_KR.map(a => [a.icao, [a.lat, a.lon]]));
const APT_NAME    = Object.fromEntries(AIRPORTS_KR.map(a => [a.icao, a.name]));

// ── 공항 기본정보 (차트탭에 업로드된 AIP TEXT PDF에서 추출·캐시) ──
//  ELEV / ARP / 활주로 / 주파수(TWR·GND·APP·ATIS 등) → METAR 팝업에 표시
async function _getAptInfo(icao) {
  try {
    const cache = JSON.parse(localStorage.getItem('aptInfoDB2') || '{}');
    if (cache[icao]) return cache[icao];
    // 차트 저장소에서 해당 공항 TEXT PDF 탐색
    const keys = await idbGetAllKeys();
    const key = keys.find(k => typeof k === 'string' && k.startsWith(icao + '|') && /TEXT/i.test(k));
    if (!key) return null;
    const blob = await idbGet(key);
    if (!blob) return null;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    const info = { elevM: null, arp: '', rwys: [], freqs: {} };
    let sec = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const rows = _pdfPageRows(await doc.getPage(p).then(pg => pg.getTextContent()));
      for (const r of rows) {
        const T = r.text;
        // 섹션 헤더만 인정: 'AD 2.n 제목' 형태 + 참조 문구(REFER/SEE 등) 제외 + 번호 역행 금지
        const sm = T.match(/\bAD 2\.(\d+)\b\s+[A-Z]/);
        if (sm && !/REFER|SEE |PARAGRAPH|ITEM/.test(T) && (+sm[1]) >= (+sec || 0)) sec = sm[1];
        if (sec === '2') {
          let m = T.match(/ARP COORDINATES[^0-9]*(\d{6})N\s*(\d{7})E/);
          if (m && !info.arp) info.arp = m[1] + 'N ' + m[2] + 'E';
          m = T.match(/ELEVATION[^0-9]{0,40}?([\d.]+)\s*M\b/);
          if (m && info.elevM == null) info.elevM = parseFloat(m[1]);
        } else if (sec === '12') {
          const dm = T.match(/^(\d{2}[LRC]?)\b/);
          const sz = T.match(/(\d[\d ]{2,4})\s*[X×]\s*(\d{2,3})\b/);
          if (dm && sz && info.rwys.length < 8)
            info.rwys.push(dm[1] + ' ' + sz[1].replace(/ /g, '') + '×' + sz[2] + 'm');
        } else if (sec === '18') {
          const kw = T.match(/\b(TWR|TOWER|GND|GROUND|APP|APPROACH|ATIS|DEL|DELIVERY|DEP|RADAR|PMSV|OPS)\b/);
          if (kw) {
            const fr = T.match(/\b(1[0-3]\d\.\d{1,3}|[23]\d{2}\.\d{1,3})\b/g) || [];
            if (fr.length) {
              const k = { TOWER: 'TWR', GROUND: 'GND', APPROACH: 'APP', DELIVERY: 'DEL' }[kw[1]] || kw[1];
              info.freqs[k] = (info.freqs[k] || []);
              fr.forEach(f => { if (!info.freqs[k].includes(f) && info.freqs[k].length < 4) info.freqs[k].push(f); });
            }
          }
        }
      }
      // (조기 종료 제거 — 참조 문구로 인한 섹션 오인 시 데이터 누락 방지)
    }
    if (info.elevM == null && !info.arp && !info.rwys.length && !Object.keys(info.freqs).length) return null;
    cache[icao] = info;
    try { localStorage.setItem('aptInfoDB2', JSON.stringify(cache)); } catch(e) { _swallow(e); }
    return info;
  } catch(e) { return null; }
}
function _aptInfoHtml(info) {
  if (!info) return '';
  const li = [];
  if (info.elevM != null) li.push(`ELEV ${Math.round(info.elevM * 3.28084)} ft (${info.elevM} m)`);
  if (info.arp) li.push(`ARP ${info.arp}`);
  if (info.rwys.length) li.push('RWY ' + info.rwys.join(' · '));
  const order = ['ATIS', 'DEL', 'GND', 'TWR', 'APP', 'DEP', 'RADAR', 'PMSV', 'OPS'];
  order.forEach(k => { if (info.freqs[k]) li.push(`${k} ${info.freqs[k].join(' ')}`); });
  Object.keys(info.freqs).forEach(k => { if (!order.includes(k)) li.push(`${k} ${info.freqs[k].join(' ')}`); });
  if (!li.length) return '';
  return `<div style="border-top:1px solid #1e3a2a;margin-top:8px;padding-top:6px;">
    <div style="color:#ffcc00;font-size:20px;font-weight:bold;margin-bottom:5px;letter-spacing:0.5px;">공항 정보 (AIP)</div>` +
    li.map(x => `<div style="color:#cfe8dc;font-size:18px;line-height:1.6;margin-bottom:4px;">${x}</div>`).join('') + '</div>';
}

let _aptWxCtl = null;

async function showAptWx(icao, name, latlng) {
  if (_aptWxCtl) _aptWxCtl.abort();
  _aptWxCtl = new AbortController();
  const ctl = _aptWxCtl;

  const div = document.createElement('div');
  div.style.cssText = 'background:#0a1a0a;padding:10px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;';
  div.innerHTML = `<div style="color:#00ff88;font-size:15px;font-weight:bold;margin-bottom:6px;">${icao} — ${name}</div><div style="color:#888;font-size:13px;">조회 중...</div>`;

  const popup = L.popup({ maxWidth: 340, className: 'apt-wx-popup', closeButton: true, autoClose: false })
    .setLatLng(latlng).setContent(div).openOn(leafMap);

  const AMO_LINK = `<div style="margin-top:4px;font-size:12px;"><a href="https://global.amo.go.kr/observation/metar.do" target="_blank" style="color:#66aaff;">AMO METAR 조회</a></div>`;
  const sig = ctl.signal;

  try {
    let raw = '';
    try {
      raw = await raceValid(
        [_ivaoMetar(icao, sig), _vatsimMetar(icao, sig), _metarTafScrape(icao, sig)],
        v => typeof v === 'string' && v.length >= 8 && v.toUpperCase().includes(icao)
      );
    } catch { raw = ''; }
    if (ctl.signal.aborted) return;
    if (raw.length >= 8) {
      renderWxMetar(raw, div, icao);
    } else {
      div.innerHTML = `<div style="color:#00ff88;font-size:15px;font-weight:bold;">${icao} — ${name}</div><div style="color:#ff8800;font-size:13px;margin-top:4px;">METAR 없음</div>${AMO_LINK}`;
    }
    popup.update();
    // 공항 기본정보 섹션(차트탭 AIP TEXT에서 추출) — 비동기 로드 후 팝업에 덧붙임
    _getAptInfo(icao).then(info => {
      if (ctl.signal.aborted) return;
      const html = _aptInfoHtml(info);
      if (!html) return;
      const sec = document.createElement('div');
      sec.innerHTML = html;
      div.appendChild(sec);
      popup.update();
    }).catch(() => {});
  } catch (e) {
    if (ctl.signal.aborted) return;
    div.innerHTML = `<div style="color:#ff5544;font-size:13px;padding:4px;">${icao}: 조회 실패</div>`;
    popup.update();
  }
}

function initAirportLayer() {
  Object.entries(APT_LATLNG).forEach(([icao, latlng]) => {
    const name = APT_NAME[icao] || IFR_DB[icao]?.name || '';
    const icon = L.divIcon({
      html: `<div style="text-align:center;cursor:pointer;">
        <div style="width:14px;height:14px;background:#ffcc00;border:2px solid #000;margin:0 auto;transform:rotate(45deg);box-shadow:0 0 5px rgba(255,204,0,0.7);"></div>
        <div style="color:#ffcc00;font:bold 10px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;white-space:nowrap;margin-top:3px;text-shadow:1px 1px 2px #000,-1px -1px 2px #000;">${icao}</div>
      </div>`,
      iconSize: [52, 28], iconAnchor: [26, 8], className: ''
    });
    L.marker(latlng, { icon, title: `${icao} ${name}`, zIndexOffset: 200 })
      .bindPopup(() => {   // 열 때 생성: AIRFIELD_INFO·잠금해제 상태를 그 시점에 확인
        const extra = [{ label: '☁ METAR/TAF',
                         onclick: `mapAptWx('${icao}',${latlng[0]},${latlng[1]})`,
                         fg: '#0b6b8a', bg: '#e6f4f9' }];
        if (_aptInfoAvailable(icao))
          extra.push({ label: 'ℹ 공항 정보', onclick: `_mapOpenAirfield('${icao}')`,
                       fg: '#7a5b00', bg: '#fff6e0' });
        return _mapSymPopup({ title: `◆ ${icao}`, color: '#a86b00', name: icao,
                              lat: latlng[0], lon: latlng[1], sub: name, extra });
      }, { maxWidth: 300 })
      .on('click', (e) => L.DomEvent.stopPropagation(e))
      .addTo(leafMap);
  });
}
initAirportLayer();

// Populate WX panel quick-select buttons from the same WX_AIRPORTS source,
// keeping the map weather icons and the WX panel list in sync.
function initWxButtons() {
  const grid = document.getElementById('wx-ap-grid');
  if (!grid) return;
  grid.innerHTML = WX_AIRPORTS.map(a =>
    `<button class="wx-ap-btn" onclick="setWxIcao('${a.icao}',this)">${a.icao}<br>` +
    `<span style="color:#ffcc00;font-weight:normal;">${a.name}</span></button>`
  ).join('');
}
initWxButtons();

// ══════════════════════════════════════════════════════
// SID: AIP 등록 절차 + 사용자 정의 절차
// ══════════════════════════════════════════════════════
function customSids() {
  try { return JSON.parse(localStorage.getItem('customSids') || '{}'); } catch(e) { return {}; }
}
function saveCustomSids(o) {
  try { localStorage.setItem('customSids', JSON.stringify(o)); } catch(e) { _swallow(e); }
}
// 해당 공항의 SID 목록(AIP + 사용자). 표시 순서 = 인덱스
function allSids(icao) {
  const aip  = (IFR_DB[icao] && IFR_DB[icao].sids) || [];
  const user = customSids()[icao] || [];
  return aip.map(s => Object.assign({}, s, { _src: 'AIP' }))
     .concat(user.map((s, i) => Object.assign({}, s, { _src: 'USER', _ui: i })));
}
// AIP 공개 공항 목록(ICAO, 이름) — 사용자 SID는 모든 AIP 공항에서 만들 수 있다
function aipAirportList() {
  const out = [];
  try {
    AIRFIELD_INFO.forEach(a => {
      if (!a.pub || !a.code || a.code.length !== 2) return;
      out.push({ icao: 'RK' + a.code, name: a.name });
    });
  } catch(e) { _swallow(e); }
  Object.keys(IFR_DB).forEach(k => {
    if (!out.some(o => o.icao === k)) out.push({ icao: k, name: IFR_DB[k].name || '' });
  });
  return out.sort((a, b) => a.icao.localeCompare(b.icao));
}
// 절차 경유점 중 좌표를 해석하지 못한 이름 목록(입력 오류 검증용)
function procUnresolved(proc) {
  return (proc && proc.wps || []).filter(w => {
    if (IFR_FIXES[w.ident]) return false;
    return !(typeof w.lat === 'number' && typeof w.lon === 'number' && !isNaN(w.lat));
  }).map(w => w.ident);
}
// 경유점 좌표 해석(픽스 DB 우선)
// 절차의 경유점 좌표를 정한다. 픽스 DB 에 이름이 있으면 그 값을 쓰고, 없으면
// 절차에 적힌 값을 쓴다. SID 는 좌표를 생략하고 이름만 적은 항목이 많아서
// (RKSI·RKSS 등 476건) 이 조회가 없으면 그대로 죽는다.
function _resolveWp(w) {
  const f = IFR_FIXES[w.ident];
  if (f) return { ident: w.ident, lat: f.lat, lon: f.lon, arc: w.arc };
  return { ident: w.ident, lat: w.lat, lon: w.lon, arc: w.arc };
}

function loadSids() {
  const icao = document.getElementById('dep-icao').value;
  const sel  = document.getElementById('dep-sid');
  const rwyEl = document.getElementById('dep-rwy');
  if (!sel) return;
  const list = allSids(icao);

  // ── RWY 필터 옵션 채우기(현재 선택 유지) ──
  if (rwyEl) {
    const cur = rwyEl.value;
    const rwys = [];
    list.forEach(s => String(s.rwy || '').split('/').forEach(r => {
      r = r.trim(); if (r && !rwys.includes(r)) rwys.push(r);
    }));
    rwys.sort();
    rwyEl.innerHTML = '<option value="">전체</option>' +
      rwys.map(r => `<option value="${r}">${r}</option>`).join('');
    if (rwys.includes(cur)) rwyEl.value = cur;
  }
  const rwyF = rwyEl ? rwyEl.value : '';

  sel.innerHTML = '';
  list.forEach((sid, i) => {
    if (rwyF && !String(sid.rwy || '').split('/').map(x => x.trim()).includes(rwyF)) return;
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = (sid._src === 'USER' ? '★ ' : '') + sid.name + ' (' + (sid.rwy || '-') + ')';
    sel.appendChild(opt);
  });
  if (!sel.options.length) sel.innerHTML = '<option value="">— 해당 RWY 절차 없음 —</option>';
  onSidSelect();
}

// SID 선택 시: 경유점·검증 결과 표시 + 지도 미리보기 갱신
function onSidSelect() {
  const icao = document.getElementById('dep-icao')?.value;
  const sel  = document.getElementById('dep-sid');
  const box  = document.getElementById('sid-detail');
  if (!box) return;
  const sid = (sel && sel.value !== '') ? allSids(icao)[parseInt(sel.value)] : null;
  if (!sid) { box.innerHTML = ''; clearProcPreview(); return; }
  const bad = procUnresolved(sid);
  const chain = (sid.wps || []).map(w => {
    const ok = !bad.includes(w.ident);
    return `<span style="color:${ok ? '#9fe6c0' : '#ff8a65'};font-weight:bold;">${w.ident}${ok ? '' : ' ⚠'}</span>`;
  }).join('<span style="color:#456;"> › </span>');
  box.innerHTML =
    `<div style="border:1px solid #1e3a2a;border-radius:4px;background:#08140e;padding:5px 7px;margin:4px 0;">` +
      `<div style="color:#6a8494;font-size:8px;letter-spacing:0.5px;margin-bottom:3px;">` +
        `${sid._src === 'USER' ? '★ 사용자 절차' : 'AIP 절차'} · ${(sid.wps || []).length}개 경유점</div>` +
      `<div style="font-size:10px;line-height:1.6;">${chain || '—'}</div>` +
      (bad.length
        ? `<div style="color:#ff8a65;font-size:9px;margin-top:4px;">⚠ 좌표 미해석: ${bad.join(', ')} — 픽스 DB에 없는 이름입니다.</div>`
        : '') +
    `</div>`;
  procPreview((sid.wps || []).map(_resolveWp));
}

// ── 절차 지도 미리보기 ──
let _procPreviewLayer = null;
function clearProcPreview() {
  if (_procPreviewLayer) { try { leafMap.removeLayer(_procPreviewLayer); } catch(e) { _swallow(e); } _procPreviewLayer = null; }
}
function procPreview(wps) {
  clearProcPreview();
  const pts = (wps || []).filter(w => typeof w.lat === 'number' && !isNaN(w.lat)).map(w => [w.lat, w.lon]);
  if (!pts.length) return;
  const g = L.layerGroup();
  if (pts.length > 1) {
    L.polyline(pts, { color:'#ffd54f', weight:2.5, opacity:0.95, dashArray:'8 5', interactive:false }).addTo(g);
  }
  wps.filter(w => typeof w.lat === 'number' && !isNaN(w.lat)).forEach((w, i) => {
    L.circleMarker([w.lat, w.lon], { radius:4, color:'#ffd54f', weight:2, fillColor:'#000', fillOpacity:1, interactive:false }).addTo(g);
    L.marker([w.lat, w.lon], { interactive:false, icon: L.divIcon({ className:'', iconSize:[0,0],
      html:`<div style="transform:translate(7px,-15px);color:#ffd54f;font-size:9px;font-weight:bold;white-space:nowrap;text-shadow:1px 1px 2px #000;">${i+1}. ${w.ident}</div>` }) }).addTo(g);
  });
  _procPreviewLayer = g.addTo(leafMap);
}
// 미리보기를 지도 화면으로 열고 범위 맞추기
function sidShowOnMap() {
  if (!_procPreviewLayer) return;
  try {
    const b = L.latLngBounds([]);
    _procPreviewLayer.eachLayer(l => { if (l.getLatLng) b.extend(l.getLatLng()); });
    cduOpenMap();
    setTimeout(() => { try { leafMap.invalidateSize(); if (b.isValid()) leafMap.fitBounds(b, { padding:[45,45] }); } catch(e) { _swallow(e); } }, 120);
  } catch(e) { _swallow(e); }
}

function addSidWps() {
  const icao   = document.getElementById('dep-icao').value;
  const selEl  = document.getElementById('dep-sid');
  const sidIdx = parseInt(selEl && selEl.value);
  if (isNaN(sidIdx)) return;
  const sid = allSids(icao)[sidIdx];
  if (!sid) return;
  const mode = document.getElementById('dep-mode')?.value || 'append';
  if (mode === 'replace') clearFP();
  const ap = AIRPORTS.find(a => a.ident === icao);
  if (ap && S.wps.length === 0) pushWP({ident:ap.ident, lat:ap.lat, lon:ap.lon}, 'DEP');
  (sid.wps || []).forEach(wp => {
    const r = _resolveWp(wp);
    if (typeof r.lat !== 'number' || isNaN(r.lat)) return;   // 좌표 미해석 경유점은 제외
    pushWP({ident:r.ident, lat:r.lat, lon:r.lon, arc:r.arc}, 'DEP');
  });
  clearProcPreview();
  fpGo('LIST');
}

// 사용자 SID 삭제
async function deleteUserSid() {
  const icao = document.getElementById('dep-icao').value;
  const sel  = document.getElementById('dep-sid');
  const sid  = (sel && sel.value !== '') ? allSids(icao)[parseInt(sel.value)] : null;
  if (!sid || sid._src !== 'USER') { uiAlert('사용자가 만든 절차만 삭제할 수 있습니다.'); return; }
  if (!await uiConfirm(`사용자 절차 "${sid.name}" 을(를) 삭제할까요?`,
        { okText: '삭제', cancelText: '취소' })) return;
  const all = customSids();
  (all[icao] || []).splice(sid._ui, 1);
  saveCustomSids(all);
  loadSids();
}

function loadAirwayFixes() {
  const awy    = document.getElementById('enr-airway').value;
  const fixes  = IFR_AIRWAYS[awy];
  const entryEl = document.getElementById('enr-entry');
  const exitEl  = document.getElementById('enr-exit');
  entryEl.innerHTML = ''; exitEl.innerHTML = '';
  if (!fixes) return;
  fixes.forEach(f => {
    const o1 = document.createElement('option'); o1.value = f; o1.textContent = f; entryEl.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = f; o2.textContent = f; exitEl.appendChild(o2);
  });
  if (fixes.length > 1) exitEl.selectedIndex = fixes.length - 1;
}

function addAirwaySegment() {
  const awy   = document.getElementById('enr-airway').value;
  const fixes = IFR_AIRWAYS[awy];
  const entry = document.getElementById('enr-entry').value;
  const exit  = document.getElementById('enr-exit').value;
  if (!fixes) return;
  const i1 = fixes.indexOf(entry), i2 = fixes.indexOf(exit);
  if (i1 < 0 || i2 < 0 || i1 >= i2) return;
  for (let i = i1; i <= i2; i++) {
    const f = fixes[i], fix = IFR_FIXES[f];
    if (fix) pushWP({ident:f, lat:fix.lat, lon:fix.lon}, 'ENR');
  }
  fpGo('LIST');
}

function addSingleFix() {
  const f   = document.getElementById('enr-fix').value;
  const fix = IFR_FIXES[f];
  if (fix) { pushWP({ident:f, lat:fix.lat, lon:fix.lon}, 'ENR'); fpGo('LIST'); }
}

function loadStars() {
  const icao = document.getElementById('app-icao').value;
  const sel  = document.getElementById('app-star');
  if (!sel) return;
  sel.innerHTML = '';
  const db = IFR_DB[icao];
  if (!db || !db.stars || db.stars.length === 0) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '(없음)';
    sel.appendChild(opt);
    return;
  }
  db.stars.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = s.name + ' (' + s.rwy + ')';
    sel.appendChild(opt);
  });
}

function addStarWps() {
  const icao = document.getElementById('app-icao').value;
  const idx  = parseInt(document.getElementById('app-star').value);
  const db   = IFR_DB[icao];
  if (!db || !db.stars || isNaN(idx)) return;
  const star = db.stars[idx];
  if (!star) return;
  // SID 와 같은 방식으로 좌표를 푼다. 종전에는 STAR·접근절차만 절차에 적힌 값을
  // 그대로 썼는데, 좌표 없는 항목이 섞이면 NaN 경유점이 비행계획에 들어갔다.
  star.wps.forEach(wp => {
    const r = _resolveWp(wp);
    if (typeof r.lat !== 'number' || isNaN(r.lat)) return;
    pushWP({ident:r.ident, lat:r.lat, lon:r.lon, arc:r.arc}, 'APP');
  });
  fpGo('LIST');
}

function loadApproaches() {
  const icao = document.getElementById('app-icao').value;
  const sel  = document.getElementById('app-proc');
  if (!sel) return;
  sel.innerHTML = '';
  const db = IFR_DB[icao];
  if (!db) return;
  db.approaches.forEach((ap, i) => {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = ap.name;
    sel.appendChild(opt);
  });
}

function addAppWps() {
  const icao = document.getElementById('app-icao').value;
  const idx  = parseInt(document.getElementById('app-proc').value);
  const db   = IFR_DB[icao];
  if (!db || isNaN(idx)) return;
  const app = db.approaches[idx];
  if (!app) return;
  app.wps.forEach(wp => {
    const r = _resolveWp(wp);
    if (typeof r.lat !== 'number' || isNaN(r.lat)) return;
    pushWP({ident:r.ident, lat:r.lat, lon:r.lon, arc:r.arc}, 'APP');
  });
  fpGo('LIST');
}

// ── 시작 안내 오버레이 ──
// 안내 내용이 크게 바뀌면 이 버전을 올린다 → '다시 보지 않기'를 했어도 한 번 더 표시
const HELP_VERSION = '2';
function closeHelp() {
  if (document.getElementById('help-dontshow')?.checked) {
    try { localStorage.setItem('helpDismissed', HELP_VERSION); } catch(e) { _swallow(e); }
  }
  document.getElementById('help-overlay').style.display = 'none';
}
function showHelpOnLaunch() {
  let dismissed = null;
  try { dismissed = localStorage.getItem('helpDismissed'); } catch(e) { _swallow(e); }
  if (dismissed !== HELP_VERSION) document.getElementById('help-overlay').style.display = 'flex';
}

