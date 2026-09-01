// ─────────────────────────────────────────────────────────────
// loc-stations.js — 로컬라이저(ILS LOC) 표지소
//
// 출처: AIP Republic of Korea, 각 공항 AD 2.19 RADIO NAVIGATION AND LANDING AIDS
// 좌표는 그 표의 '송신 안테나 위치' 를 그대로 옮긴 값이다(도분초 → 십진도).
// 접근 코스(crs)는 자북 기준이다 — 출처는 아래 crsSrc 참고.
//
// 검증: LOC 안테나에서 GP 안테나를 본 방위가 '접근 코스의 반대' 와 ±6° 안에서
// 맞는다. GP 안테나가 활주로 옆으로 100m 남짓 비켜 있어 그만큼 차이가 난다 —
// 좌표와 코스가 서로 어긋나지 않았다는 뜻이다.
//
// dme.elev 는 ft. AIP 는 m 로 싣는다(30m = 98ft).
// gp.angle 은 강하각(°). AIP 비고에 실린 곳만 적고, 없으면 3.0° 로 본다.
//
// crs(접근 코스, 자북)의 출처 — crsSrc 로 밝힌다.
//   (없음)  AIP 게재 ILS 접근 코스
//   'pair'  같은 활주로 양끝의 LOC 안테나를 잇는 방위에서 냈다. 두 안테나가
//           모두 중심선 연장선 위에 있어 기준선이 수 km 로 길다. 게재값이 있는
//           7곳에서 이 방법이 +0.7~+1.4° 높게 나와 1° 를 뺐다 — ±1° 안이다.
//   'gp'    반대편 LOC 이 없어 GP 안테나로 냈다. GP 는 활주로 옆으로 100m 남짓
//           비켜 있어 ±3° 쯤 어긋난다.
//   'rwy'   기준선이 없어 활주로 표기(예: RWY 19 → 190°)를 그대로 썼다.
// 게재 코스를 받으면 그 값으로 바꾸고 crsSrc 를 지운다.
// ─────────────────────────────────────────────────────────────
const LOC_STATIONS = [
  // ── RKSS 김포 (AIP AMDT 8/25 · 1/26) ──
  { apt:'RKSS', name:'김포', rwy:'14R', id:'IOFR', freq:'108.70', lat:37.545972, lon:126.803583, crs:143, cat:'II/III',
    gp:{ freq:'330.5', lat:37.567167, lon:126.778889 },
    dme:{ freq:'985', ch:'24X', lat:37.567194, lon:126.778944, elev:98 } },
  { apt:'RKSS', name:'김포', rwy:'14L', id:'ISEL', freq:'109.90', lat:37.545722, lon:126.809639, crs:143, cat:'I',
    gp:{ freq:'333.8', lat:37.56775, lon:126.780056 },
    dme:{ freq:'997', ch:'36X', lat:37.567722, lon:126.780028, elev:98 } },
  { apt:'RKSS', name:'김포', rwy:'32R', id:'ISKP', freq:'110.70', lat:37.572694, lon:126.775778, crs:323, cat:'I',
    gp:{ freq:'330.2', lat:37.549, lon:126.803639 },
    dme:{ freq:'1005', ch:'44X', lat:37.548972, lon:126.803583, elev:98 } },
  { apt:'RKSS', name:'김포', rwy:'32L', id:'IKMO', freq:'108.30', lat:37.570389, lon:126.772944, crs:323, cat:'I',
    gp:{ freq:'334.1', lat:37.54925, lon:126.797556 },
    dme:{ freq:'981', ch:'20X', lat:37.549222, lon:126.797556, elev:98 } },

  // ── RKTU 청주 (AIP AMDT 1/26) ──
  { apt:'RKTU', name:'청주', rwy:'24R', id:'ICHG', freq:'111.70', lat:36.708333, lon:127.484056, crs:240,
    gp:{ freq:'333.5', lat:36.724278, lon:127.507694 },
    dme:{ freq:'1015', ch:'54X', lat:36.724278, lon:127.507694, elev:295 } },
  { apt:'RKTU', name:'청주', rwy:'24L', id:'ICHL', freq:'109.35', lat:36.706139, lon:127.484694, crs:240,
    gp:{ freq:'331.85', lat:36.720556, lon:127.509833 },
    dme:{ freq:'1054', ch:'30Y', lat:36.720583, lon:127.509778, elev:295 } },
  { apt:'RKTU', name:'청주', rwy:'06L', id:'ICHJ', freq:'110.30', lat:36.726833, lon:127.513917, crs:60,
    gp:{ freq:'335.0', lat:36.711, lon:127.490167 },
    dme:{ freq:'1001', ch:'40X', lat:36.710944, lon:127.490194, elev:295 } },
  { apt:'RKTU', name:'청주', rwy:'06R', id:'ICHR', freq:'109.15', lat:36.724639, lon:127.514556, crs:60,
    gp:{ freq:'331.25', lat:36.708806, lon:127.490778 },
    dme:{ freq:'1052', ch:'28Y', lat:36.708806, lon:127.490778, elev:295 } },

  // ── RKTN 대구 (AIP AMDT 9/25) ──
  // 31L 과 13R 은 같은 주파수(108.7)를 쓴다 — 한쪽만 운용된다.
  { apt:'RKTN', name:'대구', rwy:'31L', id:'ITAG', freq:'108.70', lat:35.90225, lon:128.642861, crs:312, cat:'I',
    gp:{ freq:'330.5', lat:35.887583, lon:128.667472 },
    dme:{ freq:'985', ch:'24X', lat:35.887556, lon:128.667444 } },
  { apt:'RKTN', name:'대구', rwy:'31R', id:'IDAG', freq:'111.90', lat:35.903222, lon:128.643611, crs:312,
    dme:{ freq:'1017', ch:'56X', lat:35.903833, lon:128.644083 } },
  { apt:'RKTN', name:'대구', rwy:'13R', id:'ITGL', freq:'108.70', lat:35.885, lon:128.674056, crs:132, cat:'I',
    gp:{ freq:'330.5', lat:35.898306, lon:128.647972 },
    dme:{ freq:'985', ch:'24X', lat:35.898278, lon:128.647917 } },

  // ── RKTL 울진 (AIP AMDT 3/26) ──
  { apt:'RKTL', name:'울진', rwy:'17', id:'IUJS', freq:'111.15', lat:36.76675, lon:129.46575, crs:171, cat:'I',
    gp:{ freq:'331.55', lat:36.781778, lon:129.458528 },
    dme:{ freq:'1135', ch:'48Y', lat:36.781778, lon:129.4585, elev:197 } },
  { apt:'RKTL', name:'울진', rwy:'35', id:'IUJN', freq:'108.10', lat:36.787333, lon:129.457778, crs:351, cat:'I',
    gp:{ freq:'334.7', lat:36.771306, lon:129.462583 },
    dme:{ freq:'979', ch:'18X', lat:36.771306, lon:129.462528, elev:197 } },

  // ── RKTH 포항 (AIP AMDT 10/25) ──
  { apt:'RKTH', name:'포항', rwy:'10', id:'IKPO', freq:'110.90', lat:35.988083, lon:129.434, crs:97,
    dme:{ freq:'1007', ch:'46X', lat:35.987694, lon:129.4345, elev:98 } },

  // ── RKSM 서울(성남) (AIP AMDT 6/22) ──
  { apt:'RKSM', name:'서울(성남)', rwy:'20', id:'ISOL', freq:'110.90', lat:37.429556, lon:127.110083, crs:193, crsSrc:'gp',
    gp:{ freq:'330.8', lat:37.456333, lon:127.113556 }, dme:{ freq:'1007', ch:'46X', lat:37.456333, lon:127.113528, elev:100 } },
  { apt:'RKSM', name:'서울(성남)', rwy:'19', id:'ISUL', freq:'108.95', lat:37.431278, lon:127.114861, crs:190, crsSrc:'rwy',
    dme:{ freq:'1113', ch:'26Y', lat:37.431528, lon:127.11575, elev:100 } },

  // ── RKSI 인천 (AIP AMDT 12/25) ──
  // 평행 활주로 4본이라 15/33 · 16/34 로 나눠 표기하지만 방위는 모두 같다.
  { apt:'RKSI', name:'인천', rwy:'16R', id:'IRFS', freq:'108.55', lat:37.439056, lon:126.439833, crs:153, crsSrc:'pair', cat:'III',
    gp:{ freq:'329.75', lat:37.465806, lon:126.414333 }, dme:{ freq:'1109', ch:'22Y', lat:37.465833, lon:126.414361, elev:0 } },
  { apt:'RKSI', name:'인천', rwy:'34L', id:'IRFN', freq:'109.95', lat:37.470972, lon:126.411417, crs:333, crsSrc:'pair', cat:'III',
    gp:{ freq:'333.65', lat:37.442944, lon:126.434667 }, dme:{ freq:'1123', ch:'36Y', lat:37.442972, lon:126.434694, elev:0 } },
  { apt:'RKSI', name:'인천', rwy:'33R', id:'INRR', freq:'108.90', lat:37.486111, lon:126.438222, crs:333, crsSrc:'pair', cat:'III',
    gp:{ freq:'329.3', lat:37.459222, lon:126.463806 }, dme:{ freq:'987', ch:'26X', lat:37.459222, lon:126.463806, elev:0 } },
  { apt:'RKSI', name:'인천', rwy:'16L', id:'IRKS', freq:'110.35', lat:37.44125, lon:126.443639, crs:153, crsSrc:'pair', cat:'III',
    gp:{ freq:'334.85', lat:37.469806, lon:126.416528 }, dme:{ freq:'1127', ch:'40Y', lat:37.469833, lon:126.416583, elev:0 } },
  { apt:'RKSI', name:'인천', rwy:'34R', id:'IRKN', freq:'108.10', lat:37.474972, lon:126.413639, crs:333, crsSrc:'pair', cat:'III',
    gp:{ freq:'334.7', lat:37.445111, lon:126.4385 }, dme:{ freq:'979', ch:'18X', lat:37.445139, lon:126.438556, elev:0 } },
  { apt:'RKSI', name:'인천', rwy:'15R', id:'ISRR', freq:'109.10', lat:37.452056, lon:126.462778, crs:153, crsSrc:'pair', cat:'III',
    gp:{ freq:'331.4', lat:37.480194, lon:126.439444 }, dme:{ freq:'989', ch:'28X', lat:37.480194, lon:126.439417, elev:0 } },
  { apt:'RKSI', name:'인천', rwy:'33L', id:'INLL', freq:'109.30', lat:37.483944, lon:126.434417, crs:333, crsSrc:'pair', cat:'III',
    gp:{ freq:'332.0', lat:37.457083, lon:126.46 }, dme:{ freq:'991', ch:'30X', lat:37.457056, lon:126.459972, elev:0 } },
  { apt:'RKSI', name:'인천', rwy:'15L', id:'ISLL', freq:'111.90', lat:37.454194, lon:126.466583, crs:153, crsSrc:'pair', cat:'III',
    gp:{ freq:'331.1', lat:37.482361, lon:126.44325 }, dme:{ freq:'1017', ch:'56X', lat:37.482333, lon:126.443222, elev:0 } },

  // ── RKPU 울산 (AIP AMDT 1/26) ──
  { apt:'RKPU', name:'울산', rwy:'36', id:'IULS', freq:'110.30', lat:35.604528, lon:129.350806, crs:4, cat:'I',
    gp:{ freq:'335.0', lat:35.587167, lon:129.353361 }, dme:{ freq:'1001', ch:'40X', lat:35.587167, lon:129.353361, elev:98 } },

  // ── RKPS 사천 (AIP AMDT 2/26) ──
  { apt:'RKPS', name:'사천', rwy:'06L', id:'ISAM', freq:'109.10', lat:35.097389, lon:128.083889, crs:63, crsSrc:'pair',
    dme:{ freq:'989', ch:'28X', lat:35.097278, lon:128.084667, elev:0 } },
  { apt:'RKPS', name:'사천', rwy:'24R', id:'ISHA', freq:'108.10', lat:35.081278, lon:128.055222, crs:243, crsSrc:'pair', cat:'I',
    gp:{ freq:'334.7', lat:35.095611, lon:128.078278 , angle:3.2}, dme:{ freq:'979', ch:'18X', lat:35.095611, lon:128.078306, elev:0 } },

  // ── RKPK 김해 (AIP AMDT 10/25) ──
  { apt:'RKPK', name:'김해', rwy:'36L', id:'IKMA', freq:'108.50', lat:35.196556, lon:128.934778, crs:3, crsSrc:'gp', cat:'II',
    gp:{ freq:'329.9', lat:35.168, lon:128.937139 }, dme:{ freq:'983', ch:'22X', lat:35.168, lon:128.937111, elev:0 } },
  { apt:'RKPK', name:'김해', rwy:'36R', id:'IKHE', freq:'109.50', lat:35.196722, lon:128.937083, crs:358, crsSrc:'gp', cat:'I',
    gp:{ freq:'332.6', lat:35.172583, lon:128.941528 }, dme:{ freq:'993', ch:'32X', lat:35.172583, lon:128.941528, elev:0 } },

  // ── RKPD 정석 (AIP AMDT 8/25) ──
  { apt:'RKPD', name:'정석', rwy:'01', id:'IJDG', freq:'108.30', lat:33.406306, lon:126.711444, crs:3, crsSrc:'gp', cat:'I',
    gp:{ freq:'334.1', lat:33.385444, lon:126.712861 }, dme:{ freq:'981', ch:'20X', lat:33.3855, lon:126.712917, elev:1125 } },

  // ── RKPC 제주 (AIRAC AIP AMDT 3/25) ──
  { apt:'RKPC', name:'제주', rwy:'07', id:'ICJU', freq:'109.90', lat:33.516306, lon:126.500444, crs:65, cat:'II',
    gp:{ freq:'333.8', lat:33.502472, lon:126.471028 }, dme:{ freq:'997', ch:'36X', lat:33.5025, lon:126.471028, elev:98 } },
  { apt:'RKPC', name:'제주', rwy:'25', id:'ICHE', freq:'111.30', lat:33.498444, lon:126.465667, crs:245, cat:'I',
    gp:{ freq:'332.3', lat:33.514222, lon:126.494222 }, dme:{ freq:'1011', ch:'50X', lat:33.514278, lon:126.494194, elev:98 } },

  // ── RKNY 양양 (AIP AMDT 11/22) ──
  { apt:'RKNY', name:'양양', rwy:'33', id:'IYAN', freq:'109.30', lat:38.072111, lon:128.658056, crs:330,
    gp:{ freq:'332.0', lat:38.053861, lon:128.675028 }, dme:{ freq:'991', ch:'30X', lat:38.053833, lon:128.675, elev:246 } },

  // ── RKNW 원주 (AIP AMDT 6/25) ──
  { apt:'RKNW', name:'원주', rwy:'03', id:'IWNJ', freq:'110.10', lat:37.451472, lon:127.968778, crs:34, crsSrc:'pair', cat:'I',
    gp:{ freq:'334.40', lat:37.429722, lon:127.953944 , angle:3.3}, dme:{ freq:'999', ch:'38X', lat:37.429722, lon:127.953944, elev:0 } },
  { apt:'RKNW', name:'원주', rwy:'21', id:'IWON', freq:'111.50', lat:37.424722, lon:127.952167, crs:214, crsSrc:'pair', cat:'I',
    gp:{ freq:'332.90', lat:37.447167, lon:127.96475 , angle:3.3}, dme:{ freq:'1013', ch:'52X', lat:37.447167, lon:127.96475, elev:0 } },

  // ── RKJY 여수 (AIP AMDT 12/25) ──
  { apt:'RKJY', name:'여수', rwy:'17', id:'IYSO', freq:'111.50', lat:34.831111, lon:127.62275, crs:165, cat:'I',
    gp:{ freq:'332.9', lat:34.849222, lon:127.615111 }, dme:{ freq:'1013', ch:'52X', lat:34.84925, lon:127.615139, elev:98 } },
  { apt:'RKJY', name:'여수', rwy:'35', id:'IYSU', freq:'109.70', lat:34.853611, lon:127.611722, crs:345, cat:'I',
    gp:{ freq:'333.2', lat:34.836222, lon:127.621667 }, dme:{ freq:'995', ch:'34X', lat:34.836222, lon:127.621694, elev:98 } },

  // ── RKJK 군산 (AIP AMDT 10/19) — 36·18 이 같은 주파수(110.3)를 쓴다 ──
  { apt:'RKJK', name:'군산', rwy:'36', id:'IKUZ', freq:'110.30', lat:35.91875, lon:126.612333, crs:356,
    gp:{ freq:'335.0', lat:35.894361, lon:126.6195 } },
  { apt:'RKJK', name:'군산', rwy:'18', id:'IVPR', freq:'110.30', lat:35.888833, lon:126.619444, crs:176,
    gp:{ freq:'335.0', lat:35.913472, lon:126.615028 } },

  // ── RKJJ 광주 (AIP AMDT 3/26) ──
  { apt:'RKJJ', name:'광주', rwy:'04R', id:'IMDG', freq:'111.10', lat:35.139306, lon:126.819278, crs:37, cat:'I',
    gp:{ freq:'331.7', lat:35.116472, lon:126.804806 }, dme:{ freq:'1009', ch:'48X', lat:35.116472, lon:126.804833, elev:98 } },
  { apt:'RKJJ', name:'광주', rwy:'22L', id:'IMDH', freq:'108.50', lat:35.112306, lon:126.800361, crs:217,
    dme:{ freq:'983', ch:'22X', lat:35.111917, lon:126.801194, elev:98 } },

  // ── RKJB 무안 (AIP AMDT 6/25) ──
  { apt:'RKJB', name:'무안', rwy:'01', id:'IMUN', freq:'111.90', lat:35.006417, lon:126.382722, crs:7, cat:'I',
    gp:{ freq:'331.1', lat:34.981472, lon:126.381667 }, dme:{ freq:'1017', ch:'56X', lat:34.981444, lon:126.381611, elev:0 } },
  { apt:'RKJB', name:'무안', rwy:'19', id:'IMAN', freq:'108.90', lat:34.976389, lon:126.382917, crs:187, cat:'I',
    gp:{ freq:'329.3', lat:35.001194, lon:126.381528 }, dme:{ freq:'987', ch:'26X', lat:35.001194, lon:126.381472, elev:98 } },
];
