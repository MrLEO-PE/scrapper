/**
 * Did every source actually do its job this run?
 *
 * A scrape that "succeeds" can still be broken: a board changes its markup and
 * returns nothing, a feed moves, a login wall appears. Nothing errors — the
 * source just reports 0 scanned, the run summary looks fine, and the gap goes
 * unnoticed for weeks (Teacher Horizons did exactly this: 17 vacancies every
 * run, then 0).
 *
 * The rule is relative, because each board is a different size: a source is
 * unhealthy when it scans far fewer vacancies than it usually does, judged
 * against its own recent runs. A board that has always been small is not
 * flagged for being small.
 */

import { getDb } from "./store/db.ts";

export interface SourceHealth {
  source: string;
  status: "ok" | "failed" | "empty" | "low" | "new";
  scanned: number;
  /** The median scanned across recent runs, or null with too little history. */
  usual: number | null;
  message: string;
}

/** Recent runs to compare against. */
const HISTORY = 10;
/** Fewer than this many runs of history says nothing about "usual". */
const MIN_HISTORY = 3;
/** A source this small is too noisy to judge by a count. */
const MIN_USUAL = 5;
/** Below this share of its usual size, a source is "low". */
const LOW_SHARE = 0.4;

type BySource = Record<string, { raw: number; pe: number; failed?: string }>;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Pure, so it can be tested without a database. */
export function judge(source: string, latest: BySource[string] | undefined, history: number[]): SourceHealth {
  if (!latest) return { source, status: "ok", scanned: 0, usual: null, message: "not run this time" };

  const usual = history.length >= MIN_HISTORY ? median(history) : null;

  if (latest.failed) {
    return { source, status: "failed", scanned: 0, usual, message: `failed: ${latest.failed}` };
  }
  if (usual === null) {
    return { source, status: "new", scanned: latest.raw, usual, message: `${latest.raw} scanned (too little history to judge)` };
  }
  if (usual >= MIN_USUAL && latest.raw === 0) {
    return { source, status: "empty", scanned: 0, usual, message: `returned 0 vacancies — it usually returns about ${Math.round(usual)}` };
  }
  if (usual >= MIN_USUAL && latest.raw < usual * LOW_SHARE) {
    return { source, status: "low", scanned: latest.raw, usual, message: `returned ${latest.raw} vacancies — it usually returns about ${Math.round(usual)}` };
  }
  return { source, status: "ok", scanned: latest.raw, usual, message: `${latest.raw} scanned` };
}

/** Health of every source in the most recent scrape, against the runs before it. */
export function checkHealth(): SourceHealth[] {
  const rows = getDb()
    .prepare("SELECT stats_json FROM runs WHERE mode = 'scrape' AND stats_json IS NOT NULL ORDER BY id DESC LIMIT ?")
    .all(HISTORY + 1) as { stats_json: string }[];

  const parsed = rows
    .map((r) => {
      try {
        return (JSON.parse(r.stats_json) as { bySource?: BySource }).bySource;
      } catch {
        return undefined;
      }
    })
    .filter((b): b is BySource => !!b);
  if (!parsed.length) return [];

  const [latest, ...earlier] = parsed;
  return Object.keys(latest!).map((source) =>
    judge(
      source,
      latest![source],
      // A failed run is not a data point for what "usual" looks like.
      earlier.filter((b) => b[source] && !b[source]!.failed).map((b) => b[source]!.raw),
    ),
  );
}

export const problems = (h: SourceHealth[]): SourceHealth[] => h.filter((x) => ["failed", "empty", "low"].includes(x.status));

export function healthMarkdown(h: SourceHealth[]): string {
  const bad = problems(h);
  return [
    `${bad.length} source${bad.length === 1 ? "" : "s"} did not run as usual in the latest scrape:`,
    "",
    ...bad.map((x) => `- **${x.source}** — ${x.message}`),
    "",
    "A board that suddenly returns nothing has usually changed its page or feed, so the roles it carried are not being picked up. Open the run log to see what it printed.",
  ].join("\n");
}
