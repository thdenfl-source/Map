// Direct To — 지금 있는 자리에서 그 지점으로.
//
// 하나. 이미 활성인 지점에도 다시 걸려야 한다. 코스에서 한참 밀려난 뒤
//       "여기서 다시 곧장" 이 필요한 순간이 바로 그때다.
// 둘.  그 구간의 코스는 '현재 위치 → 그 지점' 이므로 항공기가 움직이면
//      같이 움직여야 한다. 굳어 있으면 카드가 옛말을 하게 된다.
export const name = 'Direct To (현 위치 기준)';

const A = [37.0, 127.0], B = [37.5, 127.5];

export async function run(page, t) {
  const setup = () => page.evaluate(([A, B]) => {
    S.wps = [{ ident: 'AAA', lat: A[0], lon: A[1] },
             { ident: 'BBB', lat: B[0], lon: B[1] }];
    S.awp = 1; S.fwp = 0;
    obsOn = false; navSrc = 'FMS'; holdExit();
    S.lat = 37.1; S.lon = 127.4; S.alt = 3000; S.hdg = 45; S.spd = 120;
    selectPanel('right', 'plan', true);
    fpWptIdx = 1; fpNumFld = null; fpInputBuf = '';
    fpGo('WPT');
  }, [A, B]);

  const card = () => page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[data-act="fpWptNoop"]'));
    const leg = cells.length ? cells[0].textContent.replace(/\s+/g, ' ').trim() : '';
    const dir = document.querySelector('[data-act="fpWptDirect"]');
    return { leg, dirTxt: dir ? dir.textContent.replace(/\s+/g, ' ').trim() : '' };
  });

  // ── 이미 활성이어도 버튼이 눌린다 ──
  await setup();
  const before = await card();
  t.ok(/활성 — BBB/.test(before.dirTxt),
    `이미 활성이면 그렇게 알려 준다 (${before.dirTxt})`);

  const again = await page.evaluate(() => {
    // 앞 구간(AAA→BBB) 코스에서 한참 밀려난 자리로 옮긴다
    S.lat = 37.0; S.lon = 127.45;
    updateNav();
    const offCrs = Math.round(toMag(courseCrsHere(activeCourseLine())));
    const offXtk = courseXtk(activeCourseLine());
    fpWptIdx = 1; fpGo('WPT');
    document.querySelector('[data-act="fpWptDirect"]').click();
    updateNav();
    return { offCrs, offXtk, awp: S.awp, fwp: S.fwp,
             crsM: Math.round(toMag(S.crs)),
             wantM: Math.round(toMag(bearing(S.lat, S.lon, S.wps[1].lat, S.wps[1].lon))),
             xtk: courseXtk(activeCourseLine()), mode: fpMode };
  });
  t.ok(Math.abs(again.offXtk) > 0.5,
    `누르기 전에는 옛 구간에서 ${again.offXtk.toFixed(1)}NM 밀려 있었다 (코스 ${again.offCrs}°M)`);
  t.eq(again.awp, 1, '이미 활성이던 지점이 그대로 활성이다');
  t.eq(again.fwp, -1, '앞 구간을 버리고 현재 위치가 기준이 된다');
  t.eq(again.crsM, again.wantM,
    `코스가 지금 자리에서 그 지점으로 다시 잡힌다 (${again.crsM}°M)`);
  t.ok(Math.abs(again.xtk) < 0.05,
    `그 순간 편차는 0 이다 (${again.xtk.toFixed(3)}NM — 지금 자리를 지나는 선이므로)`);
  t.eq(again.mode, 'LIST', '누르고 나면 목록으로 돌아온다');

  // ── 지정 진입 코스가 걸려 있어도 Direct To 가 이긴다 ──
  const over = await page.evaluate(() => {
    S.wps[1].inCrs = 300;                    // OBS 식 진입 코스를 걸어 두고
    S.lat = 37.05; S.lon = 127.42; updateNav();
    const withIn = Math.round(toMag(courseCrsHere(activeCourseLine())));
    fpWptIdx = 1; fpGo('WPT');
    document.querySelector('[data-act="fpWptDirect"]').click();
    updateNav();
    return { withIn, kept: 'inCrs' in S.wps[1],
             crsM: Math.round(toMag(courseCrsHere(activeCourseLine()))),
             wantM: Math.round(toMag(bearing(S.lat, S.lon, S.wps[1].lat, S.wps[1].lon))) };
  });
  t.eq(over.withIn, 300, '진입 코스를 걸면 그 코스로 들어간다 (300°M)');
  t.eq(over.kept, false, 'Direct To 를 누르면 진입 코스는 해제된다(양자택일)');
  t.eq(over.crsM, over.wantM, `코스가 현 위치 기준으로 바뀐다 (${over.crsM}°M)`);

  // ── 항공기가 움직이면 코스도 따라 움직인다 ──
  // 굳어 있으면 옆으로 밀려도 그대로라, 카드가 옛말을 하게 된다.
  const moved = await page.evaluate(() => {
    S.lat = 37.1; S.lon = 127.40; updateNav();
    const c1 = Math.round(toMag(courseCrsHere(activeCourseLine())));
    const x1 = courseXtk(activeCourseLine());
    S.lat = 37.1; S.lon = 127.62; updateNav();      // 목적지 동쪽으로 옮겨 본다
    const c2 = Math.round(toMag(courseCrsHere(activeCourseLine())));
    const x2 = courseXtk(activeCourseLine());
    const want2 = Math.round(toMag(bearing(S.lat, S.lon, S.wps[1].lat, S.wps[1].lon)));
    return { c1, c2, x1, x2, want2 };
  });
  t.ok(Math.abs(moved.c2 - moved.c1) > 30,
    `자리를 옮기면 코스가 따라 바뀐다 (${moved.c1}°M → ${moved.c2}°M)`);
  t.eq(moved.c2, moved.want2, '언제나 현재 위치에서 그 지점으로의 방위다');
  // 0 에 아주 가깝다 — 코스선은 지점에서 100NM 뒤로 그은 대권이라 그 길이만큼
  // 수렴 오차(수십 m)가 남는다. 종전(굳은 코스)에서는 NM 단위로 벌어졌다.
  t.ok(Math.abs(moved.x1) < 0.05 && Math.abs(moved.x2) < 0.05,
    `그래서 Direct To 구간의 편차는 늘 0 에 붙어 있다 (${moved.x1.toFixed(3)} · ${moved.x2.toFixed(3)}NM)`);

  // ── 카드의 레그 코스가 그 값과 같고, 열어 둔 채로 갱신된다 ──
  const live = await page.evaluate(async () => {
    fpWptIdx = 1; fpGo('WPT');
    const read = () => {
      const c = document.querySelector('[data-act="fpWptNoop"]');
      return c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
    };
    const first = read();
    const crs1 = Math.round(toMag(courseCrsHere(activeCourseLine())));
    S.lat = 37.62; S.lon = 127.40;                 // 목적지 북서쪽으로
    updateNav();
    _fpWptTick = 0;                                 // 다음 틱이 바로 돌게
    fpWptLiveTick(performance.now());
    await new Promise(r => setTimeout(r, 30));
    const second = read();
    const crs2 = Math.round(toMag(courseCrsHere(activeCourseLine())));
    return { first, second, crs1, crs2 };
  });
  t.ok(live.first.includes(String(live.crs1).padStart(3, '0')),
    `카드의 레그 코스가 실제 코스선과 같다 (${live.first})`);
  t.ok(live.first !== live.second &&
       live.second.includes(String(live.crs2).padStart(3, '0')),
    `카드를 열어 둔 채 움직여도 값이 따라온다 (${live.first} → ${live.second})`);
  t.ok(/현 위치/.test(live.second),
    `현 위치 기준임을 이름표에 적어 준다 (${live.second})`);

  // ── 숫자판으로 값을 치는 동안에는 되그리지 않는다 ──
  // 되그리면 치던 값이 지워진다.
  const typing = await page.evaluate(async () => {
    fpWptIdx = 1; fpGo('WPT');
    document.querySelector('[data-act="fpWptNum"][data-arg=\'["ICRS"]\']').click();
    ['1', '2'].forEach(n => fpType(n));
    _fpWptTick = 0;
    fpWptLiveTick(performance.now());
    await new Promise(r => setTimeout(r, 20));
    const buf = fpInputBuf;
    fpInputBuf = ''; fpNumFld = null; fpRender();
    return buf;
  });
  t.eq(typing, '12', `입력 중에는 되그리지 않는다 (치던 값 "${typing}" 이 남아 있다)`);

  // ── 앞 구간이 살아 있는 지점은 종전대로 그 구간 코스다 ──
  const leg = await page.evaluate(() => {
    S.fwp = 0; S.awp = 1; delete S.wps[1].inCrs;
    S.lat = 37.2; S.lon = 127.1; updateNav();
    fpWptIdx = 1; fpGo('WPT');
    const c = document.querySelector('[data-act="fpWptNoop"]').textContent.replace(/\s+/g, ' ').trim();
    return { c, want: Math.round(toMag(bearing(S.wps[0].lat, S.wps[0].lon, S.wps[1].lat, S.wps[1].lon))) };
  });
  t.ok(leg.c.includes(String(leg.want).padStart(3, '0')) && !/현 위치/.test(leg.c),
    `앞 지점에서 이어지는 구간은 그대로 그 구간 코스다 (${leg.c} — ${leg.want}°M)`);
}
