import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join } from "node:path";
type Seen = Map<string, Map<string, string>>; // school_key -> email -> where first seen
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
function read(path: string): Seen {
  const out: Seen = new Map();
  const d = new DatabaseSync(path, { readOnly: true });
  const add = (k: string, e: unknown, from: string) => {
    if (typeof e !== "string" || !e.includes("@")) return;
    const m = out.get(k) ?? new Map<string, string>();
    m.set(e.toLowerCase().trim(), from);
    out.set(k, m);
  };
  const cols = (d.prepare("PRAGMA table_info(schools)").all() as { name: string }[]).map((c) => c.name);
  for (const r of d.prepare("SELECT * FROM schools").all() as Record<string, unknown>[]) {
    const k = r.school_key as string;
    for (const c of ["school_email", "career_email", "contact_email"]) if (cols.includes(c)) add(k, r[c], c);
    if (typeof r.emails_json === "string") for (const m of r.emails_json.matchAll(EMAIL)) add(k, m[0], "emails_json");
  }
  d.close();
  return out;
}
const dir = process.argv[2]!;
const files = readdirSync(dir).filter((f) => f.endsWith(".db"));
const history: Seen = new Map();
for (const f of files) for (const [k, m] of read(join(dir, f))) { const h = history.get(k) ?? new Map(); for (const [e, w] of m) if (!h.has(e)) h.set(e, `${w}@${f.replace(".db", "")}`); history.set(k, h); }
const now = read(process.argv[3]!);
let total = 0, missing = 0; const byWhere: Record<string, number> = {}; const examples: string[] = []; const schoolsHit = new Set<string>();
for (const [k, m] of history) for (const [e, w] of m) {
  total++;
  if (now.get(k)?.has(e)) continue;
  missing++; schoolsHit.add(k); const kind = w.split("@")[0]!; byWhere[kind] = (byWhere[kind] ?? 0) + 1;
  if (examples.length < 25) examples.push(`${k.split("|")[0]!.slice(0, 40).padEnd(40)} ${e}  (was ${kind})`);
}
console.log(`historical DB versions read: ${files.length}`);
console.log(`addresses ever seen: ${total} | still on file: ${total - missing} | NO LONGER on file: ${missing} across ${schoolsHit.size} schools`);
console.log("missing, by where they were:", JSON.stringify(byWhere));
console.log(examples.join("\n"));
