import type { RawJob, SourceId } from "../core/types.ts";

export interface ScrapeContext {
  /** Ignore the HTTP cache. */
  fresh: boolean;
  /** Stop after this many jobs per source (0 = no limit). */
  maxJobs: number;
  /** Also fetch each vacancy's detail page for full text. Slower. */
  deep: boolean;
}

export interface Source {
  id: SourceId;
  label: string;
  /** Human-readable note shown in the run summary (limits, auth, etc.). */
  note?: string;
  collect(ctx: ScrapeContext): Promise<RawJob[]>;
}

export const DEFAULT_CONTEXT: ScrapeContext = { fresh: false, maxJobs: 0, deep: false };
