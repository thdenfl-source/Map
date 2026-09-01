// ─────────────────────────────────────────────────────────────
// data/enr-vors.js — AIP ENR 4.1 무선표지시설(VOR/VORTAC/TACAN)
// AIP 자료. 코드가 아니라 데이터이므로 따로 둔다(갱신이 코드 수정과 분리된다).
// 클래식 스크립트라 전역을 공유하며, 이 파일은 이를 쓰는 코드보다 먼저 로드돼야 한다.
// ─────────────────────────────────────────────────────────────
const ENR_VORS = [
  { id: 'SEL', name: 'ANYANG VORTAC', freq: '115.5', lat: 37.41361, lon: 126.92833 },   // 372449N 1265542E
  { id: 'PSN', name: 'BUSAN VORTAC', freq: '114.0', lat: 35.1225, lon: 128.99944 },   // 350721N 1285958E
  { id: 'TGU', name: 'DALSEONG VORTAC', freq: '112.2', lat: 35.80972, lon: 128.59083 },   // 354835N 1283527E
  { id: 'KAE', name: 'GANGWON VORTAC', freq: '115.6', lat: 37.70083, lon: 128.75389 },   // 374203N 1284514E
  { id: 'KUZ', name: 'GUNSAN VORTAC', freq: '112.8', lat: 35.91028, lon: 126.61139 },   // 355437N 1263641E
  { id: 'KWA', name: 'GWANGJU VOR/DME', freq: '114.4', lat: 35.12611, lon: 126.81222 },   // 350734N 1264844E
  { id: 'CJU', name: 'JEJU VORTAC', freq: '116.1', lat: 33.38472, lon: 126.62417 },   // 332305N 1263727E
  { id: 'KPO', name: 'POHANG VORTAC', freq: '112.5', lat: 35.97722, lon: 129.47444 },   // 355838N 1292828E
  { id: 'SOT', name: 'SONGTAN VORTAC', freq: '116.9', lat: 37.09444, lon: 127.03167 },   // 370540N 1270154E
  { id: 'CUN', name: 'YECHEON VOR/DME', freq: '114.8', lat: 36.63194, lon: 128.32528 },   // 363755N 1281931E
  { id: 'KWJ', name: 'GWANGJU TACAN', freq: '', lat: 35.12306, lon: 126.80278 },   // 350723N 1264810E
  // ── 비행장 VOR ──
  //   apt:1  = 비행장 항행표지(AWY 패널의 '비행장 VOR' 항목으로 별도 제어)
  //   pub:1  = AIP 공개 비행장 → 지도에 표시. 미표기(군 비행장)는 INFO 게이트와 동일하게 지도 미표시
  //   src    = 'AIP' 공표 좌표(AD 2 차트/코딩테이블 판독) | 'ARP' 공항 기준점 근사값
  { apt:1, pub:1, src:'ARP', id: 'NCN', name: '인천 VOR',   freq: '113.8', lat: 37.4602,  lon: 126.4407 },
  { apt:1, pub:1, src:'ARP', id: 'WNG', name: '인천(WNG)',  freq: '112.9', lat: 37.4600,  lon: 126.4400 },
  { apt:1, pub:1, src:'ARP', id: 'KIP', name: '김포 VOR',   freq: '113.6', lat: 37.5583,  lon: 126.7942 },
  { apt:1, pub:1, src:'ARP', id: 'MUA', name: '무안 VOR',   freq: '111.0', lat: 34.9914,  lon: 126.3829 },
  { apt:1, pub:1, src:'AIP', id: 'YSU', name: '여수 VOR',   freq: '115.7', lat: 34.84286, lon: 127.61908 },
  { apt:1, pub:1, src:'ARP', id: 'YDM', name: '제주 VOR',   freq: '109.0', lat: 33.5108,  lon: 126.4947 },
  { apt:1, pub:1, src:'AIP', id: 'YAG', name: '양양 VOR',   freq: '110.6', lat: 38.0633,  lon: 128.6615 },
  { apt:1, pub:1, src:'ARP', id: 'WJU', name: '원주 VOR',   freq: '110.2', lat: 37.4381,  lon: 127.9604 },
  { apt:1, pub:1, src:'AIP', id: 'CHO', name: '청주 VOR/DME', freq: '109.0', lat: 36.71806, lon: 127.49417 },
  { apt:1, pub:1, src:'AIP', id: 'DOC', name: '동촌(대구) VOR/DME', freq: '116.5', lat: 35.90378, lon: 128.64139 },
  { apt:1, pub:1, src:'AIP', id: 'UJN', name: '울진 VOR/DME', freq: '115.3', lat: 36.77639, lon: 129.4575 },
  { apt:1, pub:1, src:'AIP', id: 'USN', name: '울산 VOR/DME', freq: '111.4', lat: 35.59861, lon: 129.35333 },
  { apt:1, pub:1, src:'AIP', id: 'NPH', name: '포항 VORTAC', freq: '109.6', lat: 35.98636, lon: 129.40883 },
  { apt:1, pub:1, src:'AIP', id: 'KMH', name: '김해 VOR/DME', freq: '113.8', lat: 35.19917, lon: 128.93556 },
  { apt:1, pub:1, src:'ARP', id: 'SAC', name: '사천 VOR',   freq: '115.1', lat: 35.0886,  lon: 128.0703 },
  // 아래는 CDU INFO 목록에서 ALL 코드로 가려지는 비행장 — 항행표지 자체는 지도에 표시
  { apt:1, src:'ARP', id: 'MKP', name: '목포 VOR',   freq: '117.8', lat: 34.7585,  lon: 126.3806 },
  { apt:1, src:'ARP', id: 'NSN', name: '논산 VOR',   freq: '117.5', lat: 36.1636,  lon: 127.1147 },
  { apt:1, src:'ARP', id: 'SHO', name: '속초 VOR',   freq: '110.8', lat: 38.1427,  lon: 128.5986 },
  { apt:1, src:'ARP', id: 'ICN', name: '이천 VOR',   freq: '117.2', lat: 37.2028,  lon: 127.4746 },
];
