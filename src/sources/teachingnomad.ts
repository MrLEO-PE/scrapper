/**
 * Teaching Nomad (jobs.teachingnomad.com).
 *
 * Small but unusually rich. Most boards publish a title and a country and
 * leave pay to the imagination; this one states a salary range, and whether
 * housing, flights and a visa are provided — the three benefits that decide
 * what an international package is actually worth. Those fields feed the
 * package scoring directly, which no other source does.
 *
 * Its focus is Asia, which is where most of the configured countries are.
 *
 * The vacancies arrive embedded in the React Flight payload, twenty a page.
 * The board's front page only ever shows the newest twenty, which is all this
 * read at first. reverse-api-engineer found that the search page,
 * www.teachingnomad.com/jobs?page=N, pages through the whole board in the same
 * payload, so every page is now read until one comes back empty. robots.txt
 * allows /jobs and disallows only /api and the account pages.
 */

import { fetchText } from "../core/http.ts";
import type { RawJob, Salary } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const BOARD = "https://jobs.teachingnomad.com/";
const SEARCH = "https://www.teachingnomad.com/jobs";
/** 45 vacancies made three pages in November 2026; the cap only stops a runaway. */
const MAX_PAGES = 20;

/**
 * Reassemble the Flight stream from its `self.__next_f.push([1,"…"])` chunks.
 *
 * Hand-rolled rather than a regex because the chunks contain escaped quotes
 * that a regex would split in the wrong place.
 */
export function readFlight(html: string): string {
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
      /* one malformed chunk should not cost the rest */
    }
    i = j + 1;
  }
  return out;
}

export interface NomadJob {
  id?: string;
  slug?: string;
  title?: string;
  country?: string;
  city?: string;
  subject?: string[];
  gradeLevels?: string[];
  curriculum?: string[];
  startDate?: string;
  postedAt?: string;
  salaryMinUsdCents?: number;
  salaryMaxUsdCents?: number;
  salaryDisplay?: string;
  housingProvided?: boolean;
  flightsProvided?: boolean;
  visaSponsorshipProvided?: boolean;
  employer?: { name?: string };
}

/**
 * Pull the vacancy objects out of the payload.
 *
 * The stream is not valid JSON as a whole, so the objects are found by their
 * shape — a `slug` and a `title` together — and each is scanned to its
 * matching brace and parsed on its own.
 */
export function extractJobs(flight: string): NomadJob[] {
  const out: NomadJob[] = [];
  const seen = new Set<string>();

  for (const m of flight.matchAll(/"slug":"[a-z0-9-]+"/g)) {
    // Walk back to the opening brace of the object this slug belongs to.
    let start = m.index!;
    let depth = 0;
    while (start > 0) {
      const ch = flight[start];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) break;
        depth--;
      }
      start--;
    }
    if (flight[start] !== "{") continue;

    let end = start;
    let open = 0;
    while (end < flight.length) {
      const ch = flight[end];
      if (ch === "{") open++;
      else if (ch === "}") {
        open--;
        if (open === 0) break;
      }
      end++;
    }

    try {
      const job = JSON.parse(flight.slice(start, end + 1)) as NomadJob;
      const key = job.id ?? job.slug;
      if (!job.title || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(job);
    } catch {
      /* not a whole object — skip it */
    }
  }
  return out;
}

/** Cents of US dollars a year, as the board stores pay. */
function salaryOf(j: NomadJob): Salary | undefined {
  const min = j.salaryMinUsdCents, max = j.salaryMaxUsdCents;
  if (min == null && max == null) return j.salaryDisplay ? { text: j.salaryDisplay } : undefined;
  return {
    ...(min != null ? { min: Math.round(min / 100) } : {}),
    ...(max != null ? { max: Math.round(max / 100) } : {}),
    currency: "USD",
    period: "year",
    ...(j.salaryDisplay ? { text: j.salaryDisplay } : {}),
  };
}

/** The three that decide what a package is worth, where the board states them. */
function benefitsOf(j: NomadJob): string[] {
  const out: string[] = [];
  if (j.housingProvided) out.push("Housing provided");
  if (j.flightsProvided) out.push("Flights provided");
  if (j.visaSponsorshipProvided) out.push("Visa sponsorship provided");
  return out;
}

export function toRawJob(j: NomadJob): RawJob | null {
  const id = j.id ?? j.slug;
  if (!id || !j.title) return null;
  const benefits = benefitsOf(j);

  return {
    source: "teachingnomad",
    sourceJobId: id,
    title: j.title,
    url: j.slug ? `${BOARD}jobs/${j.slug}` : BOARD,
    schoolName: j.employer?.name,
    country: j.country,
    city: j.city,
    postedAt: j.postedAt,
    startDate: j.startDate,
    salary: salaryOf(j),
    curriculum: j.curriculum?.length ? j.curriculum : undefined,
    gradeLevels: j.gradeLevels?.length ? j.gradeLevels : undefined,
    ...(benefits.length ? { benefits } : {}),
    // The board carries no prose, so the structured fields are the description.
    description: [j.subject?.join(", "), j.gradeLevels?.join(", "), j.curriculum?.join(", ")]
      .filter(Boolean)
      .join(" · ") || undefined,
    raw: j as unknown as Record<string, unknown>,
  };
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const jobs = new Map<string, RawJob>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchText(page > 1 ? `${SEARCH}?page=${page}` : SEARCH, {
      soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 25000, label: `teachingnomad p${page}`,
    });
    if (!html) break;

    const before = jobs.size;
    for (const j of extractJobs(readFlight(html))) {
      const job = toRawJob(j);
      if (job) jobs.set(job.sourceJobId, job);
    }
    // An empty page, or one adding nothing new, is the end of the board.
    if (jobs.size === before) break;
    if (ctx.maxJobs && jobs.size >= ctx.maxJobs) break;
  }

  const out = [...jobs.values()];
  return ctx.maxJobs ? out.slice(0, ctx.maxJobs) : out;
}

export const teachingNomadSource: Source = {
  id: "teachingnomad",
  label: "Teaching Nomad",
  note: "the whole board, twenty a page; carries salary and package benefits",
  collect,
};
