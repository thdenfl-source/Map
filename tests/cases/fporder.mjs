// 비행계획 순서 바꾸기 — 손잡이(≡)를 끌어서
//
// 순서를 바꾸면 활성 WP·이전 WP·BRG2 가 따라와야 한다. 이 셋을 인덱스로만
// 들고 있으면 순서가 바뀌는 순간 엉뚱한 지점을 가리킨다 — 그래서 '무엇을'
// 가리키는지로 확인한다.
export const name = '비행계획 순서 변경';

const WPS = [
  { ident: 'AAA', lat: 37.0, lon: 127.0 },
  { ident: 'BBB', lat: 37.5, lon: 127.5 },
  { ident: 'CCC', lat: 38.0, lon: 128.0 },
  { ident: 'DDD', lat: 38.5, lon: 128.5 },
];

export async function run(page, t) {
  const setup = () => page.evaluate((WPS) => {
    S.wps = WPS.map(w => Object.assign({}, w));
    S.awp = 2; S.fwp = 1;                    // 활성 CCC · 이전 BBB
    obsOn = false; navSrc = 'FMS'; holdExit();
    S.lat = 36.5; S.lon = 126.5;
    selectPanel('right', 'plan', true);   // 목록이 실제로 화면에 놓여야 끌 수 있다
    fpMode = 'LIST'; fpRender();
  }, WPS);

  const state = () => page.evaluate(() => ({
    order: S.wps.map(w => w.ident),
    awp: S.awp >= 0 ? S.wps[S.awp].ident : null,
    fwp: S.fwp >= 0 ? S.wps[S.fwp].ident : null,
    rows: Array.from(document.querySelectorAll('.fp-wp-row'))
            .map(r => r.querySelector('.fp-wp-ident').textContent.trim()),
    seq: Array.from(document.querySelectorAll('.fp-wp-seq')).map(e => e.textContent.trim()),
  }));

  // ── 함수로 옮기기 ──
  await setup();
  await page.evaluate(() => fpMoveWp(3, 0));      // DDD 를 맨 앞으로
  const a = await state();
  t.eq(a.order.join(' '), 'DDD AAA BBB CCC', `끌어 놓은 자리로 옮겨진다 (${a.order.join(' ')})`);
  t.eq(a.rows.join(' '), a.order.join(' '), '화면 목록도 같은 순서다');
  t.eq(a.seq.join(''), '1234', `번호는 1,2,3,4 로 다시 매겨진다 (${a.seq.join(',')})`);
  // 가리키던 지점이 그대로인가 — 인덱스로 들고 있었다면 CCC→AAA 로 어긋난다
  t.eq(a.awp, 'CCC', `활성 WP 는 그대로 CCC (인덱스 ${await page.evaluate(() => S.awp)})`);
  t.eq(a.fwp, 'BBB', '이전 WP(구간 시작)도 그대로 BBB');

  // ── 활성 구간이 뒤집히면 Direct-To 로 돌린다 ──
  await setup();
  await page.evaluate(() => fpMoveWp(1, 3));      // BBB(이전 WP)를 CCC 뒤로
  const b = await state();
  t.eq(b.order.join(' '), 'AAA CCC DDD BBB', `순서 (${b.order.join(' ')})`);
  t.eq(b.awp, 'CCC', '활성 WP 는 여전히 CCC');
  t.ok(await page.evaluate(() => S.fwp < S.awp),
    `이전 WP 가 활성 WP 앞에 오도록 정리된다 (fwp ${await page.evaluate(() => S.fwp)} < awp ${await page.evaluate(() => S.awp)})`);
  t.eq(await page.evaluate(() => { const L = activeCourseLine(); return !!L; }), true,
    '코스선이 끊기지 않는다');

  // ── 말이 안 되는 순서는 받지 않는다 ──
  await setup();
  const bad = await page.evaluate(() => [
    fpReorder([0, 1, 2]),          // 개수가 다르다
    fpReorder([0, 0, 1, 2]),       // 중복
    fpReorder([0, 1, 2, 9]),       // 범위 밖
    fpReorder([0, 1, 2, 3]),       // 그대로 — 바꿀 게 없다
    S.wps.map(w => w.ident).join(' '),
  ]);
  t.eq(bad.slice(0, 4).join(','), 'false,false,false,false', '잘못된 순서는 무시한다');
  t.eq(bad[4], 'AAA BBB CCC DDD', '무시했으면 목록도 그대로다');

  // ── 실제로 끌어 본다(포인터) ──
  // 함수는 맞는데 손잡이가 안 잡히면 사용자에게는 없는 기능이다.
  await setup();
  const drag = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 120));
    const rows = Array.from(document.querySelectorAll('.fp-wp-row'));
    const grip = rows[0].querySelector('.fp-wp-grip');
    if (!grip) return { err: '손잡이 없음' };
    if (!rows[0].getBoundingClientRect().height) return { err: '목록이 화면에 없다' };
    const g = grip.getBoundingClientRect();
    const r2 = rows[2].getBoundingClientRect();
    const ev = (type, y) => grip.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, bubbles: true, cancelable: true,
      clientX: g.left + g.width / 2, clientY: y }));
    ev('pointerdown', g.top + g.height / 2);
    ev('pointermove', r2.top + r2.height / 2 + 1);   // 3번째 행 중간을 지나서
    ev('pointerup',   r2.top + r2.height / 2 + 1);
    await new Promise(r => setTimeout(r, 50));
    return { order: S.wps.map(w => w.ident).join(' ') };
  });
  t.eq(drag.order, 'BBB CCC AAA DDD',
    `손잡이를 끌면 그 자리로 옮겨진다 (${drag.order})`);

  // 끌고 난 뒤 상세 카드가 열리면 안 된다(같은 자리에서 click 이 한 번 더 난다)
  const opened = await page.evaluate(async () => {
    const row = document.querySelector('.fp-wp-row');
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 30));
    return fpMode;
  });
  t.eq(opened, 'LIST', `끌고 난 직후의 click 은 카드를 열지 않는다 (${opened})`);

  // 평소에는 눌러서 카드가 열려야 한다 — 위 방어가 클릭을 통째로 먹으면 안 된다
  const still = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 450));      // 방어 시간(400ms) 뒤
    document.querySelector('.fp-wp-row').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 30));
    const m = fpMode;
    fpGo('LIST');
    return m;
  });
  t.eq(still, 'WPT', `그냥 누르면 종전대로 상세 카드가 열린다 (${still})`);
}
