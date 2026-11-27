# 웹 작업 지침

- 화면은 `./ds/index.js`에서 가져온 컴포넌트로 만든다. `ds/` 내부 파일을 직접 가져오지 않는다. 사용법과 확장 절차는 [디자인 시스템](../docs/design-system/README.md)을 따른다.
- 버튼·입력·선택·팝오버·알림을 `el()`로 직접 만들지 않는다. 맞는 컴포넌트가 없으면 `ds/`에 컴포넌트·variant를 더하고 문서 표를 갱신한 뒤 쓴다.
- 색·간격·글자·그림자는 `ds/tokens.css`의 역할 토큰으로만 지정한다. 직접 값이 필요하면 토큰을 먼저 만든다.
- `views/*.css`는 `@layer views` 안에서 화면 요소를 배치만 한다. `.ui-*` 컴포넌트의 모양을 바꾸지 않고 `!important`를 쓰지 않는다.
- 컴포넌트 옵션을 바꾸거나 접근성 이름(버튼 이름·라벨)을 바꾸면 `tests/browser.mjs`의 선택자도 함께 고친다.

## 스튜디오

- 편집할 새 종류(예: 캐릭터)는 `studio-entities.js`의 `entityTypes`에 찾기·이름·아이콘·상위 범위를 선언하고, `studio-inspectors.js`의 `inspectors`에 속성 패널 함수를 더한다. 목록 배치는 `studio-outline.js`, 추가 동작은 같은 파일의 `addMenu` 구역에 더한다. 상단 막대나 목록에 종류별 버튼을 따로 만들지 않는다.
- 모든 개체에 적용되는 기본값(점토, 캐릭터 동작, 이후 배경)은 초안의 `defaults`에 두고 월드 패널의 `worldSections`에 구역으로 더한다. Blender와 왕복하는 가구의 덮어쓰기는 가구 객체가 아니라 `overrides.<종류>[개체 ID]`에 둔다. 개체 편집기는 덮어쓸 때 `PropertyRow`의 `override`로 표시하고 되돌리기를 제공한다.
- 편집 장면에 그리는 스튜디오 전용 요소(점토 변형, 캐릭터)는 `studio.js`의 `refreshScene()`에서 갱신한다. 계속 움직이는 요소는 `world.keepDrawing()`으로 그리기를 유지한다.
- 패널 모듈은 `editor`의 읽기 값과 명령만 쓴다. 초안을 직접 고치거나 `studio.js`의 내부 상태를 가져오지 않는다.

## 캐릭터

- 장면의 캐릭터 코드는 `characters/`에 있고 책임은 [ADR 0006](../docs/adr/0006-캐릭터의-상태-포즈-표현-성능-정책을-나누어-소유한다.md)대로 나뉜다. `assets.js`는 자료실 파일, `cast.js`는 캐릭터마다의 자리·시계·동작, `pose.js`는 관절 값, `view.js`는 그리기, `policy.js`는 무엇을 움직일지를 맡는다.
- `characters/` 밖에서는 `characters/index.js`만 가져온다. `tests/character-modules.test.mjs`가 이를 검사한다.
- 몇 마리까지 움직일지 같은 성능 수치와 판단은 `characters/policy.js`에만 둔다. 다른 파일에서 기기나 마릿수로 분기하지 않고 `characterLayer()`의 `policy`로 넘긴다.
