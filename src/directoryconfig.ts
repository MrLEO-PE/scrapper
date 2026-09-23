/**
 * The standing directory's targets: which countries, how many schools each.
 *
 * Kept separate from `locations.json`, which scopes live vacancy searches.
 * The two answer different questions — "where would I take a job?" versus
 * "which schools should I know about?" — and conflating them made it awkward
 * to research a country without also scraping its adverts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./core/logger.ts";

export interface DirectoryTarget {
  name: string;
  /** Ceiling, not a promise: whatever the directory lists is taken, up to this. */
  top: number;
  cities?: string[];
  /** Override the directory URL slug when it differs from the name. */
  slug?: string;
  on?: boolean;
}

const PATH = join(process.cwd(), "config", "directory.json");

export function loadDirectoryTargets(): DirectoryTarget[] {
  if (!existsSync(PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(PATH, "utf8")) as { countries?: DirectoryTarget[] };
    return (parsed.countries ?? [])
      .filter((c) => c.on !== false && c.name)
      .map((c) => ({ ...c, top: Number(c.top) > 0 ? Number(c.top) : 30 }));
  } catch (err) {
    log.warn(`could not read ${PATH}: ${(err as Error).message}`);
    return [];
  }
}

/** Total schools the configuration asks for, before availability caps it. */
export function plannedTotal(targets: DirectoryTarget[]): number {
  return targets.reduce((sum, t) => sum + t.top, 0);
}

/**
 * The countries you actually care about, for filtering what gets shown.
 *
 * The school table holds more than the directory collected: a vacancy anywhere
 * in the world creates a school row, so Chile, Zimbabwe and Oman turn up in a
 * list that is meant to answer "where should I be teaching, out of the places
 * I would move to". Those rows are worth keeping — their vacancies are real —
 * but they do not belong in the top-schools list.
 */
export function targetCountries(): Set<string> {
  return new Set(loadDirectoryTargets().map((t) => t.name.toLowerCase()));
}

/** Country aliases the boards use that the directory config does not. */
const ALIASES = new Map([
  ["turkiye", "türkiye"],
  ["turkey", "türkiye"],
  ["korea, republic of", "south korea"],
  ["republic of korea", "south korea"],
  ["viet nam", "vietnam"],
  ["timor leste", "timor-leste"],
  ["east timor", "timor-leste"],
  ["lao people's democratic republic", "laos"],
  ["micronesia, federated states of", "micronesia"],
  ["federated states of micronesia", "micronesia"],
]);

export function isTargetCountry(country: string | null | undefined, targets: Set<string>): boolean {
  if (!country) return false;
  const c = country.trim().toLowerCase();
  return targets.has(c) || targets.has(ALIASES.get(c) ?? "");
}
