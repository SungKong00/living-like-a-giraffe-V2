#!/bin/bash
set -euo pipefail
umask 077
bundle="$1"
cache="$2"
runtime="$cache/$(cat "$bundle/BUILD")"
mkdir -p "$cache"
if [[ ! -d "$runtime" ]]; then
  echo '처음 실행할 때 Blender와 실행 도구를 준비합니다. 인터넷 연결을 유지하세요.'
  stage="$(mktemp -d "$cache/install.XXXXXXXX")"
  cleanup() { if [[ ! -e "$stage/ready" ]]; then rm -rf "$stage"; fi; }
  trap cleanup EXIT
  cp -R "$bundle/." "$stage/"
  cd "$stage"
  fetch() {
    curl --fail --location --retry 2 --proto '=https' --proto-redir '=https' "$1" -o "$2"
    echo "$3  $2" | shasum -a 256 -c -
  }
  fetch 'https://nodejs.org/dist/v22.17.0/node-v22.17.0-darwin-arm64.tar.gz' node.tgz 615dda58b5fb41fad2be43940b6398ca56554cbe05800953afadc724729cb09e
  fetch 'https://github.com/astral-sh/uv/releases/download/0.9.5/uv-aarch64-apple-darwin.tar.gz' uv.tgz dc098ff224d78ed418e121fd374f655949d2c7031a70f6f6604eaf016a130433
  mkdir node uv
  tar xzf node.tgz -C node --strip-components=1
  tar xzf uv.tgz -C uv --strip-components=1
  rm node.tgz uv.tgz
  export PATH="$stage/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  export UV_PYTHON_INSTALL_DIR="$stage/python"
  uv/uv python install 3.11.14
  uv/uv venv --managed-python --python 3.11.14 .venv
  uv/uv pip install --only-binary=:all: -r world/requirements.txt
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  .venv/bin/python -c 'import bpy; print("Blender", bpy.app.version_string)'
  node/bin/node -e "import('./helper/publish.mjs')"
  # Publish the fully installed directory. Concurrent installers can safely lose this race.
  node/bin/node --input-type=module -e 'import fs from "node:fs";try{fs.symlinkSync(process.cwd(),process.argv[1]);fs.closeSync(fs.openSync("ready","w"))}catch(e){if(e.code!=="EEXIST")throw e}' "$runtime"
fi
