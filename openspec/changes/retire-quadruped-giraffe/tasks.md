# Tasks

다른 작업이 `tests/clay-character.test.mjs`, `tests/clay-characters.test.mjs`, `web/giraffe-proportions.js`, `assets-source/characters/riragi-clay/riragi-biped.glb`의 커밋 안 된 변경을 커밋한 뒤에 시작한다(2026-11-28 결정).

## 1. 읽을 때 옮기기

- [ ] 1.1 초안을 읽을 때 모델이 없거나 `riragi`인 캐릭터를 `riragi-biped`로 옮기고, `riragi/`로 시작하는 동작과 네발 기린의 착용물을 빼게 한다. 월드 기본 동작도 같이 본다. `npm test`에 옮기기 전후를 비교하는 검사를 더한다.
- [ ] 1.2 이미 공개된 공개본의 파일 목록(`characters/published/<ID>.json`)이 `riragi`를 가리키면 어떻게 읽히는지 확인하고, 그 공개본이 깨지지 않게 한다.

## 2. 기본 모델 정리

- [ ] 2.1 `shared/character-library.mjs`에서 `BUILTIN`과 `library.builtin` 분기를 없애고 기본 모델을 `library.builtins[id]` 하나로 다룬다. `server/characters.mjs`의 묶음 목록에서 네발 기린을 뺀다. `cloud/characters.mjs`가 같은 목록을 쓰는지 확인한다.
- [ ] 2.2 네발 골격만을 위한 체형 규칙을 `web/giraffe-proportions.js`와 `shared/giraffe-proportions.mjs`에서 지운다. 두발 기린의 체형 검사가 그대로 통과하는지 확인한다.

## 3. 검사와 자산

- [ ] 3.1 네발 기린 파일을 읽는 검사를 두발 기린이나 검사 안에서 만든 모델로 옮긴다. 착용물 규약과 `lodCovers` 규약은 검사 안에서 만든 모델로 계속 확인한다.
- [ ] 3.2 `riragi-giraffe.glb`, `riragi-giraffe-base.glb`, `riragi-giraffe.blend`를 지운다. `git grep riragi-giraffe`가 이 변경안 밖에서 아무것도 찾지 못하는지 확인한다.
- [ ] 3.3 `npm test`, `npm run build`, `npm run test:browser`를 통과시킨다.

## 4. 문서

- [ ] 4.1 `docs/world/README.md`의 **점토 기린**과 캐릭터 항목, `author-clay-and-giraffes` 명세의 네발 기린 시나리오를 두발 기린 기준으로 고치고 `openspec validate`를 통과시킨다.

## Workflow follow-up

- 푸시와 배포는 사용자가 한다.
- 운영 스튜디오의 자료실과 초안에 네발 기린이 남아 있는지는 사용자가 확인한다.
