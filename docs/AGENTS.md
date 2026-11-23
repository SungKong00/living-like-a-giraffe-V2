# 문서 작업 지침

## 행사 기록

`events/`의 행사 정보를 수정할 때는 출처와 기존 근거 ID를 유지한다. 확인한 사실, 화면 관찰, 전시 해석, 미확인 정보의 구분을 유지하고, 게시물 간 상충은 양쪽 근거와 함께 남긴다.

## ADR

- `adr/`의 결정은 `adrs list` 또는 `adrs search <검색어>`로 먼저 확인한다. `adrs new "<제목>"`이 [MADR 템플릿](adr/template.md)을 적용한다. YAML 필드명과 구조 제목을 유지하고 설명은 한국어로 쓴다.
- 날짜는 Asia/Seoul 기준 `YYYY-MM-DD`로 확인한다. 결정 상태와 대체 관계는 `adrs status`와 `adrs new --supersedes`로 관리한다.
- ADR에는 선택 이유와 장기 제약을 기록한다. 관련 제안은 OpenSpec에 두고 두 문서에서 서로 참조한다.
