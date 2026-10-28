/**
 * Principal name + one quoted fact per theme, for every school with a website.
 *
 *   node --experimental-strip-types --no-warnings src/themes.ts [--limit N] [--apply]
 *
 * Quotes are sentences cut verbatim from the school's own pages, so they are word-for-word
 * by construction. A name is accepted only when exactly one person is paired with a head
 * title on the school's pages and no division/deputy word sits in front of that title;
 * anything else is "unfound". Resumable: results append to data/themes-auto.jsonl.
 * With --apply, accepted names go to config/verified-names.json tagged "auto:".
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchText, mapLimit } from "./core/http.ts";
import { htmlToText } from "./core/text.ts";
import { log } from "./core/logger.ts";
import { isNeverFetch } from "./enrich/social.ts";
import { cleanPersonName } from "./enrich/personname.ts";
import { closeDb, getDb } from "./store/db.ts";
import { loadVerified, recordVerified } from "./export/verifiednames.ts";

const RETRY = process.argv.includes("--retry");
const OUT = RETRY ? "data/themes-auto2.jsonl" : "data/themes-auto.jsonl";
const THEMES: Record<string, RegExp> = {
  "student leadership": /\bstudent[- ](?:led|leaders?|leadership|council|voice)\b|\bleadership (?:opportunities|programme|program|roles|skills)\b|\bstudents? (?:lead|take (?:the )?lead)\b/i,
  responsibility: /\bresponsible (?:students?|young|global|citizens?|learners?)\b|\btake (?:ownership|responsibility)\b|\bsense of responsibility\b|\bsocial responsibility\b/i,
  innovation: /\binnovati(?:on|ve)\b|\binnovators?\b/i,
};
const LINK = /principal|head(?:master|teacher|-of-school)?|welcome|message|leadership|about|student-?(?:leadership|council|voice)|innovation|co-?curricular|our-?(?:team|people|school)|staff|administration|director|governance|who-we-are|meet/i;
const HEAD = /\b(?:head of school|head ?teacher|headmaster|headmistress|principal|school director|director of school)\b/i;
const DIVISION = /\b(?:elementary|primary|secondary|middle|high|lower|upper|junior|senior school|deputy|vice|assistant|associate|early|campus|pastoral|academic|curriculum|ib|pyp|myp|dp)\W*$/i;
const NOISE = /cookie|privacy|©|copyright|subscribe|click here|log ?in|read more|apply now/i;

interface School { school_key: string; name: string; website: string }
interface Result { key: string; name: string; principal: string | null; principalSource?: string; facts: { theme: string; quote: string; url: string }[]; pages: number }

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function links(html: string, base: string): string[] {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const out = new Map<string, number>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(m[1]!, base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(?:pdf|jpe?g|png|gif|docx?|xlsx?|zip)$/i.test(u.pathname) || isNeverFetch(u.href)) continue;
    if (!LINK.test(u.pathname + " " + htmlToText(m[2]!))) continue;
    u.hash = "";
    // principal/welcome pages first: they carry the name
    const score = /principal|head|welcome|message|leadership/i.test(u.pathname + m[2]) ? 2 : 1;
    out.set(u.href, Math.max(out.get(u.href) ?? 0, score));
  }
  return [...out].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, RETRY ? 10 : 5);
}

/** Names directly paired with a head title, with no division word in front of the title. */
function headNames(text: string, schoolName: string): string[] {
  const found = new Set<string>();
  const NAME = /(?:(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+)?[A-Z][a-zA-Z'’-]{1,20}(?:[  ]+[A-Z][a-zA-Z'’-]{1,20}){1,2}/g;
  for (const h of text.matchAll(new RegExp(HEAD.source, "gi"))) {
    const at = h.index!;
    if (DIVISION.test(text.slice(Math.max(0, at - 25), at))) continue;
    const before = text.slice(Math.max(0, at - 50), at).replace(/[\s—–\-,|:·•]+$/, "");
    const after = text.slice(at + h[0].length, at + h[0].length + 50).replace(/^[\s—–\-,|:·•]+/, "");
    const cands = [[...before.matchAll(NAME)].pop()?.[0], after.match(new RegExp("^" + NAME.source))?.[0]];
    // the name must touch the title: nothing but separators in between
    if (cands[0] && !before.endsWith(cands[0])) cands[0] = undefined;
    for (const c of cands) {
      const n = c && cleanPersonName(c, schoolName);
      if (n) found.add(n);
    }
  }
  return [...found];
}

async function scan(s: School): Promise<Result> {
  const res: Result = { key: s.school_key, name: s.name, principal: null, facts: [], pages: 0 };
  const home = await fetchText(s.website, { soft: true, retries: 0, timeoutMs: 15_000 });
  if (!home) return res;
  const pages: [string, string][] = [[s.website, home]];
  for (const u of links(home, s.website)) {
    const h = await fetchText(u, { soft: true, retries: 0, timeoutMs: 15_000 });
    if (h) pages.push([u, h]);
  }
  res.pages = pages.length;

  const names = new Map<string, string>();
  const got = new Set<string>();
  for (const [url, html] of pages) {
    const text = norm(htmlToText(html).slice(0, 200_000));
    for (const n of headNames(text, s.name)) if (!names.has(n)) names.set(n, url);
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const words = sentence.split(" ").length;
      if (words < 8 || words > 30 || NOISE.test(sentence)) continue;
      for (const [theme, re] of Object.entries(THEMES)) {
        if (!got.has(theme) && re.test(sentence)) {
          got.add(theme);
          res.facts.push({ theme, quote: sentence, url });
        }
      }
    }
  }
  // strict: one person, or nobody
  if (names.size === 1) {
    const [[n, u]] = [...names];
    res.principal = n!;
    res.principalSource = u!;
  }
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
  const apply = args.includes("--apply");
  const done = new Set<string>();
  if (existsSync(OUT)) for (const l of readFileSync(OUT, "utf8").split("\n")) if (l) done.add((JSON.parse(l) as Result).key);
  const confirmed = loadVerified();
  // retry: only schools the first pass reached but found no name for
  const first = new Map<string, Result>();
  if (RETRY) for (const l of readFileSync("data/themes-auto.jsonl", "utf8").split("\n")) if (l) { const r = JSON.parse(l) as Result; first.set(r.key, r); }
  const schools = (getDb().prepare("select school_key,name,website from schools where website is not null and website <> ''").all() as unknown as School[])
    .filter((s) => !done.has(s.school_key) && (!RETRY || ((first.get(s.school_key)?.pages ?? 0) > 0 && !first.get(s.school_key)?.principal)) && !(s.school_key in confirmed) && !isNeverFetch(s.website))
    .slice(0, limit);
  log.step(`${schools.length} schools to scan`);
  let n = 0;
  await mapLimit(schools, 6, async (s) => {
    const r = await scan(s).catch((): Result => ({ key: s.school_key, name: s.name, principal: null, facts: [], pages: 0 }));
    appendFileSync(OUT, JSON.stringify(r) + "\n");
    if (++n % 25 === 0) log.plain(`  ${n}/${schools.length}`);
  });

  // a sentence found on 2+ schools is boilerplate, not a fact about this school
  const all = readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Result);
  const seen = new Map<string, number>();
  for (const r of all) for (const f of r.facts) seen.set(f.quote, (seen.get(f.quote) ?? 0) + 1);
  const csv = ["school_key,school,theme,quote,url"];
  let named = 0;
  for (const r of all) {
    for (const f of r.facts) if (seen.get(f.quote) === 1) csv.push([r.key, r.name, f.theme, f.quote, f.url].map((x) => `"${x.replace(/"/g, '""')}"`).join(","));
    if (r.principal) {
      named++;
      if (apply && !(r.key in confirmed)) recordVerified(r.key, r.principal, `auto: ${r.principalSource}`);
    }
  }
  const csvPath = RETRY ? "data/themes-auto2.csv" : "data/themes-auto.csv";
  writeFileSync(csvPath, csv.join("\n") + "\n", "utf8");
  log.ok(`${all.length} scanned, ${named} with a name, ${csv.length - 1} unique facts → ${csvPath}${apply ? "" : "  (names not written; use --apply)"}`);
  closeDb();
}

await main();
