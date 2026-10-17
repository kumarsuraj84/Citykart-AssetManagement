#!/bin/bash
# Build one CKAM release folder from a git-archive tar of the committed tree.
# usage: build.sh <export.tar> <clean extraction dir> <output release folder> <full sha> <short sha> <RELEASE.json> <epoch>
set -euo pipefail
TAR="$1"; X="$2"; OUT="$3"; FULL="$4"; SHORT="$5"; RJ="$6"; EPOCH="$7"
rm -rf "$X"; mkdir -p "$X"
tar -x -f "$TAR" -C "$X" --force-local
echo "export: .git=$(test -e "$X/.git" && echo yes || echo no) demo_walkthrough=$(test -e "$X/docs/ai/CKAM_DEMO_WALKTHROUGH.md" && echo yes || echo no) demo_screens=$(test -e "$X/docs/ai/demo-screens" && echo yes || echo no) env_files=$(find "$X" -name '.env*' -printf '%P ' )"
cd "$X/frontend"
npm ci --no-audit --no-fund 2>&1 | tail -1
VITE_APP_VERSION="$SHORT" npm run build > "$X/build.log" 2>&1 || { tail -30 "$X/build.log"; exit 1; }
grep -E 'vite v|modules transformed|built in' "$X/build.log" | sed 's/\x1b\[[0-9;]*m//g'
npm run check:build 2>&1 | tail -1
cd /
rm -rf "$OUT"
mkdir -p "$OUT/backend/scripts" "$OUT/ops"
cp -r "$X/backend/app" "$OUT/backend/app"
cp "$X/backend/alembic.ini" "$X/backend/pyproject.toml" "$X/backend/constraints.txt" "$OUT/backend/"
cp "$X/backend/scripts/create_owner.py" "$OUT/backend/scripts/"
cp -r "$X/frontend/dist" "$OUT/frontend-dist"
cp -r "$X/ops/windows" "$OUT/ops/windows"
cp -r "$X/ops/db" "$OUT/ops/db"
printf '%s\n' "$FULL" > "$OUT/backend/VERSION"
cp "$RJ" "$OUT/RELEASE.json"
# packaged sources must equal the export byte for byte
diff -r "$X/backend/app" "$OUT/backend/app"; diff -r "$X/ops/windows" "$OUT/ops/windows"; diff -r "$X/ops/db" "$OUT/ops/db"
for f in alembic.ini pyproject.toml constraints.txt scripts/create_owner.py; do cmp "$X/backend/$f" "$OUT/backend/$f"; done
diff -r "$X/frontend/dist" "$OUT/frontend-dist"
echo "SOURCE_IDENTICAL_TO_EXPORT"
# caches/tests inside app (must be none)
echo "pycache/pyc/tests in app: $(find "$OUT/backend/app" \( -name '__pycache__' -o -name '*.pyc' -o -iname '*test*' -o -name conftest.py \) | wc -l)"
# dist checks
echo "dist files: $(find "$OUT/frontend-dist" -type f | wc -l); .map: $(find "$OUT/frontend-dist" -name '*.map' | wc -l); sourceMappingURL files: $(grep -rl sourceMappingURL "$OUT/frontend-dist" | wc -l); google host files: $(grep -rliE 'fonts\.googleapis|fonts\.gstatic|googleapis\.com' "$OUT/frontend-dist" | wc -l); woff2: $(find "$OUT/frontend-dist" -name '*.woff2' | wc -l)"
echo "release id '$SHORT' in js bundles: $(grep -l "$SHORT" "$OUT"/frontend-dist/assets/*.js | wc -l) file(s)"
grep -oE '(src|href)="/assets/[^"]+"' "$OUT/frontend-dist/index.html"
# normalise timestamps (commit time), then the deterministic mtree spec
find "$OUT" -exec touch -d "@$EPOCH" {} +
echo "files: $(find "$OUT" -type f | wc -l), bytes: $(du -sb "$OUT" | cut -f1)"
