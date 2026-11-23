/**
 * Harrow International Schools in Asia (AISL), career.aisl-edu.com.
 *
 * Asia International School Limited runs the Harrow-branded schools in
 * Beijing, Shanghai, Hong Kong, Shenzhen, Guangzhou, Haikou, Chongqing,
 * Nanning, Hengqin, Bangkok and Appi (Japan). Its recruitment portal's home
 * page lists every opening as plain HTML, grouped by campus in an accordion
 * ("AISL Harrow Beijing (11 openings)"), so one request reads them all.
 * robots.txt says Allow: /.
 *
 * The group's old address in the config, harrowschools.com, does not resolve;
 * that was why Harrow looked blocked.
 */

import { fetchText } from "../core/http.ts";
import { htmlToText } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://career.aisl-edu.com";

export interface HarrowRow {
  id: string;
  title: string;
  campus: string;
  fn?: string;
  division?: string;
  closes?: string;
}

/** Every opening on the portal's home page, with the campus panel it sits in. */
export function rowsFrom(html: string): HarrowRow[] {
  const out: HarrowRow[] = [];
  for (const panel of html.split('<div class="panel panel-default">').slice(1)) {
    const heading = panel.match(/<h4 class="panel-title">([\s\S]*?)<\/h4>/)?.[1];
    if (!heading) continue;
    const campus = htmlToText(heading).replace(/\(\d+ openings?\)/i, "").replace(/^AISL\s+/, "").trim();
    for (const tr of panel.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
      const link = tr.match(/href="\/job\/modalView\/(\d+)">([\s\S]*?)<\/a>/);
      if (!link) continue;
      const cells = [...tr.matchAll(/<td class="vertical-middle text-center">\s*([\s\S]*?)\s*<\/td>/g)].map((m) => htmlToText(m[1]!).trim());
      const clean = (s?: string) => (s && s !== "-" ? s : undefined);
      out.push({ id: link[1]!, title: htmlToText(link[2]!).trim(), campus, fn: clean(cells[0]), division: clean(cells[1]), closes: clean(cells[3]) });
    }
  }
  return out;
}

/** The country a campus name places it in. */
export function countryOf(campus: string): string {
  if (/hong kong/i.test(campus) && !/shenzhen/i.test(campus)) return "Hong Kong";
  if (/bangkok/i.test(campus)) return "Thailand";
  if (/appi/i.test(campus)) return "Japan";
  return "China";
}

/** "30/11/2026" -> "2026-11-30". */
export function isoDate(d?: string): string | undefined {
  const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

async function collect(ctx: ScrapeContext): Promise<RawJob[]> {
  const html = await fetchText(`${ORIGIN}/`, { soft: true, fresh: ctx.fresh, retries: 1, timeoutMs: 30000, label: "harrow aisl" });
  if (!html) return [];
  const jobs = rowsFrom(html).map((r): RawJob => ({
    source: "harrow",
    sourceJobId: r.id,
    title: r.title,
    url: `${ORIGIN}/job/modalView/${r.id}`,
    schoolName: /^harrow/i.test(r.campus) ? r.campus : `Harrow ${r.campus}`,
    country: countryOf(r.campus),
    deadlineAt: isoDate(r.closes),
    applicationUrl: `${ORIGIN}/site/beforeLogin/${r.id}`,
    raw: r as unknown as Record<string, unknown>,
  }));
  return ctx.maxJobs ? jobs.slice(0, ctx.maxJobs) : jobs;
}

export const harrowSource: Source = {
  id: "harrow",
  label: "Harrow International (AISL)",
  note: "group recruitment portal, every campus on one page; campus and closing date named",
  collect,
};
