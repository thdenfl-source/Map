// 접근절차를 불러오면 무선을 맞춘다 — NAV1 = 그 접근 공항의 VOR · NAV2 = 그 활주로의 LOC(08-ifrdb.js appAutoTune)
export const name = '접근절차 무선 자동 튜닝';

export async function run(page, t) {
  // CDU 비행계획 IFR 화면에서 공항·접근절차를 골라 ＋ ADD APPROACH 를 누른 것과 같다
  const pick = (icao, procName) => page.evaluate(([icao, procName]) => {
    S.wps = [];
    navRadios.NAV1 = { freq: '115.50', id: 'SEL', lat: null, lon: null };
    navRadios.NAV2 = { freq: '116.10', id: 'CJU', lat: null, lon: null };
    const toasts = [], orig = uiToast;
    uiToast = (m, ...a) => { toasts.push(String(m)); return orig(m, ...a); };
    try {
      fpIfrPhase = 'app';
      fpGo('IFR');
      document.getElementById('app-icao').value = icao;
      loadApproaches();
      const sel = document.getElementById('app-proc');
      const i = [...sel.options].findIndex(o => o.textContent === procName);
      sel.value = String(i);
      addAppWps();
    } finally { uiToast = orig; }
    const n1 = navRadios.NAV1, n2 = navRadios.NAV2;
    return { wps: S.wps.length, toasts,
             nav1: { id: n1.id, freq: n1.freq, ok: Number.isFinite(n1.lat) },
             nav2: { id: n2.id, freq: n2.freq, ok: Number.isFinite(n2.lat), loc: !!n2.loc, crs: n2.crs } };
  }, [icao, procName]);

  // ── 김해 ILS Z RWY 36R — VOR 은 비행장 자료의 113.8(KMH), LOC 는 36R(IKHE) ──
  const ils = await pick('RKPK', 'ILS Z RWY 36R');
  t.ok(ils.wps > 0, `접근절차가 비행계획에 들어간다 (${ils.wps}개 지점)`);
  t.ok(ils.nav1.id === 'KMH' && Math.abs(parseFloat(ils.nav1.freq) - 113.8) < 1e-6 && ils.nav1.ok,
    `NAV1 은 그 공항의 VOR 로 맞는다 (${ils.nav1.id} ${ils.nav1.freq})`);
  t.ok(ils.nav2.id === 'IKHE' && Math.abs(parseFloat(ils.nav2.freq) - 109.5) < 1e-6 && ils.nav2.loc && ils.nav2.ok,
    `NAV2 는 그 활주로(36R)의 LOC 로 맞는다 (${ils.nav2.id} ${ils.nav2.freq})`);
  t.ok(ils.toasts.some(m => /NAV1 KMH/.test(m) && /NAV2 IKHE/.test(m)), `맞춘 무선을 알려 준다 (${ils.toasts.join(' / ')})`);

  // ── 김해 ILS RWY 36L — 같은 공항의 다른 활주로면 그 LOC(IKMA) ──
  const ils36l = await pick('RKPK', 'ILS RWY 36L');
  t.ok(ils36l.nav2.id === 'IKMA' && ils36l.nav1.id === 'KMH',
    `활주로가 다르면 그 활주로의 LOC 다 (36L → ${ils36l.nav2.id} ${ils36l.nav2.freq})`);

  // ── 김해 VOR RWY 36R — 절차 경로의 VOR(KMH) ──
  const vor = await pick('RKPK', 'VOR RWY 36R');
  t.ok(vor.nav1.id === 'KMH' && vor.nav2.id === 'IKHE',
    `VOR 접근도 NAV1 VOR · NAV2 그 활주로 LOC (${vor.nav1.id} · ${vor.nav2.id})`);

  // ── 양양 ILS Z RWY 33 — 비행장 자료의 VOR(110.6 YAG), LOC 는 33(IYAN) ──
  const ny = await pick('RKNY', 'ILS Z RWY 33');
  t.ok(ny.nav1.id === 'YAG' && Math.abs(parseFloat(ny.nav1.freq) - 110.6) < 1e-6 && ny.nav1.ok,
    `양양은 비행장 자료의 VOR 이다 (${ny.nav1.id} ${ny.nav1.freq})`);
  t.ok(ny.nav2.id === 'IYAN' && Math.abs(parseFloat(ny.nav2.freq) - 109.3) < 1e-6 && ny.nav2.loc,
    `NAV2 는 33 LOC (${ny.nav2.id} ${ny.nav2.freq})`);

  // ── 주파수가 같아도 먼 국은 잡지 않는다 — 제주 VOR(YDM)과 청주 VOR(CHO)은 둘 다 109.0 이다 ──
  const cju = await page.evaluate(() => {
    const r = appTuneTargets('RKPC', { name: 'ILS RWY 07', wps: [] });
    const a = AIRPORTS.find(x => x.ident === 'RKPC');
    return { id: r.vor && r.vor.id, d: r.vor ? distance(a.lat, a.lon, r.vor.lat, r.vor.lon) : null };
  });
  t.ok(cju.id === 'YDM' && cju.d < 25,
    `주파수가 같은 먼 국(청주 CHO 109.0)이 아니라 제주 VOR 을 잡는다 (${cju.id} · ${cju.d === null ? '—' : cju.d.toFixed(1)}NM)`);

  // ── 비행장 자료의 VOR 이 목록에 없으면 공항에서 가장 가까운 VOR(30NM 안) ──
  const near = await page.evaluate(() => {
    const was = AIRFIELD_INFO.find(f => f.code === 'NY'), vorWas = was.vor;
    was.vor = '-';                                          // 비행장 자료에 VOR 이 없는 것처럼
    try {
      const r = appTuneTargets('RKNY', { name: 'ILS Z RWY 33', wps: [] });
      const a = AIRPORTS.find(x => x.ident === 'RKNY');
      let best = null, bd = 1e9;
      ENR_VORS.filter(v => v.freq).forEach(v => { const d = distance(a.lat, a.lon, v.lat, v.lon); if (d < bd) { bd = d; best = v; } });
      return { id: r.vor && r.vor.id, want: best.id, d: bd };
    } finally { was.vor = vorWas; }
  });
  t.ok(near.id === near.want && near.d <= 30,
    `비행장 자료에 VOR 이 없으면 공항에서 가장 가까운 VOR 이다 (${near.id} · ${near.d.toFixed(1)}NM)`);
}
