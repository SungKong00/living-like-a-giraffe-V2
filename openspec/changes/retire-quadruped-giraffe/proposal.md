# Proposal

## Why

네발 점토 기린(`riragi`)은 앞으로 쓰지 않는다. 기본 모델은 두발 점토 기린(`riragi-biped`) 하나로 충분하고, 네발 기린을 위한 코드 분기·검사·문서·모델 파일(GLB 두 개와 Blender 원본, 약 10MB)이 남아 있으면 캐릭터 작업마다 두 골격을 함께 맞춰야 한다.

현재 공개 사이트의 공개본은 네발 기린을 쓰지 않는다(2026-11-28에 공개 API로 확인. 캐릭터 하나가 올린 모델을 쓴다). 운영 스튜디오의 자료실과 초안은 확인하지 않았다.

## What Changes

- **BREAKING** 기본 모델에서 네발 기린을 뺀다. 자료실 목록, 추가 메뉴, 모델 선택에 더는 나오지 않는다.
- **BREAKING** 모델을 정하지 않았거나 `riragi`를 가리키는 캐릭터는 읽을 때 두발 기린으로 옮긴다. 자리·방향·크기는 유지하고, 네발 기린 전용 동작(`riragi/LookAround`)과 착용물(케이프·꽃)은 뺀다. 월드 기본 동작이 그 동작이면 함께 뺀다.
- 자료실의 기본 모델 처리에서 `riragi` 전용 분기(`BUILTIN`, `library.builtin`)를 없애고 두발 기린이 쓰는 방식(`library.builtins[id]`) 하나로 맞춘다.
- 네발 기린 모델 파일과 Blender 원본을 저장소에서 지운다: `riragi-giraffe.glb`, `riragi-giraffe-base.glb`, `riragi-giraffe.blend`.
- 네발 골격만을 위한 체형 규칙과 검사를 지우고, 네발 기린 파일로 확인하던 검사(착용물, 축소 단계, 체형)는 두발 기린이나 검사 안에서 만든 모델로 옮긴다.
- `docs/world/README.md`의 **점토 기린** 항목과 캐릭터 설명을 두발 기린 기준으로 고친다.

## Capabilities

### New Capabilities

- `default-character-model`: 기본으로 들어 있는 모델과, 없어진 기본 모델을 가리키는 캐릭터를 읽는 방법.

### Modified Capabilities

없음. `studio-characters`는 진행 중 변경 `author-clay-and-giraffes`에만 있어 기본 명세가 없다. 그 명세의 "리라지 점토 기린" 시나리오는 이 변경의 작업에서 두발 기린으로 고친다.

## Impact

- 자료실(`shared/character-library.mjs`, `server/characters.mjs`, `cloud/characters.mjs`)과 초안 읽기(`server/layout.mjs`).
- 체형(`web/giraffe-proportions.js`, `shared/giraffe-proportions.mjs`)과 점토 얼굴 보호의 기린 규칙.
- 검사: `tests/clay-character.test.mjs`, `tests/clay-characters.test.mjs`, `tests/cloud-publication.test.mjs`, `tests/character-lods.test.mjs`.
- 자산: `assets-source/characters/riragi-clay/`.
- 운영: 푸시하면 배포본에서 네발 기린 파일이 빠진다. 운영 자료실에 네발 기린의 이름·키를 바꾼 기록(`builtin`)이 있으면 쓰이지 않는 값으로 남는다.
