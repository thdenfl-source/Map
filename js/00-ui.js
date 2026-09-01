// ─────────────────────────────────────────────────────────────
// 00-ui.js — 인앱 알림/확인/입력 다이얼로그
// index.html 에서 분리한 조각. 클래식 스크립트라 전역 스코프를 공유하므로
// 로드 순서가 곧 실행 순서다. 순서를 바꾸면 동작이 달라진다.
//
// 브라우저 기본 alert/confirm/prompt 는 모달이 뜬 동안 스크립트를 멈춘다.
// 시뮬레이터는 requestAnimationFrame 으로 계속 돌아가야 하는데, 모달이 뜨면
// 그 루프가 통째로 정지하고 iOS 사파리에서는 복귀 후 화면이 튀거나 전체화면이
// 풀린다. 그래서 여기 있는 uiAlert / uiConfirm / uiPrompt 로 모두 대체했다.
//
// 셋 다 Promise 를 돌려준다(브라우저 원본과 달리 동기 반환이 아니다).
//   await uiAlert('메시지')            → undefined
//   await uiConfirm('물음')            → true / false
//   await uiPrompt('라벨', '기본값')   → 문자열 또는 null(취소)
//   await uiPrompt('라벨', 0, {numeric:true})  → 모바일에서 숫자 키패드
//   await uiConfirm('물음', {linkHref:'https://…'})  → 확인 버튼이 새 탭 링크
// 호출부는 async 함수로 바꾸고 await 를 붙여야 한다.
//
// uiToast 는 대기 없이 잠깐 떴다 사라지는 알림이다. 결과를 알리기만 하고
// 사용자의 응답이 필요 없는 자리에 쓴다.
// ─────────────────────────────────────────────────────────────

(function () {
  const CSS = `
  .ui-dlg-back{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);
    display:flex;align-items:center;justify-content:center;padding:16px;
    -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
  .ui-dlg{background:#1b1f26;color:#e8eaed;border:1px solid #3a424e;border-radius:10px;
    box-shadow:0 10px 40px rgba(0,0,0,.6);max-width:min(440px,94vw);width:100%;
    font-size:14px;line-height:1.5;overflow:hidden}
  .ui-dlg-msg{padding:18px 18px 14px;white-space:pre-wrap;word-break:break-word;
    max-height:52vh;overflow:auto}
  .ui-dlg-in{display:block;width:calc(100% - 36px);margin:0 18px 14px;padding:9px 10px;
    background:#11151b;color:#e8eaed;border:1px solid #4a5464;border-radius:6px;
    font-size:16px;font-family:inherit}
  .ui-dlg-in:focus{outline:none;border-color:#5a9cff}
  .ui-dlg-btns{display:flex;gap:8px;justify-content:flex-end;padding:0 14px 14px}
  .ui-dlg-btns button{min-width:76px;padding:9px 14px;border-radius:6px;cursor:pointer;
    font-size:14px;font-family:inherit;border:1px solid #4a5464;background:#2a313b;color:#e8eaed}
  .ui-dlg-btns .ui-dlg-ok{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
  .ui-dlg-btns a.ui-dlg-ok{min-width:76px;padding:9px 14px;border-radius:6px;cursor:pointer;
    font-size:14px;font-family:inherit;border:1px solid #2f6fd0;text-align:center}
  .ui-dlg-btns button:active,.ui-dlg-btns a:active{filter:brightness(1.25)}
  .ui-toast-wrap{position:fixed;left:50%;bottom:38px;transform:translateX(-50%);
    z-index:100001;display:flex;flex-direction:column;gap:8px;align-items:center;
    pointer-events:none;max-width:92vw}
  .ui-toast{background:rgba(24,28,34,.95);color:#e8eaed;border:1px solid #3a424e;
    border-radius:8px;padding:10px 16px;font-size:13.5px;white-space:pre-wrap;
    box-shadow:0 6px 20px rgba(0,0,0,.5);opacity:0;transition:opacity .18s ease}
  .ui-toast.on{opacity:1}
  .ui-toast.warn{border-color:#b4632a}
  .ui-toast.err{border-color:#c04a4a}
  `;
  const st = document.createElement('style');
  st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);
})();

// 다이얼로그가 열려 있는 동안 그 아래 화면으로 클릭이 새지 않게 하나만 띄운다.
// 이미 열려 있는데 또 열리면 뒤에 줄을 세운다(먼저 뜬 것이 닫혀야 다음이 뜬다).
let _uiDlgQueue = Promise.resolve();

function _uiDialog(opts) {
  const run = () => new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'ui-dlg-back';
    const dlg = document.createElement('div');
    dlg.className = 'ui-dlg';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');

    const msg = document.createElement('div');
    msg.className = 'ui-dlg-msg';
    msg.textContent = String(opts.msg == null ? '' : opts.msg);
    dlg.appendChild(msg);

    let input = null;
    if (opts.kind === 'prompt') {
      input = document.createElement('input');
      input.className = 'ui-dlg-in';
      input.type = 'text';
      // 숫자 입력칸은 모바일에서 숫자 키패드가 바로 뜨게 한다(type=number 는
      // 선행 0·부호 편집이 브라우저마다 달라 text + inputmode 로 둔다).
      if (opts.numeric) { input.inputMode = 'decimal'; input.autocomplete = 'off'; }
      if (opts.password) { input.type = 'password'; input.autocomplete = 'off'; }
      input.value = opts.def == null ? '' : String(opts.def);
      dlg.appendChild(input);
    }

    const btns = document.createElement('div');
    btns.className = 'ui-dlg-btns';
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      try { back.remove(); } catch (e) { _swallow(e); }
      resolve(val);
    };

    if (opts.kind !== 'alert') {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = opts.cancelText || '취소';
      cancel.onclick = () => close(opts.kind === 'confirm' ? false : null);
      btns.appendChild(cancel);
    }
    // linkHref 가 있으면 확인 버튼을 <a target="_blank"> 로 만든다.
    // await 뒤에 window.open() 을 부르면 사용자 제스처와 끊겨 팝업 차단에 걸리는데,
    // 사용자가 직접 누르는 링크는 차단되지 않는다.
    const ok = document.createElement(opts.linkHref ? 'a' : 'button');
    if (opts.linkHref) {
      ok.href = opts.linkHref;
      ok.target = '_blank';
      ok.rel = 'noopener noreferrer';
      ok.style.textDecoration = 'none';
      ok.style.display = 'inline-block';
    } else {
      ok.type = 'button';
    }
    ok.className = 'ui-dlg-ok';
    ok.textContent = opts.okText || '확인';
    ok.onclick = () => close(opts.kind === 'confirm' ? true
      : opts.kind === 'prompt' ? input.value : undefined);
    btns.appendChild(ok);
    dlg.appendChild(btns);

    // 배경 클릭 = 취소(알림은 확인과 같다)
    back.onclick = (ev) => {
      if (ev.target !== back) return;
      close(opts.kind === 'confirm' ? false : opts.kind === 'prompt' ? null : undefined);
    };
    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault(); ev.stopPropagation();
        close(opts.kind === 'confirm' ? false : opts.kind === 'prompt' ? null : undefined);
      } else if (ev.key === 'Enter' && (opts.kind !== 'prompt' || ev.target === input)) {
        ev.preventDefault(); ev.stopPropagation();
        ok.onclick();
      }
    }
    document.addEventListener('keydown', onKey, true);

    back.appendChild(dlg);
    document.body.appendChild(back);
    // 입력창은 바로 포커스하되, 모바일에서 키보드가 화면을 덮는 걸 피해 선택만 한다.
    if (input) { try { input.focus(); input.select(); } catch (e) { _swallow(e); } }
    else { try { ok.focus(); } catch (e) { _swallow(e); } }
  });
  const p = _uiDlgQueue.then(run, run);
  _uiDlgQueue = p.then(() => {}, () => {});
  return p;
}

function uiAlert(msg) { return _uiDialog({ kind: 'alert', msg }); }
function uiConfirm(msg, opts) {
  return _uiDialog(Object.assign({ kind: 'confirm', msg }, opts || {}));
}
function uiPrompt(msg, def, opts) {
  return _uiDialog(Object.assign({ kind: 'prompt', msg, def }, opts || {}));
}

// 바깥 사이트를 여는 유일한 통로.
//
// window.open('...','_blank') 은 기기마다 결과가 갈린다. 홈 화면에 설치한
// PWA(standalone)에서는 새 탭이 아니라 앱 창 자체를 그 주소로 덮어써서
// 시뮬레이터가 통째로 사라지고 돌아올 길이 없어진다(차트에서 겪은 그 증상이다).
// 사용자가 누른 <a target="_blank"> 는 어느 기기에서도 바깥 브라우저로 나간다.
// 그래서 앵커를 만들어 즉시 클릭한다 — 사용자 제스처 안에서 불러야 한다.
function uiOpenExternal(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { try { a.remove(); } catch (e) { _swallow(e); } }, 0);
}

// 손가락으로 쓰는 기기인가. 데스크톱 크롬의 기기 시뮬레이션까지 맞힐 필요는 없고,
// "모바일 안내를 보여 줄 만한가"만 가리면 된다.
function uiIsMobile() {
  const ua = navigator.userAgent || '';
  return /Android|iP(ad|hone|od)|Mobile/.test(ua) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
}

let _uiToastWrap = null;
function uiToast(msg, kind, ms) {
  try {
    if (!_uiToastWrap || !_uiToastWrap.isConnected) {
      _uiToastWrap = document.createElement('div');
      _uiToastWrap.className = 'ui-toast-wrap';
      document.body.appendChild(_uiToastWrap);
    }
    const t = document.createElement('div');
    t.className = 'ui-toast' + (kind ? ' ' + kind : '');
    t.textContent = String(msg == null ? '' : msg);
    _uiToastWrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => {
      t.classList.remove('on');
      setTimeout(() => { try { t.remove(); } catch (e) { _swallow(e); } }, 250);
    }, ms || 2600);
  } catch (e) { _swallow(e); }
}
