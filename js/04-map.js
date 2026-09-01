// ─────────────────────────────────────────────────────────────
// 04-map.js — 2D 지도 · 3D 지형
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
// ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════
// MAP
// ══════════════════════════════════════════════════════
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:18});
const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19});
let currentLayer = 'sat';
const leafMap = L.map('map',{center:[37.3895,126.6550],zoom:12,zoomControl:false,attributionControl:false});
L.control.zoom({position:'bottomright'}).addTo(leafMap);
satLayer.addTo(leafMap);

// Custom dual-unit scale bar (km + NM)
L.Control.DualScale = L.Control.extend({
  options: { position: 'bottomleft', maxWidth: 120 },
  onAdd(map) {
    const div = L.DomUtil.create('div', 'vfr-scale');
    this._kmRow = L.DomUtil.create('div', 'vfr-scale-row', div);
    this._kmBar = L.DomUtil.create('div', 'vfr-scale-bar vfr-scale-km', this._kmRow);
    this._kmLbl = L.DomUtil.create('span', '', this._kmRow);
    this._nmRow = L.DomUtil.create('div', 'vfr-scale-row', div);
    this._nmBar = L.DomUtil.create('div', 'vfr-scale-bar vfr-scale-nm', this._nmRow);
    this._nmLbl = L.DomUtil.create('span', '', this._nmRow);
    map.on('zoomend moveend', this._update, this);
    this._update();
    return div;
  },
  _mpp() {
    const z = this._map.getZoom(), lat = this._map.getCenter().lat;
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
  },
  _nice(maxM, unitM, unit) {
    const steps = [0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000];
    const maxU = maxM / unitM;
    // largest clean step that fits within maxWidth (≤ maxU)
    let v = steps[0];
    for (const s of steps) { if (s <= maxU) v = s; else break; }
    return { px: v * unitM / this._mpp(), label: v + ' ' + unit };
  },
  _update() {
    const maxM = this.options.maxWidth * this._mpp();
    const km = this._nice(maxM, 1000, 'km');
    const nm = this._nice(maxM, 1852, 'NM');
    this._kmBar.style.width = Math.min(km.px, this.options.maxWidth) + 'px';
    this._kmLbl.textContent = km.label;
    this._nmBar.style.width = Math.min(nm.px, this.options.maxWidth) + 'px';
    this._nmLbl.textContent = nm.label;
  }
});
new L.Control.DualScale().addTo(leafMap);

// ── 단일 공항 마스터 데이터 ──
// WX_AIRPORTS, APT_LATLNG, APT_NAME 모두 여기서 파생
const AIRPORTS_KR = [
  { icao:'RKSI', name:'인천',  lat:37.4603, lon:126.4400 },
  { icao:'RKSS', name:'김포',  lat:37.5581, lon:126.7911 },
  { icao:'RKPK', name:'김해',  lat:35.1786, lon:128.9389 },
  { icao:'RKPC', name:'제주',  lat:33.5108, lon:126.4947 },
  { icao:'RKTU', name:'청주',  lat:36.7186, lon:127.4989 },
  { icao:'RKJJ', name:'광주',  lat:35.1231, lon:126.8092 },
  { icao:'RKJK', name:'군산',  lat:35.9039, lon:126.6158 },
  { icao:'RKJY', name:'여수',  lat:34.8423, lon:127.6170 },
  { icao:'RKJB', name:'무안',  lat:34.9914, lon:126.3829 },
  { icao:'RKPS', name:'사천',  lat:35.0886, lon:128.0703 },
  { icao:'RKTH', name:'포항',  lat:35.9878, lon:129.4201 },
  { icao:'RKPU', name:'울산',  lat:35.5934, lon:129.3520 },
  { icao:'RKTN', name:'대구',  lat:35.8939, lon:128.6586 },
  { icao:'RKNN', name:'강릉',  lat:37.7537, lon:128.9437 },
  { icao:'RKNY', name:'양양',  lat:38.0611, lon:128.6689 },
  { icao:'RKNS', name:'속초',  lat:38.1427, lon:128.5986 },
  { icao:'RKSM', name:'성남',  lat:37.4458, lon:127.1142 },
  { icao:'RKSW', name:'수원',  lat:37.2394, lon:127.0070 },
  { icao:'RKSO', name:'오산',  lat:37.0911, lon:127.0300 },
  { icao:'RKNW', name:'원주',  lat:37.4381, lon:127.9603 },
  { icao:'RKTY', name:'예천',  lat:36.6319, lon:128.3519 },
  { icao:'RKTI', name:'중원',  lat:37.0295, lon:127.8862 },
  { icao:'RKTL', name:'울진',  lat:36.7769, lon:129.4617 },
  // 이천의 ICAO는 RKRN이다. RKUC는 조치원 — 좌표(37.20N/127.47E)와 AIRFIELD_INFO의
  // 코드 체계(이천 'RN' / 조치원 'UC') 두 곳이 모두 이천임을 가리켜 ICAO를 바로잡았다.
  { icao:'RKRN', name:'이천',  lat:37.2011, lon:127.4719 },
  { icao:'RKPD', name:'정석',  lat:33.3983, lon:126.7131 },
  { icao:'RKSG', name:'평택',  lat:36.9600, lon:127.0333 },
  // 서산은 AIP AD 2 차트로 ARP를 아직 대조하지 못했다(공개 위치값).
  { icao:'RKTP', name:'서산',  lat:36.7039, lon:126.4861 },
  // 태안 ARP — 한서대학교 태안비행장 비행절차(2025-09-01) 제2장 제1절 7항
  //   N 36°35.63′ / E 126°17.80′
  // 검증: 활주로 시단 두 점(RWY34 N36°35.36′ E126°17.99′, RWY16 N36°35.91′ E126°17.59′)
  //       사이 거리 1180m = 문서의 활주로 길이, 진방위 329.7°+자편차 = 338° = 문서 방향.
  { icao:'RKTA', name:'태안',  lat:36.5938, lon:126.2967 },
];

// ── 공항 목록 단일 소스 ──
// 과거에 AIRPORTS(15개)와 AIRPORTS_KR(26개)이 따로 있어 6개 공항 좌표가 어긋나 있었고,
// 사천이 RKTL(실제 울진), 울산이 RKDU(존재하지 않는 코드)로 잘못 들어가 있었다.
// 이제 AIRPORTS_KR만 유지하고 나머지는 전부 여기서 파생한다.
const AIRPORTS = AIRPORTS_KR.map(a => ({ ident: a.icao, name: a.name, lat: a.lat, lon: a.lon }));
// 비행계획 화면의 빠른 추가 버튼(표시 순서) — 좌표·명칭은 위 단일 소스에서 조회
const FP_PRESET_ICAOS = ['RKSI','RKSS','RKPK','RKPC','RKTU','RKJJ','RKJK','RKJY',
                         'RKJB','RKPS','RKTH','RKPU','RKNN','RKNY','RKNS'];
const FP_PRESETS = FP_PRESET_ICAOS.map(ic => AIRPORTS.find(a => a.ident === ic)).filter(Boolean);


function toggleLayer() {
  const btn = document.getElementById('layer-btn');
  if (currentLayer === 'osm') {
    leafMap.removeLayer(osmLayer);
    satLayer.addTo(leafMap);
    currentLayer = 'sat';
    btn.textContent = 'MAP';
    btn.classList.add('sat');
  } else {
    leafMap.removeLayer(satLayer);
    osmLayer.addTo(leafMap);
    currentLayer = 'osm';
    btn.textContent = 'SAT';
    btn.classList.remove('sat');
  }
}

// ── RainViewer precipitation overlay ──


// ══════════════════════════════════════════════════════
// 3D TERRAIN MAP  (Maplibre GL JS)
// ══════════════════════════════════════════════════════
let _ml3d = null;          // Maplibre GL map instance (lazy init)
let _ml3dMarker = null;    // aircraft marker on 3D map
let _view3dOn = false;
let _ml3dPitch = 70;       // current 3D map pitch (adjustable via tilt buttons)
// 카메라를 움직여도 되는 상태인가.
// 종전에는 _ml3d.loaded() 로 물었다. 그건 "스타일도 타일도 전부 준비됨" 이라
// 비행 중 새 타일을 받는 동안 계속 false 가 되고, 그 사이 1인칭 추종과 방위
// 맞추기가 통째로 멈췄다 — 네트워크가 느릴수록 "3D 에서 안 된다" 가 된다.
// (load 이벤트를 기다리는 것도 같은 함정이다. 타일이 안 잡히면 영영 안 온다)
// 카메라 이동(easeTo)은 타일도 스타일도 필요 없다 — 지도 객체가 만들어진
// 순간부터 허용한다. 타일이 필요한 일(항적 소스·비 레이어)만 따로 기다린다.
let _ml3dReady = false;

function tiltAdj(delta) {
  _ml3dPitch = Math.max(0, Math.min(85, _ml3dPitch + delta));
  if (_ml3d && _ml3dReady) {
    if (followMode) {
      _applyFollow(); // let follow recalculate with new pitch
    } else {
      _ml3d.easeTo({ pitch: _ml3dPitch, duration: 200 });
    }
  }
}

function toggle3dMap() {
  const btn = document.getElementById('layer-btn-3d');
  const div3d = document.getElementById('map3d');
  const wrap = document.getElementById('map-wrap');

  // Library must be loaded
  if (typeof maplibregl === 'undefined') {
    if (btn) { btn.textContent = '3D ✕'; setTimeout(() => btn.textContent = '3D', 1500); }
    console.error('[3D] maplibre-gl failed to load');
    return;
  }

  _view3dOn = !_view3dOn;
  btn.classList.toggle('active', _view3dOn);

  const tiltCtrl = document.getElementById('tilt-ctrl');
  if (_view3dOn) {
    div3d.classList.add('active');
    wrap.classList.add('map3d-on');
    if (tiltCtrl) tiltCtrl.classList.add('active');
    _init3dMap();
    // Container just became visible — force a resize once layout settles
    requestAnimationFrame(() => {
      if (_ml3d) { _ml3d.resize(); _applyFollow(); }
    });
  } else {
    div3d.classList.remove('active');
    wrap.classList.remove('map3d-on');
    if (tiltCtrl) tiltCtrl.classList.remove('active');
    // Returning to 2D — Leaflet needs to recompute its size; apply follow immediately
    setTimeout(() => {
      try { leafMap.invalidateSize(); } catch (e) { _swallow(e); }
      _applyFollow();
    }, 50);
  }
}

function _init3dMap() {
  if (_ml3d) {
    // Already initialised — just jump to current aircraft position
    _ml3d.resize();
    _ml3d.jumpTo({ center: [S.lon, S.lat] });
    _update3dMarker();
    return;
  }

  const SKY = {
    'sky-color': '#1a2a4a',
    'sky-horizon-blend': 0.5,
    'horizon-color': '#6699bb',
    'horizon-fog-blend': 0.3,
    'fog-color': '#aabbcc',
    'fog-ground-blend': 0.9
  };

  try {
    _ml3d = new maplibregl.Map({
      container: 'map3d',
      style: {
        version: 8,
        sources: {
          satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Tiles © Esri'
          },
          terrain: {
            type: 'raster-dem',
            encoding: 'terrarium',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            minzoom: 0, maxzoom: 15,
            tileSize: 256,
            attribution: 'Terrain © Tilezen/AWS'
          }
        },
        layers: [
          { id: 'satellite', type: 'raster', source: 'satellite' }
        ]
      },
      center: [S.lon, S.lat],
      zoom: 11,
      pitch: 55,
      bearing: 0,
      maxPitch: 85,
      attributionControl: false
    });
  } catch (e) {
    console.error('[3D] map init failed:', e);
    return;
  }

  _ml3dReady = true;   // 카메라는 지금부터 움직일 수 있다(타일을 기다리지 않는다)

  _ml3d.on('error', (e) => console.warn('[3D] map error:', e && e.error ? e.error.message : e));
  // 사용자가 3D 지도를 수동 회전할 때도 마커가 실제 기수를 가리키도록 갱신
  _ml3d.on('rotate', () => { try { _update3dMarker(); } catch(e) { _swallow(e); } });

  _ml3d.on('load', () => {
    _ml3dReady = true;
    // Terrain is best-effort — a DEM failure must not blank the satellite view
    try { _ml3d.setTerrain({ source: 'terrain', exaggeration: 1.5 }); }
    catch (e) { console.warn('[3D] terrain unavailable:', e); }
    try { _ml3d.setSky(SKY); } catch (e) { /* sky optional */ }

    // Aircraft marker. Maplibre controls the OUTER element's transform for
    // positioning, so heading rotation is applied to an INNER wrapper instead.
    const el = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;';
    const inner = document.createElement('div');
    inner.className = 'ac3d-inner';
    inner.style.cssText = 'width:18px;height:18px;transition:transform 0.1s linear;';
    inner.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
      <polygon points="12,2 15,18 12,15 9,18" fill="#00ff88" stroke="#000" stroke-width="1"/>
    </svg>`;
    el.appendChild(inner);
    _ml3dMarker = new maplibregl.Marker({ element: el, pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
      .setLngLat([S.lon, S.lat])
      .addTo(_ml3d);
    // Aircraft trail — draped on terrain surface (no z, terrain-following)
    _ml3d.addSource('ac-trail', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
    });
    _ml3d.addLayer({
      id: 'ac-trail', type: 'line', source: 'ac-trail',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#00ff88',
        'line-width': 2.5,
        'line-opacity': 0.85
      }
    }, _firstSymbolLayerId());

    _update3dMarker();
    _update3dTrail();
    if (_fdrTrack.length) _fdrDraw3dTrackRoute();
    // 레이더가 이미 켜져 있으면 3D에도 적용
    if (rainActive && _rainFrames.length) {
      const f = _rainFrames[_rainFrameIdx];
      const tileUrl = `${f._host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
      try {
        _ml3d.addSource('rain-src', { type:'raster', tiles:[tileUrl], tileSize:256, attribution:'RainViewer' });
        _ml3d.addLayer({ id:'rain-layer', type:'raster', source:'rain-src', paint:{'raster-opacity':0.55} }, _firstSymbolLayerId());
      } catch {}
    }
    _ml3d.resize();
  });

  _ml3d.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  // 2D와 동일한 km+NM 이중 축척 위젯(.vfr-scale) — maplibre 컨트롤 컨테이너를
  // 거치지 않고 지도 컨테이너에 직접 절대배치(left:10px)해 2D와 픽셀 단위로 정렬
  const _sc3d = new DualScale3D();
  const _sc3dEl = _sc3d.onAdd(_ml3d);
  _sc3dEl.style.cssText += ';position:absolute;left:10px;bottom:62px;z-index:850;margin:0;';
  _ml3d.getContainer().appendChild(_sc3dEl);
}

// 3D(maplibre)용 이중 축척 — 2D L.Control.DualScale과 동일한 마크업/CSS·계산방식
class DualScale3D {
  onAdd(map) {
    this._map = map;
    const div = document.createElement('div');
    div.className = 'vfr-scale';
    const kmRow = document.createElement('div'); kmRow.className = 'vfr-scale-row';
    this._kmBar = document.createElement('div'); this._kmBar.className = 'vfr-scale-bar vfr-scale-km';
    this._kmLbl = document.createElement('span');
    kmRow.appendChild(this._kmBar); kmRow.appendChild(this._kmLbl);
    const nmRow = document.createElement('div'); nmRow.className = 'vfr-scale-row';
    this._nmBar = document.createElement('div'); this._nmBar.className = 'vfr-scale-bar vfr-scale-nm';
    this._nmLbl = document.createElement('span');
    nmRow.appendChild(this._nmBar); nmRow.appendChild(this._nmLbl);
    div.appendChild(kmRow); div.appendChild(nmRow);
    this._div = div;
    this._upd = () => this._update();
    map.on('move', this._upd);
    this._update();
    return div;
  }
  onRemove() { if (this._map) this._map.off('move', this._upd); if (this._div) this._div.remove(); }
  _mpp() {
    // 화면 하단(축척 위치) 부근에서 가로 100px에 해당하는 지상거리로 m/px 산출
    // → 3D 틸트/원근에서도 실제 축척과 근사
    const c = this._map.getContainer();
    const y = Math.max(1, c.clientHeight - 60);
    const p0 = this._map.unproject([20, y]), p1 = this._map.unproject([120, y]);
    return (distance(p0.lat, p0.lng, p1.lat, p1.lng) * 1852) / 100;   // m/px
  }
  _nice(maxM, unitM, unit, mpp) {
    const steps = [0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000];
    const maxU = maxM / unitM;
    let v = steps[0];
    for (const s of steps) { if (s <= maxU) v = s; else break; }
    return { px: v * unitM / mpp, label: v + ' ' + unit };
  }
  _update() {
    const MAXW = 120, mpp = this._mpp();
    if (!isFinite(mpp) || mpp <= 0) return;
    const maxM = MAXW * mpp;
    const km = this._nice(maxM, 1000, 'km', mpp);
    const nm = this._nice(maxM, 1852, 'NM', mpp);
    this._kmBar.style.width = Math.min(km.px, MAXW) + 'px'; this._kmLbl.textContent = km.label;
    this._nmBar.style.width = Math.min(nm.px, MAXW) + 'px'; this._nmLbl.textContent = nm.label;
  }
}

function _update3dMarker() {
  if (!_ml3d || !_view3dOn || !_ml3dMarker) return;
  _ml3dMarker.setLngLat([S.lon, S.lat]);
  // Rotate the inner wrapper (outer element's transform is owned by maplibre)
  // rotationAlignment:'viewport'(화면 기준)이므로 카메라 방위를 빼야
  // 삼각형이 실제 기수방향을 가리킨다 (예: 팔로우 중에는 항상 화면 위쪽).
  const inner = _ml3dMarker.getElement().querySelector('.ac3d-inner');
  if (inner) inner.style.transform = `rotate(${S.hdg - _ml3d.getBearing()}deg)`;
}

let rainLayer = null;
let rainActive = false;
let _rainFrames = [];
let _rainFrameIdx = 0;
let _rainAnimTimer = null;
let _rainRefreshTimer = null;
let _rain3dLayerId = null;

async function _loadRainFrames() {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  const data = await res.json();
  return { host: data.host, frames: data.radar.past.slice(-6) }; // 최근 6프레임
}

function _setRainFrame(host, frame) {
  if (rainLayer) { leafMap.removeLayer(rainLayer); rainLayer = null; }
  const tileUrl = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  rainLayer = L.tileLayer(tileUrl, { opacity: 0.6, attribution: 'RainViewer', zIndex: 500 });
  rainLayer.addTo(leafMap);

  // 3D 맵에도 적용
  if (_ml3d && _ml3d.loaded()) {
    const src = _ml3d.getSource ? _ml3d.getSource('rain-src') : null;
    if (src) {
      src.tiles = [tileUrl];
      src.setTiles([tileUrl]);
    } else {
      try {
        if (_ml3d.getSource('rain-src')) _ml3d.removeLayer('rain-layer'), _ml3d.removeSource('rain-src');
      } catch {}
      _ml3d.addSource('rain-src', { type:'raster', tiles:[tileUrl], tileSize:256, attribution:'RainViewer' });
      _ml3d.addLayer({ id:'rain-layer', type:'raster', source:'rain-src', paint:{'raster-opacity':0.55} }, _firstSymbolLayerId());
      _rain3dLayerId = 'rain-layer';
    }
  }

  // 타임스탬프 표시
  const ts = new Date(frame.time * 1000);
  const label = `${ts.getUTCHours().toString().padStart(2,'0')}:${ts.getUTCMinutes().toString().padStart(2,'0')}Z`;
  const btn = document.getElementById('rain-btn');
  if (btn) btn.textContent = `RAIN ${label}`;
}

function _startRainAnim() {
  if (_rainAnimTimer) clearInterval(_rainAnimTimer);
  _rainAnimTimer = setInterval(() => {
    if (!_rainFrames.length) return;
    _rainFrameIdx = (_rainFrameIdx + 1) % _rainFrames.length;
    _setRainFrame(_rainFrames[0]._host, _rainFrames[_rainFrameIdx]);
  }, 800);
}

function _stopRainAnim() {
  if (_rainAnimTimer) { clearInterval(_rainAnimTimer); _rainAnimTimer = null; }
}

async function toggleRain() {
  const btn = document.getElementById('rain-btn');
  if (rainActive) {
    _stopRainAnim();
    if (_rainRefreshTimer) { clearInterval(_rainRefreshTimer); _rainRefreshTimer = null; }
    if (rainLayer) { leafMap.removeLayer(rainLayer); rainLayer = null; }
    if (_ml3d && _ml3d.loaded()) {
      try { _ml3d.removeLayer('rain-layer'); _ml3d.removeSource('rain-src'); } catch {}
    }
    rainActive = false;
    btn.classList.remove('rain-active');
    btn.textContent = 'RAIN';
    return;
  }
  btn.textContent = '…';
  try {
    const { host, frames } = await _loadRainFrames();
    _rainFrames = frames.map(f => ({ ...f, _host: host }));
    _rainFrameIdx = _rainFrames.length - 1;
    _setRainFrame(host, _rainFrames[_rainFrameIdx]);
    rainActive = true;
    btn.classList.add('rain-active');
    _startRainAnim();
    // 5분마다 자동 갱신
    _rainRefreshTimer = setInterval(async () => {
      try {
        const { host: h2, frames: f2 } = await _loadRainFrames();
        _rainFrames = f2.map(f => ({ ...f, _host: h2 }));
        _rainFrameIdx = _rainFrames.length - 1;
      } catch {}
    }, 5 * 60 * 1000);
  } catch (e) {
    btn.textContent = 'RAIN';
    uiAlert('강수 레이더 로드 실패. 네트워크를 확인하세요.');
  }
}

let windLayer = null;
let windActive = false;

async function loadWindLayer() {
  const bounds = leafMap.getBounds();
  const latMin = bounds.getSouth(), latMax = bounds.getNorth();
  const lonMin = bounds.getWest(), lonMax = bounds.getEast();
  const gridN = 8;
  const latStep = (latMax - latMin) / (gridN - 1);
  const lonStep = (lonMax - lonMin) / (gridN - 1);

  const lats = [], lons = [];
  for (let i = 0; i < gridN; i++) {
    lats.push(+(latMin + i * latStep).toFixed(4));
    lons.push(+(lonMin + i * lonStep).toFixed(4));
  }

  const latParam = lats.join(',');
  const lonParam = lons.join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latParam}&longitude=${lonParam}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timeformat=unixtime`;

  const res = await fetch(url);
  const data = await res.json();
  const entries = Array.isArray(data) ? data : [data];

  const uData = [], vData = [];
  for (let j = 0; j < gridN; j++) {
    const row = entries[j] || entries[0];
    const spd = row.current.wind_speed_10m;
    const dir = row.current.wind_direction_10m * Math.PI / 180;
    const u = -spd * Math.sin(dir);
    const v = -spd * Math.cos(dir);
    for (let i = 0; i < gridN; i++) {
      uData.push(u);
      vData.push(v);
    }
  }

  const velocityData = [
    {
      header: {
        parameterCategory: 2, parameterNumber: 2,
        lo1: lonMin, lo2: lonMax, la1: latMax, la2: latMin,
        dx: (lonMax - lonMin) / (gridN - 1), dy: (latMax - latMin) / (gridN - 1),
        nx: gridN, ny: gridN
      },
      data: uData
    },
    {
      header: {
        parameterCategory: 2, parameterNumber: 3,
        lo1: lonMin, lo2: lonMax, la1: latMax, la2: latMin,
        dx: (lonMax - lonMin) / (gridN - 1), dy: (latMax - latMin) / (gridN - 1),
        nx: gridN, ny: gridN
      },
      data: vData
    }
  ];

  return L.velocityLayer({
    data: velocityData,
    maxVelocity: 20,
    velocityScale: 0.008,
    particleAge: 64,
    lineWidth: 1.5,
    particleMultiplier: 0.003,
    colorScale: ['#ffffcc','#a1dab4','#41b6c4','#2c7fb8','#253494'],
    displayValues: true,
    displayOptions: {
      velocityType: 'Wind',
      position: 'bottomleft',
      emptyString: '바람 데이터 없음',
      angleConvention: 'bearingCCW',
      speedUnit: 'm/s'
    }
  });
}

let _windAptLayer = null;

async function _loadAirportWinds() {
  // Open-Meteo에서 모든 공항 풍향/풍속 병렬 요청
  const base = 'https://api.open-meteo.com/v1/forecast?current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timeformat=unixtime';
  const results = await Promise.allSettled(
    AIRPORTS_KR.map(a =>
      fetch(`${base}&latitude=${a.lat}&longitude=${a.lon}`)
        .then(r => r.json())
        .then(d => ({ icao: a.icao, name: a.name, lat: a.lat, lon: a.lon,
          spd: Math.round(d.current.wind_speed_10m),
          dir: Math.round(d.current.wind_direction_10m) }))
    )
  );
  return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

function _makeWindIcon(dir, spd) {
  const color = spd < 10 ? '#88ffcc' : spd < 20 ? '#ffdd44' : '#ff6644';
  return L.divIcon({
    className: '',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    html: `<div style="width:48px;height:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;">
      <div style="font-size:18px;transform:rotate(${dir}deg);line-height:1;color:${color};">↑</div>
      <div style="font-size:9px;color:${color};font-weight:bold;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;line-height:1.2;">${spd}kt</div>
    </div>`,
  });
}

async function toggleWind() {
  const btn = document.getElementById('wind-btn');
  if (windActive) {
    if (windLayer) { leafMap.removeLayer(windLayer); windLayer = null; }
    if (_windAptLayer) { leafMap.removeLayer(_windAptLayer); _windAptLayer = null; }
    windActive = false;
    btn.classList.remove('wind-active');
    btn.textContent = 'WIND';
    return;
  }
  btn.textContent = '…';
  try {
    // 속도장 레이어 + 공항 풍향 화살표 동시 로드
    const [wl, aptWinds] = await Promise.all([loadWindLayer(), _loadAirportWinds()]);
    windLayer = wl;
    windLayer.addTo(leafMap);

    _windAptLayer = L.layerGroup(
      aptWinds.map(w => L.marker([w.lat, w.lon], { icon: _makeWindIcon(w.dir, w.spd), zIndexOffset: 600 })
        .bindTooltip(`${w.icao} ${w.name}<br>${fmtA(toMag(w.dir))}° / ${w.spd}kt`, { direction:'top', offset:[0,-24] }))
    ).addTo(leafMap);

    windActive = true;
    btn.classList.add('wind-active');
    btn.textContent = 'WIND';
  } catch (e) {
    console.error('Wind layer error:', e);
    btn.textContent = 'WIND';
    uiAlert('바람 데이터 로드 실패. 네트워크를 확인하세요.');
  }
}

function makeAircraftIcon(hdg) {
  return L.divIcon({
    html:`<div class="ac-marker" style="transform:rotate(${hdg}deg);transform-origin:12px 12px;">
      <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <!-- Main rotor disk -->
        <circle cx="12" cy="12" r="9" fill="none" stroke="#00ff88" stroke-width="0.7" stroke-dasharray="2 1.5" opacity="0.55"/>
        <!-- Fuselage (forward of mast) -->
        <ellipse cx="12" cy="11" rx="2.8" ry="4.4" fill="#00ff88" stroke="#003322" stroke-width="0.7"/>
        <!-- Cockpit dot at nose -->
        <circle cx="12" cy="8" r="1" fill="#003322"/>
        <!-- Tail boom -->
        <rect x="11.3" y="14" width="1.4" height="7" fill="#00ff88" stroke="#003322" stroke-width="0.5"/>
        <!-- Tail rotor -->
        <line x1="9" y1="21" x2="15" y2="21" stroke="#00ff88" stroke-width="1.6" stroke-linecap="round"/>
      </svg></div>`,
    iconSize:[24,24],iconAnchor:[12,12],className:'',
  });
}

let acMarker = L.marker([S.lat,S.lon],{icon:makeAircraftIcon(S.hdg),draggable:true,zIndexOffset:1000}).addTo(leafMap);
let acDragging = false;
let _acEl = null; // track DOM element to avoid duplicate listeners

function _bindAcPointerDown() {
  const el = acMarker.getElement();
  if (!el || el === _acEl) return;
  _acEl = el;
  const onDown = () => { acDragging = true; };
  el.addEventListener('mousedown',  onDown);
  el.addEventListener('touchstart', onDown, {passive: true});
}
setTimeout(_bindAcPointerDown, 0);

// dragstart is too late (after Leaflet detects movement threshold), so we use DOM events above
acMarker.on('drag',    e => { const p=e.target.getLatLng(); S.lat=p.lat; S.lon=p.lng; updateNav(); });
acMarker.on('dragend', () => { acDragging=false; S.trail=[]; updateTrail(); updateNav(); });

// Fallback reset in case dragend doesn't fire
document.addEventListener('mouseup',  () => { acDragging = false; });
document.addEventListener('touchend', () => { acDragging = false; });

