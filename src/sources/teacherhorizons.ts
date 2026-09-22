/**
 * Teacher Horizons (teacherhorizons.com).
 *
 * This source is deliberately limited, and it is worth knowing why.
 *
 * The site is an Angular SPA with no server-side rendering, so the HTML pages
 * carry no vacancy content at all. Its full job search lives behind
 * `/th/api/jobs`, which (a) returns 401 without a signed-in session and (b) is
 * explicitly disallowed by robots.txt, along with `/jobs/*`.
 *
 * What IS public and robots-allowed is `/th/api/v1/jobs` — the feed the site
 * uses for its own "latest vacancies" widget. It ignores every pagination
 * parameter and always returns the newest ~20 postings. That is what we read by
 * default: small, but legitimate and genuinely fresh.
 *
 * Running this daily still gives good coverage of new TH postings over time,
 * because the database keeps everything it has ever seen.
 *
 * If you have a Teacher Horizons account and want the full search, set
 * TH_COOKIE to your own session cookie and pass `--th-authenticated`. That
 * reads the site as you, rather than as an anonymous crawler. It is off by
 * default and never enabled implicitly.
 */

import { fetchJson } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { htmlToText, toIso } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://www.teacherhorizons.com";
const PUBLIC_FEED = `${ORIGIN}/th/api/v1/jobs`;
const AUTHED_SEARCH = `${ORIGIN}/th/api/jobs`;

interface ThJob {
  id: number;
  title: string;
  furtherInfo?: string;
  startDate?: string;
  deadline?: number;
  lastUpdatedDate?: number;
  subjectId?: number;
  roleId?: number;
  isRemote?: number;
  city?: {
    name?: string;
    country?: { name?: string; region?: { name?: string } };
  };
  school?: { name?: string; slug?: string; website?: string };
}

/**
 * The public feed carries service listings ("CV Review Service") alongside real
 * vacancies. They are not jobs and must not reach the sheet.
 */
const NOT_A_VACANCY = /\b(?:cv\s+review|coaching\s+session|webinar|service|consultation|membership)\b/i;

function toRawJob(j: ThJob): RawJob | null {
  const title = (j.title ?? "").trim();
  if (!title) return null;

  const info = j.furtherInfo ? htmlToText(j.furtherInfo) : undefined;
  if (NOT_A_VACANCY.test(title) || /this is not a job vacancy/i.test(info ?? "")) {
    log.debug(`teacherhorizons: skipping non-vacancy "${title}"`);
    return null;
  }

  return {
    source: "teacherhorizons",
    sourceJobId: String(j.id),
    title,
    // TH job pages are behind /jobs/* which robots disallows; link to the
    // board so the user can open it themselves in a browser.
    url: `${ORIGIN}/jobs/${j.id}`,
    schoolName: j.school?.name,
    country: j.city?.country?.name,
    city: j.city?.name,
    description: info,
    postedAt: toIso(j.lastUpdatedDate),
    deadlineAt: toIso(j.deadline),
    startDate: j.startDate,
    schoolWebsite: j.school?.website,
    raw: j,
  };
}

export const teacherHorizonsSource: Source = {
  id: "teacherhorizons",
  label: "Teacher Horizons",
  note: "Public latest-vacancies feed only (~20 newest). Full search needs a login and is robots-disallowed — run daily to accumulate.",

  async collect(ctx: ScrapeContext): Promise<RawJob[]> {
    const out = new Map<string, RawJob>();

    const feed = await fetchJson<{ jobs?: ThJob[] }>(PUBLIC_FEED, {
      fresh: ctx.fresh,
      soft: true,
      // Short TTL: this endpoint is a rolling window, so a stale cache costs us
      // postings that have already scrolled off.
      ttlMs: 30 * 60 * 1000,
      label: "teacherhorizons public feed",
    });

    for (const j of feed?.jobs ?? []) {
      const raw = toRawJob(j);
      if (raw) out.set(raw.sourceJobId, raw);
    }
    log.info(`teacherhorizons: ${out.size} vacancies from the public feed`);

    const cookie = process.env.TH_COOKIE;
    if (process.env.TH_AUTHENTICATED === "1" && cookie) {
      log.info("teacherhorizons: authenticated mode on (using your TH_COOKIE session)");
      const res = await fetchJson<{ data?: unknown[] }>(
        `${AUTHED_SEARCH}?page[size]=100&include=school,city,subject`,
        {
          fresh: ctx.fresh,
          soft: true,
          ignoreRobots: true, // user-authorised, acting as their own account
          headers: { cookie, accept: "application/vnd.api+json, application/json" },
          label: "teacherhorizons authed search",
        },
      );
      const rows = res?.data;
      if (!rows?.length) {
        log.warn("teacherhorizons: authenticated call returned nothing — the cookie may have expired");
      } else {
        log.ok(`teacherhorizons: ${rows.length} vacancies from the authenticated search`);
        for (const row of rows as any[]) {
          const a = row.attributes ?? row;
          const raw = toRawJob({ id: row.id ?? a.id, ...a } as ThJob);
          if (raw) out.set(raw.sourceJobId, raw);
        }
      }
    }

    return [...out.values()];
  },
};
