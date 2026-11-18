#!/usr/bin/env bash
set -euo pipefail

arch="arm64"
if [[ "${1:-$arch}" != "$arch" ]]; then
  exit 2
fi
version="$(node -p 'require("./package.json").version')"
bundle="dist/TidePlanner-darwin-$arch/TidePlanner.app"
archive="dist/release/TidePlanner-$version-macos-$arch.zip"
mkdir -p dist/release
ditto -c -k --sequesterRsrc --keepParent "$bundle" "$archive"
unpacked="$(mktemp -d)"
trap 'rm -rf "$unpacked"' EXIT
ditto -x -k "$archive" "$unpacked"
bundle="$unpacked/TidePlanner.app"
codesign --verify --deep --strict --verbose=2 "$bundle"
test "$(lipo -archs "$bundle/Contents/MacOS/TidePlanner")" = "$arch"
test "$(lipo -archs "$bundle/Contents/Resources/convene")" = "$arch"
bundle_version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$bundle/Contents/Info.plist")"
test "$bundle_version" = "$version"
"$bundle/Contents/MacOS/TidePlanner" --smoke-test
