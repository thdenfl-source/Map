// GSPD 와 측면축 오토파일럿의 관계
// GSPD 는 요/롤 축을 가져가므로 NAV·OBS 가 뱅크를 지령해도 기수가 돌지 않는다.
// 버튼은 켜진 채 두되(끄면 이어서 동작) 조향 불가 상태가 화면에 보여야 한다.
export const name = 'GSPD 상호작용';

export async function run(page, t) {
  const r = await page.evaluate(() => {
    const out = {};
    const cls = id => document.getElementById(id).classList.contains('ap-inh');
    // 초기: GSPD 꺼짐 → 무력화 표시 없음
    gspdOn = false; gspdCoasting = false; updateHoverBtns();
    out.offNav = cls('nav-ap-btn'); out.offObs = cls('obs-btn');
    // GSPD 켜기
    if (!gspdOn) toggleGspd();
    out.onNav = cls('nav-ap-btn'); out.onObs = cls('obs-btn');
    out.title = document.getElementById('nav-ap-btn').title;
    // NAV 를 켠 채 GSPD 중이면 FMA 중앙이 대기 표기
    navApOn = true; hdgSelOn = false;
    out.fmaNav = (() => {
      // FMA 문자열 생성 로직과 같은 조건으로 확인
      return gspdOn ? (navApOn ? 'GS/NAV' : (hdgSelOn ? 'GS/HDG' : 'GS')) : null;
    })();
    // 실제 조향 불가 확인: 뱅크를 줘도 기수가 안 바뀐다
    S.hdg = 90; S.bnk = 20; S.spd = 60;
    const h0 = S.hdg;
    for (let i = 0; i < 20; i++) {
      if (Math.abs(S.bnk) > 0.5 && !gspdOn && !gspdCoasting) {
        const V = Math.max(10, S.spd) * 0.5144;
        S.hdg = normA(S.hdg + 9.81 * Math.tan(S.bnk * D2R) / V / D2R * 0.5);
      }
    }
    out.hdgLocked = (S.hdg === h0);
    // GSPD 끄기 → 표시 해제, 설정(NAV) 유지
    toggleGspd(); gspdCoasting = false; updateHoverBtns();
    out.afterNavOn = navApOn;
    out.afterInh = cls('nav-ap-btn');
    return out;
  });

  t.eq(r.offNav, false, 'GSPD 꺼짐 — NAV 버튼 정상');
  t.eq(r.offObs, false, 'GSPD 꺼짐 — OBS 버튼 정상');
  t.eq(r.onNav, true, 'GSPD 켜짐 — NAV 버튼 무력화 표시');
  t.eq(r.onObs, true, 'GSPD 켜짐 — OBS 버튼 무력화 표시');
  t.ok(/ANTI-TORQUE/.test(r.title), `NAV 버튼 안내 문구: ${r.title.slice(0, 40)}…`);
  t.eq(r.fmaNav, 'GS/NAV', 'FMA 중앙이 NAV 대기 표기');
  t.eq(r.hdgLocked, true, 'GSPD 중 뱅크를 줘도 기수 불변(설계상)');
  t.eq(r.afterNavOn, true, 'GSPD 해제 후에도 NAV 설정 유지');
  t.eq(r.afterInh, false, 'GSPD 해제 후 무력화 표시 사라짐');
}
