# vendor — 외부 라이브러리 사본

종전에는 이 파일들을 CDN(unpkg · jsDelivr · cdnjs)에서 받아 썼다.
그런데 CDN 이 안 받아지면 앱이 통째로 죽는다. 실제로 네트워크가 없는 환경에서
확인하면 `L is not defined` → `leafMap is not defined` 순으로 무너져 흰 화면이 된다.

서비스워커가 CDN 응답을 캐시하긴 했지만 **한 번은 성공적으로 받아야** 한다.
새 기기·새 브라우저·캐시 정리 직후에 음영지역이면 그대로 먹통이다.
비행 중에 쓰는 도구에 맞지 않는 위험이라 저장소에 직접 넣는다.

| 파일 | 버전 | 용도 |
|---|---|---|
| leaflet.js · leaflet.css · images/ | 1.9.4 | 2D 지도 |
| leaflet-velocity.min.js · .css | 2.1.0 | 바람 입자 레이어 |
| maplibre-gl.js · .css | 4.7.1 | 3D 지형 |
| jszip.min.js | 3.10.1 | AIRAC ZIP 가져오기 |
| pdf.min.js · pdf.worker.min.js | 3.11.174 | 차트 PDF 뷰어 |

각 라이선스는 `licenses/` 에 원본 그대로 두었다(전부 BSD-2/MIT/Apache-2.0 계열).

## 갱신 방법

버전을 올릴 때는 npm 배포본에서 그대로 꺼내 온다. 손으로 고치지 않는다.

    npm pack leaflet@<버전>
    tar xf leaflet-<버전>.tgz
    cp package/dist/leaflet.js package/dist/leaflet.css vendor/

바꾼 뒤에는 `sw.js` 의 CACHE 버전을 올려야 사용자 기기에 반영된다.
