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
  /** Present when the figure comes from a pool of teacher submissions. */
  reports?: number;
  /** "reported" from submissions, or "sourced" from named published figures. */
  basis?: "reported" | "sourced";
  /** What a teacher typically keeps after rent and tax, [low, high]. */
  savings?: [number, number];
  /** An independent source's figure, for triangulation. */
  crosscheck?: string;
  /** Which entry in `sources` a "sourced" figure came from. */
  via?: string;
  note?: string;
}

interface BenchmarkFile {
  sources?: Record<string, { label: string; url?: string }>;
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
  /** 0 for a figure taken from named published sources rather than a pool. */
  reports: number;
  source: string;
  savings?: [number, number];
  crosscheck?: string;
}

interface SourceRef { label: string; url?: string }

/** The country entry, if it exists and is solid enough to publish. */
function entryFor(country: string | null | undefined): [string, CountryBenchmark] | null {
  if (!country) return null;
  const file = load();
  const wanted = country.trim().toLowerCase();
  if (!wanted || wanted.startsWith("//")) return null;

  const found = Object.entries(file.countries ?? {}).find(
    ([name, v]) => !name.startsWith("//") && typeof v === "object" && name.toLowerCase() === wanted,
  );
  if (!found) return null;

  const b = found[1] as CountryBenchmark;
  // A figure from named published sources has no submission pool to count, so
  // the threshold applies only to the self-reported kind.
  if (b.basis !== "sourced" && (!b.reports || b.reports < (file.minReports ?? 5))) return null;
  return [found[0], b];
}

/**
 * The published average for a country, or nothing.
 *
 * Returns nothing when too few teachers reported it: a single contract is not
 * a country average, and Bangladesh sitting at $88,000 on one submission would
 * have been the most eye-catching wrong number in the sheet.
 */
export function countryBenchmark(country: string | null | undefined): BenchmarkHit | null {
  const hit = entryFor(country);
  if (!hit) return null;
  const [name, b] = hit;
  const file = load();
  const n = (v: number) => v.toLocaleString("en-GB");

  // Say where the number came from in the cell itself, so it can be argued
  // with rather than taken on trust.
  const sourced = b.basis === "sourced";
  const ref = (sourced && b.via ? (file.sources ?? {})[b.via] : undefined) as SourceRef | undefined;
  const evidence = sourced
    ? `USD ${n(b.avg)} for ${name} — ${ref?.label ?? "published figures"}` +
      (b.note ? `. ${b.note}` : "")
    : `${b.reports} teachers reporting from ${name}, averaging USD ${n(b.avg)} — ` +
      `${file.source ?? "self-reported"}${file.retrieved ? `, read ${file.retrieved}` : ""}`;

  return {
    reports: b.reports ?? 0,
    source: ref?.label ?? file.source ?? "country benchmark",
    savings: b.savings,
    crosscheck: b.crosscheck,
    salary: {
      min: b.low,
      max: b.high,
      currency: "USD",
      period: "ANNUAL",
      basis: "country-benchmark",
      samples: b.reports ?? 0,
      evidence: b.crosscheck ? `${evidence}. Cross-check — ${b.crosscheck}` : evidence,
    },
  };
}

/** The headline average, for the sheet cell. */
export function benchmarkAverage(country: string | null | undefined): number | null {
  return entryFor(country)?.[1].avg ?? null;
}

/** What a teacher typically keeps there, after rent and tax. */
export function benchmarkSavings(country: string | null | undefined): [number, number] | null {
  return entryFor(country)?.[1].savings ?? null;
}
