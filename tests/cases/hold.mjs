// 홀딩 — 진입 구역 판정(좌우 대칭), 경로 추종, NAV 유지
export const name = '홀딩 패턴';

export async function run(page, t) {
  // ① 진입 구역 판정이 좌·우선회에서 정확히 거울상인가
  const sym = await page.evaluate(() => {
    let n = 0, bad = 0;
    [0, 37, 90, 141, 200, 270, 315, 359].forEach(C => {
      for (let r = 0; r < 360; r += 0.5) {
        holdCrs = C; holdRight = true;  const R = _holdEntryType(normA(C + r));
        holdRight = false;              const L = _holdEntryType(normA(C - r));
        n++; if (R !== L) bad++;
      }
    });
    const w = {}; holdRight = true; holdCrs = 90;
    for (let r = 0; r < 360; r += 0.25) { const k = _holdEntryType(normA(90 + r)); w[k] = (w[k] || 0) + 0.25; }
    return { n, bad, w };
  });
  t.eq(sym.bad, 0, `좌우 거울상 판정 ${sym.n}건 불일치 없음`);
  t.ok(Math.abs(sym.w.PARALLEL - 108) < 4, `평행 섹터 폭 ${sym.w.PARALLEL}° (110° 근처)`);
  t.ok(Math.abs(sym.w.TEARDROP - 68) < 4, `눈물방울 섹터 폭 ${sym.w.TEARDROP}° (70° 근처)`);

  // ② 진입 3종 비행 — 그려진 트랙 추종, NAV 유지
  const fly = await page.evaluate(() => {
    const C = 90, FIX = [37.0, 127.5];
    const dev = (pts, la, lo) => {
      const X = p => [(p[1] - FIX[1]) * Math.cos(FIX[0] * D2R) * 60, (p[0] - FIX[0]) * 60];
      const me = X([la, lo]), XY = pts.map(X); let best = 1e9;
      for (let i = 0; i < XY.length - 1; i++) {
        const ax = XY[i][0], ay = XY[i][1], dx = XY[i + 1][0] - ax, dy = XY[i + 1][1] - ay;
        const L2 = dx * dx + dy * dy; let u = L2 > 1e-12 ? ((me[0] - ax) * dx + (me[1] - ay) * dy) / L2 : 0;
        u = Math.max(0, Math.min(1, u));
        best = Math.min(best, Math.hypot(me[0] - (ax + u * dx), me[1] - (ay + u * dy)));
      }
      return best;
    };
    const one = (dir, appr, spd) => {
      const A = destPoint(FIX[0], FIX[1], normA(appr + 180), 25);
      S.wps = [{ ident: 'A', lat: A[0], lon: A[1] },
               { ident: 'FIX', lat: FIX[0], lon: FIX[1], hold: { dir, crs: C, legType: 'TIME', legVal: 60 } }];
      S.fwp = 0; S.awp = 1; obsOn = false; navSrc = 'FMS'; S.crs = C;
      const st = destPoint(FIX[0], FIX[1], normA(appr + 180), 14);
      S.lat = st[0]; S.lon = st[1]; S.spd = spd || 120; S.hdg = appr; S.bnk = 0;
      windSpd = 0; windDir = 0; navApOn = true; hdgSelOn = false; rollApOn = true; holdExit();
      const dt = 0.5; let entry = '', tTrack = -1, devs = [], navOff = false, entryDist = -1;
      let devCap = 0;   // 패턴을 붙잡는 과도 구간까지 포함한 최대 이탈
      // 패턴을 붙잡은 뒤 60초 동안 기수를 몇 도나 돌렸는가.
      // 제대로면 인바운드로 살짝 물어 들어가는 정도(<100°)로 끝난다.
      let capTurn = 0, prevHdg = S.hdg;
      for (let i = 0; i < 3000 / dt; i++) {
        updateNav();
        if (S.awp >= 0 && !obsOn && !holdOn && S.dtw < 0.25 && S.awp + 1 >= S.wps.length) navApOn = false;
        if (!navApOn) { navOff = true; break; }
        const p0 = _holdPhase;
        holdSyncFromWp();
        const hb = holdBankTarget(dt); bankTarget = (hb === null) ? navApBankTarget() : hb;
        if (p0 === 'TOFIX' && _holdPhase !== 'TOFIX') { entry = _holdEntry; entryDist = distance(S.lat, S.lon, FIX[0], FIX[1]); }
        if (_holdPhase === 'TRACK' && tTrack < 0) tTrack = i;
        S.bnk += Math.max(-3, Math.min(3, bankTarget - S.bnk));
        const V = Math.max(10, S.spd) * 0.5144;
        S.hdg = normA(S.hdg + 9.81 * Math.tan(S.bnk * D2R) / V / D2R * dt);
        const sc = 1852 / 3600 * dt / 111320;
        S.lat += S.spd * Math.cos(S.hdg * D2R) * sc;
        S.lon += S.spd * Math.sin(S.hdg * D2R) * sc / Math.cos(S.lat * D2R);
        if (tTrack >= 0 && i < tTrack + 120) capTurn += Math.abs(normAS(S.hdg - prevHdg));
        prevHdg = S.hdg;
        if (tTrack >= 0) {
          const e = dev(holdPatternLatLngs(), S.lat, S.lon);
          devCap = Math.max(devCap, e);
          if (i > tTrack + 400) devs.push(e);
        }
      }
      return { entry, navOff, entryDist, devCap, capTurn,
               devMax: devs.length ? Math.max(...devs) : NaN,
               devAvg: devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : NaN };
    };
    return { R90: one('R', 90), R230: one('R', 230), R330: one('R', 330),
             L90: one('L', 90), L310: one('L', 310), L210: one('L', 210),
             // 헬기 순항속도(81kt) — 평행 진입이 패턴을 가장 크게 벗어나는 경우
             R330s: one('R', 330, 81), L210s: one('L', 210, 81) };
  });

  // 판정 기준은 픽스에서 본 방위(기수의 반대편)다. 인바운드 90°·우선회면
  // 방위 20~90° 가 눈물방울 → 그 방향에서 오는 기수는 200~270°.
  const want = { R90: 'DIRECT', R230: 'TEARDROP', R330: 'PARALLEL',
                 L90: 'DIRECT', L310: 'TEARDROP', L210: 'PARALLEL' };
  for (const [k, v] of Object.entries(want)) {
    t.eq(fly[k].entry, v, `${k} 진입 = ${v}`);
    t.eq(fly[k].navOff, false, `${k} NAV 유지`);
    // 픽스를 지나기 전에 꺾으면 안 된다. 종전에는 "0.35NM 안이면 통과" 라는
    // 지름길이 있어 픽스 앞에서 선회가 시작됐고, 항적에 그대로 드러났다.
    t.ok(fly[k].entryDist <= 0.05, `${k} 픽스를 지난 뒤에 선회를 시작한다 (${fly[k].entryDist.toFixed(3)}NM)`);
    t.ok(fly[k].devMax < 0.35, `${k} 그려진 트랙 이탈 최대 ${fly[k].devMax.toFixed(3)}NM`);
  }

  // 평행 진입에서 반대 방향으로 크게 한 바퀴 도는 일이 없어야 한다.
  // 종전에는 추종 대상 구간을 "가장 가까운 선분" 으로만 골랐다. 평행 진입을
  // 마치면 항공기는 홀딩측에서 인바운드를 향하는데, 이때 반대 방향인
  // 아웃바운드 구간이 더 가까이(2R≈0.57NM 대 0.71NM) 있어 그쪽을 잡고
  // 거의 한 바퀴(≈354°)를 돌아 거꾸로 합류했다.
  ['R330', 'L210', 'R330s', 'L210s'].forEach(k => {
    t.ok(fly[k].capTurn < 150,
      `${k} 평행 진입 뒤 곧장 인바운드로 붙는다 (붙잡고 60초간 기수 변화 ${Math.round(fly[k].capTurn)}° — 종전 217°)`);
  });

  // 진입 직후 패턴을 붙잡는 구간 — 여기가 뱅크 상한에 좌우된다.
  // 상한이 표준선회 뱅크(81kt 면 13°)뿐이던 때는 평행 진입에서 0.58NM 까지
  // 벌어졌다. 상한을 23° 로 열어 절반 가까이 줄었다.
  ['R330s', 'L210s'].forEach(k => {
    t.ok(fly[k].devCap < 0.40,
      `${k} 81kt 평행 진입 — 패턴을 붙잡기까지 최대 이탈 ${fly[k].devCap.toFixed(3)}NM`);
  });

  // ③ MAP 의 HOLD 진입 판정 레이어
  // 그림이 판정 규칙을 따로 베끼면 둘이 어긋나는 날 그림이 거짓말을 한다.
  // 그래서 부채꼴은 _holdEntryType 에서 되읽어 만든다 — 여기서 그걸 확인한다.
  const sec = await page.evaluate(() => {
    const span = (crs, right) => {
      const w = {};
      holdEntrySectors(crs, right).forEach(s => { w[s.type] = (w[s.type] || 0) + (s.to - s.from); });
      return w;
    };
    // 부채꼴 각도 θ(픽스에서 본 방위)에 칠한 색이, 그 방향에서 픽스로 곧장
    // 들어올 때(기수 θ+180)의 판정과 같은가
    let mismatch = 0, n = 0;
    [[90, true], [90, false], [217, true], [4, false]].forEach(([crs, right]) => {
      holdEntrySectors(crs, right).forEach(s => {
        for (let θ = s.from + 0.25; θ < s.to; θ += 5) {
          n++;
          if (_holdEntryType(normA(θ + 180), crs, right) !== s.type) mismatch++;
        }
      });
    });
    // 인자로 넘긴 판정이 무장된 홀딩의 전역값을 건드리지 않는가
    holdCrs = 123; holdRight = true;
    _holdEntryType(0, 300, false);
    return { r: span(90, true), l: span(90, false), mismatch, n,
             keptCrs: holdCrs, keptRight: holdRight };
  });
  t.eq(sec.mismatch, 0, `부채꼴 색이 진입 판정과 일치 (${sec.n}점)`);
  t.ok(Math.abs(sec.r.DIRECT - 180) < 5 && Math.abs(sec.r.PARALLEL - 110) < 5 && Math.abs(sec.r.TEARDROP - 70) < 5,
    `우선회 부채꼴 폭 직진 ${sec.r.DIRECT}° · 평행 ${sec.r.PARALLEL}° · 눈물방울 ${sec.r.TEARDROP}°`);
  // 폭만 보면 세 구역의 자리가 바뀌어도 통과한다 — 경계 각도를 못박는다.
  // 인바운드 091°·좌선회: 픽스 기준 091~161 눈물방울 / 161~341 직진 / 341~091 평행
  const bnd = await page.evaluate(() => holdEntrySectors(toTrue(91), false)
    .map(s => `${s.type} ${Math.round(toMag(s.from))}~${Math.round(toMag(s.to))}`).join(' · '));
  t.eq(bnd, 'TEARDROP 91~161 · DIRECT 161~341 · PARALLEL 341~91',
    `구역 경계가 자리에 있다 (${bnd})`);

  // 경계 바로 양옆 — 여기가 어긋나면 그림과 판정이 따로 논다.
  // (종전에는 경계에 2° 여유를 둬서 090°M 접근이 눈물방울로 판정됐다)
  const edge = await page.evaluate(() => {
    const crsT = toTrue(91);   // 인바운드 091°M · 좌선회
    return [89, 90, 90.9, 91, 92, 160.9, 161, 340.9, 341].map(m =>
      m + ':' + _holdEntryType(normA(toTrue(m) + 180), crsT, false));
  });
  t.eq(edge.join(' '),
    '89:PARALLEL 90:PARALLEL 90.9:PARALLEL 91:TEARDROP 92:TEARDROP ' +
    '160.9:TEARDROP 161:DIRECT 340.9:DIRECT 341:PARALLEL',
    `경계가 자북 각도 그대로 갈린다 (${edge.join(' ')})`);
  const srt = w => JSON.stringify(Object.keys(w).sort().map(k => [k, w[k]]));
  t.eq(srt(sec.l), srt(sec.r), '좌선회도 같은 폭(거울상)');
  t.ok(sec.keptCrs === 123 && sec.keptRight === true, '인자로 판정해도 무장된 홀딩 값은 그대로');

  // 홀딩이 없으면 열리지 않는다(빈 원을 띄워 두면 없는 정보를 있는 척하게 된다)
  const none = await page.evaluate(() => {
    S.wps = []; holdExit();
    document.getElementById('map-wrap').classList.remove('hold-entry-on');
    toggleHoldEntry();
    return document.getElementById('map-wrap').classList.contains('hold-entry-on');
  });
  t.eq(none, false, '설정된 홀딩이 없으면 레이어가 열리지 않는다');

  // 비행계획에만 있고 아직 활성이 아닌 홀딩도 미리 볼 수 있어야 한다
  const shown = await page.evaluate(() => {
    const FIX = [37.0, 127.5];
    const A = destPoint(FIX[0], FIX[1], 45, 6);      // 픽스 북동 6NM
    S.lat = A[0]; S.lon = A[1]; S.hdg = 225; S.spd = 120;
    S.wps = [{ ident: 'ROKAN', lat: FIX[0], lon: FIX[1],
               hold: { dir: 'R', crs: 90, legType: 'TIME', legVal: 60 } }];
    S.awp = -1;                                       // 무장 전
    toggleHoldEntry();
    drawHoldEntry();
    const cv = document.getElementById('hold-entry-canvas');
    const g = cv.getContext('2d');
    const px = g.getImageData(0, 0, cv.width, cv.height).data;
    let painted = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 8) painted++;
    return {
      on: document.getElementById('map-wrap').classList.contains('hold-entry-on'),
      btn: document.getElementById('map-hold-btn').classList.contains('active'),
      fix: document.getElementById('hold-entry-fix').textContent,
      info: document.getElementById('hold-entry-info').textContent,
      want: _holdEntryType(normA(bearing(FIX[0], FIX[1], S.lat, S.lon) + 180), 90, true),
      painted, total: cv.width * cv.height,
    };
  });
  t.eq(shown.on && shown.btn, true, '비행계획에만 있는 홀딩도 레이어가 열린다');
  t.ok(/ROKAN/.test(shown.fix) && /예정/.test(shown.fix),
    `픽스 이름과 아직 무장 전임을 함께 보여 준다 (${shown.fix})`);
  t.ok(shown.info.startsWith(shown.want),
    `판정이 시뮬과 같다 — ${shown.want} (${shown.info.split('\n')[0].slice(0, 24)})`);
  t.ok(shown.painted / shown.total > 0.3,
    `그림이 실제로 그려진다 (칠해진 화소 ${(100 * shown.painted / shown.total).toFixed(0)}%)`);
  t.eq(await page.evaluate(() => { toggleHoldEntry(); return document.getElementById('map-wrap').classList.contains('hold-entry-on'); }),
    false, '한 번 더 누르면 닫힌다');

  // 그려진 패턴이 기준선과 같은 각도 기준 위에 있는가
  // (종전에는 패턴만 좌표 오프셋을 편차만큼 반대로 돌려 18° 어긋나 있었다.
  //  경계·눈금은 멀쩡했으므로 숫자 검사로는 잡히지 않고 그림에서만 드러났다)
  const align = await page.evaluate(() => {
    const FIX = [37.0, 127.5];
    S.lat = FIX[0] + 0.1; S.lon = FIX[1] + 0.1; S.hdg = 200; S.spd = 120;
    S.wps = [{ ident: 'ALIGN', lat: FIX[0], lon: FIX[1],
               hold: { dir: 'L', crs: toTrue(91), legType: 'TIME', legVal: 60 } }];
    if (!document.getElementById('map-wrap').classList.contains('hold-entry-on')) toggleHoldEntry();
    drawHoldEntry();
    const cv = document.getElementById('hold-entry-canvas');
    const W = cv.clientWidth, H = cv.clientHeight;
    const dpr = cv.width / W;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 12;
    const pts = holdPatternLatLngs({ lat: FIX[0], lon: FIX[1] },
                                   { dir: 'L', crs: toTrue(91), legType: 'TIME', legVal: 60 });
    const pol = pts.map(p => ({ m: toMag(bearing(FIX[0], FIX[1], p[0], p[1])),
                                d: distance(FIX[0], FIX[1], p[0], p[1]) }));
    const ext = Math.max(0.5, ...pol.map(q => q.d));
    const pxPerNM = R * 0.62 / ext;
    const g = cv.getContext('2d');
    // 각 꼭짓점이 있어야 할 자리에 밝은 선이 실제로 그려져 있는가(±2px)
    let hit = 0, miss = 0;
    pol.forEach(q => {
      if (q.d * pxPerNM < 4) return;                     // 픽스 바로 옆은 건너뛴다
      const x = cx + q.d * pxPerNM * Math.sin(q.m * D2R);
      const y = cy - q.d * pxPerNM * Math.cos(q.m * D2R);
      let found = false;
      for (let dx = -2; dx <= 2 && !found; dx++) for (let dy = -2; dy <= 2 && !found; dy++) {
        const px = g.getImageData(Math.round((x + dx) * dpr), Math.round((y + dy) * dpr), 1, 1).data;
        // 패턴선(밝은 회색) 또는 그 위에 겹쳐 그린 기준선(노랑). 부채꼴 색은
        // 셋 다 빨강·초록 중 한쪽이 어두워 여기에 걸리지 않는다.
        if (px[0] > 140 && px[1] > 140) found = true;
      }
      found ? hit++ : miss++;
    });
    return { hit, miss };
  });
  t.eq(align.miss, 0,
    `패턴이 부채꼴·기준선과 같은 각도 기준 위에 그려진다 (꼭짓점 ${align.hit}개 일치, ${align.miss}개 어긋남)`);
}
