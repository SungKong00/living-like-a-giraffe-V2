# 화면 및 소스 확인

## 확인 기록

- 기준: 공개 관람 사이트 `https://living-like-a-giraffe.pages.dev/`, Git 원격 `main` `91c4f6608b6278f7313b61d661781a84b3cb79bb`.
- 브라우저: macOS Google Chrome, 1100×736. 페이지 초기화 마크 `riragi-world-ready` 뒤 캔버스 1개, 페이지 예외 0개를 기록했다. 실제 `멘탈 사우나` 버튼을 클릭해 이동 전후를 촬영했다. GIF는 같은 화면의 초기 로딩만 잘랐으며 UI를 재구성하지 않았다.
- 촬영 환경: 익명 브라우저, 같은 출처의 GET/HEAD만 허용, 관리자 경로 제외. 공개 관람과 행사 기록 URL의 HTTP 200을 확인했다. 공개 월드 API의 버전 ID `405dc1de-8341-481d-9bd7-e4afccfd421d`가 촬영 전후에 일치했다. 이 사본에는 신청자 정보·원본 자산·장면 데이터·로그인 정보가 없다.
- 공개 HTML의 진입 파일 `/assets/index-CmOEQQwL.js`와 원격 커밋을 `git archive`로 분리하여 빌드한 같은 파일의 SHA-256이 일치했다: `64c68326eadb922a24891536ad35b62321a844dea04081479c3142d813dfcbe9`. 방문자 번들의 비교이며 Cloudflare Functions/D1 배포 전체의 커밋을 읽어 낸 것은 아니다.
- 격리 복사에서 `npm run build` 성공, `npm test` 51/51 통과. 설치된 의존성도 별도로 복사했다. `test:world`, 스튜디오 발행, 실기기 성능은 새로 실행하지 않았다.
- 프로젝트 원본에 있는 작업 중 변경은 사용하지 않았다. 검증 당시 로컬 커밋은 `c760a47`, 원격은 `91c4f66`이었다. `c760a47`의 평가 문서도 캐릭터가 담긴 초안의 전체 베이크·공개 흐름은 별도 미확인이라고 적는다.

## 콘텐츠 근거

- `91c4f66:README.md`는 월드 자산과 프로젝트 운영 문서부터 안내하는 기존 원격 README다. 이번 검토본은 관람 접근과 결과를 먼저 보인 뒤 제작 경계를 설명하도록 재배치했다.
- `docs/world/README.md`의 ‘편집 원본’, ‘전체 파일 인계’, ‘클라우드 스튜디오’: v06 원본 팩 제작자를 NohSungBeen으로 명기한다. 그 외 재배포 제한, 웹과 Blender의 역할, 비공개 검토와 복원.
- `docs/adr/0002-*`, `docs/adr/0004-*`, `openspec/changes/cloud-studio-helper/`: 원본/관람 데이터 분리, 운영자 컴퓨터에 묶이지 않는 배포, 편집자 컴퓨터로 베이크 위임.
- `functions/api/[[path]].js`, `cloud/state.mjs`, `wrangler.jsonc`, `package.json`: 검토·공개 분기, 버전 검사, Cloudflare D1 바인딩, Babylon.js 빌드 근거.
- 해당 프로젝트 Codex 대화에서는 휴대폰 관람 품질을 우선하고 긴 사전 굽기는 감수하며, 편집 확인을 공개와 분리하자는 제품 판단을 확인했다. README에 비공개 대화 원문이나 내부 파일 경로를 인용하지 않았다.
- 글 구성 참고: [PlayCanvas Engine의 원본 README](https://github.com/playcanvas/engine#readme)는 실제 Examples와 사용 문서의 진입점을 구분한다. 이번 글에도 관람 진입과 개발 근거의 분리를 참고했다. 스크린샷이나 아이콘은 가져오지 않았다.

## 관람 시연 재현

[공개 3D 전시](https://living-like-a-giraffe.pages.dev/)에서 전체 공간이 뜨면 **멘탈 사우나 → 방 안 표식 → 행사 자세히 보기**를 선택한다. 행사 페이지에서 본문까지 스크롤한다.

새 관람 녹화 기록 · 브라우저 촬영 스크립트 · GIF 인코딩

Node 22 이상, Playwright와 Chrome이 있는 환경에서 별도 빈 폴더에 실행한다. 환경 변수 PLAYWRIGHT_ROOT는 Playwright를 설치한 디렉터리다. 촬영 브라우저에서는 전시 사이트의 GET/HEAD만 허용한다.

    PLAYWRIGHT_ROOT=/path/to/node-project node /path/to/source/capture-event.mjs > observed.json
    python3 /path/to/source/render-event.py

촬영마다 첫 로딩 시점이 달라지므로 인코딩 전에 관찰 로그와 원본 화면 프레임을 보고 자르는 위치를 맞춘다. 카메라 이동과 본문 스크롤은 연속 녹화로 보존한다.
