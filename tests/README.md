# 회귀 테스트

수동으로 화면을 보며 찾아내던 버그(조용히 죽은 버튼, 좌표 파싱 오류, 홀딩 진입
오판 등)를 자동으로 잡기 위한 스위트입니다. 실제 브라우저에서 `index.html` 을
띄우고 앱의 내부 함수를 그대로 호출해 검증합니다.

## 준비

```bash
npm i -D playwright leaflet@1.9.4
npx playwright install chromium
```

이미 설치된 크로미움을 쓰려면:

```bash
CHROMIUM_PATH=/path/to/chrome node tests/run.mjs
```

## 실행

```bash
node tests/run.mjs                # 전체
node tests/run.mjs 홀딩 NAV       # 이름으로 일부만
VERBOSE=1 node tests/run.mjs      # 통과 항목까지 출력
```

실패가 있으면 종료코드 1 을 돌려줍니다(CI 연결용).

## 스위트

| 파일 | 내용 |
|---|---|
| `cases/smoke.mjs` | 로드 오류, 핵심 전역, **죽은 버튼 검출**(인라인 onclick·data-act), CDU 11개 화면 렌더, Back 동작 |
| `cases/coords.mjs` | 차트 PDF 좌표 토큰 파싱 12종, 오인식 좌표 정제 |
| `cases/chartcal.mjs` | 위치보정 변환 모델(반전 포함), 3점 정확도, 품질 게이트·이상점 지목 |
| `cases/hold.mjs` | 진입 구역 좌우 대칭(5,760건), 진입 3종 비행, 트랙 추종 이탈, NAV 유지 |
| `cases/nav.mjs` | 코스 추종(FMS·OBS), 측풍 편류수정각 |

## 새 케이스 추가

`cases/` 에 `export const name` 과 `export async function run(page, t)` 를 가진
모듈을 만들고 `run.mjs` 의 `SUITES` 에 추가하면 됩니다. `t.ok(cond, msg)` 와
`t.eq(a, b, msg)` 만 쓰면 되고, `page.errors` 로 페이지 오류를 확인할 수 있습니다.
