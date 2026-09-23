/**
 * European Chamber of Commerce in China — job vacancies board.
 *
 * Mostly commercial roles, but member international schools (Dulwich Beijing
 * among them) post teaching vacancies here, and the whole board is a single
 * server-rendered page. One request per run for occasional finds the big
 * boards miss.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { decodeEntities, htmlToText } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import type { ScrapeContext, Source } from "./base.ts";

const ORIGIN = "https://www.europeanchamber.com.cn";
const BOARD = `${ORIGIN}/en/job-vacancies`;

/** /en/job-vacancies/{id}/{Title_With_Underscores} */
const JOB_HREF = /href="(\/en\/job-vacancies\/(\d+)\/([^"]*))"/gi;

function titleFromSlug(slug: string, anchorText: string): string {
  const fromAnchor = anchorText.replace(/\s+/g, " ").trim();
  if (fromAnchor.length > 4) return fromAnchor;
  // Fall back to the URL slug: underscores stand in for spaces.
  return decodeURIComponent(slug)
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const europeanChamberSource: Source = {
  id: "europeanchamber",
  label: "European Chamber China",
  note: "Member-company board; international schools in China post here occasionally.",

  async collect(ctx: ScrapeContext): Promise<RawJob[]> {
    const html = await fetchText(BOARD, {
      fresh: ctx.fresh,
      soft: true,
      retries: 1,
      timeoutMs: 25000,
      label: "european chamber board",
    });
    if (!html) {
      log.warn("european chamber: board page unavailable");
      return [];
    }

    const out = new Map<string, RawJob>();
    let m: RegExpExecArray | null;
    JOB_HREF.lastIndex = 0;

    while ((m = JOB_HREF.exec(html))) {
      const [, path, id, slug] = m;
      if (!id || out.has(id)) continue;

      // The anchor text sits just after the href in these cards.
      const after = html.slice(m.index, m.index + 600);
      const anchorText = htmlToText(/>([^<]{4,120})</.exec(after)?.[1] ?? "");

      out.set(id, {
        source: "europeanchamber",
        sourceJobId: id,
        title: titleFromSlug(slug ?? "", anchorText),
        url: ORIGIN + decodeEntities(path!),
        // The board is China-wide; the advert names the city.
        country: "China",
        raw: { path },
      });
    }

    log.info(`european chamber: ${out.size} vacancies listed`);
    return [...out.values()];
  },
};
