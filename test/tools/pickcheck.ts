import { DatabaseSync } from "node:sqlite";
import { getSchools } from "../../src/store/db.ts";
const raw = new DatabaseSync("data/jobs.db", { readOnly: true });
const stored = new Map((raw.prepare("SELECT school_key, career_email, school_email, contact_email FROM schools").all() as any[]).map((r) => [r.school_key, r]));
const now = getSchools();
let hrNow = 0, hrBefore = 0, anyNow = 0, anyBefore = 0, swapped = 0, gained = 0, anyGained = 0;
const ex: string[] = [], gainEx: string[] = [], anyEx: string[] = [];
for (const [k, s] of now) {
  const o = stored.get(k)!;
  if (o.career_email) hrBefore++; if (s.career_email) hrNow++;
  const a0 = o.career_email || o.contact_email || o.school_email, a1 = s.career_email || s.contact_email || s.school_email;
  if (a0) anyBefore++; if (a1) anyNow++;
  if (o.career_email && s.career_email && o.career_email !== s.career_email) { swapped++; if (ex.length < 14) ex.push(`${s.name.slice(0, 34).padEnd(34)} ${o.career_email}  →  ${s.career_email}`); }
  if (!o.career_email && s.career_email) { gained++; if (gainEx.length < 6) gainEx.push(`${s.name.slice(0, 34).padEnd(34)} (none)  →  ${s.career_email}`); }
  if (!a0 && a1) { anyGained++; if (anyEx.length < 6) anyEx.push(`${s.name.slice(0, 34).padEnd(34)} (none)  →  ${a1}`); }
}
console.log(`HR/careers address: ${hrBefore} → ${hrNow}  (${gained} schools gained one, ${swapped} switched to a better one)`);
console.log(`any address:        ${anyBefore} → ${anyNow}  (${anyGained} schools gained one)`);
console.log("\nswitched to a better HR address:\n" + ex.join("\n"));
console.log("\ngained an HR address:\n" + gainEx.join("\n"));
console.log("\ngained an address where there was none:\n" + anyEx.join("\n"));
const ism = now.get("international-school-myanmar|myanmar") ?? [...now.values()].find((s) => /international school of myanmar/i.test(s.name));
console.log("\nISM now writes to:", ism?.career_email);
