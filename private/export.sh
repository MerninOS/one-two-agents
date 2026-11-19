#!/usr/bin/env bash
# Builds the public OPERATOR tree (Operator-A/Operator) from a commit of this repo (card 127).
# It lives in private/, which the public tree leaves out, so it never ships itself. The public tree
# has no migration history (the starting migration and the paid layer's tables instead), and no One
# Two names, ids or keys. Card 136 runs it one last time: from then on the public repo is the repo.
#
#   private/export.sh <out dir> [ref, default HEAD]
#
# Then run the checks and the build in <out dir> (this script does that with --check).
set -euo pipefail
OUT=${1:?usage: export.sh <out dir> [ref] [--check]}
REF=${2:-HEAD}
CHECK=${3:-}
SRC=$(git rev-parse --show-toplevel)
STAMP=20261219000000
EE_STAMP=20261219000100

rm -rf "$OUT" && mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
cd "$OUT"

# 1. This repo's private folder (One Two's deploy notes, this script, its brand words)
rm -rf private
node - <<'EOF'
const fs = require("fs");
const edit = (f, fn) => { const a = fs.readFileSync(f, "utf8"), b = fn(a); if (a === b) throw new Error(`${f}: nothing changed`); fs.writeFileSync(f, b); };
edit("CLAUDE.md", (s) => s.replace("@private/DEPLOY.md\n\n", ""));
EOF

# 1b. The paid layer ships in full under ee/LICENSE (card 136, Zak decided): no outside pull requests.

# 2. The starting migration and the paid layer's tables instead of the history
rm -f supabase/migrations/*.sql
mv supabase/baseline/operator_baseline.sql "supabase/migrations/${STAMP}_operator_baseline.sql"
mv supabase/baseline/ee_tables.sql "supabase/migrations/${EE_STAMP}_ee_tables.sql"
rmdir supabase/baseline

# 3. Nothing of One Two's may remain
BRAND='\bzak\b|one[ _-]?two|onetwo|astromall|mernin|zakuccinos|lptfkikpiumiodpjaxal|blended|\baustin\b|zdebrine@'
HITS=$(grep -rniE "$BRAND" . --exclude-dir=node_modules --exclude-dir=.git || true)
if [ -n "$HITS" ]; then echo "$HITS" | head -40 >&2; echo "export refused: One Two names above" >&2; exit 1; fi
SECRET='sk-ant-[A-Za-z0-9_-]{10,}|shpat_[a-f0-9]{10,}|shpss_[a-f0-9]{10,}|secret_[A-Za-z0-9]{30,}|ntn_[A-Za-z0-9]{30,}|re_[A-Za-z0-9]{20,}|eyJhbGciOi[A-Za-z0-9._-]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY'
if grep -rnE "$SECRET" . --exclude-dir=node_modules --exclude-dir=.git; then echo "export refused: a key-shaped string above" >&2; exit 1; fi
grep -rqE "private/(DEPLOY\.md|export\.sh)" . --exclude-dir=node_modules --exclude-dir=.git && { grep -rnE "private/(DEPLOY\.md|export\.sh)" . --exclude-dir=node_modules --exclude-dir=.git >&2; echo "export refused: a reference to this repo's private folder" >&2; exit 1; }
echo "export: tree ok ($(git -C "$SRC" rev-parse --short "$REF"))"

# 4. Optionally, every check and the build, on the exported tree
if [ "$CHECK" = "--check" ]; then
  cp -al "$SRC/node_modules" node_modules 2>/dev/null || cp -r "$SRC/node_modules" node_modules
  cp -r "$SRC/.schemas" . 2>/dev/null || true
  npm run -s check && npm run -s check:all && npm run -s build >/dev/null && echo "export: checks and build ok"
  rm -rf node_modules .next .schemas tsconfig.tsbuildinfo
fi
