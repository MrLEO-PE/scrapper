/**
 * Country salary benchmarks — what to expect where, when nobody publishes it.
 *
 * Per-school salary is not public data for international schools. A sweep of
 * job packs, school websites and salary aggregators produced figures for 9 of
 * 521 schools. So the honest fallback is the country average, clearly labelled
 * as one.
 *
 * Two limits are worth stating plainly, because the number looks more precise
 * than it is:
 *
 *   - It is self-reported by teachers and unaudited. The `reports` count is
 *     carried into the sheet so a figure standing on five submissions is not
 *     mistaken for a survey.
 *   - It is identical for every school in a country, so it cannot rank schools
 *     against each other. Within-country ranking stays on package terms and
 *     accreditation.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";
import type { SourcedSalary } from "./salary.ts";

export interface CountryBenchmark {
  avg: number;
  low: number;
  high: number;
  reports: number;
}

interface BenchmarkFile {
  minReports?: number;
  source?: string;
  sourceUrl?: string;
  retrieved?: string;
  countries?: Record<string, CountryBenchmark | string>;
}

const PATH = join(process.cwd(), "config", "salary-benchmarks.json");

let cache: BenchmarkFile | null = null;

function load(): BenchmarkFile {
  if (cache) return cache;
  if (!existsSync(PATH)) return (cache = {});
  try {
    cache = JSON.parse(readFileSync(PATH, "utf8")) as BenchmarkFile;
  } catch (err) {
    log.warn(`could not read ${PATH}: ${(err as Error).message}`);
    cache = {};
  }
  return cache;
}

/** For tests and the watch loop, which stays up across runs. */
export function resetBenchmarks(): void {
  cache = null;
}

export interface BenchmarkHit {
  salary: SourcedSalary;
  reports: number;
  source: string;
}

/**
 * The published average for a country, or nothing.
 *
 * Returns nothing when too few teachers reported it: a single contract is not
 * a country average, and Bangladesh sitting at $88,000 on one submission would
 * have been the most eye-catching wrong number in the sheet.
 */
export function countryBenchmark(country: string | null | undefined): BenchmarkHit | null {
  if (!country) return null;
  const file = load();
  const entries = file.countries ?? {};
  const min = file.minReports ?? 5;

  const wanted = country.trim().toLowerCase();
  const found = Object.entries(entries).find(
    ([name, v]) => typeof v === "object" && name.toLowerCase() === wanted,
  );
  if (!found) return null;

  const b = found[1] as CountryBenchmark;
  if (!b.reports || b.reports < min) return null;

  return {
    reports: b.reports,
    source: file.source ?? "country benchmark",
    salary: {
      min: b.low,
      max: b.high,
      currency: "USD",
      period: "ANNUAL",
      basis: "country-benchmark",
      samples: b.reports,
      evidence:
        `${b.reports} teachers reporting from ${found[0]}, averaging ` +
        `USD ${b.avg.toLocaleString("en-GB")} — ${file.source ?? "self-reported"}` +
        (file.retrieved ? `, read ${file.retrieved}` : ""),
    },
  };
}

/** The headline average, for the sheet cell. */
export function benchmarkAverage(country: string | null | undefined): number | null {
  if (!country) return null;
  const entries = load().countries ?? {};
  const min = load().minReports ?? 5;
  const found = Object.entries(entries).find(
    ([name, v]) => typeof v === "object" && name.toLowerCase() === country.trim().toLowerCase(),
  );
  const b = found?.[1] as CountryBenchmark | undefined;
  return b && b.reports >= min ? b.avg : null;
}
