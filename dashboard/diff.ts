// A plain line diff for the setup version list (Thinking instructions). Pure; small inputs only
// (instructions are capped at 6,000 characters), so the simple LCS table is fine.
export type DiffLine = { op: "same" | "add" | "del"; text: string };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n"), b = after.split("\n");
  const n = a.length, m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: "same", text: a[i] }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) out.push({ op: "del", text: a[i++] });
    else out.push({ op: "add", text: b[j++] });
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

/** Only the changed lines, with up to `ctx` unchanged lines around each, and "…" for the gaps. */
export function trimDiff(d: DiffLine[], ctx = 1): (DiffLine | { op: "gap"; text: string })[] {
  const keep = d.map((l, k) => l.op !== "same" || d.slice(Math.max(0, k - ctx), k + ctx + 1).some((x) => x.op !== "same"));
  const out: (DiffLine | { op: "gap"; text: string })[] = [];
  d.forEach((l, k) => { if (keep[k]) out.push(l); else if (out.at(-1)?.op !== "gap") out.push({ op: "gap", text: "…" }); });
  return out;
}
