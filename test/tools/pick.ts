import { getSchools } from "../../src/store/db.ts";
import { ledgerState } from "../../src/ledger.ts";
import { loadSentLog } from "../../src/sentlog.ts";
import { loadSkipLog } from "../../src/skiplog.ts";
const want = ["Thailand", "Taiwan", "Vietnam", "Philippines", "Indonesia", "China"];
const sent = loadSentLog(), skip = loadSkipLog(), led = ledgerState();
const appliedKeys = new Set([...led.applied.values()].map((e) => e.school_key));
const BRIT = /british|cambridge|igcse|uk\b|national curriculum|ipc|imyc|england/i;
const by = new Map<string, any[]>();
for (const s of getSchools().values()) if (want.includes(s.country ?? "") && s.country_rank != null) by.set(s.country!, [...(by.get(s.country!) ?? []), s]);
for (const c of want) {
  const list = by.get(c)!.sort((a, b) => a.country_rank - b.country_rank);
  const top = list.slice(0, Math.ceil(list.length * 0.35));
  const ok = top.filter((s) => s.career_email && s.website && !sent.has(s.career_email.toLowerCase()) && !skip.has(s.career_email.toLowerCase()) && !appliedKeys.has(s.school_key) && !/saigon star|crescendo/i.test(s.name));
  const brit = ok.filter((s) => BRIT.test((s.curriculum_json ?? "") + " " + s.name));
  console.log(`\n== ${c}: top35%=${top.length} | with HR email, not yet contacted=${ok.length} | of which British/IGCSE-type=${brit.length}`);
  for (const s of (brit.length >= 3 ? brit : ok).slice(0, 5)) console.log(`  rank ${String(s.country_rank).padStart(3)} | ${s.name.slice(0, 46).padEnd(46)} | ${s.career_email} | ${(s.curriculum_json ?? "").slice(0, 40)} | ${s.website}`);
}
