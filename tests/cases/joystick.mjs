// 조종 장치(조이스틱 · 게임패드) 연동.
//
// 실제 장치를 꽂을 수 없으므로 navigator.getGamepads 를 가짜 패드로 바꿔 두고
// joyPoll(시각) 을 직접 돌린다 — 폴링 한 번이 곧 한 프레임이다.
// 확인할 것은 "버튼을 눌렀을 때 실제로 그 동작이 일어나는가" 이므로,
// 배정된 동작이 바꾸는 상태값(selHdg · S.running …)을 본다.
export const name = '조이스틱 연동';

// 가짜 패드를 깔고 버튼 상태를 바꿀 수 있는 손잡이를 만든다
const SETUP = () => {
  window._pad = {
    index: 0, id: 'TEST STICK', mapping: '',
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  navigator.getGamepads = () => [window._pad];
  window._press = (i, on) => { _pad.buttons[i] = { pressed: !!on, value: on ? 1 : 0 }; };
  window._axis  = (i, v) => { _pad.axes[i] = v; };
  joyStop();                      // rAF 루프는 끄고 손으로 돌린다
  joyBinds = {}; joyCancelCapture();
  joyOn = true;
  for (const k in _joyNeutral) delete _joyNeutral[k];
  for (const k in _joyHat) delete _joyHat[k];
  joyActiveIdx = -1;
};

export async function run(page, t) {
  // ── 배정한 버튼이 동작을 부른다 ──
  const press = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    joySetBind('b5', 'sim');
    S.running = false;
    let now = 1000;
    joyPoll(now);                         // 안 누른 상태 — 아무 일 없어야 한다
    const idle = S.running;
    _press(5, true);  joyPoll(now += 16); // 누름 = FLY
    const down = S.running;
    joyPoll(now += 16);                   // 누른 채로 더 돌아도 한 번뿐
    const held = S.running;
    _press(5, false); joyPoll(now += 16); // 떼도 그대로
    const up = S.running;
    _press(5, true);  joyPoll(now += 16); // 다시 누르면 PAUSE
    const again = S.running;
    _press(5, false); joyPoll(now += 16);
    S.running = false;
    return { idle, down, held, up, again };
  })()`);
  t.eq(press.idle, false, '누르지 않으면 아무 일도 없다');
  t.eq(press.down, true, '배정한 버튼을 누르면 FLY 로 바뀐다');
  t.eq(press.held, true, '누르고 있는 동안 다시 실행되지 않는다(누르는 순간 한 번)');
  t.eq(press.up, true, '떼는 것만으로는 바뀌지 않는다');
  t.eq(press.again, false, '다시 누르면 PAUSE — 토글이다');

  // ── 반복(repeat) 동작은 화면 버튼 홀드와 같은 리듬이다 ──
  // 누르는 즉시 1회, 350ms 뒤부터 80ms 마다.
  const rep = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    joySetBind('b2', 'hdgUp');
    gspdOn = false; selHdg = 100;
    let now = 1000;
    _press(2, true);
    joyPoll(now); const first = selHdg;
    for (let i = 0; i < 20; i++) joyPoll(now += 16);   // +320ms — 아직 반복 전
    const beforeDelay = selHdg;
    for (let i = 0; i < 20; i++) joyPoll(now += 16);   // +640ms 까지
    const after = selHdg;
    _press(2, false); joyPoll(now += 16);
    const stopped = selHdg;
    for (let i = 0; i < 20; i++) joyPoll(now += 16);
    return { first, beforeDelay, after, stopped, end: selHdg };
  })()`);
  t.eq(rep.first, 101, '누르는 즉시 한 번 움직인다 (HDG 100→101)');
  t.eq(rep.beforeDelay, 101, '350ms 전에는 반복하지 않는다');
  t.ok(rep.after >= 104 && rep.after <= 106,
    `그 뒤 80ms 마다 반복한다 (640ms 에 ${rep.after - 100}°)`);
  t.eq(rep.end, rep.stopped, '떼면 즉시 멈춘다');

  // ── 누르는 동안 유지되는 동작(hold)은 뗄 때 반드시 풀린다 ──
  // 트림은 자체 반복 타이머를 쓴다 — 떼는 것을 놓치면 타이머가 살아남아
  // 계속 속도가 오른다(런어웨이). 그래서 타이머가 정리됐는지를 본다.
  const hold = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    joySetBind('b3', 'trimF');
    gspdOn = false; S.spd = 100;
    let now = 1000;
    _press(3, true); joyPoll(now += 16);
    const on = { spd: S.spd, timer: trimHoldTimer !== null };
    _press(3, false); joyPoll(now += 16);
    return { on, offTimer: trimHoldTimer, offInt: trimHoldInt };
  })()`);
  t.eq(hold.on.spd, 101, '누르면 트림이 걸린다 (IAS 100→101)');
  t.eq(hold.on.timer, true, '누르고 있는 동안 트림 홀드가 살아 있다');
  t.eq(hold.offTimer, null, '떼면 홀드 타이머가 정리된다');
  t.eq(hold.offInt, null, '반복 타이머도 남지 않는다');

  // 연결이 끊겨도 마찬가지다 — 장치가 사라진 프레임에서 풀어야 한다
  const lost = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    joySetBind('b3', 'trimF');
    gspdOn = false; S.spd = 100;
    let now = 1000;
    _press(3, true); joyPoll(now += 16);
    navigator.getGamepads = () => [];       // 뽑힘
    joyPoll(now += 16);
    return { timer: trimHoldTimer, name: joyPadName };
  })()`);
  t.eq(lost.timer, null, '장치가 빠지면 누르고 있던 트림이 풀린다');
  t.eq(lost.name, '', '연결 표시도 지워진다');

  // ── 햇(HAT)처럼 축으로 올라오는 입력도 방향별로 잡는다 ──
  // 중립이 0 이 아닌 기종이 있어(정지 상태 -1) 연결 시점 값을 중립으로 삼는다.
  const ax = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    _pad.axes = [0, 0, -1, 0];               // 축2(햇)는 -1 에서 쉰다
    joySetBind('a0+', 'spdUp');
    joySetBind('a0-', 'spdDn');
    joySetBind('a2+', 'altUp');
    S.spd = 100; selAlt = 1000;
    let now = 1000;
    joyPoll(now);                            // 중립 학습 — 쉬는 값이 눌림이 되면 안 된다
    const idle = { spd: S.spd, alt: selAlt };
    _axis(0, 1);  joyPoll(now += 16);
    const plus = S.spd;
    _axis(0, 0);  joyPoll(now += 16);
    _axis(0, -1); joyPoll(now += 16);
    const minus = S.spd;
    _axis(0, 0);  joyPoll(now += 16);
    _axis(2, 0);  joyPoll(now += 16);        // 햇을 밀면 중립(-1)에서 +1 만큼
    const hat = selAlt;
    _axis(2, -1); joyPoll(now += 16);
    return { idle, plus, minus, hat };
  })()`);
  t.eq(ax.idle.spd, 100, '가운데 있는 축은 눌린 것으로 보지 않는다');
  t.eq(ax.idle.alt, 1000, '쉬는 값이 -1 인 햇도 눌린 것으로 보지 않는다');
  t.eq(ax.plus, 101, '축을 + 로 밀면 그 방향 동작이 돈다');
  t.eq(ax.minus, 100, '반대로 밀면 반대 동작이 돈다');
  t.eq(ax.hat, 1100, '햇도 쉬는 자리에서 벗어난 만큼으로 판정한다 (ALT 1000→1100)');

  // ── 축 하나로 올라오는 8방향 햇(HAT) ──
  // 쉬는 자리를 1 밖(3.2857)으로 보내고 눌린 방향은 -1…1 을 8등분해 싣는
  // 기종이 많다. ± 두 방향으로 보면 여덟 방향이 죄다 한 입력으로 뭉친다.
  // 네 방향으로 풀리는지, 대각에서 이웃 두 방향이 함께 걸리는지를 본다.
  const hat = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    _pad.axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3.2857142857142856];   // 축9 = 햇
    joySetBind('h9N', 'trimF'); joySetBind('h9S', 'trimA');
    joySetBind('h9W', 'trimL'); joySetBind('h9E', 'trimR');
    gspdOn = false; rollApOn = true;
    let now = 1000;
    S.spd = 100; bankTarget = 0;
    joyPoll(now);                       // 쉬는 자리 — 아무 방향도 아니다
    const idle = { spd: S.spd, bank: bankTarget };
    const push = (v) => {
      _axis(9, v); joyPoll(now += 16);
      const r = { spd: S.spd, bank: bankTarget };
      _axis(9, 3.2857142857142856); joyPoll(now += 16);
      return r;
    };
    const up    = push(-1);             // ▲
    S.spd = 100; bankTarget = 0;
    const right = push(-3/7);           // ▶
    S.spd = 100; bankTarget = 0;
    const down  = push(1/7);            // ▼
    S.spd = 100; bankTarget = 0;
    const left  = push(5/7);            // ◀
    S.spd = 100; bankTarget = 0;
    const upRight = push(-5/7);         // ▲▶ — 두 방향이 함께
    S.spd = 100; bankTarget = 0;
    const codes = { up: joyHatDirs(-1), diag: joyHatDirs(-5/7), rest: joyHatDirs(3.2857142857142856),
                    analog: joyHatDirs(0.31) };
    stopTrimHold();
    return { idle, up, right, down, left, upRight, codes, label: joyCodeLabel('h9N') };
  })()`);
  t.eq(hat.idle.spd, 100, '햇이 쉬는 자리에서는 아무 방향도 걸리지 않는다');
  t.eq(hat.up.spd, 101, '▲ 는 전방 트림이다 (IAS 100→101)');
  t.eq(hat.down.spd, 99, '▼ 는 후방 트림이다 (IAS 100→99)');
  t.eq(hat.right.bank, 1, '▶ 는 우 트림이다 (뱅크 +1)');
  t.eq(hat.left.bank, -1, '◀ 는 좌 트림이다 (뱅크 −1)');
  t.eq(hat.upRight.spd, 101, '대각 ▲▶ 에서도 전방 트림이 걸린다');
  t.eq(hat.upRight.bank, 1, '같은 대각에서 우 트림도 함께 걸린다');
  t.eq(JSON.stringify(hat.codes.up), '["N"]', '▲ 값은 한 방향으로 풀린다');
  t.eq(JSON.stringify(hat.codes.diag), '["N","E"]', '대각 값은 이웃 두 방향으로 풀린다');
  t.eq(JSON.stringify(hat.codes.rest), '[]', '쉬는 값(3.2857)은 방향이 아니다');
  t.eq(JSON.stringify(hat.codes.analog), '[]', '격자에서 벗어난 아날로그 축 값은 방향으로 보지 않는다');
  t.eq(hat.label, '햇 9 ▲', '화면에는 햇 방향으로 읽힌다');

  // ── 쉬는 자리가 0 인 8방향 햇 ──
  // 쉬는 값을 1 밖으로 보내지 않는 기종이 있다. 이때 ± 로만 보면 좌우(±3/7·±5/7)가
  // 전후(±1)와 같은 코드로 뭉쳐서 "좌우가 안 먹는" 증상이 된다.
  // 8등분 격자에만 나오는 값(±1/7·±3/7·±5/7)으로 햇임을 알아채야 한다.
  const hat0 = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    _pad.axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];      // 축9 햇이 0 에서 쉰다
    joySetBind('h9N', 'trimF'); joySetBind('h9S', 'trimA');
    joySetBind('h9W', 'trimL'); joySetBind('h9E', 'trimR');
    gspdOn = false; S.spd = 100; bankTarget = 0;
    let now = 1000;
    joyPoll(now);
    const idle = { spd: S.spd, bank: bankTarget, hat: !!(_joyHat[0] || {})[9] };
    _axis(9, -3/7); joyPoll(now += 16);              // ▶ — 격자값이라 여기서 햇으로 판정
    const right = { bank: bankTarget, hat: !!(_joyHat[0] || {})[9] };
    _axis(9, 0); joyPoll(now += 16);
    bankTarget = 0;
    _axis(9, 5/7); joyPoll(now += 16);               // ◀
    const left = bankTarget;
    _axis(9, 0); joyPoll(now += 16);
    _axis(9, -1); joyPoll(now += 16);                // ▲
    const up = S.spd;
    _axis(9, 0); joyPoll(now += 16);
    stopTrimHold();
    return { idle, right, left, up,
             analog: joyIsHatValue(-1), lattice: joyIsHatValue(-3/7) };
  })()`);
  t.eq(hat0.idle.hat, false, '가운데 있을 때만으로는 햇인지 알 수 없다');
  t.eq(hat0.right.hat, true, '8등분 격자값이 오면 그 축을 햇으로 알아챈다');
  t.eq(hat0.right.bank, 1, '▶ 가 우 트림으로 걸린다 (종전에는 전후와 같은 입력으로 뭉쳤다)');
  t.eq(hat0.left, -1, '◀ 는 좌 트림이다');
  t.eq(hat0.up, 101, '햇으로 바뀐 뒤에도 ▲ 는 전방 트림이다');
  t.eq(hat0.analog, false, '±1 만으로는 햇으로 보지 않는다(보통 축도 내는 값)');
  t.eq(hat0.lattice, true, '±3/7 같은 값은 햇에서만 나온다');

  // ── 입력 진단 — 지금 들어오는 값을 그대로 보여 준다 ──
  const mon = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    _pad.axes = [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 3.2857142857142856];
    let now = 1000;
    joyPoll(now);                       // 축9 를 햇으로 판정
    _press(4, true); joyPoll(now += 16);
    const m = joyMonitor();
    _press(4, false); joyPoll(now += 16);
    return { id: m.id, btns: m.btns.map(x => x.i), a0: m.axes[0].v, hat9: m.axes[9].hat, n: m.axes.length };
  })()`);
  t.eq(mon.id, 'TEST STICK', '진단에 장치 이름이 나온다');
  t.eq(JSON.stringify(mon.btns), '[4]', '지금 눌린 버튼 번호가 나온다');
  t.eq(mon.a0, 0.5, '축 원값이 그대로 나온다');
  t.eq(mon.hat9, true, '햇으로 푸는 축은 그렇게 표시된다');
  t.eq(mon.n, 10, '축은 빠짐없이 보여 준다');

  // ── 조종 장치가 여러 대로 올라오는 기종 ──
  // 스틱 하나가 패드 두 대로 잡히면서 첫 번째가 아무 값도 내지 않는 껍데기인
  // 경우가 있다(복합 HID). 종전에는 첫 번째만 보다가 영영 조용했다.
  // 움직이는 쪽으로 옮겨 붙는지 본다.
  const multi = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    const mk = (index, id) => ({ index, id, mapping: '',
      buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })), axes: [0, 0] });
    const dummy = mk(0, 'PXN GHOST'), real = mk(1, 'PXN-F16');
    navigator.getGamepads = () => [dummy, real];
    joySetBind('b3', 'sim');
    S.running = false;
    let now = 1000;
    joyPoll(now);                                    // 아무도 안 움직임 — 첫 패드를 본다
    const idle = { idx: joyActiveIdx, name: joyPadName };
    real.buttons[3] = { pressed: true, value: 1 };   // 진짜 장치에서 입력
    joyPoll(now += 16);
    const moved = { idx: joyActiveIdx, name: joyPadName, run: S.running };
    real.buttons[3] = { pressed: false, value: 0 };
    joyPoll(now += 16);
    const mon = joyMonitor();
    S.running = false;
    return { idle, moved, monIdx: mon.index, pads: mon.pads.length };
  })()`);
  t.eq(multi.idle.idx, 0, '아무 것도 안 움직이면 첫 장치를 본다');
  t.eq(multi.moved.idx, 1, '값을 내는 쪽으로 옮겨 붙는다 (껍데기 장치 건너뜀)');
  t.eq(multi.moved.name, 'PXN-F16', '이름도 그 장치 것으로 바뀐다');
  t.eq(multi.moved.run, true, '그 장치의 버튼이 동작을 부른다 (종전에는 조용했다)');
  t.eq(multi.monIdx, 1, '진단도 쓰고 있는 장치를 가리킨다');
  t.eq(multi.pads, 2, '진단에 연결된 장치가 모두 나온다');

  // ── 장치가 안 보일 때 이유를 알려 준다 ──
  const why = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    navigator.getGamepads = () => [];
    joyPoll(1000);
    const m = joyMonitor();
    return { none: m.none, why: m.why, api: m.api, secure: m.secure };
  })()`);
  t.eq(why.none, true, '장치가 없으면 그렇게 알려 준다');
  t.eq(why.api, true, '이 브라우저가 Gamepad API 를 지원하는지 함께 본다');
  t.ok(why.why === 'NO_INPUT' || why.why === 'BLUR' || why.why === 'INSECURE',
    `왜 안 보이는지까지 짚어 준다 (${why.why})`);

  // ── 배정(캡처) — 동작을 고른 뒤 누른 버튼이 그 자리에서 잡힌다 ──
  const cap = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    joySetBind('b1', 'gspd');
    gspdOn = false;
    let now = 1000;
    joyBeginCapture('gspd');
    _press(7, true); joyPoll(now += 16);     // 배정용 입력은 동작을 실행하지 않는다
    const ranWhileBinding = gspdOn;
    _press(7, false); joyPoll(now += 16);
    const code = joyBindOf('gspd'), old = joyBinds['b1'];
    _press(7, true); joyPoll(now += 16);     // 이제부터는 그 버튼이 동작을 부른다
    const ran = gspdOn;
    _press(7, false); joyPoll(now += 16);
    if (gspdOn) toggleGspd();
    return { ranWhileBinding, code, old, ran, capture: joyCapture,
             label: joyCodeLabel(code), saved: localStorage.getItem('joyBinds') };
  })()`);
  t.eq(cap.ranWhileBinding, false, '배정하려고 누른 그 입력은 동작을 실행하지 않는다');
  t.eq(cap.code, 'b7', '누른 버튼이 그 동작에 잡힌다');
  t.eq(cap.old, undefined, '한 동작에 입력 하나 — 종전 배정은 지워진다');
  t.eq(cap.ran, true, '배정 뒤에는 그 버튼이 동작을 부른다');
  t.eq(cap.capture, null, '한 번 잡으면 대기가 풀린다');
  t.eq(cap.label, '버튼 7', '화면에 읽을 수 있는 이름으로 나온다');
  t.ok((cap.saved || '').includes('b7'), '배정은 기기에 저장된다(다시 켜도 남는다)');

  // ── 기능을 끄면 아무 버튼도 듣지 않는다 ──
  const off = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    joySetBind('b5', 'sim');
    S.running = false; joyOn = false;
    let now = 1000;
    _press(5, true); joyPoll(now += 16);
    const while_off = S.running;
    joyOn = true; _press(5, false); joyPoll(now += 16);
    _press(5, true); joyPoll(now += 16);
    const on = S.running;
    _press(5, false); joyPoll(now += 16);
    S.running = false;
    return { while_off, on, name: joyPadName };
  })()`);
  t.eq(off.while_off, false, '설정에서 끄면 버튼이 듣지 않는다');
  t.eq(off.on, true, '다시 켜면 듣는다');
  t.eq(off.name, 'TEST STICK', '꺼져 있어도 연결 여부는 알려 준다');

  // ── 버튼이 '키' 로 올라오는 기종(안드로이드) ──
  // 안드로이드는 조종 장치의 버튼을 게임패드 버튼이 아니라 키 이벤트로 넘기는
  // 기종이 많다(축·햇만 잡히고 버튼은 조용한 증상). 키도 같은 입력으로 받는다.
  const key = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    const hit = (type, code) => document.dispatchEvent(
      new KeyboardEvent(type, { code, bubbles: true }));
    joyBeginCapture('gspd');
    hit('keydown', 'F13'); hit('keyup', 'F13');      // 배정
    const bound = joyBindOf('gspd');
    gspdOn = false;
    hit('keydown', 'F13');                            // 이제 동작을 부른다
    const ran = gspdOn;
    hit('keyup', 'F13');
    // 배정하지 않은 키는 건드리지 않는다(기존 키보드 단축키와 다투지 않게)
    let stray = false;
    const before = selHdg;
    hit('keydown', 'F14'); hit('keyup', 'F14');
    stray = (selHdg !== before);
    if (gspdOn) toggleGspd();
    return { bound, ran, stray, label: joyCodeLabel(bound) };
  })()`);
  t.eq(key.bound, 'kF13', '키로 올라오는 버튼도 배정된다');
  t.eq(key.ran, true, '배정한 키를 누르면 동작이 돈다');
  t.eq(key.stray, false, '배정하지 않은 키는 건드리지 않는다');
  t.eq(key.label, '키 F13', '화면에는 키 이름으로 나온다');

  // ── 게임패드로 안 잡히는 장치를 직접 여는 길(WebHID) ──
  // 리포트 서술자(WebHID 가 풀어 준 items)를 따라 비트를 잘라 낸다.
  // 기종별 하드코딩이 없으므로, 서술자와 바이트만 주고 결과를 확인한다.
  const hid = await page.evaluate(`(() => {
    const B = (u) => 0x00090000 | u, D = (u) => 0x00010000 | u;
    const items = [
      { usageMinimum: B(1), usageMaximum: B(8), usages: [],
        reportSize: 1, reportCount: 8, logicalMinimum: 0, logicalMaximum: 1 },
      { usages: [D(0x30)], reportSize: 8, reportCount: 1,
        logicalMinimum: 0, logicalMaximum: 255 },              // X
      { usages: [D(0x31)], reportSize: 8, reportCount: 1,
        logicalMinimum: 0, logicalMaximum: 255 },              // Y
      { usages: [D(0x39)], reportSize: 4, reportCount: 1,
        logicalMinimum: 0, logicalMaximum: 7 },                // 햇
      { isConstant: true, reportSize: 4, reportCount: 1 },     // 자리 채우기
    ];
    const bytes = new Uint8Array([0b00000101, 255, 128, 0x02]); // B1·B3 · X끝 · Y중간 · 햇 E
    const r = hidParseReport(items, new DataView(bytes.buffer));
    const idle = hidParseReport(items,
      new DataView(new Uint8Array([0, 128, 128, 0x0f]).buffer)); // 햇 = 범위 밖(가운데)
    return { b0: r.btn[0], b1: r.btn[1], b2: r.btn[2], x: r.ax[0], y: r.ax[1],
             hat: r.ax[2], hatDir: joyHatDirs(r.ax[2]),
             idleHat: idle.ax[2], idleDir: joyHatDirs(idle.ax[2]) };
  })()`);
  t.eq(hid.b0, 1, '1비트씩 붙은 버튼을 제자리에서 읽는다 (B1)');
  t.eq(hid.b1, 0, '누르지 않은 버튼은 0 이다');
  t.eq(hid.b2, 1, '세 번째 버튼도 제자리다 (B3)');
  t.eq(hid.x, 1, '축은 논리범위를 -1…1 로 편다 (X 255→+1)');
  t.ok(Math.abs(hid.y) < 0.01, `가운데 값은 0 근처다 (Y ${hid.y.toFixed(3)})`);
  t.eq(JSON.stringify(hid.hatDir), '["E"]', '햇은 게임패드 관례값으로 바꿔 방향이 그대로 풀린다');
  t.eq(JSON.stringify(hid.idleDir), '[]', '범위 밖(가운데) 햇은 아무 방향도 아니다');

  // ── 직접 연결을 못 쓰는 기기에서는 사정을 그대로 알려 준다 ──
  // 아이패드는 크롬을 깔아도 사파리(WebKit) 엔진이라 WebHID 가 없다.
  // "크롬을 쓰십시오" 는 그 기기에서 아무 도움이 안 되는 안내다.
  const ios = await page.evaluate(`(() => ({
    ipadUA:  joyIsIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) CriOS/120', 5, 'iPad'),
    ipadOS:  joyIsIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, 'MacIntel'),
    mac:     joyIsIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120', 0, 'MacIntel'),
    win:     joyIsIos('Mozilla/5.0 (Windows NT 10.0) Chrome/120', 0, 'Win32'),
    android: joyIsIos('Mozilla/5.0 (Linux; Android 14) Chrome/120', 5, 'Linux armv8l'),
    msg: JOY_HID_WHY_MSG.IOS,
  }))()`);
  t.eq(ios.ipadUA, true, '아이패드(크롬 CriOS)를 알아본다');
  t.eq(ios.ipadOS, true, '데스크톱으로 위장한 아이패드OS 도 알아본다 (MacIntel + 멀티터치)');
  t.eq(ios.mac, false, '맥은 아이패드로 보지 않는다 — 여기서는 직접 연결이 된다');
  t.eq(ios.win, false, '윈도우도 아니다');
  t.eq(ios.android, false, '안드로이드도 아니다');
  t.ok(ios.msg.includes('WebKit') && !ios.msg.includes('Chrome · Edge 를 쓰십시오'),
    '아이패드 안내는 "크롬을 쓰라" 가 아니라 사정을 설명한다');

  // ── 설정 화면에 배정 화면이 있고, 목록이 그려진다 ──
  const ui = await page.evaluate(`(() => {
    (${SETUP.toString()})();
    joySetBind('b4', 'ftr');
    selectPanel('right', 'cdu', true);
    switchMode('JOYSTICK');
    const el = document.getElementById('mainContentArea');
    const txt = el.innerText;
    const rows = el.querySelectorAll('[data-act="joyPick"]').length;
    const hasMon = !!document.getElementById('joy-mon');
    const hasHid = !!el.querySelector('[data-act="joyHidPick"]');
    // 못 쓰는 기기에서는 버튼에 그렇게 적힌다
    const st = joyHidStatus();
    const hidTxt = el.querySelector('[data-act="joyHidPick"]').innerText;
    const hidMark = st.supported ? !hidTxt.includes('못 씀') : hidTxt.includes('못 씀');
    const hasHoverPage = txt.includes('HOVER PAGE');
    // 행을 누르면 배정 대기로 들어간다
    el.querySelector('[data-act="joyPick"]').click();
    const cap = joyCapture;
    joyCancelCapture(); switchMode('HOME');
    return { txt, rows, cap, hasMon, hasHid, hidMark, hasHoverPage, n: JOY_ACTIONS.length, first: JOY_ACTIONS[0].id };
  })()`);
  t.eq(ui.rows, ui.n, `동작 ${ui.n} 가지가 모두 배정 가능하다`);
  t.ok(ui.txt.includes('FORCE TRIM') && ui.txt.includes('버튼 4'),
    '배정된 버튼이 동작 옆에 보인다');
  t.ok(ui.txt.includes('TEST STICK'), '연결된 장치 이름이 보인다');
  t.eq(ui.hasMon, true, '배정 화면에 입력 진단 칸이 있다');
  t.eq(ui.hasHid, true, '게임패드로 안 잡히는 장치를 직접 열 수 있다');
  t.eq(ui.hidMark, true, '쓸 수 없는 기기에서는 버튼에 그렇게 적혀 있다(눌러 보고 알게 되지 않는다)');
  t.eq(ui.hasHoverPage, true, 'HOVER PAGE 도 배정할 수 있다');
  t.eq(ui.cap, ui.first, '행을 누르면 그 동작이 입력 대기가 된다');

  // 뒷정리 — 다음 검사가 가짜 패드를 물려받지 않도록
  await page.evaluate(() => {
    navigator.getGamepads = () => [];
    joyBinds = {}; joyCancelCapture(); joyReleaseAll();
    try { localStorage.removeItem('joyBinds'); } catch (e) {}
  });
}
