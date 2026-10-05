// 종료 확인 — 손이 스쳐 앱이 바로 닫히지 않는가
//
//   · 탭 닫기·새로고침 → 브라우저의 확인 창(beforeunload)
//   · 안드로이드 뒤로 버튼 → 앱의 확인 창(기록에 얹은 '지킴이' 칸)
//   · ⟳(hardReload) 는 일부러 누른 것이므로 묻지 않는다
export const name = '종료 확인';

export async function run(page, t) {
  await page.evaluate(() => { setSolo('map'); window.__alive = 1; });

  // ── ① 누르기 전에는 지킴이를 얹지 않는다(크롬이 건너뛰므로 의미가 없다) ──
  const before = await page.evaluate(() => ({ armed: _exitGuardArmed, len: history.length }));
  t.eq(before.armed, false, '화면을 누르기 전에는 지킴이 칸이 없다');

  // 화면을 한 번 누른다(지도 빈 곳)
  await page.mouse.click(700, 450);
  await page.waitForTimeout(100);
  const armed = await page.evaluate(() => ({ armed: _exitGuardArmed, len: history.length,
                                              st: history.state }));
  t.eq(armed.armed, true, '화면을 누르면 뒤로 버튼 지킴이를 얹는다');
  t.eq(armed.len, before.len + 1, `기록이 한 칸 늘어난다 (${before.len} → ${armed.len})`);

  // ── ② 새로고침·탭 닫기 → 브라우저 확인 창 ─────────────────────────────
  const dialogs = [];
  const onDialog = d => { dialogs.push(d.type()); d.dismiss().catch(() => {}); };   // '머무르기'
  page.on('dialog', onDialog);
  await page.evaluate(() => { location.reload(); });
  await page.waitForTimeout(800);
  page.off('dialog', onDialog);
  const stayed = await page.evaluate(() => window.__alive === 1).catch(() => false);
  t.ok(dialogs.includes('beforeunload'), `새로고침하려 하면 확인 창이 뜬다 (${dialogs.join(',') || '없음'})`);
  t.eq(stayed, true, '머무르기를 고르면 앱이 그대로다');

  // ── ③ 뒤로 버튼 → 앱의 확인 창, '계속 사용' 이면 머문다 ────────────────
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  const ask = await page.evaluate(() => ({
    dlg: document.querySelector('.ui-dlg-back')?.innerText || '', armed: _exitGuardArmed }));
  t.ok(/앱을 종료할까요/.test(ask.dlg), '뒤로 버튼을 누르면 종료할지 묻는다');
  t.ok(/이어집니다/.test(ask.dlg), '저장돼 있어 다시 열면 이어진다고 알려 준다');
  await page.click('.ui-dlg-back button:not(.ui-dlg-ok)');   // 계속 사용
  await page.waitForTimeout(200);
  const kept = await page.evaluate(() => ({ alive: window.__alive === 1, armed: _exitGuardArmed,
                                            dlg: !!document.querySelector('.ui-dlg-back') }));
  t.ok(kept.alive && !kept.dlg, '계속 사용을 고르면 창이 닫히고 앱이 그대로다');
  t.eq(kept.armed, true, '지킴이를 다시 얹는다 — 다음 뒤로 버튼도 묻는다');

  // ── ④ '종료' — 나갈 앞 페이지가 없을 때(홈 화면에서 연 앱) ─────────────
  // 스크립트로는 앱을 닫을 수 없다. 그때는 뒤로를 한 번 더 누르게 한다.
  // (검사 창에는 앞 페이지가 있으므로, 홈 화면 앱처럼 history.go 가 아무 일도
  //  하지 않게 잠시 바꿔 둔다 — 지킴이를 걷는 것은 진짜 뒤로 이동으로 한다)
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__realGo = history.go.bind(history); history.go = () => {}; });
  await page.click('.ui-dlg-back .ui-dlg-ok');                // 종료
  await page.waitForTimeout(700);
  await page.evaluate(() => { history.go = window.__realGo; });
  const left = await page.evaluate(() => ({
    confirmed: _exitConfirmed, armed: _exitGuardArmed,
    toast: [...document.querySelectorAll('.ui-toast')].map(e => e.textContent).join(' ') }));
  t.eq(left.confirmed, true, '종료를 고르면 더는 붙잡지 않는다');
  t.eq(left.armed, false, '지킴이를 다시 얹지 않는다 — 다음 뒤로 버튼은 곧바로 닫는다');
  t.ok(/한 번 더/.test(left.toast), `나갈 앞 페이지가 없으면 뒤로를 한 번 더 누르라고 알린다 (${left.toast})`);
  // 그 사이 화면을 눌러도 곧바로 지킴이를 얹지 않는다(종료 버튼을 누른 손가락 등)
  await page.mouse.click(700, 450);
  t.eq(await page.evaluate(() => _exitGuardArmed), false, '종료를 고른 직후의 터치로는 지킴이를 얹지 않는다');

  // 마음을 바꿔 계속 쓰면 다시 지킨다
  await page.waitForTimeout(4300);
  await page.mouse.click(700, 450);
  const again = await page.evaluate(() => ({ confirmed: _exitConfirmed, armed: _exitGuardArmed }));
  t.ok(!again.confirmed && again.armed, '잠시 뒤 다시 쓰면 다시 지킨다');

  // ── ⑤ ⟳ 는 일부러 누른 것이다 — 묻지 않고 바로 새로 연다 ────────────────
  const d2 = [];
  const onD2 = d => { d2.push(d.type()); d.dismiss().catch(() => {}); };
  page.on('dialog', onD2);
  await Promise.all([
    page.waitForEvent('load', { timeout: 15000 }).catch(() => null),
    page.evaluate(() => { hardReload(); }),
  ]);
  page.off('dialog', onD2);
  await page.waitForFunction(() => typeof S === 'object' && typeof leafMap === 'object', null, { timeout: 20000 });
  const reloaded = await page.evaluate(() => window.__alive === undefined);
  t.eq(d2.length, 0, `⟳ 새로고침은 확인 창을 띄우지 않는다 (${d2.join(',') || '없음'})`);
  t.eq(reloaded, true, '⟳ 를 누르면 실제로 새로 열린다');

  // ── ⑥ '종료' — 앞 페이지가 있으면 그리로 나간다(브라우저 확인 창 없이) ────
  // 방금 ⟳ 로 새로 열렸으므로 기록에는 앞 생애의 지킴이 칸이 남아 있다. 한 칸만
  // 물러나면 같은 앱이 다시 열린다 — 그 칸들까지 건너 실제로 떠나는지 본다.
  await page.mouse.click(700, 450);                           // 지킴이를 얹는다
  await page.waitForTimeout(100);
  const d3 = [];
  const onD3 = d => { d3.push(d.type()); d.dismiss().catch(() => {}); };
  page.on('dialog', onD3);
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  const lenBefore = await page.evaluate(() => history.length);
  await Promise.all([
    page.waitForURL(u => !String(u).includes('index.html'), { timeout: 5000 }).catch(() => null),
    page.click('.ui-dlg-back .ui-dlg-ok'),
  ]);
  await page.waitForTimeout(300);
  page.off('dialog', onD3);
  t.ok(!page.url().includes('index.html'), `종료를 고르면 앱을 떠난다 (기록 ${lenBefore}칸 → ${page.url()})`);
  t.eq(d3.length, 0, '종료를 고른 뒤에는 브라우저 확인 창으로 다시 붙잡지 않는다');
}
