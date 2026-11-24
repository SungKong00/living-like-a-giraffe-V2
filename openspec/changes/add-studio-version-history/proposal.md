# Proposal

## Why

자동 저장된 초안은 다시 열 수 있지만 브라우저의 실행 취소 이력은 다시 열 때 사라진다. 배치 실험이나 Blender 원본 교체 전 장면을 다음 날에도 확인하고 복구할 수 있어야 한다.

## What Changes

- 하루 첫 편집, Blender 파일 적용, 버전 복원 직전의 초안을 자동으로 보관한다.
- 편집자는 현재 초안에 이름을 붙여 보관하고, 기록에서 장면을 미리 본 뒤 초안으로 복원한다.

## Capabilities

### New Capabilities

- `studio-version-history` — 원본 모델과 웹 초안의 보관, 조회 및 복원.

### Modified Capabilities

없음.

## Impact

스튜디오 상단 도구, 관리자 API와 로컬·클라우드 저장소의 개정 보존 규칙에 적용한다.
