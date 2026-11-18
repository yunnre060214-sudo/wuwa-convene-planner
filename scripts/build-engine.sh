#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${1:-$project/build/engine/convene}"
mkdir -p "$(dirname "$output")"
cd "$project/engine"
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -buildid=' -o "$output" ./cmd/convene
