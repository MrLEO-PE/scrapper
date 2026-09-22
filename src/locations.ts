/**
 * The country / city tick list.
 *
 * Drives two things:
 *   - which places a scrape or directory build targets;
 *   - filling in a country when a board only gave us a city name (TES often
 *     says "Lo Barnechea" and nothing else).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./core/logger.ts";
import { slugify } from "./core/text.ts";

export interface CountryEntry {
  code: string;
  name: string;
  region: string;
  on: boolean;
  cities: string[];
}

interface LocationsFile {
  countries: CountryEntry[];
  [key: string]: unknown;
}

// Resolved locally rather than via config.ts so that normalize.ts can use the
// city index without pulling in the export/database import chain.
const PATH = join(process.cwd(), "config", "locations.json");

let cache: LocationsFile | null = null;

export function loadLocations(): LocationsFile {
  if (cache) return cache;
  if (!existsSync(PATH)) {
    log.warn(`missing ${PATH} — no locations configured`);
    cache = { countries: [] };
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(PATH, "utf8")) as LocationsFile;
    if (!Array.isArray(cache.countries)) cache.countries = [];
  } catch (err) {
    log.error(`could not parse ${PATH}: ${(err as Error).message}`);
    cache = { countries: [] };
  }
  return cache;
}

function save(data: LocationsFile): void {
  writeFileSync(PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  cache = data;
  log.ok(`saved ${PATH}`);
}

export function allCountries(): CountryEntry[] {
  return loadLocations().countries;
}

/** Countries currently ticked. Empty means "no filter — everywhere". */
export function selectedCountries(): CountryEntry[] {
  return allCountries().filter((c) => c.on);
}

/** Resolve a user token (code, name or slug) to a country entry. */
export function findCountry(token: string): CountryEntry | undefined {
  const t = token.trim().toLowerCase();
  const s = slugify(token);
  return allCountries().find(
    (c) => c.code.toLowerCase() === t || c.name.toLowerCase() === t || slugify(c.name) === s,
  );
}

export function setCountries(tokens: string[], on: boolean, exclusive = false): void {
  const data = loadLocations();
  const wanted = new Set<string>();
  const unknown: string[] = [];

  for (const token of tokens) {
    const hit = findCountry(token);
    if (hit) wanted.add(hit.code);
    else unknown.push(token);
  }
  if (unknown.length) log.warn(`not in the list: ${unknown.join(", ")}`);

  for (const c of data.countries) {
    if (exclusive) c.on = wanted.has(c.code);
    else if (wanted.has(c.code)) c.on = on;
  }
  save(data);
}

export function clearCountries(): void {
  const data = loadLocations();
  for (const c of data.countries) c.on = false;
  save(data);
}

/** Tick every country in a region, e.g. "Middle East". */
export function setRegion(region: string, on: boolean): number {
  const data = loadLocations();
  const target = region.trim().toLowerCase();
  let n = 0;
  for (const c of data.countries) {
    if (c.region.toLowerCase() === target) {
      c.on = on;
      n++;
    }
  }
  save(data);
  return n;
}

export function regions(): string[] {
  return [...new Set(allCountries().map((c) => c.region))];
}

// ---------------------------------------------------------------------------

let cityIndex: Map<string, CountryEntry> | null = null;

/**
 * City -> country lookup, built from the tick list. Lets us fill in a country
 * when a board reported only a city.
 */
export function countryForCity(city?: string): CountryEntry | undefined {
  if (!city) return undefined;
  if (!cityIndex) {
    cityIndex = new Map();
    for (const entry of allCountries()) {
      for (const name of entry.cities) {
        const key = slugify(name);
        // First country listing a city wins; the list has no real collisions.
        if (!cityIndex.has(key)) cityIndex.set(key, entry);
      }
    }
  }
  // Try the whole string, then each comma-separated part.
  const candidates = [city, ...city.split(",")].map((s) => slugify(s.trim())).filter(Boolean);
  for (const key of candidates) {
    const hit = cityIndex.get(key);
    if (hit) return hit;
  }
  return undefined;
}

/** The target filter a scrape/export should apply, from the ticked list. */
export function activeFilter(): { countries: string[]; cities: string[] } {
  const picked = selectedCountries();
  if (!picked.length) return { countries: [], cities: [] };
  return {
    countries: picked.map((c) => c.name),
    cities: [],
  };
}

export function printLocations(showCities: boolean): void {
  const countries = allCountries();
  const on = countries.filter((c) => c.on);

  log.step(`Countries (${on.length} of ${countries.length} ticked)`);
  let region = "";
  for (const c of countries) {
    if (c.region !== region) {
      region = c.region;
      log.plain(`\n  ${region.toUpperCase()}`);
    }
    const mark = c.on ? "[x]" : "[ ]";
    const cities = showCities ? `  ${c.cities.join(", ")}` : "";
    log.plain(`   ${mark} ${c.code}  ${c.name.padEnd(24)}${cities}`);
  }
  log.plain("");
  log.plain("  npm run locations -- --on AE,QA,SG        tick these");
  log.plain("  npm run locations -- --only AE            tick only this one");
  log.plain("  npm run locations -- --region \"Middle East\"");
  log.plain("  npm run locations -- --off AE            untick");
  log.plain("  npm run locations -- --clear             untick everything");
  log.plain("  npm run locations -- --list --cities     show city lists");
}
