import { getSchools } from "../../src/store/db.ts";
import { sameDomain } from "../../src/enrich/careerscan.ts";
const by = new Map<string, any[]>();
for (const s of getSchools().values()) if (s.country && s.country_rank != null) by.set(s.country, [...(by.get(s.country) ?? []), s]);
let total = 0, ok = 0, noSite = 0; const odd: string[] = []; const generic: string[] = [];
const GENERIC = /^(info|admission|admissions|enquir\w*|contact|office|admin|reception|hello|principal|registrar|marketing)\b/i;
for (const list of by.values()) {
  list.sort((a, b) => a.country_rank - b.country_rank);
  for (const s of list.slice(0, Math.max(1, Math.ceil(list.length * 0.35)))) {
    if (!s.career_email) continue;
    total++;
    if (GENERIC.test(s.career_email.split("@")[0])) generic.push(`${s.country} ${s.country_rank} ${s.name.slice(0, 40)} — ${s.career_email}`);
    if (!s.website) { noSite++; continue; }
    if (sameDomain(s.career_email, /^https?:/.test(s.website) ? s.website : "https://" + s.website)) ok++;
    else odd.push(`${s.country} ${s.country_rank} ${s.name.slice(0, 38)} | ${s.career_email} | site ${s.website.replace(/^https?:\/\//, "").split("/")[0]}`);
  }
}
console.log(`top-35% schools WITH an HR address: ${total} | on the school's own domain: ${ok} | no website to compare: ${noSite} | different domain: ${odd.length} | generic-looking name (info@, admissions@…): ${generic.length}`);
console.log("\n-- generic-looking 'HR' addresses (likely just the front desk):\n" + generic.slice(0, 40).join("\n"));
console.log("\n-- different domain (group inbox, or wrong?):\n" + odd.slice(0, 45).join("\n"));
