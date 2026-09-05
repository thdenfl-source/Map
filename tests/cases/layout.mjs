// 처음 켤 때의 화면 구성 — 한 창(MAP) + 상단 탭
//
// 이 앱은 폰·패드를 세로로 들고 쓰는 물건이다. 그 폭에 창을 둘·셋 세우면
// 계기가 손바닥만 해져 읽을 수가 없다. 그래서 분할(2·3분할)을 두지 않는다 —
// PC 에서 열어도 마찬가지다.
//
// 기본값은 코드 여러 곳에 흩어져 있다(마지막으로 보던 창, setSolo 의 초기값,
// CDU 초기화). 손발이 맞아야 화면에 그대로 나오므로, 실제로 어느 창이
// 떠 있는지로 확인한다.
export const name = '시작 화면 구성';

export async function run(page, t) {
  const browser = page.context().browser();
  const url = page.url();

  // 아무것도 저장되지 않은 새 브라우저 문맥에서 처음부터 연다
  const fresh = async (vp, init) => {
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { localStorage.setItem('gpsDenied', '1'); } catch (e) {} });
    if (init) await p.addInitScript(init);
    await p.goto(url);
    await p.waitForFunction(() => typeof S === 'object' && typeof navGo === 'function',
      null, { timeout: 20000 });
    await p.waitForTimeout(900);
    return [ctx, p];
  };

  const look = p => p.evaluate(() => {
    const host = id => { const e = document.getElementById(id); return e && e.parentElement ? e.parentElement.id : null; };
    const wide = id => { const e = document.getElementById(id); return !!e && e.getBoundingClientRect().width > 0; };
    return { cur: _soloCurrent, solo: _soloActive,
             shown: ['pfd-wrap', 'map-wrap', 'cdu-wrap'].filter(wide),
             pfdHost: host('pfd-wrap'), mapHost: host('map-wrap'), cduHost: host('cdu-wrap'),
             activeTab: (document.querySelector('#phone-bar button.active') || {}).dataset?.nav,
             barShown: document.getElementById('phone-bar').getBoundingClientRect().height > 0,
             appTop: Math.round(document.getElementById('app').getBoundingClientRect().top),
             barBottom: Math.round(document.getElementById('phone-bar').getBoundingClientRect().bottom) };
  });

  // ── 처음 켜면 MAP 한 창 ──
  const [c1, p1] = await fresh({ width: 390, height: 844 });
  const v = await look(p1);
  t.eq(v.cur, 'map', `처음 켜면 MAP 이다 (${v.cur})`);
  t.eq(v.solo, true, '한 창으로 뜬다');
  t.eq(v.shown.join(','), 'map-wrap', `보이는 것은 지도 하나뿐이다 (${v.shown.join(',') || '없음'})`);
  t.eq(v.barShown, true, '상단 탭바가 뜬다');
  t.eq(v.activeTab, 'map', `MAP 탭이 눌린 상태다 (${v.activeTab})`);
  t.ok(Math.abs(v.appTop - v.barBottom) <= 1, '본문이 탭바 바로 아래에서 시작한다');

  // ── 마지막으로 보던 창을 기억한다 ──
  const [c2, p2] = await fresh({ width: 390, height: 844 },
    () => { try { localStorage.setItem('phoneScreen', 'pfd'); } catch (e) {} });
  const v2 = await look(p2);
  t.eq(v2.cur, 'pfd', `PFD 를 보던 참이면 PFD 로 뜬다 (${v2.cur})`);
  t.eq(v2.shown.join(','), 'pfd-wrap', `그때는 계기 하나뿐이다 (${v2.shown.join(',')})`);
  await c2.close();

  // ── 넓게 열어도 한 창이다 ──
  const [c3, p3] = await fresh({ width: 1400, height: 900 });
  const v3 = await look(p3);
  t.eq(v3.solo, true, '넓은 화면에서도 한 창이다');
  t.eq(v3.shown.length, 1, `보이는 창은 하나뿐이다 (${v3.shown.join(',') || '없음'})`);
  t.eq(v3.barShown, true, '넓은 화면에서도 상단 탭으로 고른다');
  await c3.close();

  // ── 탭으로 네 창을 오간다 ──
  for (const [screen, wrap, host] of [['pfd', 'pfd-wrap', 'left-panel'],
                                      ['map', 'map-wrap', 'left-panel'],
                                      ['cdu', 'cdu-wrap', 'right-panel'],
                                      ['plan', 'fp-wrap', 'right-panel']]) {
    const r = await p1.evaluate(([sc, wr, ho]) => {
      const btn = document.querySelector(`#phone-bar [data-nav="${sc}"]`);
      if (btn) btn.click(); else navGo(sc);
      const e = document.getElementById(wr);
      const others = ['pfd-wrap', 'map-wrap', 'cdu-wrap', 'fp-wrap']
        .filter(x => x !== wr)
        .filter(x => { const o = document.getElementById(x);
                       return o && o.getBoundingClientRect().width > 0; });
      return { cur: _soloCurrent, host: e.parentElement.id,
               w: Math.round(e.getBoundingClientRect().width),
               full: Math.round(window.innerWidth), others };
    }, [screen, wrap, host]);
    t.eq(r.cur, screen, `${screen.toUpperCase()} 탭을 누르면 그 창이 뜬다`);
    t.eq(r.host, host, `${screen.toUpperCase()} 는 ${host} 에 들어 있다 (${r.host})`);
    t.ok(r.w > r.full * 0.95, `${screen.toUpperCase()} 가 화면을 가득 채운다 (${r.w}px / ${r.full}px)`);
    t.eq(r.others.length, 0,
      `그때 다른 창은 보이지 않는다${r.others.length ? ' (' + r.others.join(',') + ')' : ''}`);
  }

  // ── CDU · Flight Plan 계기 틀이 위아래를 빈 칸 없이 채우는가 ──
  // 354×567 규격 화면을 폭 기준으로 줄이면(세로로 긴 폰에서 흔하다) 원래는
  // 위아래가 남았다. 그 자리를 비워 두지 않고 계기 틀 높이를 늘려 채운다
  // (cduFrameRect 의 frameH). 좁은 폰(위아래가 남는 경우)과 넓은 화면
  // (원래도 안 남는 경우) 둘 다 본다 — 넓은 화면에서 새로 틈이 생기면 안 된다.
  for (const [vp, label] of [[{ width: 390, height: 844 }, '세로로 긴 폰'],
                             [{ width: 1400, height: 900 }, '넓은 화면']]) {
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { localStorage.setItem('gpsDenied', '1'); } catch (e) {} });
    await p.goto(url);
    await p.waitForFunction(() => typeof S === 'object' && typeof navGo === 'function',
      null, { timeout: 20000 });
    await p.waitForTimeout(300);
    for (const [screen, wrap, scaler] of [['cdu', 'cdu-wrap', 'cdu-scaler'], ['plan', 'fp-wrap', 'fp-scaler']]) {
      const gap = await p.evaluate(([sc, wr, sca]) => {
        navGo(sc);
        const w = document.getElementById(wr), f = document.querySelector(`#${sca} .cdu-frame`);
        const wr2 = w.getBoundingClientRect(), fr = f.getBoundingClientRect();
        return { top: fr.top - wr2.top, bottom: wr2.bottom - fr.bottom };
      }, [screen, wrap, scaler]);
      t.ok(Math.abs(gap.top) < 1 && Math.abs(gap.bottom) < 1,
        `${label} — ${screen.toUpperCase()} 계기 틀 위아래에 빈 칸이 없다 (위 ${gap.top.toFixed(1)}px · 아래 ${gap.bottom.toFixed(1)}px)`);
    }
    await ctx.close();
  }

  await c1.close();
}
