/**
 * Facts gathered by hand (Cowork / Claude.ai) → school_hook, only when they can be said back to a
 * school as a true sentence.
 *
 * The collector hands over whole quotes, often in another language or about a group, and a letter
 * needs a short phrase ("is accredited by WASC"). So nothing is paraphrased: a quote is accepted
 * only if it matches one of the shapes below AND its text is found on the page it cites. Anything
 * else goes to the report for a person to look at.
 *
 *   npm run import-facts -- <facts-found-1.csv> ...  [--apply]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fetchText } from "./core/http.ts";
import { htmlToText } from "./core/text.ts";
import { log } from "./core/logger.ts";
import { closeDb, getDb } from "./store/db.ts";

interface Row { key: string; type: string; quote: string; url: string }

/** RFC-4180-ish: quoted fields may hold commas, doubled quotes and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

const ORGS: [RegExp, string][] = [
  [/\bWASC\b/, "WASC"],
  [/\bCognia\b/i, "Cognia"],
  [/\bNEASC\b/, "NEASC"],
  [/\bCIS\b|Council of International Schools/, "the Council of International Schools"],
];

const GENERIC = /^(?:international|school|academy|college|the|of|and|for|in|at|christian|british|american|primary|secondary|high|private|preparatory|world|day|boarding|state|public|independent|catholic|national|local|new|first|our|every|each|german|french|baccalaureate|cambridge|council|diploma|programme|primary|years)$/i;

/** A quote that names some other school ("Yantai Huasheng International School…") says nothing about this one. */
function namesAnotherSchool(quote: string, schoolName: string): boolean {
  const mine = new Set(schoolName.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !GENERIC.test(w)));
  for (const m of quote.matchAll(/((?:[A-Z][\w'\u2019-]+ )+)(?:International )?(?:School|Academy|College)\b/g)) {
    const words = m[1]!.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !GENERIC.test(w));
    if (words.length && !words.some((w) => mine.has(w))) return true;
  }
  return false;
}

/** The phrase that follows the school's name in the letter, or null when the quote does not earn one. */
export function shapeFact(quote: string, schoolName: string): string | null {
  // Not English: a letter in English must not quote a language the reader may not share.
  if (/[㐀-鿿À-ÿ]/.test(quote)) return null;
  if (/\b(?:candidate|pending|seeking|applying)\b/i.test(quote)) return null;
  // A tutoring or language centre is not a school a PE letter can be written to.
  if (/\b(?:english|language|tutor\w*|learning cent(?:re|er)|recruit\w*|consult\w*|agency)\b/i.test(schoolName)) return null;
  if (namesAnotherSchool(quote, schoolName)) return null;

  const accredited = /accredit/i.test(quote) ? ORGS.find(([re]) => re.test(quote)) : undefined;
  if (accredited) return `is accredited by ${accredited[1]}`;

  if (/\bIB World School\b/i.test(quote)) return "is an IB World School";

  const founded = /\b(founded|established)\b[^.]{0,30}?\b((?:18|19|20)\d{2})\b/i.exec(quote);
  if (founded) {
    // "Founded in 1999, Seadragon Education…" was a recruiter. The subject has to be a school.
    const operator = /education|consult|recruit|group|network|agency/i.test(schoolName);
    const nameWords = schoolName.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !/school|international|academy|college|education/.test(w));
    const aboutSchool = /\b(?:school|academy|college|campus)\b/i.test(quote) || nameWords.some((w) => quote.toLowerCase().includes(w));
    if (aboutSchool && !(operator && !/\b(?:school|academy|college)\b/i.test(quote))) {
      return `was ${founded[1]!.toLowerCase()} in ${founded[2]}`;
    }
  }
  return null;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").replace(/[\s.…]+$/, "").trim();

async function onPage(url: string, quote: string): Promise<boolean> {
  const html = await fetchText(url, { retries: 1, soft: true, timeoutMs: 15000, label: `fact ${url}` });
  return !!html && norm(htmlToText(html)).includes(norm(quote));
}

export async function importFacts(files: string[], apply: boolean): Promise<void> {
  const rows: Row[] = files.flatMap((f) =>
    parseCsv(readFileSync(f, "utf8")).slice(1).map(([key, type, quote, url]) => ({ key: key ?? "", type: type ?? "", quote: quote ?? "", url: url ?? "" })));
  const db = getDb();
  db.exec("PRAGMA busy_timeout = 30000");
  const school = db.prepare("SELECT name, school_hook, provenance_json FROM schools WHERE school_key = ?");
  const write = db.prepare("UPDATE schools SET school_hook = ?, provenance_json = ? WHERE school_key = ? AND COALESCE(school_hook,'') = ''");

  const report: string[] = ["status,school_key,hook,reason,quote,url"];
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const counts: Record<string, number> = {};
  const done = new Set<string>();

  for (const r of rows) {
    const note = (status: string, hook: string, reason: string) => {
      counts[status] = (counts[status] ?? 0) + 1;
      report.push([status, r.key, hook, reason, r.quote, r.url].map(q).join(","));
    };
    // Cowork writes the country slug hyphenated ("south-korea"); the key holds a space.
    const key = school.get(r.key) ? r.key : r.key.replace(/|(.*)$/, (_m, c: string) => "|" + c.replace(/-/g, " "));
    r.key = key;
    const s = school.get(r.key) as { name: string; school_hook: string | null; provenance_json: string | null } | undefined;
    if (!s) { note("rejected", "", "school_key not in the database"); continue; }
    if (r.type === "none") { note("skipped", "", "collector found nothing"); continue; }
    if (r.type === "pe") { note("review", "", "PE fact: not auto-imported, read it yourself"); continue; }
    if (s.school_hook) { note("skipped", "", "school already has a fact"); continue; }
    if (done.has(r.key)) { note("skipped", "", "second fact for the same school"); continue; }
    const hook = shapeFact(r.quote, s.name);
    if (!hook) { note("review", "", "not English, a group or a plain claim: no safe phrase"); continue; }
    if (hook.length < 12 || hook.length > 110) { note("rejected", hook, "bad length"); continue; }
    if (!(await onPage(r.url, r.quote))) { note("rejected", hook, "quote not found on the cited page"); continue; }
    if (apply) {
      const prov = { ...(s.provenance_json ? JSON.parse(s.provenance_json) : {}), schoolHook: { confidence: 0.9, source: `collected by hand, ${r.url}` } };
      write.run(hook, JSON.stringify(prov), r.key);
    }
    done.add(r.key);
    note(apply ? "imported" : "would-import", hook, "");
    log.plain(`  ${s.name}  ${hook}`);
  }
  const out = "data/facts-import-report.csv";
  writeFileSync(out, report.join("\n"));
  log.ok(`${rows.length} rows: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}  ->  ${out}`);
  closeDb();
}
