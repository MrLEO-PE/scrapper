/**
 * A school's own careers page.
 *
 * Schools frequently advertise on their own site days before a board picks the
 * role up, and some never post to a board at all — so for a shortlist of
 * target schools it is worth looking directly.
 *
 * Careers pages are wildly inconsistent: some list roles inline, some link to a
 * PDF job description, some embed an applicant-tracking widget that renders
 * client-side and is therefore invisible here. This source is best-effort by
 * design — it reads what is in the HTML, classifies it, and stays quiet about
 * the rest.
 *
 * Schools are configured in `config/schools.json`. Only the website is
 * required; the careers page is found automatically unless one is given.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { decodeEntities, hostOf, htmlToText, slugify } from "../core/text.ts";
import { isTargetCountry, targetCountries } from "../directoryconfig.ts";
import { isNeverFetch } from "../enrich/social.ts";
import { getDb } from "../store/db.ts";
import type { RawJob } from "../core/types.ts";
import { detectApplicationForm } from "../match/appform.ts";
import { classify } from "../match/classify.ts";
import type { ScrapeContext, Source } from "./base.ts";

interface SchoolEntry {
  name: string;
  website: string;
  careers?: string;
  country?: string;
  city?: string;
  on?: boolean;
}

/** Link text/href patterns that mark a careers page, best first. */
const CAREERS_LINK =
  /(?:^|[\/\-_\s])(?:careers?|vacanc(?:y|ies)|recruit(?:ment)?|employment|job-?opportunities|jobs?|work-?(?:with|for)-?us|join-?(?:us|our-?team)|teaching-?(?:at|in)|hiring|opportunities|work-?here)(?:[\/\-_.?#\s]|$)/i;

/**
 * Text that looks like a role rather than a navigation label. The PE
 * classifier alone is not enough: a curriculum page called "Physical
 * Education" would otherwise be reported as a vacancy.
 */
const ROLE_SHAPED =
  /\b(?:teacher|teaching|head\s+of|director\s+of|coordinator|co-ordinator|instructor|coach|leader|specialist|assistant|manager|officer|vacancy|position|required|wanted|appointment|hod)\b/i;

/**
 * Nav/marketing destinations that are never vacancies.
 *
 * Note the student-facing careers pages: a school's "Careers Programme" or
 * "University and Careers" section is guidance for pupils, not recruitment.
 */
const NOT_A_VACANCY =
  /(?:curriculum|academics?|about-us|our-school|admissions?|parent|student-life|news|blog|event|calendar|alumni|contact|privacy|policy|careers?-(?:programme|program|uni|university|guidance|advice|support|education|fair)|uni-?guidance|facebook|twitter|linkedin|instagram|youtube)/i;

/**
 * Student-facing careers guidance, which reads as a careers page but is about
 * pupils' futures, not recruitment. The word order varies —
 * "university-and-careers", "higher-education-and-careers", "careers-and-he" —
 * so both sides are matched.
 */
const STUDENT_CAREERS =
  /(?:universit\w*|higher[\s-]?education|he|college|futures?|guidance|advice)[\s-]*(?:and|&|\+)?[\s-]*careers?|careers?[\s-]*(?:and|&|\+)?[\s-]*(?:universit\w*|higher[\s-]?education|he\b|college|futures?|guidance|advice)/i;

/**
 * Links on a careers page that lead to the actual list of roles. Schools
 * routinely put only category headings on the landing page — "Teaching
 * Vacancies", "Faculty Vacancies" — with the openings a click away.
 */
const VACANCY_CATEGORY =
  /\b(?:teaching|faculty|academic|leadership|current|all|staff|support|open)\s+(?:vacanc(?:y|ies)|positions?|opportunities|roles?|openings?)\b|\b(?:vacanc(?:y|ies)|current-openings?|job-?openings?)\b/i;

function configPath(): string {
  return join(process.cwd(), "config", "schools.json");
}

export function loadSchoolEntries(): SchoolEntry[] {
  const path = configPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { schools?: SchoolEntry[] };
    return (parsed.schools ?? []).filter((s) => s.on !== false && s.name && s.website);
  } catch (err) {
    log.warn(`could not read ${path}: ${(err as Error).message}`);
    return [];
  }
}

/**
 * How many database-sourced schools to poll in one run.
 *
 * Each one costs a page fetch or two, so the whole directory cannot be swept
 * every night. Best-ranked first, which is also where the jobs worth having
 * are.
 */
const FROM_DB_LIMIT = 120;

/**
 * The schools to check, drawn from the database as well as the config file.
 *
 * The config file is a hand-curated shortlist of 45, and it was the only
 * source of targets — yet the database already holds 151 schools in the
 * configured countries with a known website, and 55 with a careers page
 * already discovered by enrichment. Those are precisely the schools worth
 * watching, and many post on their own site before a board picks the role up,
 * or never post to a board at all.
 *
 * Config entries always win: they are deliberate, and they may carry a careers
 * URL that discovery would not find.
 */
export function schoolsToCheck(): SchoolEntry[] {
  const configured = loadSchoolEntries();
  const seen = new Set(configured.map((s) => hostKey(s.website)).filter(Boolean));
  const out = [...configured];

  const targets = targetCountries();
  let rows: {
    name: string; website: string | null; careers_url: string | null;
    country: string | null; city: string | null; country_rank: number | null;
  }[] = [];
  try {
    rows = getDb()
      .prepare(
        `SELECT name, website, careers_url, country, city, country_rank
           FROM schools
          WHERE website IS NOT NULL
          ORDER BY careers_url IS NULL, COALESCE(country_rank, 9999)`,
      )
      .all() as typeof rows;
  } catch (err) {
    // The source must still work against the config alone.
    log.debug(`school sites: could not read the database (${(err as Error).message})`);
    return configured;
  }

  let added = 0;
  for (const r of rows) {
    if (added >= FROM_DB_LIMIT) break;
    if (!r.website || !isTargetCountry(r.country, targets)) continue;
    // A social page is not a careers page, and must never be fetched.
    if (isNeverFetch(r.website) || isNeverFetch(r.careers_url)) continue;
    const key = hostKey(r.website);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    added++;
    out.push({
      name: r.name,
      website: r.website,
      ...(r.careers_url ? { careers: r.careers_url } : {}),
      ...(r.country ? { country: r.country } : {}),
      ...(r.city ? { city: r.city } : {}),
    });
  }

  if (added) log.info(`school sites: ${configured.length} configured + ${added} from the directory`);
  return out;
}

/** One entry per site, so a group's campuses are not all fetched separately. */
function hostKey(url: string | null | undefined): string | null {
  return hostOf(url) ?? null;
}

interface Anchor {
  url: string;
  text: string;
}

function anchors(html: string, base: string): Anchor[] {
  const out: Anchor[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]!.trim());
    if (!href || /^(?:mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    const text = htmlToText(m[2] ?? "").replace(/\s+/g, " ").trim();
    try {
      const abs = new URL(href, base);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      abs.hash = "";
      out.push({ url: abs.href, text });
    } catch {
      /* unparseable */
    }
  }
  return out;
}

/**
 * A line from a duties list rather than a job title.
 *
 * Careers pages embed the full advert, and its bullet points are full of
 * role words — "Follow the direction of the Head of Golf and the Director of
 * Sport" reads as a PE role to a naive matcher. Duty lines start with an
 * imperative verb, which titles never do.
 */
const DUTY_LINE =
  /^(?:follow|attend|assist|undertake|ensure|support|maintain|liaise|work\b|working\b|participate|provide|contribute|deliver|carry\s+out|develop|promote|monitor|report|prepare|plan|organis|organiz|oversee|perform|take\b|help|collaborate|other\s+(?:tasks|duties)|any\s+other|to\s+\w+|responsible|reporting)\b/i;

/** Job titles are short; a duty bullet or sentence is not. */
const MAX_TITLE_LENGTH = 70;

/** Headings and list items, for pages that list roles without linking them. */
function blocks(html: string): string[] {
  const out: string[] = [];
  const re = /<(h[2-5]|li|strong|td)\b[^>]*>([\s\S]{0,300}?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = htmlToText(m[2] ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 6 || text.length > MAX_TITLE_LENGTH) continue;
    if (DUTY_LINE.test(text)) continue;
    // A title is not a sentence.
    if (/[.!?]$/.test(text)) continue;
    out.push(text);
  }
  return out;
}

/** Find the careers page from the site root when one was not configured. */
async function discoverCareersPage(site: string, fresh?: boolean): Promise<string | null> {
  const html = await fetchText(site, {
    soft: true,
    fresh,
    retries: 1,
    timeoutMs: 15000,
    label: `school home ${site}`,
  });
  if (!html) return null;

  let origin: string;
  try {
    origin = new URL(site).origin;
  } catch {
    return null;
  }

  for (const a of anchors(html, site)) {
    if (!a.url.startsWith(origin)) continue;
    const hay = `${a.url} ${a.text}`;
    if (!CAREERS_LINK.test(hay)) continue;
    // "University and Careers" is student guidance, not recruitment.
    if (NOT_A_VACANCY.test(a.url) || STUDENT_CAREERS.test(a.url)) continue;
    return a.url;
  }
  return null;
}

/**
 * Strip the table furniture that comes with a role title.
 *
 * Careers pages are often tables, and the cell text arrives with its own
 * column heading attached: Globeducate produced "Job Title Physical Education
 * Primary Teacher" alongside the clean version, which then read as two
 * different vacancies because dedupe compares titles.
 */
export function cleanTitle(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:job\s*title|position(?:\s*title)?|role|vacancy|post)\s*[:\-–—]?\s*/i, "");
  // Trailing furniture: "Apply now", "Read more", "(View details)".
  t = t.replace(/\s*[-–—|]?\s*(?:apply(?:\s*now)?|read\s*more|view\s*(?:details|more|job)|more\s*info)\s*$/i, "");
  t = t.replace(/^[\s|>·•\-–—]+|[\s|<·•\-–—]+$/g, "").trim();
  return t.length >= 6 && t.length <= 140 ? t : "";
}

function toRawJob(school: SchoolEntry, title: string, url: string): RawJob {
  return {
    source: "schoolsite",
    // Stable per school + role so re-runs update rather than duplicate.
    sourceJobId: `${slugify(school.name)}-${slugify(title).slice(0, 60)}`,
    title,
    url,
    schoolName: school.name,
    country: school.country,
    city: school.city,
    schoolWebsite: school.website,
    raw: { via: "school careers page" },
  };
}

/** Scan one page for PE-linked roles. Returns how many were added. */
function scanPage(
  school: SchoolEntry,
  html: string,
  pageUrl: string,
  out: Map<string, RawJob>,
): number {
  let found = 0;
  const pageLinks = anchors(html, pageUrl);

  // A downloadable application form is usually linked once on the careers
  // page and applies to every vacancy listed there.
  const form = detectApplicationForm({
    links: pageLinks.map((a) => ({ url: a.url, text: a.text })),
    text: htmlToText(html),
  });

  const remember = (rawTitle: string, url: string): void => {
    const title = cleanTitle(rawTitle);
    if (!title) return;
    const job = toRawJob(school, title, url);
    if (form.kind !== "none") job.applicationForm = form;
    if (!out.has(job.sourceJobId)) {
      out.set(job.sourceJobId, job);
      found++;
    }
  };

  // Linked roles, including PDF job descriptions.
  for (const a of pageLinks) {
    const text = a.text;
    if (!text || text.length < 6 || text.length > 140) continue;
    if (DUTY_LINE.test(text)) continue;
    if (NOT_A_VACANCY.test(a.url) || STUDENT_CAREERS.test(a.url)) continue;
    if (!ROLE_SHAPED.test(text)) continue;
    if (!classify(text).isPe) continue;
    remember(text, a.url);
  }

  // Roles listed as plain text, with the page itself as the link.
  for (const text of blocks(html)) {
    if (!ROLE_SHAPED.test(text)) continue;
    if (!classify(text).isPe) continue;
    remember(text, pageUrl);
  }

  return found;
}

/** Up to this many category pages are followed from a careers landing page. */
const MAX_CATEGORY_PAGES = 3;

async function collectSchool(
  school: SchoolEntry,
  ctx: ScrapeContext,
  out: Map<string, RawJob>,
): Promise<void> {
  const careers =
    school.careers ?? (await discoverCareersPage(school.website, ctx.fresh));

  if (!careers) {
    log.debug(`${school.name}: no careers page found`);
    return;
  }

  const read = (url: string, label: string) =>
    fetchText(url, { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 20000, label });

  const html = await read(careers, `careers ${school.name}`);
  if (!html) {
    log.debug(`${school.name}: could not read ${careers}`);
    return;
  }

  let found = scanPage(school, html, careers, out);

  // Many schools list only category headings and keep the roles a click away.
  let origin: string;
  try {
    origin = new URL(careers).origin;
  } catch {
    origin = "";
  }

  const categories = anchors(html, careers)
    .filter((a) => a.url.startsWith(origin) && a.url !== careers)
    .filter((a) => !NOT_A_VACANCY.test(a.url) && !STUDENT_CAREERS.test(a.url))
    .filter((a) => VACANCY_CATEGORY.test(`${a.text} ${a.url}`))
    .filter((a) => !/\.(?:pdf|docx?|jpe?g|png)$/i.test(a.url));

  const seen = new Set<string>([careers]);
  let visited = 0;

  for (const category of categories) {
    if (visited >= MAX_CATEGORY_PAGES) break;
    if (seen.has(category.url)) continue;
    seen.add(category.url);

    const sub = await read(category.url, `careers ${school.name} / ${category.text.slice(0, 30)}`);
    if (!sub) continue;
    visited++;
    found += scanPage(school, sub, category.url, out);
  }

  if (found) log.info(`${school.name}: ${found} PE-linked (${1 + visited} page${visited ? "s" : ""})`);
  else log.debug(`${school.name}: nothing PE-linked on ${careers}`);
}

export const schoolSitesSource: Source = {
  id: "schoolsite",
  label: "School careers pages",
  note: "Target schools checked directly — they often post before the boards. Edit config/schools.json.",

  async collect(ctx: ScrapeContext): Promise<RawJob[]> {
    const schools = schoolsToCheck();
    if (!schools.length) {
      log.info("no schools configured — add some to config/schools.json");
      return [];
    }

    log.info(`checking ${schools.length} school careers pages…`);
    const out = new Map<string, RawJob>();

    for (const school of schools) {
      if (ctx.maxJobs && out.size >= ctx.maxJobs) break;
      try {
        await collectSchool(school, ctx, out);
      } catch (err) {
        log.warn(`${school.name}: ${(err as Error).message}`);
      }
    }

    log.info(`school sites: ${out.size} PE-linked vacancies`);
    return [...out.values()];
  },
};
