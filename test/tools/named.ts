import { readFileSync } from "node:fs";
import { scanSchool } from "../../src/enrich/careerscan.ts";
import { getSchools } from "../../src/store/db.ts";
const cfg = JSON.parse(readFileSync("config/school-emails.json", "utf8"));
const schools = getSchools();
for (const [k, v] of Object.entries(cfg) as [string, any][]) {
  if (!/a person|named/.test(v.via ?? "") && !/hr\]|careers-page scan/.test(v.via ?? "")) continue;
  if (!/careers-page scan/.test(v.via)) continue;
  if (!/named person/.test(v.via)) continue;
  const s = schools.get(k);
  const r = await scanSchool(s!.website!);
  console.log(`\n${v.note}\n  ${v.email}\n  …${r.best?.context ?? "(not re-found)"}…`);
}
