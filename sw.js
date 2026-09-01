// VFR Flight Sim — Service Worker
// 버전을 올리면 캐시가 갱신됩니다
const CACHE = 'vfr-flight-v402';
const CORE  = [
  './index.html',
  './manifest.json',
  './icon.png',
  './icon-512.png',
  // 외부 라이브러리 사본 — CDN 이 안 받아지면 앱이 통째로 죽으므로 직접 들고 있다
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/leaflet-velocity.min.js',
  './vendor/leaflet-velocity.min.css',
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
  './vendor/jszip.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  // AIP 데이터 — 코드보다 먼저 로드된다
  './js/data/terminal-fixes.js',
  './js/data/ifr-fixes.js',
  './js/data/ifr-procedures.js',
  './js/data/airfield-info.js',
  './js/data/enr-vors.js',
  './js/data/loc-stations.js',
  './js/data/enr-routes.js',
  './js/data/airspace.js',
  // 앱 코드 — index.html 에서 분리한 조각들(로드 순서 = 실행 순서)
  './js/00-ui.js',
  './js/01-state.js',
  './js/02-math.js',
  './js/03-pfd.js',
  './js/04-map.js',
  './js/05-gps.js',
  './js/06-nav.js',
  './js/07-sim.js',
  './js/08-ifrdb.js',
  './js/09-cdu.js',
  './js/10-tools.js',
  './js/11-charts.js',
  './js/12-joystick.js',
  './js/13-joyhid.js',
];

// 설치 시 핵심 파일 캐시 (HTTP 캐시 우회로 항상 최신본 저장)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(CORE.map(u =>
        fetch(new Request(u, { cache: 'reload' }))
          .then(res => res && res.ok ? c.put(u, res) : null)
          .catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

// 오래된 캐시 정리
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선 → 실패 시 캐시 (Leaflet 타일은 네트워크 필요)
self.addEventListener('fetch', e => {
  // GET 외(POST 등)는 SW가 관여하지 않음
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // OSM 지도 타일: 캐시 우선
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open('vfr-tiles').then(c =>
        c.match(e.request).then(cached => {
          const fresh = fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; });
          return cached || fresh;
        })
      )
    );
    return;
  }

  // Esri 위성 타일: 캐시 우선
  if (url.includes('arcgisonline.com')) {
    e.respondWith(
      caches.open('vfr-sat-tiles').then(c =>
        c.match(e.request).then(cached => {
          const fresh = fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; });
          return cached || fresh;
        })
      )
    );
    return;
  }

  // 3D 지형(DEM) 타일: 캐시 우선 (CORS 응답만 캐시)
  if (url.includes('elevation-tiles-prod')) {
    e.respondWith(
      caches.open('vfr-dem-tiles').then(c =>
        c.match(e.request).then(cached => {
          const fresh = fetch(e.request).then(res => {
            if (res && res.ok) c.put(e.request, res.clone());
            return res;
          });
          return cached || fresh;
        })
      )
    );
    return;
  }

  // 여기부터는 우리 앱 파일 이야기다. 남의 출처(eAIP 차트 등)는 손대지 않는다.
  // 종전에는 모든 GET 을 가로챘는데 그 탓에 두 가지가 망가졌다.
  //   · 교차 출처 응답을 앱 캐시에 넣어, no-cors 로 받은 opaque 응답이 뒤이은
  //     cors 요청에 그대로 나갔다 ("Response served by service worker is opaque")
  //   · 실패하면 index.html 을 돌려줘, 차트 PDF 자리에 앱 HTML 이 들어갔다
  if (new URL(url).origin !== self.location.origin) return;

  // 앱 파일: 네트워크 우선 → 실패 시 캐시 (index.html 업데이트가 즉시 반영됨)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
