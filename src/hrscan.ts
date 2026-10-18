/**
 * Raising the quality of the HR address across a whole list.
 *
 * For every country, the top share of its ranked schools — the ones worth
 * applying to — are checked for an address a careers page tells you to write
 * to. What is found is written to config/school-emails.json, where each entry
 * says which page it came from, so it can be checked and is never lost.
 *
 * Addresses already in that file are left alone: they were checked by a person.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./core/logger.ts";
import { mapLimit } from "./core/http.ts";
import { getSchools, type SchoolRow } from "./store/db.ts";
import { scanSchool, type Candidate } from "./enrich/careerscan.ts";
import { FORMS_PATH, knownForm, resetForms, type FormKind } from "./enrich/knownforms.ts";
import { recordAddresses } from "./addressbook.ts";

const PATH = join(process.cwd(), "config", "school-emails.json");

export interface HrScanOptions {
  /** The top share of each country's ranking to work on, 0–100. */
  top?: number;
  country?: string;
  limit?: number;
  concurrency?: number;
  dryRun?: boolean;
  /** Also look for each school's application form, and scan schools that already have an HR address. */
  forms?: boolean;
}

export interface FormHit {
  school: SchoolRow;
  kind: FormKind;
  url: string;
  page: string;
}

export interface HrScanHit {
  school: SchoolRow;
  best: Candidate;
  others: Candidate[];
}

/** The schools worth working on: top share of each country that has a website and no careers address. */
export function targets(opts: HrScanOptions = {}): SchoolRow[] {
  const share = Math.min(100, Math.max(1, opts.top ?? 35)) / 100;
  const byCountry = new Map<string, SchoolRow[]>();
  for (const s of getSchools().values()) {
    if (!s.country || s.country_rank == null) continue;
    if (opts.country && s.country.toLowerCase() !== opts.country.toLowerCase()) continue;
    byCountry.set(s.country, [...(byCountry.get(s.country) ?? []), s]);
  }
  const out: SchoolRow[] = [];
  for (const list of byCountry.values()) {
    const ranked = list.sort((a, b) => (a.country_rank ?? 0) - (b.country_rank ?? 0));
    const n = Math.max(1, Math.ceil(ranked.length * share));
    // Looking for forms means visiting schools that already have an address too.
    out.push(...ranked.slice(0, n).filter((s) => (opts.forms || !s.career_email) && s.website));
  }
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export async function runHrScan(opts: HrScanOptions = {}): Promise<{ scanned: number; hits: HrScanHit[]; formHits: FormHit[] }> {
  const list = targets(opts);
  log.step(`Scanning ${list.length} schools' careers pages`);
  const hits: HrScanHit[] = [];
  const formHits: FormHit[] = [];
  let done = 0;

  await mapLimit(list, opts.concurrency ?? 6, async (school) => {
    try {
      const r = await scanSchool(school.website!);
      // Nothing seen is thrown away, whether or not it is the address chosen.
      recordAddresses(school.school_key, r.addresses, "careers-page scan");
      // An address is only wanted where the school has none yet.
      if (r.best && !school.career_email) hits.push({ school, best: r.best, others: r.others });
      if (opts.forms && r.form && !knownForm(school.school_key)) formHits.push({ school, kind: r.form.kind as FormKind, url: r.form.url!, page: r.form.page });
    } catch (err) {
      log.debug(`${school.name}: ${(err as Error).message}`);
    }
    if (++done % 25 === 0) log.info(`${done}/${list.length} scanned, ${hits.length} found`);
  });

  if (!opts.dryRun && hits.length) {
    const file = (existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : {}) as Record<string, unknown>;
    const day = new Date().toISOString().slice(0, 10);
    for (const { school, best } of hits) {
      if (file[school.school_key]) continue;
      file[school.school_key] = {
        email: best.email,
        via: `careers-page scan (${best.kind === "hr" ? "address named for hiring" : "address the page says to send applications to — a named person, check"}): ${best.page}`,
        found: day,
        note: `${school.name} — ${school.country}`,
      };
    }
    writeFileSync(PATH, JSON.stringify(file, null, 2) + "\n");
  }
  if (!opts.dryRun && formHits.length) {
    const file = (existsSync(FORMS_PATH) ? JSON.parse(readFileSync(FORMS_PATH, "utf8")) : {}) as Record<string, unknown>;
    if (!file["//"]) file["//"] = "Application forms linked from a school's careers pages (found by hr-scan --forms). Each says which page it came from.";
    const day = new Date().toISOString().slice(0, 10);
    for (const { school, kind, url, page } of formHits) {
      if (file[school.school_key]) continue;
      file[school.school_key] = { kind, url, page, found: day, note: `${school.name} — ${school.country}` };
    }
    writeFileSync(FORMS_PATH, JSON.stringify(file, null, 2) + "\n");
    resetForms();
  }
  return { scanned: list.length, hits, formHits };
}
