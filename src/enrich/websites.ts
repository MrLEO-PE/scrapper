/**
 * Websites for schools whose listing does not carry one.
 *
 * This is the difference between a row of names and a usable record. The crawl
 * is what finds the careers email, the package and any published pay figure, and
 * it cannot start without an address: 263 of 401 profiled schools had no website
 * stored, and every one of them came back empty.
 *
 * Teach Away does not publish these, and neither do its per-school pages, so
 * they are filled in here — by lookup where a school is in an open dataset, by
 * hand where it is not. The file is plain JSON so it can be edited directly.
 *
 * What this is NOT is a place to guess. An address that turns out to belong to
 * a different school poisons everything downstream: the wrong careers email,
 * the wrong package, the wrong salary, all looking exactly as confident as the
 * right ones. Every entry records where it came from.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";

export interface WebsiteEntry {
  /** The school's own site. Omit when it genuinely has none. */
  url?: string;
  /**
   * A Facebook or Instagram page, for a school that has no website at all.
   * Recorded so there is somewhere to send you; never fetched, because those
   * platforms forbid automated collection.
   */
  social?: string;
  /** Where this came from: "wikidata", "search", "manual". */
  via: string;
  /** When it was established, so a stale entry can be spotted. */
  found?: string;
}

const PATH = join(process.cwd(), "config", "school-websites.json");

let cache: Record<string, WebsiteEntry> | null = null;

function load(): Record<string, WebsiteEntry> {
  if (cache) return cache;
  if (!existsSync(PATH)) return (cache = {});
  try {
    const parsed = JSON.parse(readFileSync(PATH, "utf8")) as Record<string, unknown>;
    const out: Record<string, WebsiteEntry> = {};
    for (const [key, value] of Object.entries(parsed)) {
      // Keys beginning "//" are notes in the file, not schools.
      if (key.startsWith("//") || typeof value !== "object" || !value) continue;
      const entry = value as WebsiteEntry;
      // One or the other is enough: a school with only a Facebook page is
      // exactly the case this file exists for.
      if (entry.url || entry.social) out[key] = entry;
    }
    cache = out;
  } catch (err) {
    log.warn(`could not read ${PATH}: ${(err as Error).message}`);
    cache = {};
  }
  return cache;
}

export function resetWebsites(): void {
  cache = null;
}

/** The known website for a school, if one has been established. */
export function knownWebsite(schoolKey: string): WebsiteEntry | undefined {
  return load()[schoolKey];
}

export function websiteCount(): number {
  return Object.keys(load()).length;
}

/** Add or replace entries, keeping the file readable and sorted. */
export function saveWebsites(found: Record<string, WebsiteEntry>): number {
  const existing = load();
  const merged = { ...existing, ...found };
  const sorted: Record<string, unknown> = {
    "//": "Websites for schools whose directory listing carries none, so the crawl can run.",
    "//via": "wikidata = matched in an open dataset; search = found and verified by hand; manual = entered directly.",
    "//warning": "A wrong address is worse than none: it produces a confident careers email for the wrong school. Verify before adding.",
  };
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];

  writeFileSync(PATH, JSON.stringify(sorted, null, 2) + "\n");
  cache = merged;
  return Object.keys(merged).length - Object.keys(existing).length;
}
