# 공용 포인트(GPX/KML) — 저장소에서 불러오기

이 폴더에 GPX/KML 포인트 파일을 넣고 `index.json` 에 목록을 등록하면,
웹앱의 **CDU → Track & Point → POINT → ☁ 저장소에서 불러오기** 에서
바로 가져올 수 있습니다. (같은 출처라 CORS 문제 없음)

## 사용 방법

1. 이 `points/` 폴더에 GPX(또는 KML) 파일을 커밋합니다. 예: `points/rksi_helipads.gpx`
2. `points/index.json` 에 목록을 추가합니다:

```json
[
  { "file": "rksi_helipads.gpx", "name": "인천 헬리패드", "folder": "인천", "icon": "🚁" },
  { "file": "coast_guard.kml",   "name": "해경 거점",     "folder": "거점",  "icon": "⚓" }
]
```

### 필드 설명
| 필드 | 필수 | 설명 |
|---|---|---|
| `file` | ✅ | `points/` 안의 파일명 |
| `name` | 선택 | 앱 목록에 보일 이름(없으면 파일명) |
| `folder` | 선택 | 가져올 대상 폴더명(없으면 name/파일명으로 폴더 생성) |
| `icon` | 선택 | 폴더 아이콘(이모지). 예: `📍 🔴 🔺 ⭐ 🚩 ⚓ 🚁 🏥` |

## 지원 형식
- **GPX**: `<wpt lat lon><name>…</name></wpt>`
- **KML**: `<Placemark><name>…</name><Point><coordinates>lon,lat</coordinates></Point></Placemark>`

파일을 추가/수정한 뒤에는 앱을 새로고침(⟳)하면 최신 목록이 반영됩니다.
