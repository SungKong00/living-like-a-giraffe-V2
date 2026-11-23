# Living Like a Giraffe V2

리라지의 공간과 행사 기록을 Babylon.js 월드로 다시 만드는 프로젝트다. 프로젝트 폴더에는 월드 원본과 행사 조사 기록, 명세와 설계 결정 도구가 준비되어 있다.

- 모델을 열거나 수정할 때는 [월드 자산](docs/world/README.md)을 확인한다.
- 행사 페이지를 준비할 때는 [행사 자료](docs/events/README.md)에서 출처를 확인한다.
- 프로젝트 작업을 시작할 때는 [작업 지침](AGENTS.md)을 읽는다.

## 개발 도구

OpenSpec과 adrs가 필요한 환경에서는 아래 명령으로 설치한다. 이 프로젝트는 OpenSpec 1.14.3과 adrs 0.13.0으로 구성했다.

```sh
npm install -g @fission-ai/openspec@1.14.3
brew install adrs
```

프로젝트 루트에서 `openspec list`로 진행 중인 변경을, `adrs list`로 설계 결정을 조회한다. Codex의 프로젝트 MCP 설정은 `adrs`와 `uvx`를 PATH에서 찾는다.

## 로컬 실행

Node 22.17 이상, uv와 macOS에서 프로젝트 루트에서 실행한다. Blender 작업은 독립 Python 환경에 설치되며 별도 애드온이 필요하지 않다.

```sh
npm ci
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r world/requirements.txt
npm run prepare:world
npm run dev
```

관람은 http://127.0.0.1:4173, PC 편집은 `/studio`에서 연다. 기존 두 행사 페이지는 `/events`에서 3D 초기화와 별도로 열린다. 첫 시작 시 관리자 키가 로컬 `.world/admin-key`에 생성된다. 운영자가 별도로 지정할 때는 `RIRAGI_ADMIN_KEY`를 사용한다. `.world`에는 비공개 전체 원본·초안·인계 기준·공개 버전이 포함되므로 이 디렉터리 전체를 함께 백업한다.

`npm run build && npm start`로 빌드 결과를 확인한다. `npm test`는 배치 검증·병합·되돌리기를 검사한다. `npm run test:world`는 준비한 원본을 임시 저장소에 복사해 실제 Blender 다운로드·재업로드·베이크·복원을 검사한다. 서버는 루프백 주소에 바인딩한다.

브라우저 흐름은 로컬 Chrome이 설치된 환경에서 `npm run build && npm run test:browser`로 검증한다. 모바일 기기 설정을 적용한 Chrome 테스트와 실제 iOS Safari·Android 기기의 화질·성능 측정은 구분한다.

`.venv/bin/python tests/asset-contract.py`는 회전한 방과 같은 재질의 바닥·가구를 검사한다. 로컬 사이트가 실행 중일 때 `node tests/render-batches.mjs`는 서로 호환되는 가구 두 개와 다른 가구 한 개를 그려 실제 WebGL 호출 횟수와 개별 클릭 연결을 확인한다.
