/**
 * SAP SuccessFactors career sites.
 *
 * Several of the large international school groups run their recruitment on
 * SuccessFactors, and they all expose the same server-rendered search page —
 * so one parser serves all of them. Adding another group is a single entry in
 * SUCCESSFACTORS_SITES below.
 *
 * These are the employers rather than a job board, which makes them a useful
 * complement to TES and Teach Away: roles appear here that never reach an
 * aggregator, and the school is named directly.
 *
 * The results page carries title, school, location and contract per row, so a
 * detail page is fetched only for roles that classify as PE — the same
 * economy used for TES.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { decodeEntities, htmlToText, toIso } from "../core/text.ts";
import type { RawJob, SourceId } from "../core/types.ts";
import { classify } from "../match/classify.ts";
import type { ScrapeContext, Source } from "./base.ts";

export interface SuccessFactorsSite {
  id: SourceId;
  label: string;
  origin: string;
  note: string;
}

export const SUCCESSFACTORS_SITES: SuccessFactorsSite[] = [
  {
    id: "nordanglia",
    label: "Nord Anglia Education",
    origin: "https://careers.nordanglia.com",
    note: "Group careers site — 80+ international schools worldwide.",
  },
  {
    id: "inspired",
    label: "Inspired Education",
    origin: "https://jobs.inspirededu.com",
    note: "Group careers site — schools across Europe, LatAm, Africa and Asia.",
  },
];

/** SuccessFactors returns 25 rows per page. */
const PAGE_SIZE = 25;
const MAX_PAGES = 40;

interface Row {
  id: string;
  title: string;
  path: string;
  fields: Record<string, string>;
}

const clean = (s: string): string =>
  decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Parse the job rows out of a results page.
 *
 * Each row is anchored by `<a class="jobTitle-link" ... href="/job/…/{id}/">`,
 * and its other fields live in elements id'd `job-{id}-desktop-section-{name}-value`.
 */
function parseRows(html: string): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();

  const linkRe = /<a\b[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html))) {
    const path = decodeEntities(m[1]!.trim());
    const title = clean(m[2] ?? "");
    if (!path || !title) continue;

    // /job/{slug}/{id}/ — the trailing numeric segment is the job id.
    const idMatch = /\/(\d{4,})\/?$/.exec(path);
    const id = idMatch?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const fields: Record<string, string> = {};
    const fieldRe = new RegExp(
      `id="job-${id}-desktop-section-([a-z]+)-value"[^>]*>([\\s\\S]{0,300}?)</(?:div|span)>`,
      "gi",
    );
    let f: RegExpExecArray | null;
    while ((f = fieldRe.exec(html))) {
      const value = clean(f[2] ?? "");
      if (value) fields[f[1]!.toLowerCase()] = value;
    }

    rows.push({ id, title, path, fields });
  }
  return rows;
}

/** "Barcelona, ES" / "Abu Dhabi, AE" -> city + country token. */
function splitLocation(value?: string): { city?: string; country?: string } {
  if (!value) return {};
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts.slice(0, -1).join(", "), country: parts[parts.length - 1] };
  }
  return { city: parts[0] };
}

function toRawJob(site: SuccessFactorsSite, row: Row): RawJob {
  const { city, country } = splitLocation(row.fields.location);
  // `facility` is the school; without it the group itself is the employer.
  const school = row.fields.facility || site.label;

  return {
    source: site.id,
    sourceJobId: row.id,
    title: row.title,
    url: site.origin + row.path,
    schoolName: school,
    city,
    country,
    contractType: row.fields.shifttype,
    contractTerm: row.fields.department,
    raw: row,
  };
}

/** Fetch a job page for its full advert text and posting date. */
async function fetchDetail(job: RawJob, fresh: boolean): Promise<void> {
  const html = await fetchText(job.url, {
    soft: true,
    fresh,
    retries: 1,
    timeoutMs: 20000,
    label: `sf detail ${job.sourceJobId}`,
  });
  if (!html) return;

  // SuccessFactors marks its fields with data-careersite-propertyid.
  const pick = (prop: string): string | undefined => {
    const re = new RegExp(
      `data-careersite-propertyid="${prop}"[^>]*>([\\s\\S]{0,20000}?)</(?:span|div|p)>`,
      "i",
    );
    const m = re.exec(html);
    return m?.[1];
  };

  const description = pick("description");
  if (description) {
    const text = htmlToText(description);
    if (text.length > (job.description?.length ?? 0)) job.description = text;
  }

  const date = pick("date");
  if (date) job.postedAt = toIso(clean(date)) ?? job.postedAt;

  // Fall back to the whole advert body if the marked-up field was not found.
  if (!job.description) {
    const body = /<span class="jobdescription"[^>]*>([\s\S]*?)<\/span>/i.exec(html);
    if (body?.[1]) job.description = htmlToText(body[1]);
  }
}

export function createSuccessFactorsSource(site: SuccessFactorsSite): Source {
  return {
    id: site.id,
    label: site.label,
    note: site.note,

    async collect(ctx: ScrapeContext): Promise<RawJob[]> {
      const byId = new Map<string, RawJob>();

      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${site.origin}/search/?q=&startrow=${page * PAGE_SIZE}`;
        const html = await fetchText(url, {
          fresh: ctx.fresh,
          soft: true,
          retries: 1,
          timeoutMs: 30000,
          label: `${site.id} p${page + 1}`,
        });
        if (!html) break;

        const rows = parseRows(html);
        if (!rows.length) break;

        let added = 0;
        for (const row of rows) {
          if (byId.has(row.id)) continue;
          byId.set(row.id, toRawJob(site, row));
          added++;
        }
        log.debug(`${site.id} p${page + 1}: ${rows.length} rows (${added} new)`);

        // A page that adds nothing means we have wrapped past the end.
        if (added === 0) break;
        if (rows.length < PAGE_SIZE) break;
        if (ctx.maxJobs && byId.size >= ctx.maxJobs) break;
      }

      const jobs = [...byId.values()];
      log.info(`${site.id}: ${jobs.length} vacancies listed`);

      if (ctx.deep) {
        // Only PE-linked roles are worth a detail request.
        const worth = jobs.filter((j) => classify(j.title).isPe);
        log.info(`${site.id}: fetching ${worth.length} detail pages (of ${jobs.length})…`);
        for (const job of worth) await fetchDetail(job, ctx.fresh);
      }
      return jobs;
    },
  };
}

export const successFactorsSources: Source[] = SUCCESSFACTORS_SITES.map(createSuccessFactorsSource);
