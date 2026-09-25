/**
 * Schools recorded by hand, for the places the databases do not reach.
 *
 * The two directories between them miss whole countries. The International
 * Schools Database returns nothing for New Delhi, Mumbai, Bangalore, Colombo,
 * Kathmandu, Dhaka, Sydney or Auckland; Teach Away lists only schools that
 * advertise with it. That is a real gap, and for a list whose purpose is not
 * to miss a good school, "no source covers it" is not an acceptable answer.
 *
 * So this file is the third route: a school can be added by name, from
 * research, an association's member list, a colleague, anywhere. What it
 * cannot do is enter the database unverified — every entry without a website
 * goes through the same discovery and page check as a guessed one, and is
 * dropped if it cannot be confirmed. A name without a verified school behind
 * it is a rumour, and a rumour that reaches the sheet is indistinguishable
 * from a fact.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./core/logger.ts";

export interface KnownSchool {
  name: string;
  country: string;
  city?: string;
  /** Skip discovery when the address is already known and checked. */
  website?: string;
  /** Where the name came from, so a bad entry can be traced. */
  via?: string;
  note?: string;
  /** Set false to keep an entry on file without using it. */
  on?: boolean;
}

const PATH = join(process.cwd(), "config", "known-schools.json");

export function loadKnownSchools(): KnownSchool[] {
  if (!existsSync(PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(PATH, "utf8")) as { schools?: KnownSchool[] };
    return (parsed.schools ?? []).filter((s) => s.on !== false && s.name && s.country);
  } catch (err) {
    log.warn(`could not read ${PATH}: ${(err as Error).message}`);
    return [];
  }
}

/** Record a resolved website against an entry, so discovery runs once. */
export function rememberWebsite(name: string, country: string, website: string): void {
  if (!existsSync(PATH)) return;
  try {
    const file = JSON.parse(readFileSync(PATH, "utf8")) as { schools?: KnownSchool[] };
    const hit = (file.schools ?? []).find(
      (s) => s.name === name && s.country === country,
    );
    if (!hit || hit.website) return;
    hit.website = website;
    writeFileSync(PATH, JSON.stringify(file, null, 2) + "\n");
  } catch (err) {
    log.debug(`could not record ${name}'s website: ${(err as Error).message}`);
  }
}
