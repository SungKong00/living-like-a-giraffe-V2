#!/bin/bash
set -eu
resources="$(cd "$(dirname "$0")" && pwd)"
cache="$HOME/Library/Application Support/Living Like A Giraffe"
cd "$cache/$(cat "$resources/lib/BUILD")"
exec node/bin/node helper/bridge.mjs "$cache"
