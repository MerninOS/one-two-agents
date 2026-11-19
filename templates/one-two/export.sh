#!/usr/bin/env bash
# Builds the public OPERATOR tree (Operator-A/Operator) from a commit of this repo (card 127).
# It lives in templates/one-two, so it never ships itself. The public tree has no One Two pack, no
# migration history (one starting migration instead), and no One Two names, ids or keys.
#
#   templates/one-two/export.sh <out dir> [ref, default HEAD]
#
# Then run the checks and the build in <out dir> (this script does that with --check).
set -euo pipefail
OUT=${1:?usage: export.sh <out dir> [ref] [--check]}
REF=${2:-HEAD}
CHECK=${3:-}
SRC=$(git rev-parse --show-toplevel)
STAMP=20261219000000

rm -rf "$OUT" && mkdir -p "$OUT"
git -C "$SRC" archive "$REF" | tar -x -C "$OUT"
cd "$OUT"

# 1. The One Two pack and its tables
PACK_TABLES=$(node -e 'const s=require("fs").readFileSync("templates/one-two/index.ts","utf8");console.log([...s.matchAll(/tables: \[([^\]]*)\]/g)].flatMap(m=>[...m[1].matchAll(/"([a-z_]+)"/g)].map(x=>x[1])).join(" "))')
rm -rf templates/one-two
node - "$PACK_TABLES" <<'EOF'
const fs = require("fs");
const tables = process.argv[2].split(" ").filter(Boolean);
const edit = (f, fn) => { const a = fs.readFileSync(f, "utf8"), b = fn(a); if (a === b) throw new Error(`${f}: nothing changed`); fs.writeFileSync(f, b); };
edit("templates/index.ts", (s) => s.replace(/^import \{ oneTwo \} from "\.\/one-two";\n/m, "").replace("PACKS: readonly TemplatePack[] = [oneTwo];", "PACKS: readonly TemplatePack[] = [];"));
edit("core/tenancy.ts", (s) => s.replace(/"ee_[a-z_]+",[ \t]*/g, ""));
edit("core/tenancy.ts", (s) => { for (const t of tables) { const re = new RegExp(`"${t}",[ \\t]*`); if (!re.test(s)) throw new Error(`${t} not in TENANT_TABLES`); s = s.replace(re, ""); } return s; });
edit("CLAUDE.md", (s) => s.replace("@templates/one-two/DEPLOY.md\n\n", ""));
edit("package.json", (s) => s.replace(/^\s+"check:pack-one-two": .*\n/m, "").replace(/^\s+"check:ee": .*\n/m, "").replace('"name": "one-two-agents"', '"name": "operator"'));
edit("package-lock.json", (s) => s.split('"name": "one-two-agents"').join('"name": "operator"'));
EOF

# 1b. The paid layer's code: the public tree keeps ee/LICENSE and ee/README.md only, and builds the
# open edition (core/extensions/none.ts); OPERATOR_EDITION=cloud needs this repo.
find ee -mindepth 1 -maxdepth 1 ! -name LICENSE ! -name README.md -exec rm -r {} +

# 2. One starting migration instead of the history
rm -f supabase/migrations/*.sql
mv supabase/baseline/operator_baseline.sql "supabase/migrations/${STAMP}_operator_baseline.sql"
rmdir supabase/baseline

# 3. Nothing of One Two's may remain
BRAND='\bzak\b|one[ _-]?two|onetwo|astromall|mernin|zakuccinos|lptfkikpiumiodpjaxal|blended|\baustin\b|zdebrine@'
HITS=$(grep -rniE "$BRAND" . --exclude-dir=node_modules --exclude-dir=.git || true)
if [ -n "$HITS" ]; then echo "$HITS" | head -40 >&2; echo "export refused: One Two names above" >&2; exit 1; fi
SECRET='sk-ant-[A-Za-z0-9_-]{10,}|shpat_[a-f0-9]{10,}|shpss_[a-f0-9]{10,}|secret_[A-Za-z0-9]{30,}|ntn_[A-Za-z0-9]{30,}|re_[A-Za-z0-9]{20,}|eyJhbGciOi[A-Za-z0-9._-]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY'
if grep -rnE "$SECRET" . --exclude-dir=node_modules --exclude-dir=.git; then echo "export refused: a key-shaped string above" >&2; exit 1; fi
grep -rq "templates/one-two" . --exclude-dir=node_modules --exclude-dir=.git && { grep -rn "templates/one-two" . --exclude-dir=node_modules --exclude-dir=.git >&2; echo "export refused: a reference to the One Two pack" >&2; exit 1; }
echo "export: tree ok ($(git -C "$SRC" rev-parse --short "$REF"), pack tables left out: ${PACK_TABLES:-none})"

# 4. Optionally, every check and the build, on the exported tree
if [ "$CHECK" = "--check" ]; then
  cp -al "$SRC/node_modules" node_modules 2>/dev/null || cp -r "$SRC/node_modules" node_modules
  cp -r "$SRC/.schemas" . 2>/dev/null || true
  npm run -s check && npm run -s check:all && npm run -s build >/dev/null && echo "export: checks and build ok"
  rm -rf node_modules .next .schemas tsconfig.tsbuildinfo
fi
