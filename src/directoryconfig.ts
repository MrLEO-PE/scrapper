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
