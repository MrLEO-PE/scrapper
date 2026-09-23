/**
 * "Is this the same school we already have?"
 *
 * A school reaches the database from two directions — a vacancy on a board and
 * a country listing in the directory — and the two rarely agree on the name or
 * even the country. Left alone they become two rows, which is worse than
 * untidy: the evidence splits, so the job row holds the salary while the
 * directory row holds the accreditation, and neither can be ranked on what is
 * actually known about the school.
 *
 * Matching is deliberately conservative. A missed merge leaves a duplicate,
 * which is visible and fixable; a wrong merge silently fuses two real schools
 * and there is no way to tell afterwards.
 */

import { hostOf, schoolCore, slugify } from "../core/text.ts";

export interface SchoolIdentity {
  schoolKey: string;
  name: string;
  country?: string | null;
  city?: string | null;
  website?: string | null;
  origin?: string | null;
}

/** Why two records were judged the same, for the log and the merge note. */
export type MatchReason = "same name, country unknown" | "same name and website" | "same website";

export interface Match {
  existing: SchoolIdentity;
  reason: MatchReason;
}

const norm = (s?: string | null): string | undefined => {
  const t = s?.trim();
  return t ? slugify(t) : undefined;
};

/**
 * Do these two records describe one school?
 *
 * `peersOnHost` is how many distinct school names share the candidate's
 * website. A school's own domain carries one or two names; a shared applicant
 * tracking domain carries many — `jobs.basisinternationalschools.com` serves
 * thirteen different BASIS schools — so a busy host cannot identify anything
 * on its own.
 */
export function sameSchool(
  a: SchoolIdentity,
  b: SchoolIdentity,
  peersOnHost = 1,
): MatchReason | undefined {
  if (a.schoolKey === b.schoolKey) return undefined; // already one row

  const coreA = schoolCore(a.name);
  const coreB = schoolCore(b.name);
  const countryA = norm(a.country);
  const countryB = norm(b.country);
  const hostA = hostOf(a.website);
  const hostB = hostOf(b.website);
  const sameHost = !!hostA && hostA === hostB;

  // Two campuses of one group sit on one domain under one brand. If both name
  // a city and the cities differ, they are different schools whatever else
  // matches.
  const cityA = norm(a.city);
  const cityB = norm(b.city);
  if (cityA && cityB && cityA !== cityB) return undefined;

  if (coreA === coreB) {
    // The usual case: a board gave no country, the directory did.
    if (!countryA || !countryB) return "same name, country unknown";
    if (countryA === countryB) return "same name, country unknown";
    // Same name, different countries. Only the website can settle it —
    // otherwise this is Lincoln School in Nepal and Lincoln School in Costa
    // Rica, which are genuinely unrelated.
    return sameHost ? "same name and website" : undefined;
  }

  // Different names on one domain: a school written two ways, such as "United
  // World College of South East Asia" and "UWC South East Asia". Only trust
  // this when the domain is not shared with a crowd.
  if (sameHost && peersOnHost <= 2) return "same website";

  return undefined;
}

/**
 * Pick which of two records to keep.
 *
 * The directory row wins, because its country came from the country page that
 * was fetched, while a vacancy's location is free text a board typed. That
 * distinction is the whole reason Life Plus — a school in China — was filed
 * under the United Arab Emirates and ranked fifth there.
 */
export function preferred(a: SchoolIdentity, b: SchoolIdentity): SchoolIdentity {
  if (a.origin === b.origin) return a;
  return a.origin === "directory" ? a : b;
}

/** The best match for a candidate among existing rows, if any. */
export function findMatch(
  candidate: SchoolIdentity,
  existing: SchoolIdentity[],
  peersOnHost = 1,
): Match | undefined {
  for (const row of existing) {
    const reason = sameSchool(candidate, row, peersOnHost);
    if (reason) return { existing: row, reason };
  }
  return undefined;
}
