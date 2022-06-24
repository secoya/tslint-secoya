#!/usr/bin/env bash

set -e
PKGROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && echo "$PWD")
PATH=$PKGROOT/node_modules/.bin:$PATH

main() {
  rm -rf "$PKGROOT/dist"
  tsc --project "$PKGROOT/tsconfig.json"
}

main "$@"
