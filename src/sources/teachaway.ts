/**
 * Teach Away (teachaway.com).
 *
 * The job board is a Next.js App Router page. Its React Flight payload embeds
 * the *complete* job records — school profile, curriculum, salary, benefits and
 * the school's recruitment email — so one board request yields far more than
 * the rendered HTML shows.
 *
 * Two passes:
 *   1. the `phys-ed` subject filter, paginated (rich, structured records);
 *   2. a sitemap slug sweep for sport roles filed under another subject, read
 *      from each page's schema.org JobPosting.
 *
 * A third pass over the unfiltered board was tried and removed: sweeping 229
 * distinct titles across the whole board surfaced exactly the same PE roles the
 * subject filter already returns, including the leadership ones. It cost ~50
 * extra requests per run for nothing, so the subject filter is trusted.
 *
 * robots.txt allows everything except /api, /trpc-me and a few utility paths.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { htmlToText, toIso, uniq } from "../core/text.ts";
import type { RawJob, Salary } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://www.teachaway.com";
const BOARD = (subject: string, page: number) =>
  `${ORIGIN}/teaching-jobs-abroad/all-countries/all-positions/${subject}/any-level` +
  (page > 1 ? `?page=${page}` : "");
const SITEMAP = `${ORIGIN}/schools/sitemap-jobs.xml`;

/** Slugs worth fetching when they are not already in the phys-ed results. */
const SLUG_HINTS =
  /(?:^|-)(?:pe|phys|physical-education|sport|sports|athletic|athletics|games|coach|swim|swimming|basketball|football|soccer|netball|rugby|cricket|tennis|volleyball|gymnastics|fitness)(?:-|$)/;

interface TaJob {
  id: number;
  title: string;
  slug: string;
  description?: string;
  minSalaryAmount?: number;
  maxSalaryAmount?: number;
  salaryFrequency?: string;
  hideSalary?: boolean;
  otherBenefits?: string;
  countryId?: string;
  locality?: string;
  startDate?: string;
  applicationDeadline?: string;
  lastPublishedDate?: string;
  sortDate?: string;
  applicationUrl?: string | null;
  numberOfVacancies?: number;
  contractType?: string;
  type?: string;
  currency?: { code?: string };
  benefits?: { benefit?: { name?: string } }[];
  subjects?: { subject?: { name?: string; slug?: string } }[];
  curriculums?: { curriculum?: { name?: string } }[];
  gradeLevels?: { gradeLevel?: { name?: string } }[];
  school?: {
    schoolName?: string;
    slug?: string;
    schoolProfiles?: {
      website?: string;
      orgType?: string;
      type?: string;
      country?: string;
      locality?: string;
      description?: string;
      notifEmailAddresses?: string[];
      notifJobEmail?: string[];
      brochures?: unknown[];
      intAccreditations?: string;
    }[];
  };
}

/**
 * Concatenate every `self.__next_f.push([1,"…"])` chunk back into the original
 * Flight stream. Written as a hand-rolled scanner because the chunks contain
 * escaped quotes that a regex would mis-split.
 */
function readFlight(html: string): string {
  const marker = "self.__next_f.push([1,";
  let out = "";
  let i = 0;
  while ((i = html.indexOf(marker, i)) !== -1) {
    const start = i + marker.length;
    if (html[start] !== '"') {
      i = start;
      continue;
    }
    let j = start + 1;
    while (j < html.length) {
      if (html[j] === "\\") {
        j += 2;
        continue;
      }
      if (html[j] === '"') break;
      j++;
    }
    try {
      out += JSON.parse(html.slice(start, j + 1)) as string;
    } catch {
      /* skip a malformed chunk */
    }
    i = j + 1;
  }
  return out;
}

/** Index of the character after the JSON value starting at `start`. */
function endOfValue(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Pull every job object out of the Flight stream by finding a field unique to
 * job records and walking back to the enclosing `{`.
 */
function extractJobs(flight: string): TaJob[] {
  const found = new Map<number, TaJob>();
  const NEEDLE = '"postingType"';
  let i = 0;

  while ((i = flight.indexOf(NEEDLE, i)) !== -1) {
    let parsed: TaJob | null = null;
    let end = -1;

    // Walk backwards to the opening brace of the object containing the needle.
    for (let k = i; k >= 0 && i - k < 300_000; k--) {
      if (flight[k] !== "{") continue;
      const stop = endOfValue(flight, k);
      if (stop <= i) continue;
      try {
        parsed = JSON.parse(flight.slice(k, stop)) as TaJob;
        end = stop;
      } catch {
        continue; // not a complete object; keep walking out
      }
      break;
    }

    if (parsed?.slug && typeof parsed.id === "number") {
      if (!found.has(parsed.id)) found.set(parsed.id, parsed);
      i = end > i ? end : i + NEEDLE.length;
    } else {
      i += NEEDLE.length;
    }
  }
  return [...found.values()];
}

function salaryOf(j: TaJob): Salary | undefined {
  if (j.hideSalary) return undefined;
  if (j.minSalaryAmount == null && j.maxSalaryAmount == null) return undefined;
  const s: Salary = { period: j.salaryFrequency, currency: j.currency?.code };
  if (j.minSalaryAmount != null) s.min = j.minSalaryAmount;
  if (j.maxSalaryAmount != null) s.max = j.maxSalaryAmount;
  return s;
}

function toRawJob(j: TaJob): RawJob {
  const profile = j.school?.schoolProfiles?.[0];
  const benefits = uniq([
    ...(j.benefits ?? []).map((b) => b.benefit?.name).filter((x): x is string => !!x),
    ...(j.otherBenefits ? [htmlToText(j.otherBenefits)] : []),
  ]).filter(Boolean);

  const emails = uniq([
    ...(profile?.notifJobEmail ?? []),
    ...(profile?.notifEmailAddresses ?? []),
  ]).filter((e) => typeof e === "string" && e.includes("@"));

  return {
    source: "teachaway",
    sourceJobId: String(j.id),
    title: j.title,
    url: `${ORIGIN}/teaching-jobs-abroad/${j.slug}`,
    schoolName: j.school?.schoolName,
    country: j.countryId ?? profile?.country,
    city: j.locality ?? profile?.locality,
    description: j.description ? htmlToText(j.description) : undefined,
    postedAt: toIso(j.lastPublishedDate ?? j.sortDate),
    deadlineAt: toIso(j.applicationDeadline),
    startDate: toIso(j.startDate),
    salary: salaryOf(j),
    contractType: j.type ?? j.contractType,
    curriculum: uniq((j.curriculums ?? []).map((c) => c.curriculum?.name).filter((x): x is string => !!x)),
    gradeLevels: uniq((j.gradeLevels ?? []).map((g) => g.gradeLevel?.name).filter((x): x is string => !!x)),
    benefits,
    schoolWebsite: profile?.website,
    schoolEmails: emails,
    applicationUrl: j.applicationUrl ?? undefined,
    raw: j,
  };
}

/** Fallback reader for a single job page, using its schema.org JobPosting. */
function fromJsonLd(html: string, url: string): RawJob | null {
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      const o = node as any;
      if (o?.["@type"] !== "JobPosting") continue;
      const addr = o.jobLocation?.address ?? {};
      return {
        source: "teachaway",
        sourceJobId: String(o.identifier?.value ?? url.split("/").pop()),
        title: String(o.title ?? ""),
        url: String(o.url ?? url),
        schoolName: o.hiringOrganization?.name,
        country: addr.addressCountry,
        city: addr.addressLocality,
        description: o.description ? htmlToText(String(o.description)) : undefined,
        postedAt: toIso(o.datePosted),
        deadlineAt: toIso(o.validThrough),
        contractType: o.employmentType,
        raw: o,
      };
    }
  }
  return null;
}

async function boardPass(subject: string, ctx: ScrapeContext, out: Map<string, RawJob>): Promise<void> {
  for (let page = 1; page <= 60; page++) {
    const html = await fetchText(BOARD(subject, page), {
      fresh: ctx.fresh,
      soft: true,
      label: `teachaway ${subject} p${page}`,
    });
    if (!html) break;

    const jobs = extractJobs(readFlight(html));
    if (!jobs.length) break;

    let added = 0;
    for (const j of jobs) {
      const raw = toRawJob(j);
      if (!out.has(raw.sourceJobId)) {
        out.set(raw.sourceJobId, raw);
        added++;
      }
    }
    log.debug(`teachaway ${subject} p${page}: ${jobs.length} jobs (${added} new)`);

    // A page that adds nothing new means we've wrapped around the end.
    if (added === 0) break;
    if (jobs.length < 20) break;
    if (ctx.maxJobs && out.size >= ctx.maxJobs) break;
  }
}

async function sitemapPass(ctx: ScrapeContext, out: Map<string, RawJob>): Promise<void> {
  const xml = await fetchText(SITEMAP, { fresh: ctx.fresh, soft: true, label: "teachaway sitemap" });
  if (!xml) return;

  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
  const known = new Set([...out.values()].map((j) => j.url));
  const candidates = urls.filter((u) => {
    if (known.has(u)) return false;
    const slug = u.split("/").pop() ?? "";
    return SLUG_HINTS.test(slug);
  });

  log.info(`teachaway: ${candidates.length} extra PE-ish slugs from sitemap (${urls.length} total)`);

  for (const url of candidates) {
    if (ctx.maxJobs && out.size >= ctx.maxJobs) break;
    const html = await fetchText(url, { fresh: ctx.fresh, soft: true, label: `teachaway ${url}` });
    if (!html) continue;

    // Prefer the embedded record; fall back to JSON-LD.
    const [embedded] = extractJobs(readFlight(html));
    const raw = embedded ? toRawJob(embedded) : fromJsonLd(html, url);
    if (raw && !out.has(raw.sourceJobId)) out.set(raw.sourceJobId, raw);
  }
}

export const teachawaySource: Source = {
  id: "teachaway",
  label: "Teach Away",
  note: "Board records carry school profile, curriculum, salary, benefits and recruitment email.",

  async collect(ctx: ScrapeContext): Promise<RawJob[]> {
    const out = new Map<string, RawJob>();
    await boardPass("phys-ed", ctx, out);
    log.info(`teachaway: ${out.size} from the phys-ed filter`);
    await sitemapPass(ctx, out);
    log.info(`teachaway: ${out.size} vacancies total`);
    return [...out.values()];
  },
};
