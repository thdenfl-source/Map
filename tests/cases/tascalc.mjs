// TAS / IAS 계산기 (CDU → UTIL → True / Indicated Airspeed)
//
// 조종사가 이 숫자로 항법 계산을 한다. 그래서 "그럴듯한 값" 으로는 부족하고,
// 앱 바깥에서 독립적으로 계산한 값과 맞아야 한다. 여기서는 두 가지로 건다.
//   ① 널리 쓰는 계산기의 알려진 답과 대조 (PA 8000ft · OAT 15°C · IAS 100 → 116.03)
//   ② ISA 식을 이 파일에서 다시 구현해 전 구간을 대조 (앱 코드를 베끼지 않는다)
// 그리고 화면의 숫자판을 실제로 눌러 넣는다 — 계산이 맞아도 입력이 끊기면 소용없다.
export const name = 'TAS / IAS 계산';

// 앱과 무관한 독립 구현 — 두 코드가 같은 실수를 하지 않는 한 어긋남이 드러난다
function tasRatio(paFt, oatC) {
  const p = 1013.25 * Math.pow(1 - 6.87535e-6 * paFt, 5.2558797);   // hPa
  const rho = p * 100 / (287.05287 * (oatC + 273.15));              // kg/m³
  return Math.sqrt(1.225 / rho);
}

export async function run(page, t) {
  // 화면에 그려진 값을 라벨로 찾아 읽는다(내부 변수가 아니라 조종사가 보는 숫자)
  const setup = () => page.evaluate(() => {
    window.__tas = {
      read: lbl => {
        for (const d of document.querySelectorAll('#cdu-wrap div')) {
          const sp = d.querySelectorAll(':scope > span');
          if (sp.length === 2 && sp[0].textContent.trim() === lbl) return parseFloat(sp[1].textContent);
        }
        return null;
      },
      type: (fld, val) => {
        CDU_ACT.utilFocus(fld);
        String(val).split('').forEach(ch => CDU_ACT.utilNumKey(ch === '-' ? '±' : ch));
        CDU_ACT.utilNumKey('ENT');
      },
    };
  });
  await setup();

  // ── 메뉴에 있고 열리는가 ──
  const open = await page.evaluate(() => {
    CDU_ACT.utilOpen('MENU');
    const inMenu = /True \/ Indicated Airspeed/.test(document.getElementById('cdu-wrap').textContent);
    CDU_ACT.utilOpen('TAS');
    const txt = document.getElementById('cdu-wrap').textContent;
    return { inMenu, opened: /True \/ Indicated Airspeed/.test(txt),
             hasIas: /지시대기속도 IAS/.test(txt), hasTas: /진대기속도 TAS/.test(txt) };
  });
  t.eq(open.inMenu, true, 'UTIL 목록에 TAS 계산기가 있다');
  t.ok(open.opened && open.hasIas && open.hasTas, 'TAS 화면이 열리고 IAS·TAS 칸이 있다');

  // ── 알려진 답과 대조 ──
  const ref = await page.evaluate(() => {
    __tas.type('tasPA', 8000); __tas.type('tasOAT', 15); __tas.type('tasIAS', 100);
    return __tas.read('진대기속도 TAS');
  });
  t.ok(Math.abs(ref - 116.03) < 0.1,
    `PA 8000ft · OAT 15°C · IAS 100kt → TAS ${ref}kt (기준 116.03)`);

  // ── 독립 구현과 전 구간 대조 ──
  const CASES = [[0, 15, 100], [5000, 5, 90], [10000, -5, 120], [2000, 30, 60],
                 [14000, -20, 150], [-500, 35, 80]];
  const got = await page.evaluate(cs => cs.map(([pa, oat, ias]) => {
    __tas.type('tasPA', pa); __tas.type('tasOAT', oat); __tas.type('tasIAS', ias);
    return __tas.read('진대기속도 TAS');
  }), CASES);
  const bad = [];
  CASES.forEach(([pa, oat, ias], i) => {
    const want = ias * tasRatio(pa, oat);
    if (Math.abs(got[i] - want) > 0.1) bad.push(`PA${pa}/${oat}°C/${ias}kt → ${got[i]} ≠ ${want.toFixed(1)}`);
  });
  t.eq(bad.length, 0,
    `${CASES.length}가지 조건이 ISA 식과 일치${bad.length ? ' — ' + bad.join(' / ') : ''}`);

  // 해면 표준대기에서는 IAS 와 TAS 가 같다 — 눈으로 검산되는 기준점
  const sea = await page.evaluate(() => {
    __tas.type('tasPA', 0); __tas.type('tasOAT', 15); __tas.type('tasIAS', 100);
    return __tas.read('진대기속도 TAS');
  });
  t.eq(sea, 100, `해면 표준대기에서는 IAS = TAS (${sea}kt)`);

  // ── 반대 방향: TAS 를 넣으면 IAS 가 나온다 ──
  const rev = await page.evaluate(() => {
    __tas.type('tasPA', 8000); __tas.type('tasOAT', 15);
    __tas.type('tasTAS', 116.03);
    const ias = __tas.read('지시대기속도 IAS');
    // 조건만 바꾸면 지금 IAS 기준으로 TAS 가 다시 잡힌다
    __tas.type('tasOAT', -15);
    return { ias, tasAfter: __tas.read('진대기속도 TAS'), iasAfter: __tas.read('지시대기속도 IAS') };
  });
  t.ok(Math.abs(rev.ias - 100) < 0.1, `TAS 116.03 → IAS ${rev.ias}kt (되돌아온다)`);
  t.ok(Math.abs(rev.iasAfter - rev.ias) < 0.05 &&
       Math.abs(rev.tasAfter - rev.ias * tasRatio(8000, -15)) < 0.2,
    `조건(OAT)을 바꾸면 IAS 는 그대로 두고 TAS 를 다시 잡는다 (${rev.tasAfter}kt)`);

  // ── 영하 온도가 입력되는가(± 키) ──
  const neg = await page.evaluate(() => {
    __tas.type('tasOAT', -20);
    return __tas.read('외기온도 OAT');
  });
  t.eq(neg, -20, `영하 온도가 들어간다 (${neg}°C)`);

  // ── 현재 비행상태 채우기 ──
  const here = await page.evaluate(() => {
    S.alt = 5000; S.spd = 90; window._oatSurfaceC = 20;
    CDU_ACT.utilTasHere();
    return { pa: __tas.read('기압고도 PA'), oat: __tas.read('외기온도 OAT'),
             ias: __tas.read('지시대기속도 IAS'), tas: __tas.read('진대기속도 TAS') };
  });
  t.ok(here.pa === 5000 && here.ias === 90,
    `현재 비행상태를 그대로 넣는다 (PA ${here.pa}ft · IAS ${here.ias}kt)`);
  t.eq(here.oat, 10, `고도 감률(-1.98°C/1000ft)로 외기온도를 잡는다 (지면 20°C → ${here.oat}°C)`);
  t.ok(Math.abs(here.tas - 90 * tasRatio(5000, 10)) < 0.2,
    `채운 값으로 TAS 까지 나와 있다 (${here.tas}kt)`);

  // ── 근거를 함께 보여 주는가 ──
  // 숫자 하나만 던지면 조종사가 검산할 수 없다.
  const note = await page.evaluate(() => document.getElementById('cdu-wrap').textContent);
  t.ok(/ISA/.test(note) && /밀도고도/.test(note) && /배율/.test(note),
    'ISA 편차·밀도고도·배율을 함께 보여 준다');
}
