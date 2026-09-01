// 처음 켤 때의 화면 구성 — 좌 PFD · 중 MAP · 우 CDU (3분할)
//
// 기본값은 코드 여러 곳에 흩어져 있다. leftSel/midSel/rightSel 초기값,
// tripleMode 초기값, 그리고 CDU 초기화의 setPage(...) 까지 손발이 맞아야
// 화면에 그대로 나온다 — 실제로 어느 패널에 어느 창이 들어갔는지로 확인한다.
export const name = '시작 화면 구성';

export async function run(page, t) {
  // 다른 검사들이 배치를 바꿔 놓았을 수 있고 저장값도 남아 있으므로,
  // 아무것도 저장되지 않은 새 브라우저 문맥에서 처음부터 연다.
  const browser = page.context().browser();
  const url = page.url();
  const ctx1 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const fresh = await ctx1.newPage();
  await fresh.goto(url);
  await fresh.waitForTimeout(900);

  const v = await fresh.evaluate(() => {
    const host = id => {
      const e = document.getElementById(id);
      return e && e.parentElement ? e.parentElement.id : null;
    };
    const shown = id => {
      const e = document.getElementById(id);
      return !!e && !e.classList.contains('page-hidden');
    };
    const active = tabs => {
      const b = document.querySelector(`#${tabs} [data-sel].active`);
      return b ? b.dataset.sel : null;
    };
    return { triple: document.getElementById('app').classList.contains('triple'),
             pfd: host('pfd-wrap'), map: host('map-wrap'), cdu: host('cdu-wrap'),
             shownAll: shown('pfd-wrap') && shown('map-wrap') && shown('cdu-wrap'),
             tabs: [active('left-tabs'), active('mid-tabs'), active('page-tabs')],
             sel: [leftSel, midSel, rightSel], tripleVar: tripleMode,
             midW: Math.round(document.getElementById('mid-panel').getBoundingClientRect().width) };
  });

  t.eq(v.triple, true, '처음부터 3분할이다');
  t.eq(v.pfd, 'left-panel',  `좌측은 PFD (${v.pfd})`);
  t.eq(v.map, 'mid-panel',   `중앙은 MAP (${v.map})`);
  t.eq(v.cdu, 'right-panel', `우측은 CDU (${v.cdu})`);
  t.eq(v.shownAll, true, '세 창이 모두 보인다');
  t.eq(v.tabs.join('·'), 'pfd·map·cdu', `탭 표시도 그대로다 (${v.tabs.join('·')})`);
  t.eq(v.sel.join('·'), 'pfd·map·cdu', '상태값도 같다');
  t.ok(v.midW > 50, `중앙 패널이 실제로 자리를 차지한다 (${v.midW}px)`);

  // ── 2분할을 골라 두면 그 뜻을 따른다 ──
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const two = await ctx2.newPage();
  await two.addInitScript(() => { try { localStorage.setItem('tripleMode', '0'); } catch (e) {} });
  await two.goto(url);
  await two.waitForTimeout(900);
  const w = await two.evaluate(() => ({
    triple: document.getElementById('app').classList.contains('triple'),
    sel: [leftSel, rightSel],
    cduShown: !document.getElementById('cdu-wrap').classList.contains('page-hidden'),
  }));
  t.eq(w.triple, false, '2분할을 저장해 뒀으면 2분할로 뜬다');
  t.eq(w.sel.join('·'), 'pfd·map', `그때는 종전대로 좌 PFD · 우 MAP (${w.sel.join('·')})`);
  t.eq(w.cduShown, false, '그 배치에서는 CDU 가 접혀 있다');

  // ── PFD 단독 ──
  // 좌측 상단 버튼 하나로 PFD 만 화면 가득. 한 번 더 누르면 원래 배치로 돌아온다.
  // 화면에 실제로 무엇이 남아 있는지(패널 폭)로 확인한다 — 3분할이 기본이 된 뒤로는
  // 가운데 창을 접지 않으면 '단독' 인데도 지도가 옆에 남는다.
  const solo = await fresh.evaluate(() => {
    const W = id => Math.round(document.getElementById(id).getBoundingClientRect().width);
    const btn = document.getElementById('pfd-solo-btn');
    const before = { l: W('left-panel'), m: W('mid-panel'), r: W('right-panel'), txt: btn.textContent };
    btn.click();
    const on = { l: W('left-panel'), m: W('mid-panel'), r: W('right-panel'),
                 txt: btn.textContent, solo: _soloActive, cur: _soloCurrent,
                 pfd: document.getElementById('pfd-wrap').parentElement.id,
                 body: document.body.classList.contains('solo-mode') };
    btn.click();                                  // 다시 누르면 복귀
    const off = { l: W('left-panel'), m: W('mid-panel'), r: W('right-panel'),
                  txt: btn.textContent, solo: _soloActive,
                  sel: [leftSel, midSel, rightSel].join('·'),
                  triple: document.getElementById('app').classList.contains('triple') };
    return { before, on, off, full: Math.round(window.innerWidth) };
  });
  t.ok(solo.before.txt.includes('PFD 단독'), `좌측 상단에 PFD 단독 버튼이 있다 (${solo.before.txt})`);
  t.eq(solo.on.solo, true, '누르면 단독 화면으로 들어간다');
  t.eq(solo.on.cur, 'pfd', '보이는 것은 PFD 다');
  t.eq(solo.on.pfd, 'left-panel', 'PFD 가 그 창에 들어 있다');
  t.eq(solo.on.m, 0, `가운데 지도 창이 접힌다 (${solo.on.m}px — 접지 않으면 옆에 남는다)`);
  t.eq(solo.on.r, 0, `우측 CDU 창도 접힌다 (${solo.on.r}px)`);
  t.ok(solo.on.l > solo.full * 0.95,
    `PFD 가 화면을 가득 채운다 (${solo.on.l}px / ${solo.full}px)`);
  t.ok(solo.on.txt.includes('분할') && !solo.on.txt.includes('단독'),
    `그때 버튼은 되돌아가는 버튼이 된다 (${solo.on.txt})`);
  t.eq(solo.off.solo, false, '한 번 더 누르면 나온다');
  t.eq(solo.off.triple, true, '나오면 3분할 배치가 그대로 돌아온다');
  t.eq(solo.off.sel, 'pfd·map·cdu', `창 배치도 들어가기 전 그대로다 (${solo.off.sel})`);
  t.ok(solo.off.m > 50 && solo.off.r > 50,
    `가운데·우측 창이 다시 자리를 잡는다 (${solo.off.m}px · ${solo.off.r}px)`);

  // ── MAP 단독 · CDU 단독 ──
  // 같은 방식이 다른 창에도 그대로 되는가. 어느 창이 화면을 차지하는지로 본다.
  for (const [screen, btnId, wrap] of [['map', 'map-solo-btn', 'map-wrap'],
                                       ['cdu', 'cdu-solo-btn', 'cdu-wrap']]) {
    const r = await fresh.evaluate(([sc, id, wr]) => {
      const W = e => Math.round(e.getBoundingClientRect().width);
      const btn = document.getElementById(id);
      const label = btn.textContent;
      btn.click();
      const host = document.getElementById(wr).parentElement;
      const others = ['left-panel', 'mid-panel', 'right-panel']
        .filter(x => x !== host.id).map(x => W(document.getElementById(x)));
      const on = { solo: _soloActive, cur: _soloCurrent, host: host.id,
                   w: W(host), others, shown: !document.getElementById(wr).classList.contains('page-hidden') };
      exitSolo();
      return { label, on, sel: [leftSel, midSel, rightSel].join('·'),
               solo: _soloActive, full: Math.round(window.innerWidth) };
    }, [screen, btnId, wrap]);
    t.ok(r.label.includes(screen.toUpperCase() + ' 단독'),
      `${screen.toUpperCase()} 단독 버튼이 그 창 탭 줄에 있다 (${r.label})`);
    t.eq(r.on.cur, screen, `누르면 ${screen.toUpperCase()} 단독으로 들어간다`);
    t.eq(r.on.shown, true, '그 창이 화면에 남는다');
    t.eq(r.on.others.join('·'), '0·0', `나머지 두 창은 접힌다 (${r.on.others.join('·')}px)`);
    t.ok(r.on.w > r.full * 0.95, `화면을 가득 채운다 (${r.on.w}px / ${r.full}px)`);
    t.eq(r.solo, false, '나오면 단독이 풀린다');
    t.eq(r.sel, 'pfd·map·cdu', `배치도 들어가기 전 그대로다 (${r.sel})`);
  }

  await ctx1.close();
  await ctx2.close();
}
