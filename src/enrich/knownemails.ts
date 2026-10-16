/**
 * Careers addresses found by hand.
 *
 * Some schools print their recruitment address only where a crawler cannot go
 * — inside the job-description PDF attached to a vacancy for another subject,
 * on a board's login-only page, in a recruiter's brochure. When you spot one,
 * it goes in config/school-emails.json and the enrichment treats it as the
 * school's careers address, ahead of anything the crawl guessed.
 *
 * Same rule as school-websites.json: an address copied from a document the
 * school itself published, never one worked out from a pattern.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";
import type { DiscoveredEmail } from "../core/types.ts";

export interface KnownEmail {
  email: string;
  /** Where it was read: "job brochure PDF on TES", "careers page", … */
  via: string;
  note?: string;
  found?: string;
}

const PATH = join(process.cwd(), "config", "school-emails.json");
let cache: Record<string, KnownEmail> | null = null;

function load(): Record<string, KnownEmail> {
  if (cache) return cache;
  cache = {};
  if (!existsSync(PATH)) return cache;
  try {
    const parsed = JSON.parse(readFileSync(PATH, "utf8")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("//") || typeof value !== "object" || !value) continue;
      const entry = value as KnownEmail;
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(entry.email ?? "")) cache[key] = entry;
    }
  } catch (err) {
    log.warn(`could not read ${PATH}: ${(err as Error).message}`);
  }
  return cache;
}

/** The hand-found careers address for a school, shaped like a crawled one but outranking it. */
export function knownCareerEmail(schoolKey: string): DiscoveredEmail | undefined {
  const known = load()[schoolKey];
  if (!known) return undefined;
  return { email: known.email.toLowerCase(), kind: "careers", score: 1, foundAt: known.via, via: "source" };
}
