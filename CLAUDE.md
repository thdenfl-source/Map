# Flightsimulator — Claude 작업 지침

## 항상 따를 규칙

### 작업 단위 완료 시 Push + PR 생성
**하나의 작업 단위(기능/수정 요청)가 끝났을 때** 아래 순서를 실행한다:

1. 변경 파일을 `git add` → `git commit` (의미 있는 단위로 커밋)
2. `git push -u origin claude/keen-darwin-9c4ek`
3. GitHub MCP(`mcp__github__create_pull_request`)로 PR 생성
   - owner: `thdenfl-source`
   - repo: `Flightsimulator`
   - head: `claude/keen-darwin-9c4ek`
   - base: `main`
4. **PR 머지는 사용자가 직접 GitHub에서 수행한다. Claude는 절대 머지하지 않는다.**
   - 사용자가 GitHub에서 머지 → Actions 정상 트리거 → GitHub Pages 배포
   - Claude가 API로 머지하면 Actions가 트리거되지 않아 사이트에 미반영됨

#### PR 분할 기준 (남발 방지)
- **한 작업 요청 = 1 PR** 을 원칙으로 한다. 같은 요청에 대한 후속 미세 수정
  (오타·색상·굵기 조정 등)은 **새 PR을 만들지 말고 같은 브랜치에 커밋을 추가**한다.
- 직전 PR이 아직 머지되지 않았다면, 이어지는 수정은 그 PR에 커밋을 쌓는다.
- 서로 무관한 별개 기능일 때만 새 PR로 분리한다.

#### 후속 커밋 주의 (반영 누락 방지)
- 새 커밋을 푸시하기 전, **직전 PR이 이미 머지·종료됐는지 먼저 확인**한다.
  머지됐으면 **반드시 새 PR을 만든다.** (브랜치에만 쌓으면 main에 안 들어감)
