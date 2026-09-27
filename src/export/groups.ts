/**
 * Which big group a school belongs to.
 *
 * Who owns a school is a fact about the job, not about the building. A group
 * school runs a group pay scale, a central HR desk that may recruit for every
 * campus at once, and an internal transfer route between countries — so
 * "Nord Anglia" beside a name tells you things the phase never will.
 *
 * Kept out of the Accreditation column on purpose. Cognia accredits schools
 * owned by many different companies, so it describes a standard a school
 * meets, not who pays the staff. Cognita, one letter away, is an owner. The
 * two belong in different columns and the confusion between them is exactly
 * why this file exists.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";

export interface SchoolGroup {
  name: string;
  re: RegExp;
}

const PATH = join(process.cwd(), "config", "school-groups.json");

let cache: SchoolGroup[] | null = null;

export function loadGroups(): SchoolGroup[] {
  if (cache) return cache;
  cache = [];
  if (!existsSync(PATH)) return cache;

  try {
    const raw = JSON.parse(readFileSync(PATH, "utf8")) as { groups?: { name?: string; match?: string }[] };
    for (const g of raw.groups ?? []) {
      if (!g.name || !g.match) continue;
      try {
        cache.push({ name: g.name, re: new RegExp(g.match, "i") });
      } catch {
        // A bad pattern is the editor's mistake to see, not a reason to lose
        // every other group.
        log.warn(`school-groups.json: "${g.name}" has an unreadable match pattern and was skipped`);
      }
    }
  } catch (err) {
    log.warn(`school-groups.json could not be read: ${(err as Error).message}`);
  }
  return cache;
}

/** Only for tests, which write their own config. */
export function forgetGroups(): void {
  cache = null;
}

/**
 * The group a school belongs to, or nothing.
 *
 * Matched against the name and the website together, because some groups are
 * obvious in the domain and invisible in the name.
 */
export function schoolGroup(name?: string | null, website?: string | null): string | undefined {
  const haystack = `${name ?? ""} ${website ?? ""}`;
  if (!haystack.trim()) return undefined;
  return loadGroups().find((g) => g.re.test(haystack))?.name;
}
