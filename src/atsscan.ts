/**
 * Which hiring system each school uses, found from the links on its pages.
 *
 * A school's own careers page usually holds no vacancies in its HTML: they
 * live in a hiring system (Workday, Workable, Lever, …) that the page links
 * to. Several of those systems publish every open post as public JSON, so one
 * account found here becomes a whole school, or a whole group, read daily.
 * ESF was missed by the first scan of careers pages because its Workday link
 * sits on the home page, so both pages are read.
 *
 * Nothing is added automatically: the scan prints the accounts that are not
 * read yet, and each is checked by hand before it goes into
 * src/sources/schoolats.ts or src/sources/workday.ts.
 *
 *   npm run ats-scan -- [--country Thailand] [--limit N]
 */

import { fetchText, mapLimit } from "./core/http.ts";
import { log } from "./core/logger.ts";
import { getSchools, type SchoolRow } from "./store/db.ts";
import { isTargetCountry, targetCountries } from "./directoryconfig.ts";
import { SITES } from "./sources/schoolats.ts";
import { WORKDAY_SITES } from "./sources/workday.ts";

/** Hiring systems and how their links name the account. */
const SYSTEMS: [system: string, pattern: RegExp][] = [
  ["workday", /([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g],
  ["workable", /apply\.workable\.com\/(?!api\b|j\/)([a-z0-9-]+)/g],
  ["lever", /jobs\.lever\.co\/([a-z0-9-]+)/g],
  ["greenhouse", /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9]+)/g],
  ["bamboohr", /([a-z0-9-]+)\.bamboohr\.com/g],
  ["recruitee", /([a-z0-9-]+)\.recruitee\.com/g],
  ["teamtailor", /([a-z0-9-]+)\.teamtailor\.com/g],
  ["smartrecruiters", /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9]+)/g],
  ["personio", /([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/g],
  ["breezy", /([a-z0-9-]+)\.breezy\.hr/g],
  ["ashby", /jobs\.ashbyhq\.com\/([A-Za-z0-9-]+)/g],
  ["jobvite", /jobs\.jobvite\.com\/([a-z0-9-]+)/g],
  ["jazzhr", /([a-z0-9-]+)\.applytojob\.com/g],
  ["pinpoint", /([a-z0-9-]+)\.pinpointhq\.com/g],
  ["zoho", /([a-z0-9-]+)\.zohorecruit\.(?:com|in|eu)/g],
  ["successfactors", /career\d*\.successfactors\.(?:com|eu)\/career\?company=([A-Za-z0-9]+)/g],
  ["csod", /([a-z0-9-]+)\.csod\.com/g],
];

/** Subdomains that are the system's own pages, not an employer's account. */
const NOT_ACCOUNTS = new Set(["www", "api", "app", "help", "support", "careers", "jobs", "static", "cdn", "assets", "resources", "facebook", "careers-analytics"]);

export interface AtsLink {
  system: string;
  account: string;
}

/** Every hiring-system account linked from a page. */
export function atsLinks(html: string): AtsLink[] {
  const found = new Map<string, AtsLink>();
  for (const [system, re] of SYSTEMS) {
    for (const m of html.matchAll(re)) {
      // Workday names the tenant and the career site; both are needed to read it.
      const account = system === "workday" ? `${m[1]}/${m[2]}` : m[1]!;
      if (NOT_ACCOUNTS.has(account.toLowerCase())) continue;
      found.set(`${system}:${account.toLowerCase()}`, { system, account });
    }
  }
  return [...found.values()];
}

/** The accounts already read every day, as "system:account" in lower case. */
function alreadyRead(): Set<string> {
  const keys = SITES.map((s) => `${s.system}:${s.site.replace(/\..*$/, "")}`.toLowerCase());
  for (const w of WORKDAY_SITES) keys.push(`workday:${w.tenant}/${w.site}`.toLowerCase());
  return new Set(keys);
}

export interface AtsHit extends AtsLink {
  schools: { name: string; country: string | null; page: string }[];
}

export async function runAtsScan(opts: { country?: string; limit?: number; concurrency?: number } = {}): Promise<{ scanned: number; hits: AtsHit[] }> {
  const targets = targetCountries();
  let list: SchoolRow[] = [...getSchools().values()].filter((s) =>
    s.website && isTargetCountry(s.country, targets) &&
    (!opts.country || s.country?.toLowerCase() === opts.country.toLowerCase()));
  if (opts.limit) list = list.slice(0, opts.limit);
  log.step(`Looking for hiring-system links on ${list.length} schools' pages`);

  const known = alreadyRead();
  const hits = new Map<string, AtsHit>();
  let done = 0;
  await mapLimit(list, opts.concurrency ?? 8, async (school) => {
    const pages = [...new Set([school.website!, school.careers_url].filter(Boolean) as string[])];
    for (const page of pages) {
      const html = await fetchText(page, { soft: true, retries: 0, timeoutMs: 15000, label: `ats-scan ${school.name}` });
      for (const link of html ? atsLinks(html) : []) {
        const key = `${link.system}:${link.account}`.toLowerCase();
        if (known.has(key)) continue;
        const hit = hits.get(key) ?? { ...link, schools: [] };
        if (!hit.schools.some((s) => s.name === school.name)) hit.schools.push({ name: school.name, country: school.country, page });
        hits.set(key, hit);
      }
    }
    if (++done % 200 === 0) log.info(`${done}/${list.length} schools checked`);
  });
  return { scanned: list.length, hits: [...hits.values()].sort((a, b) => a.system.localeCompare(b.system)) };
}
