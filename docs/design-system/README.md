# 디자인 시스템

관람 화면(`/`, `/events`)과 PC 스튜디오(`/studio`)의 모든 화면 요소는 이 디자인 시스템으로 만든다. 새 화면을 만들거나 기존 화면을 고칠 때는 여기 있는 토큰과 컴포넌트를 먼저 쓰고, 없으면 이 문서의 [확장 절차](#확장-절차)대로 시스템에 더한 뒤 쓴다. 이렇게 정한 이유는 [ADR 0003](../adr/0003-웹-화면을-토큰과-검증되는-컴포넌트로-구성한다.md)에 있다.

## 방향

따뜻한 회백색 바탕 위에 3D 공간이 주인공이 되도록 화면 요소는 조용하게 둔다. 주요 동작은 거의 검은 잉크색 하나로, 선택·완료는 초록, 행사 표시·검토 가능은 라임으로 구분한다. 한글 가독성을 위해 Pretendard Variable을 쓰고 제목은 자간을 좁힌다.

레퍼런스는 Mobbin에서 모았다. 편집기는 Framer·Krea·Magnific의 떠 있는 도구 막대와 촘촘한 속성 패널, 지도 위 카드는 Tripadvisor, 행사 아카이브는 Notion의 지난 행사 목록, 발행 창은 Base44·Wix의 발행 팝오버를 참고했다.

## 구조

| 위치                    | 내용                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `web/ds/tokens.css`     | 원시 값(`--gray-*` 등)과 역할 토큰(`--color-*`, `--space-*`, `--radius-*` …) |
| `web/ds/base.css`       | 초기화와 요소 기본값, `.sr-only`                                             |
| `web/ds/components.css` | `ui-*` 컴포넌트 스타일                                                       |
| `web/ds/*.js`           | 컴포넌트 팩토리. `index.js`가 공개 API다                                     |
| `web/views/site.css`    | 관람 화면 배치                                                               |
| `web/views/studio.css`  | 스튜디오 배치. 스튜디오 청크에만 실린다                                      |
| `web/style.css`         | CSS 층 순서와 진입점                                                         |
| `web/public/brand/`     | `Brand`와 파비콘·홈 화면 아이콘에 쓰는 기린 로고 이미지                      |

CSS 층 순서는 `reset → tokens → base → components → views`다. 뒤 층이 선택자 우선순위와 상관없이 이기므로 `!important`를 쓰지 않는다.

## 토큰

화면과 컴포넌트는 역할 토큰만 쓴다. 원시 값(`--gray-500`, `#fff` 같은 직접 값)은 `tokens.css` 밖에서 쓰지 않는다.

| 분류      | 토큰                                                                                                                                   | 용도                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 바탕      | `--color-bg`, `--color-surface`, `--color-surface-muted`, `--color-surface-sunken`, `--color-surface-glass`, `--color-surface-inverse` | 페이지, 카드·패널, 입력 바탕, 눌린 영역, 3D 위 반투명 막대, 어두운 도구 막대 |
| 글자      | `--color-text`, `-secondary`, `-tertiary`, `-inverse`                                                                                  | 본문, 설명, 보조 정보, 어두운 바탕 위                                        |
| 선        | `--color-border`, `-subtle`, `-strong`                                                                                                 | 입력 테두리, 패널 구분선, 강조 테두리                                        |
| 의미      | `--color-accent(-soft)`, `--color-highlight`, `--color-success/warning/danger(-soft)`                                                  | 선택·완료, 행사 표시·검토 가능, 상태                                         |
| 글자 크기 | `--text-display`, `-h1`, `-h2`, `-h3`, `-title`, `-lead`, `-body`, `-prose`, `-ui`, `-ui-strong`, `-caption`, `-label`, `-mono`        | `font:` 축약값 하나로 크기·굵기·줄 간격을 함께 지정한다                      |
| 간격      | `--space-0-5`(2px) ~ `--space-20`(80px), `--gutter`                                                                                    | 4px 격자                                                                     |
| 크기      | `--control-xs`~`-xl`(24~48px), `--icon-xs`~`-lg`                                                                                       | 컨트롤 높이와 아이콘                                                         |
| 모서리    | `--radius-xs`(4) ~ `--radius-2xl`(22), `--radius-full`                                                                                 |                                                                              |
| 그림자    | `--shadow-xs`~`-xl`, `--ring-border`, `--ring-focus`                                                                                   | 떠 있는 정도. 포커스는 항상 `--ring-focus`                                   |
| 움직임    | `--ease-out`, `--duration-fast/base/slow`                                                                                              | 동작 줄이기 설정에서 0이 된다                                                |

## 컴포넌트

모든 컴포넌트는 `import { … } from './ds/index.js'`로 가져오고, 옵션 객체 하나를 받아 DOM 요소(또는 고정된 제어 객체)를 돌려준다.

| 컴포넌트                                                                                      | 쓰는 곳                                                                                                                                               | 주요 옵션                                                                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Button`                                                                                      | 이름이 보이는 모든 동작. `href`를 주면 링크                                                                                                           | `label`, `variant`(primary·secondary·ghost·danger·inverse·link), `size`(sm·md·lg), `icon`, `iconEnd`, `shortcut`, `wide` |
| `IconButton`                                                                                  | 아이콘만 보이는 동작                                                                                                                                  | `icon`, `label`(필수, 접근성 이름·툴팁)                                                                                  |
| `ButtonGroup`                                                                                 | 관련 버튼 묶음                                                                                                                                        | `label`, `attached`                                                                                                      |
| `TextInput`, `TextArea`                                                                       | 글 입력. 나갈 때 저장, Enter·Esc 처리, 검증 오류 표시                                                                                                 | `label`, `value`, `validate`, `onCommit`, `appearance: 'title'`(제목처럼 보이는 입력)                                    |
| `NumberInput`, `Slider`                                                                       | 숫자. 슬라이더는 끄는 동안 `onInput`, 놓을 때 `onCommit`. 숫자 칸은 범위 밖 값을 맞추고 빈 값을 되돌리며 알림으로 알린다                                  | `prefix`(X·Y·Z), `min`, `max`, `step`, `format`                                                                          |
| `Select`, `Segmented`, `SwatchPicker`, `Toggle`, `RadioCards`                                 | 선택. 5개 이하 짧은 선택은 `Segmented`, 많으면 `Select`, 설명이 필요한 둘 중 하나는 `RadioCards`                                                      | `options: [{ value, label }]`, 작은 선택은 `Segmented.size: 'sm'`, 패널 재구성 뒤 스위치 포커스 유지는 `Toggle.key`      |
| `Field`                                                                                       | 보이는 라벨이 필요한 글 입력(로그인 등)                                                                                                               | `label`, `control`                                                                                                       |
| `FileButton`                                                                                  | 파일 하나를 골라 올리는 버튼. 숨긴 파일 입력을 열고 고른 뒤 비운다                                                                                    | `label`, `accept`(필수), `onFile`, `variant`, `size`                                                                     |
| `FileDrop` | 파일 하나를 끌어놓거나 선택하는 영역 | `label`, `description`, `accept`, `onFile`, `onError`, `disabled` |
| `FileList`                                                                                    | 자료실에 올린 파일 목록. 행마다 아이콘·이름·설명 한 줄, 지울 수 있으면 삭제 버튼. `onSelect`가 있으면 행이 눌림 버튼이 되어 고른 파일의 설정을 엽니다 | `label`, `items: [{ name, icon, detail, removeLabel, onRemove, onSelect, selected }]`, `empty`                           |
| `Tabs`, `NavLinks`, `TreeItem`                                                                | 탐색                                                                                                                                                  |                                                                                                                          |
| `Breadcrumbs`                                                                                 | 선택 대상이 속한 범위(월드 › 방 › 가구). 마지막 항목이 현재 대상이고, 앞 항목은 그 범위를 연다                                                        | `label`, `items: [{ label, icon, onSelect }]`                                                                            |
| `SceneCaption`                                                                               | 3D 장면 위에서 제목과 설명을 흰 글씨와 검은 반투명 바탕으로 함께 표시                                                                                | `title`, `description`, `eyebrow`, `icon`                                                                                |
| `ObjectPreview`                                                                              | 선택 모델의 단독 보기. 드래그·방향키로 시점을 회전                                                                                                                       | `label`, `onOrbit(yaw, pitch)`(라디안 증분)                                                                                                                  |
| `PanelHeader`, `PanelSection`, `PropertyRow`, `Disclosure`                                    | 속성 패널은 항상 이 순서로 구성                                                                                                                       | `PropertyRow`의 `override: { from, onReset, subject }` — 넓은 범위에서 이어받은 값을 덮어쓴 행                           |
| `Toolbar`, `ToolbarDivider`                                                                   | `floating`(3D 위), `inverse`(선택 도구), `bar`                                                                                                        |                                                                                                                          |
| `Popover`, `Menu`, `Dialog`                                                                   | 떠 있는 창. 제어 객체(`open`, `close`, `toggle`, `refresh`)를 돌려준다                                                                                | `Menu`는 목록 하나면 `items`, 여러 종류를 추가하면 `sections: [{ heading, items }]`. 항목은 `hint`, `disabled`를 받는다  |
| `Badge`, `StatusText`, `Callout`, `Steps`, `EmptyState`, `Spinner`, `Kbd`, `ColorDot`, `Chip` | 상태와 안내                                                                                                                                           | `tone`(neutral·accent·success·warning·danger·highlight)                                                                  |
| `toast(message, { action, tone })`                                                            | 짧은 알림. 화면은 알림 요소를 직접 만들지 않는다                                                                                                      | 화면 아래에 떠 있는 도구 막대가 있으면 그 화면의 `body`에 `--toast-offset`을 주어 알림을 막대 위로 올린다                |
| `Pin`, `Brand`, `Icon`                                                                        | 3D 위 표시(`tone: 'place' \| 'event'`), 로고, 아이콘(기록은 `history`, 이름 붙인 버전은 `bookmark`)                                                                                                  |                                                                                                                          |

## 화면에서 쓰는 규칙

- 클릭할 수 있는 것, 입력하는 것, 상태를 알리는 것은 모두 컴포넌트로 만든다. `el('button')`이나 `el('input')`을 화면에서 직접 만들지 않는다. `el()`은 제목·문단·목록 같은 문서 구조에만 쓴다.
- 화면 CSS는 컴포넌트의 위치·간격·격자 배치만 정한다. `.ui-*` 선택자로 색·크기·모서리를 바꾸지 않는다. 컴포넌트에 `className`을 넘길 수 있지만 `ui-`로 시작하는 이름은 거부된다.
- 화면 전용 클래스는 `블록__요소` 형태로 화면 이름을 앞에 붙인다(`place-card__title`, `studio-outline__list`).
- 역할이 같으면 같은 컴포넌트를 쓴다. 화면의 주 동작은 하나만 `primary`, 파괴적 동작은 `danger`, 3D 위 막대는 `Toolbar floating`이다.
- 아이콘만 있는 버튼은 `IconButton`으로 만들고 `label`에 동작을 적는다. 그 이름이 툴팁과 스크린 리더 이름이 된다.
- 다시 그려지는 패널의 입력에는 `key`를 준다. `renderKeepingFocus()`가 포커스와 커서를 되돌린다. 다시 그려도 남아야 하는 화면 상태(열린 접힘, 입력 중인 외부 주소)는 DOM이 아니라 화면 상태 변수에 둔다.
- 값을 넓은 범위에서 이어받는 항목(Blender 원본 조명, 모델 원본 재질, 이후 월드 기본값)은 덮어썼을 때 `PropertyRow`에 `override`를 넘긴다. 행 라벨이 강조되고 원래 값으로 되돌리는 버튼이 붙는다. 이어받는 중이면 아무것도 넘기지 않는다. 편집기마다 덮어쓰기 표시를 따로 만들지 않는다.
- 팝오버·메뉴는 `Popover`·`Menu`로 만든다. 바깥 클릭과 Esc는 오버레이 중재자가 처리하므로 화면에서 `document`에 닫기 이벤트를 걸지 않는다.

## 설계 의도

| 패턴                       | 위치                                                   | 이유                                                                                                                                               |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facade                     | `ds/index.js`                                          | 화면은 공개 API에만 의존한다. 내부 파일을 바꿔도 화면이 깨지지 않는다                                                                              |
| Factory + 닫힌 옵션 스키마 | `ds/contract.js`의 `options()`·`is`                    | 오타 옵션, 없는 variant, 이름 없는 아이콘 버튼을 만들 때 `DesignSystemError`를 던진다                                                              |
| Flyweight                  | `ds/icon.js`                                           | 아이콘마다 SVG 원형을 한 번 만들고 복제한다. 등록되지 않은 이름은 거부한다                                                                         |
| Singleton                  | `ds/feedback.js`의 `toast`                             | 페이지에 알림 영역이 하나만 있다                                                                                                                   |
| Mediator                   | `ds/overlay.js`의 `overlays`                           | 열린 팝오버를 쌓아 두고 바깥 클릭·Esc를 한곳에서 닫는다                                                                                            |
| Registry                   | `studio-entities.js`의 `entityTypes`                   | 목록·범위 경로·선택 확인에 쓰는 찾기·이름·아이콘·상위 범위를 개체 종류별로 선언한다. 점토 대상의 `clayScope`는 속성 패널과 3D 장면이 함께 읽는다 |
| Strategy                   | `studio-inspectors.js`의 `inspectors`, `worldSections` | 선택 종류마다 속성 패널 구성 함수를 하나씩 둔다. 월드 설정은 분류마다 구역 함수를 하나씩 둔다. 종류를 더할 때 분기 대신 항목을 더한다              |
| Facade                     | `studio.js`의 `editor`                                 | 목록·속성 패널은 고정된 `editor`로만 초안을 읽고 명령으로 바꾼다. 모든 변경이 편집 기록과 자동 저장을 거친다                                       |
| State                      | `studio-publish.js`의 `states`·`classify()`            | 발행 상태마다 배지·안내·주 동작·단계를 표로 둔다                                                                                                   |

제어 객체는 `Object.freeze`로 고정해 화면이 내부 상태를 바꿀 수 없게 한다.

## 확장 절차

1. **이미 있는지 확인한다.** 위 표에서 역할이 맞는 컴포넌트·variant·tone을 찾는다. 비슷하면 그것을 쓴다.
2. **값이 필요하면 토큰부터.** 새 색·간격은 `tokens.css`에 원시 값과 역할 토큰을 함께 더한다. 역할 이름은 용도로 짓는다(`--color-danger-on-inverse`).
3. **variant·옵션을 더할 때**는 컴포넌트 JS의 스키마(`is.oneOf([...])` 등)와 `components.css`의 `.ui-이름--variant`를 같이 고친다.
4. **새 컴포넌트**는 알맞은 `ds/*.js` 파일에 `options('이름', props, { … })`로 시작하는 팩토리를 만들고, 스타일은 `components.css`의 `@layer components` 안에 `ui-이름` 블록으로 둔다. `ds/index.js`에서 내보낸다. 두 화면 이상에서 쓰거나 같은 역할이 반복될 때 컴포넌트로 만든다. 한 화면에만 있는 배치는 화면 CSS에 둔다.
5. **새 아이콘**은 `ds/icon.js`의 `lucide` 가져오기와 `glyphs` 표에 역할 이름으로 더한다(`delete`, `publish`처럼 모양이 아니라 뜻으로).
6. **이 문서의 표를 갱신한다.**

## 검증

- `npm run build`가 CSS 층과 글꼴을 함께 묶는다.
- `npm run test:browser`는 접근성 이름(`getByRole`, `getByLabel`)과 `ui-*` 클래스로 화면을 조작한다. 버튼 이름이나 라벨을 바꾸면 테스트도 함께 고친다.
- 컴포넌트 계약 위반은 브라우저 콘솔의 `[ds] 컴포넌트: …` 오류로 바로 보인다.
