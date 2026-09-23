/**
 * RawJob -> Job: resolve location, classify the role, and build the identity
 * keys used for deduplication across boards.
 */

import { countryForCity } from "../locations.ts";
import { detectApplicationForm } from "../match/appform.ts";
import { classify } from "../match/classify.ts";
import { countryCode, countryName, schoolKey, slugify } from "./text.ts";
import type { Job, RawJob } from "./types.ts";

/** Words to drop from a title before comparing two postings. */
const TITLE_NOISE =
  /\b(?:urgent|immediate|asap|required|wanted|vacancy|job|position|role|opportunity|apply\s+now|new|hot|featured|maternity\s+cover|fixed\s+term|part[\s-]time|full[\s-]time|permanent|temporary|talent\s+pool|august|september|january|jan|aug|sept?|start(?:ing)?|academic\s+year|ay\s*\d{2,4}(?:[\/-]\d{2,4})?|20\d\d(?:[\/-]\d{2,4})?)\b/gi;

function titleKey(title: string): string {
  const cleaned = title
    .replace(/[\[\](){}|–—-]+/g, " ")
    .replace(TITLE_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return slugify(cleaned || title);
}

/**
 * Split a display location into country and city.
 *
 * TES hands back one string: "Dubai, United Arab Emirates", "United Arab
 * Emirates", or a bare region like "Shaanxi". We test segments from the right,
 * since the country is conventionally last.
 */
export function resolveLocation(
  rawCountry?: string,
  rawCity?: string,
): { country?: string; city?: string } {
  const direct = countryName(rawCountry);
  const directIsCountry = !!rawCountry && !!countryCode(rawCountry);

  if (directIsCountry) {
    const city = rawCity && rawCity !== rawCountry ? stripCountry(rawCity, direct!) : undefined;
    return { country: direct, city: city || undefined };
  }

  // Try to find a country inside the combined string.
  for (const candidate of [rawCountry, rawCity]) {
    if (!candidate) continue;
    const parts = candidate.split(",").map((s) => s.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const code = countryCode(parts[i]!);
      if (code) {
        const country = countryName(code)!;
        const city = parts.slice(0, i).join(", ").trim();
        return { country, city: city || undefined };
      }
    }
  }

  // No country recognised. Sources that expose a single display string (TES)
  // pass it as both fields; reporting "Dubai, Dubai" would be wrong, so treat
  // an unrecognised value as a city.
  const display = rawCity ?? rawCountry ?? "";
  const segments = display.split(",").map((s) => s.trim()).filter(Boolean);
  const city = segments[0];

  // Last resort: look the city up in the configured hub list, which turns a
  // bare "Lo Barnechea" into Chile.
  const viaCity = countryForCity(display) ?? countryForCity(city);
  if (viaCity) return { country: viaCity.name, city: city || undefined };

  const sameValue = !!rawCountry && !!rawCity && rawCountry.trim() === rawCity.trim();
  const country = sameValue ? undefined : rawCountry?.trim() || undefined;
  return { country, city: city || undefined };
}

function stripCountry(city: string, country: string): string {
  return city
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && slugify(s) !== slugify(country))
    .join(", ");
}

export interface NormalizeOptions {
  threshold?: number;
}

export function normalize(raw: RawJob, opts: NormalizeOptions = {}): Job {
  const { country, city } = resolveLocation(raw.country, raw.city);
  const pe = classify(raw.title, raw.description ?? "", { threshold: opts.threshold });
  // Detected here so every source benefits without repeating the logic.
  const applicationForm =
    raw.applicationForm ??
    detectApplicationForm({ attachments: raw.attachments, text: raw.description });
  const now = new Date().toISOString();

  // Some boards withhold the school until you are signed in (Teacher Horizons
  // does this by design). Those postings get a per-job key so they stay
  // distinct instead of collapsing into one "unknown school" bucket.
  const sKey = raw.schoolName
    ? schoolKey(raw.schoolName, country)
    : `unknown-${slugify(raw.source)}-${slugify(raw.sourceJobId)}`;

  return {
    ...raw,
    applicationForm,
    country,
    city,
    id: `${raw.source}:${raw.sourceJobId}`,
    // `schoolKey::titleKey` — db.ts splits on "::" to recover the school key.
    dedupeKey: `${sKey}::${titleKey(raw.title)}`,
    pe,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

/**
 * Collapse the same vacancy appearing on more than one board. Keeps the record
 * with the richest data and notes the other sources it was found on.
 */
export function dedupe(jobs: Job[]): { kept: Job[]; duplicates: number } {
  const groups = new Map<string, Job[]>();
  for (const job of jobs) {
    const g = groups.get(job.dedupeKey);
    if (g) g.push(job);
    else groups.set(job.dedupeKey, [job]);
  }

  const kept: Job[] = [];
  let duplicates = 0;

  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]!);
      continue;
    }
    // Richness = how many useful fields are populated.
    const score = (x: Job) =>
      (x.description?.length ?? 0) / 100 +
      (x.salary ? 5 : 0) +
      (x.benefits?.length ?? 0) +
      (x.schoolEmails?.length ?? 0) * 3 +
      (x.schoolWebsite ? 3 : 0) +
      (x.curriculum?.length ?? 0);

    const sorted = [...group].sort((a, b) => score(b) - score(a));
    const winner = sorted[0]!;
    duplicates += group.length - 1;

    // Fill gaps in the winner from its duplicates rather than discarding data.
    for (const other of sorted.slice(1)) {
      winner.description ||= other.description;
      winner.salary ??= other.salary;
      winner.schoolWebsite ||= other.schoolWebsite;
      winner.startDate ||= other.startDate;
      winner.deadlineAt ||= other.deadlineAt;
      winner.applicationUrl ||= other.applicationUrl;
      if (other.schoolEmails?.length) {
        winner.schoolEmails = [...new Set([...(winner.schoolEmails ?? []), ...other.schoolEmails])];
      }
      if (other.benefits?.length) {
        winner.benefits = [...new Set([...(winner.benefits ?? []), ...other.benefits])];
      }
      if (other.curriculum?.length) {
        winner.curriculum = [...new Set([...(winner.curriculum ?? []), ...other.curriculum])];
      }
    }
    kept.push(winner);
  }

  return { kept, duplicates };
}
