#!/bin/bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
app="$(cd ../.. && pwd)"
installed="$HOME/Applications/Giraffe Studio.app"
if [[ "$app" != "$installed" ]]; then
  mkdir -p "$HOME/Applications"
  /usr/bin/ditto "$app" "$installed"
  exec "$installed/Contents/Resources/install.sh"
fi
if [[ "$(uname -sm)" != 'Darwin arm64' ]]; then
  echo '이 도우미는 Apple Silicon 맥용입니다.'
  exit 1
fi
bundle="$PWD/lib"
cache="$HOME/Library/Application Support/Living Like A Giraffe"
release="$(cat "$bundle/BUILD")"
runtime="$cache/$release"
mkdir -p "$cache"
"$installed/Contents/Resources/runtime.sh" "$bundle" "$cache"
cd "$runtime"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$installed"
nohup "$runtime/node/bin/node" helper/bridge.mjs "$cache" </dev/null >>"$cache/helper.log" 2>&1 &
studio="$("$runtime/node/bin/node" helper/connect.mjs "$cache")"
if [[ ! -e "$cache/login-choice" ]]; then
  choice="$(osascript -e 'button returned of (display dialog "맥에 로그인할 때 도우미를 자동으로 켤까요?" buttons {"직접 켜기", "자동으로 켜기"} default button "자동으로 켜기" with title "Giraffe Studio")')"
  if [[ "$choice" == '자동으로 켜기' ]]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    plist="$HOME/Library/LaunchAgents/dev.living-like-a-giraffe.publisher.plist"
    /usr/bin/plutil -create xml1 "$plist"
    /usr/bin/plutil -insert Label -string dev.living-like-a-giraffe.publisher "$plist"
    /usr/bin/plutil -insert ProgramArguments -json '[]' "$plist"
    /usr/bin/plutil -insert ProgramArguments.0 -string "$installed/Contents/Resources/login.sh" "$plist"
    /usr/bin/plutil -insert RunAtLoad -bool YES "$plist"
  fi
  touch "$cache/login-choice"
fi
osascript -e 'display dialog "준비됐어요. 이제 스튜디오에서 작업하세요." buttons {"스튜디오 열기"} default button 1 with title "Giraffe Studio"'
/usr/bin/open "$studio"
