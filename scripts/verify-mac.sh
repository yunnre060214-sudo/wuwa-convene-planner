#!/usr/bin/env bash
set -euo pipefail

arch="$1"
case "$arch" in
  arm64) mach=arm64 ;;
  x64) mach=x86_64 ;;
  *) exit 2 ;;
esac
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
test "$(lipo -archs "$bundle/Contents/MacOS/TidePlanner")" = "$mach"
test "$(lipo -archs "$bundle/Contents/Resources/convene")" = "$mach"
bundle_version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$bundle/Contents/Info.plist")"
test "$bundle_version" = "$version"
"$bundle/Contents/MacOS/TidePlanner" --smoke-test
