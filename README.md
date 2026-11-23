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
