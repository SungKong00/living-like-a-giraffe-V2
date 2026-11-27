# Proposal

## Why

캐릭터가 수십 마리로 늘고 동작과 옷의 종류도 늘어난다. 지금은 캐릭터마다 메시와 골격을 복제하고, 화면 밖 캐릭터의 자세도 매 프레임 계산하며, 전체 보기에서도 삼각형 15,000개짜리 원본을 그린다. 두발 기린 50마리는 드로우 300회로 월드 전체(21회)의 14배다. 관람 화면은 이 비용을 피하려고 전체 보기에서 터치 기기 8마리·그 밖 24마리만 움직이게 막고 있어, 마릿수가 늘수록 멈춰 선 캐릭터가 많아진다.

관람 카메라를 이동과 확대만 하도록 바꾸기로 했다. 직교 투영에 방향이 고정되면 모든 캐릭터의 화면 크기가 확대 배율 하나로 정해지므로, 얼마나 자세히 그릴지를 장면 전체에서 한 번에 고를 수 있다.

## What Changes

- **BREAKING** 관람 카메라가 방향을 바꾸지 않는다. 끌면 화면이 이동하고, 휠·핀치·버튼으로 확대·축소한다. 좌우 ±30°와 상하 회전은 없앤다.
- **BREAKING** 관람 장면의 움직임 제한(방을 고르면 그 방만, 전체 보기에서 터치 기기 8개·그 밖 24개)을 없앤다. 화면에 보이는 캐릭터는 모두 매 프레임 움직이고, 화면 밖 캐릭터는 자세를 계산하지 않는다. 경로를 걷는 캐릭터는 화면 밖에서도 경로를 따라 나아간다.
- 모델 파일에 **축소 단계**(삼각형과 재질을 줄인 같은 골격의 메시, 최대 2단계)를 넣을 수 있다. 자료실이 올린 파일에서 축소 단계를 읽어 기록하고, 관람 장면은 캐릭터가 화면에 보이는 크기에 맞는 단계를 그린다. 기본 두발·네발 기린에 축소 단계를 넣는다.
- 성능 목표를 **대표 중급 휴대폰에서 캐릭터 50마리, 초당 30프레임**으로 정하고, 50마리 기준 장면과 측정 방법을 저장소에 둔다. 자동 검사는 같은 장면의 드로우 횟수와 삼각형 수 상한으로 회귀를 막는다.
- 캐릭터 코드를 [ADR 0006](../../../docs/adr/0006-캐릭터의-상태-포즈-표현-성능-정책을-나누어-소유한다.md)의 책임(자산·상태·포즈·표현·정책)으로 나눈다. 이 단계는 동작을 바꾸지 않는다.
- 진행 중 변경 `preserve-world-layout`의 "제한된 사선 관람"에서 방위각·고도 범위와 회전 한계 시나리오를 지운다. `show-characters-to-visitors`의 "관람 장면의 움직임 제한"과 `walk-character-routes`의 "움직임 제한에서 멈추는 캐릭터" 문장은 이 변경의 요구사항으로 대체한다.

## Capabilities

### New Capabilities

- `visitor-camera`: 관람 화면 카메라의 고정 방향, 이동과 확대·축소, 이동 범위.
- `character-performance`: 화면에 보이는 캐릭터만 움직이는 규칙, 화면 크기에 맞는 축소 단계, 모델의 축소 단계 등록, 성능 예산과 검증.

### Modified Capabilities

없음. `world-layout`·`visitor-characters`·`character-routes`는 진행 중 변경에만 있어 기본 명세가 없다. 충돌하는 문장은 위 마지막 항목대로 그 변경의 명세에서 고친다.

## Impact

- 관람 장면(`web/scene.js`): 카메라 입력, 이동 범위, 장면을 계속 그릴지 정하는 등록.
- 캐릭터 레이어(`web/studio-characters.js`, `web/visitor-characters.js`, `web/giraffe-proportions.js`): `web/characters/` 아래 책임별 모듈로 옮긴다. `web/studio.js`·`web/studio-versions.js`가 쓰는 `characterLayer()`의 모양은 유지한다.
- 자료실(`shared/character-library.mjs`, `server/characters.mjs`, `cloud/characters.mjs`)과 공개 파일 목록(`shared/character-sheet.mjs`): 모델 항목에 축소 단계 기록을 더한다. 축소 단계가 없는 기존 모델과 공개본은 그대로 읽는다.
- 자산: `assets-source/characters/riragi-clay/`의 기린 모델과 내보내기 스크립트(`scripts/export-clay-biped.py`).
- 검사: `tests/browser.mjs`의 관람 카메라·캐릭터 움직임 검사, 새 기준 장면.
- 문서: `docs/world/README.md`의 화면·캐릭터·캐릭터 모델 만들기 항목, `web/AGENTS.md`의 스튜디오 규칙.
- 초안·공개본 레이아웃 형식과 Blender 굽기는 바꾸지 않는다.
