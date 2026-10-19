import { getSchools } from "../../src/store/db.ts";
import { buildRecipients } from "../../src/export/recipients.ts";
const r = buildRecipients([...getSchools().values()]);
const pick = r.find((x) => x.factQuality === "unique" && x.schools.length === 1 && x.country === "Thailand") ?? r[0]!;
console.log("TO:", pick.email, "|", pick.schools[0]!.name, "\nSUBJECT:", pick.subject, "\n\n" + pick.body);
const lens = r.filter((x) => x.body).map((x) => x.body.split(/\s+/).length);
console.log("\n--- letters:", lens.length, "| words avg", Math.round(lens.reduce((a, b) => a + b, 0) / lens.length));
const has = (re: RegExp) => r.filter((x) => re.test(x.body)).length;
console.log("mention Crescendo-HELP:", has(/Crescendo/i), "| IGCSE:", has(/IGCSE/i), "| 'WHAT I WOULD BRING':", has(/WHAT I WOULD BRING/i), "| August 2027:", has(/August 2027/i), "| 5 core skills:", has(/core skills/i), "| online tools:", has(/online tools/i), "| website link:", has(/mrleo-pe/i));
