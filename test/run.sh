#!/bin/sh
# Storage tests. Run from the repo root: test/run.sh
# Run this before shipping any change to how drills or practices are stored.
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "JavaScriptCore not found at $JSC"; exit 1; }

out=$("$JSC" test/storage-test.js 2>&1)
echo "$out"
case "$out" in
  *FAILED*|*ERROR*) exit 1 ;;
esac
exit 0
