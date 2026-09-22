/**
 * TES Jobs (tes.com/jobs).
 *
 * The jobs board is a Next.js app backed by a public tRPC endpoint that the
 * page itself calls. We query it directly, which avoids HTML parsing entirely
 * and gives us structured records.
 *
 * International scoping needs BOTH `locations: ["International"]` and the
 * matching `filters.location` object — the array alone is ignored by the API.
 *
 * robots.txt allows /jobs/browse, /jobs/vacancy and /jobs/api.
 */

import { fetchJson, fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { htmlToText, toIso, uniq } from "../core/text.ts";
import { classify } from "../match/classify.ts";
import type { RawJob, Salary } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const API = "https://www.tes.com/jobs/api/trpc/jobs.search";
const ORIGIN = "https://www.tes.com";

/** The literal filter object the site sends for "International". */
const INTERNATIONAL_LOCATION = {
  lat: 0,
  lon: 0,
  name: "International",
  distanceUnit: "mi",
  distance: 30,
};

interface TesJob {
  id: number;
  title: string;
  shortDescription?: string;
  displayLocation?: string;
  displaySalary?: string;
  contractTerms?: string[];
  contractTypes?: string[];
  canonicalUrl: string;
  employer?: { name?: string };
  salary?: { range?: { min?: number; max?: number; currency?: string } | null };
  advert?: { startDate?: string; endDate?: string };
  application?: { closeDate?: string };
}

interface TesResponse {
  result?: { data?: { json?: { numFound: number; totalPages: number; currentPage: number; jobs: TesJob[] } } };
}

interface Probe {
  label: string;
  subjects: string[];
  keywords: string;
  positions: string[];
}

/**
 * Several passes, unioned. The subject facet catches classroom PE; the keyword
 * passes catch sport leadership roles that schools file under other subjects
 * (a "Director of Sport" is often tagged Senior Leadership, not PE).
 */
const PROBES: Probe[] = [
  { label: "subject:Physical Education", subjects: ["Physical Education"], keywords: "", positions: [] },
  { label: "keyword:head of sport", subjects: [], keywords: "head of sport", positions: [] },
  { label: "keyword:director of sport", subjects: [], keywords: "director of sport", positions: [] },
  { label: "keyword:head of physical education", subjects: [], keywords: "head of physical education", positions: [] },
  { label: "keyword:sports coordinator", subjects: [], keywords: "sports coordinator", positions: [] },
  { label: "keyword:athletic director", subjects: [], keywords: "athletic director", positions: [] },
  { label: "keyword:games teacher", subjects: [], keywords: "games teacher", positions: [] },
];

function buildUrl(probe: Probe, page: number): string {
  const input = {
    json: {
      limit: 20,
      filters: {
        keywords: probe.keywords,
        excludedLocations: [],
        locations: ["International"],
        filters: {
          contractTerms: [],
          contractTypes: [],
          subjects: probe.subjects,
          workplaces: [],
          positions: probe.positions,
          location: INTERNATIONAL_LOCATION,
        },
        sort: "relevance",
        page,
      },
      siteCountry: "gb",
    },
  };
  return `${API}?input=${encodeURIComponent(JSON.stringify(input))}`;
}

function parseSalary(job: TesJob): Salary | undefined {
  const range = job.salary?.range;
  const text = job.displaySalary?.trim();
  if (!range && !text) return undefined;
  const s: Salary = {};
  if (range?.min != null) s.min = range.min;
  if (range?.max != null) s.max = range.max;
  if (range?.currency) s.currency = range.currency;
  if (text) s.text = text;
  return s;
}

function toRawJob(job: TesJob): RawJob {
  return {
    source: "tes",
    sourceJobId: String(job.id),
    title: job.title,
    url: ORIGIN + job.canonicalUrl,
    schoolName: job.employer?.name,
    city: job.displayLocation,
    // TES gives one display string ("Dubai, United Arab Emirates"); the country
    // is resolved downstream in normalise().
    country: job.displayLocation,
    description: job.shortDescription,
    postedAt: toIso(job.advert?.startDate),
    deadlineAt: toIso(job.application?.closeDate ?? job.advert?.endDate),
    salary: parseSalary(job),
    contractType: job.contractTypes?.join(", "),
    contractTerm: job.contractTerms?.join(", "),
    raw: job,
  };
}

/**
 * Pull the full record from a vacancy page.
 *
 * This is where TES becomes the richest source: the detail page carries the
 * school's website and postal country, the address applications should go to,
 * and links to the job-description and prospectus PDFs — all of which the
 * search API omits.
 */
async function fetchDetail(job: RawJob, fresh: boolean): Promise<void> {
  const html = await fetchText(job.url, { soft: true, fresh, label: `tes detail ${job.sourceJobId}` });
  if (!html) return;

  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m?.[1]) return;

  try {
    const data = JSON.parse(m[1]) as any;
    const item = data?.props?.pageProps?.job?.item;
    if (!item) return;

    if (typeof item.description === "string" && item.description.length > (job.description?.length ?? 0)) {
      job.description = htmlToText(item.description);
    }

    const emails: string[] = [...(job.schoolEmails ?? [])];

    // The address the school actually wants applications sent to.
    const appContact = item.application?.contact;
    if (appContact?.email) emails.push(appContact.email);
    if (item.application?.url) job.applicationUrl ??= item.application.url;

    const employer = item.employer;
    if (employer) {
      const contact = employer.contact ?? {};
      if (contact.website) job.schoolWebsite ??= contact.website;

      const loc = contact.location ?? {};
      if (loc.country) job.country = loc.country;
      if (loc.cityTown) job.city = loc.cityTown;

      // The employer blurb often states curriculum and roll size.
      if (typeof employer.description === "string") {
        job.description = `${job.description ?? ""}\n\n${htmlToText(employer.description)}`.trim();
      }
    }

    // Job packs and prospectuses — read downstream for emails and school facts.
    const attachments = [...(item.attachments ?? []), ...(employer?.attachments ?? [])];
    const docs = attachments
      .filter((a: any) => a?.url && !/\.(?:png|jpe?g|gif|webp|svg)(?:$|\?)/i.test(a.url))
      .map((a: any) => String(a.url));
    if (docs.length) job.attachments = uniq([...(job.attachments ?? []), ...docs]);

    if (emails.length) job.schoolEmails = uniq(emails);
  } catch (err) {
    log.debug(`tes: detail parse failed for ${job.url}: ${(err as Error).message}`);
  }
}

export const tesSource: Source = {
  id: "tes",
  label: "TES Jobs",
  note: "Public tRPC API, International filter. Strongest source for British-curriculum schools.",

  async collect(ctx: ScrapeContext): Promise<RawJob[]> {
    const byId = new Map<string, RawJob>();

    for (const probe of PROBES) {
      let page = 1;
      let totalPages = 1;

      do {
        const res = await fetchJson<TesResponse>(buildUrl(probe, page), {
          fresh: ctx.fresh,
          soft: true,
          label: `tes ${probe.label} p${page}`,
        });
        const data = res?.result?.data?.json;
        if (!data) {
          log.warn(`tes: no data for ${probe.label} page ${page}`);
          break;
        }
        totalPages = data.totalPages || 1;
        for (const j of data.jobs ?? []) {
          const raw = toRawJob(j);
          if (!byId.has(raw.sourceJobId)) byId.set(raw.sourceJobId, raw);
        }
        log.debug(`tes ${probe.label} p${page}/${totalPages}: ${data.jobs?.length ?? 0} jobs (${data.numFound} found)`);
        page++;
        if (ctx.maxJobs && byId.size >= ctx.maxJobs) break;
      } while (page <= totalPages);

      if (ctx.maxJobs && byId.size >= ctx.maxJobs) break;
    }

    const jobs = [...byId.values()];
    log.info(`tes: ${jobs.length} international vacancies across ${PROBES.length} probes`);

    if (ctx.deep) {
      // The keyword probes return a lot of non-PE noise. Classify on the search
      // snippet first so we only spend a request on vacancies we would keep.
      const worthFetching = jobs.filter((j) => classify(j.title, j.description ?? "").isPe);
      log.info(`tes: fetching ${worthFetching.length} detail pages (of ${jobs.length})…`);
      let done = 0;
      for (const job of worthFetching) {
        await fetchDetail(job, ctx.fresh);
        if (++done % 10 === 0) log.debug(`tes: ${done}/${worthFetching.length} details`);
      }
    }
    return jobs;
  },
};
