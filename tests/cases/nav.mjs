// NAV 오토파일럿 — 편류수정(WCA), 코스 추종
export const name = 'NAV 오토파일럿';

export async function run(page, t) {
  const r = await page.evaluate(() => {
    const fly = (crs, spd, wSpd, wDir, obs) => {
      S.wps = [{ ident: 'WP', lat: 37.2, lon: 127.6 }];
      S.fwp = -1; S.awp = 0; navSrc = 'FMS'; obsOn = !!obs; S.crs = crs;
      const st = destPoint(37.2, 127.6, normA(crs + 180), 20);
      const off = destPoint(st[0], st[1], normA(crs + 90), 3);   // 코스에서 3NM 벗어나 시작
      S.lat = off[0]; S.lon = off[1]; S.spd = spd; S.hdg = crs; S.bnk = 0;
      windSpd = wSpd; windDir = wDir; navApOn = true; hdgSelOn = false; rollApOn = true;
      gspdOn = false; gspdCoasting = false;
      if (typeof holdExit === 'function') holdExit();
      const dt = 0.5; let x0 = null, xN = null;
      for (let i = 0; i < 1800 / dt; i++) {
        updateNav();
        bankTarget = navApBankTarget();
        S.bnk += Math.max(-3, Math.min(3, bankTarget - S.bnk));
        if (Math.abs(S.bnk) > 0.5) {
          const V = Math.max(10, S.spd) * 0.5144;
          S.hdg = normA(S.hdg + 9.81 * Math.tan(S.bnk * D2R) / V / D2R * dt);
        }
        const wt = normA(windDir + 180) * D2R, wE = effectiveWindSpd(), sc = 1852 / 3600 * dt / 111320;
        S.lat += (S.spd * Math.cos(S.hdg * D2R) + wE * Math.cos(wt)) * sc;
        S.lon += (S.spd * Math.sin(S.hdg * D2R) + wE * Math.sin(wt)) * sc / Math.cos(S.lat * D2R);
        if (i === 0) x0 = Math.abs(courseXtk(activeCourseLine()));
        xN = Math.abs(courseXtk(activeCourseLine()));
      }
      return { x0, xN, hdg: S.hdg };
    };
    return {
      calm:  fly(45, 120, 0, 0, false),
      wind:  fly(90, 120, 30, 180, false),   // 정측풍 30kt
      obs:   fly(317, 80, 0, 0, true),
      wcaExp: Math.asin(30 * Math.sin((180 - 90) * D2R) / 120) / D2R,
    };
  });
  t.ok(r.calm.xN < 0.05, `무풍 FMS 추종 XTK ${r.calm.x0.toFixed(2)} → ${r.calm.xN.toFixed(3)}NM`);
  t.ok(r.obs.xN  < 0.05, `OBS 모드 추종 XTK ${r.obs.x0.toFixed(2)} → ${r.obs.xN.toFixed(3)}NM`);
  t.ok(r.wind.xN < 0.10, `측풍 30kt 추종 XTK ${r.wind.x0.toFixed(2)} → ${r.wind.xN.toFixed(3)}NM`);
  const wca = Math.abs(((r.wind.hdg - 90 + 540) % 360) - 180);
  t.ok(Math.abs(wca - r.wcaExp) < 2,
    `편류수정각 ${wca.toFixed(1)}° (이론 ${r.wcaExp.toFixed(1)}°)`);
}
