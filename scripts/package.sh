#!/usr/bin/env bash
# Builds dist/web-shot-<version>.zip containing only the files the extension
# needs (for "Load unpacked" from an unzipped folder or Chrome Web Store upload).
set -euo pipefail

cd "$(dirname "$0")/.."

version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
out="dist/web-shot-${version}.zip"

mkdir -p dist
rm -f "$out"
zip -r -X -q "$out" manifest.json background.js page.js icons _locales LICENSE
echo "$out"
