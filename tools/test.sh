#!/usr/bin/env bash

set -e
PKGROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && echo "$PWD")
export PATH=$PKGROOT/node_modules/.bin:$PATH

main() {
  find tests/rules -type d -exec tslint --test {} \;
}

main "$@"
