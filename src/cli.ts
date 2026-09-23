#!/usr/bin/env node
/**
 * Command line entry point.
 *
 *   scrape   pull vacancies from the boards
 *   enrich   build school profiles (website + PDFs + emails)
 *   export   write the ticked columns for Google Sheets
 *   run      scrape + enrich + export in one go
 *   fields   show / set which columns the sheet gets
 *   stats    what is in the database
 */

import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR, loadFields, loadTargets, writeFieldsConfig } from "./config.ts";
import { stats as httpStats } from "./core/http.ts";
import { log, setLogLevel, type LogLevel } from "./core/logger.ts";
import { FIELDS, FIELD_MAP } from "./export/fields.ts";
import {
  clearCountries,
  printLocations,
  setCountries,
  setRegion,
} from "./locations.ts";
import {
  installSchedule,
  listSchedule,
  parseEvery,
  removeSchedule,
  watch,
} from "./schedule.ts";
import { closeDb } from "./store/db.ts";
import {
  ALL_SOURCES,
  printStats,
  runEnrich,
  runDirectory,
  runSite,
  runExport,
  runScrape,
  type ScrapeSummary,
} from "./pipeline.ts";

interface Args {
  command: string;
  flags: Map<string, string | true>;
  positional: string[];
}

function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
    } else if (rest[i + 1] && !rest[i + 1]!.startsWith("--")) {
      flags.set(body, rest[++i]!);
    } else {
      flags.set(body, true);
    }
  }
  return { command, flags, positional };
}

const str = (a: Args, k: string): string | undefined => {
  const v = a.flags.get(k);
  return typeof v === "string" ? v : undefined;
};
const bool = (a: Args, k: string): boolean => a.flags.has(k);
const num = (a: Args, k: string): number | undefined => {
  const v = str(a, k);
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const csv = (a: Args, k: string): string[] | undefined =>
  str(a, k)?.split(",").map((s) => s.trim()).filter(Boolean);

function reportScrape(s: ScrapeSummary): void {
  log.step("Scrape summary");
  for (const [id, r] of Object.entries(s.bySource)) {
    const source = ALL_SOURCES.find((x) => x.id === id);
    if (r.failed) log.error(`${source?.label ?? id}: FAILED — ${r.failed}`);
    else log.plain(`  ${(source?.label ?? id).padEnd(20)} ${String(r.pe).padStart(4)} PE-linked  (${r.raw} scanned)`);
  }
  log.plain("");
  log.plain(`  new vacancies        ${s.inserted}`);
  log.plain(`  updated              ${s.updated}`);
  if (s.reopened) log.plain(`  re-opened            ${s.reopened}`);
  if (s.duplicates) log.plain(`  cross-board dupes    ${s.duplicates}`);
  if (s.stale) log.plain(`  now possibly filled  ${s.stale}`);
  if (s.closed) log.plain(`  closed               ${s.closed}`);
  if (s.expired) log.plain(`  past deadline        ${s.expired}`);
  log.plain(`  http requests        ${httpStats.requests} (${httpStats.cacheHits} from cache)`);
}

function showFields(args: Args): void {
  const enabled = new Set(loadFields());

  if (bool(args, "set")) {
    const keys = csv(args, "set") ?? [];
    const valid = keys.filter((k) => FIELD_MAP.has(k));
    const unknown = keys.filter((k) => !FIELD_MAP.has(k));
    if (unknown.length) log.warn(`unknown: ${unknown.join(", ")}`);
    writeFieldsConfig(new Set(valid));
    log.ok(`${valid.length} columns ticked`);
    return;
  }
  if (str(args, "enable")) {
    for (const k of csv(args, "enable") ?? []) if (FIELD_MAP.has(k)) enabled.add(k);
    writeFieldsConfig(enabled);
    return;
  }
  if (str(args, "disable")) {
    for (const k of csv(args, "disable") ?? []) enabled.delete(k);
    writeFieldsConfig(enabled);
    return;
  }

  log.step("Columns (tick these in config/fields.json)");
  let group = "";
  for (const f of FIELDS) {
    if (f.group !== group) {
      group = f.group;
      log.plain(`\n  ${group.toUpperCase()}`);
    }
    const mark = enabled.has(f.key) ? "[x]" : "[ ]";
    log.plain(`   ${mark} ${f.key.padEnd(17)} ${f.label.padEnd(26)} ${f.help}`);
  }
  log.plain(`\n  ${enabled.size} of ${FIELDS.length} ticked.`);
  log.plain("  Change with:  npm run fields -- --enable pe_score,website");
  log.plain("                npm run fields -- --disable description");
}

/**
 * Open the newest HTML report in the default browser.
 *
 * The report is a single self-contained file — inline styles and script, no
 * external assets — so it opens straight from disk and needs no web server.
 */
function openLatestReport(outDir?: string): void {
  const dir = outDir ?? OUT_DIR;
  let newest: { path: string; at: number } | null = null;

  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".html")) continue;
      const full = join(dir, name);
      const at = statSync(full).mtimeMs;
      if (!newest || at > newest.at) newest = { path: full, at };
    }
  } catch {
    /* directory does not exist yet */
  }

  if (!newest) {
    log.warn(`no HTML report in ${dir}`);
    log.plain("  Generate one with:  npm run export");
    return;
  }

  const opener =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", newest.path]]
    : process.platform === "darwin" ? ["open", [newest.path]]
    : ["xdg-open", [newest.path]];

  try {
    execFile(opener[0] as string, opener[1] as string[], { windowsHide: true });
    log.ok(`opened ${newest.path}`);
  } catch (err) {
    log.warn(`could not open it automatically: ${(err as Error).message}`);
    log.plain(`  Open this file yourself: ${newest.path}`);
  }
}

const HELP = `
International school PE job scraper

USAGE
  npm run scrape                     pull vacancies from all boards
  npm run enrich                     build school profiles (website, PDFs, emails)
  npm run export                     write the sheet
  npm run run-all                    scrape + enrich + export
  npm run fields                     show which columns are ticked
  npm run locations                  show / tick countries and cities
  npm run directory                  top schools per country, recruiting or not
  npm run watch -- --every 24h       keep running on an interval
  npm run schedule -- --daily 07:00  install an OS scheduled task
  npm run site                       build the publishable site/ folder
  npm run report                     open the latest HTML report
  npm run stats                      what's in the database

LOCATIONS
  --list [--cities]                  show the country list
  --on AE,QA,SG                      tick these countries
  --only AE                          tick only this one
  --off AE                           untick
  --region "Middle East"             tick a whole region
  --clear                            untick everything

DIRECTORY
  --top 30                           schools per country (default 30)
  --countries "Qatar,Oman"           override the ticked list
  --cities Dubai,Doha                narrow to cities
  --list-only                        collect and rank without crawling sites

WATCH / SCHEDULE
  --every 24h | 6h | 30m             watch interval
  --max-runs 10                      stop after N cycles
  --daily HH:MM                      schedule daily
  --weekly MON --at 07:00            schedule weekly
  --remove                           delete the scheduled task
  --list                             show the installed task

SCRAPE
  --sources tes,teachaway            limit to certain sources. Available:
                                     tes, teachaway, teacherhorizons, nordanglia,
                                     inspired, schoolsite, europeanchamber, mailalert
  --fresh                            ignore the cache
  --shallow                          skip vacancy detail pages (faster, much less data)
  --max-jobs 50                      stop early (useful for a quick test)

ENRICH
  --limit 20                         only enrich N schools
  --no-crawl                         board data only, no website visits
  --max-pages 8                      pages per school website
  --max-pdfs 3                       job-pack PDFs to read per school
  --max-age-days 30                  re-enrich profiles older than this
  --concurrency 4                    schools in parallel
  --budget-ms 90000                  time budget per school website

EXPORT
  --format csv,html,tsv,json         output formats (default csv,html)
  --fields country,city,...          override the ticked columns
  --schools                          one row per school instead of per vacancy
  --status open|stale|closed|any     which vacancies (default open)
  --min-score 55                     only strong PE matches
  --countries "United Arab Emirates,Spain"
  --seniority head_of_department,director_of_sport
  --since 2026-09-01                 only vacancies first seen since then
  --out data/out                     output directory
  --sheet-id <id>                    also push to this Google Sheet
  --sheet-tab "PE Jobs"              tab name to write
  --key-file key.json                service-account key (or set
                                     GOOGLE_APPLICATION_CREDENTIALS)

GLOBAL
  --verbose / --quiet                logging level
`;

async function main(): Promise<void> {
  // Pick up GOOGLE_SHEET_ID, GOOGLE_APPLICATION_CREDENTIALS, TH_COOKIE and the
  // SCRAPPER_* tuning knobs from a .env file, so scheduled runs get the same
  // environment as interactive ones without exporting anything.
  try {
    process.loadEnvFile(join(process.cwd(), ".env"));
  } catch {
    /* no .env file — everything has a default */
  }

  const args = parseArgs(process.argv.slice(2));

  if (bool(args, "verbose")) setLogLevel("debug");
  else if (bool(args, "quiet")) setLogLevel("warn");
  else setLogLevel((str(args, "log") as LogLevel) ?? "info");

  const targets = loadTargets();
  if (num(args, "threshold") != null) targets.threshold = num(args, "threshold")!;
  if (csv(args, "countries")) targets.countries = csv(args, "countries")!;
  if (csv(args, "cities")) targets.cities = csv(args, "cities")!;
  if (csv(args, "seniority")) targets.seniority = csv(args, "seniority")!;

  const scrapeOpts = {
    sources: csv(args, "sources"),
    fresh: bool(args, "fresh"),
    // On by default: vacancy detail pages carry the school website, country,
    // application email and job-pack PDFs, none of which the search API
    // returns. It costs about a minute and roughly triples the usable data,
    // so the useful mode should not depend on remembering a flag.
    deep: !bool(args, "shallow"),
    maxJobs: num(args, "max-jobs"),
    targets,
  };

  const enrichOpts = {
    limit: num(args, "limit"),
    noCrawl: bool(args, "no-crawl"),
    maxPages: num(args, "max-pages"),
    maxPdfs: num(args, "max-pdfs"),
    maxAgeDays: num(args, "max-age-days"),
    concurrency: num(args, "concurrency"),
    budgetMs: num(args, "budget-ms"),
    fresh: bool(args, "fresh"),
  };

  const exportOpts = {
    formats: csv(args, "format"),
    fields: csv(args, "fields"),
    outDir: str(args, "out"),
    name: str(args, "name"),
    schoolsOnly: bool(args, "schools"),
    sheetId: str(args, "sheet-id"),
    sheetTab: str(args, "sheet-tab"),
    keyFile: str(args, "key-file"),
    query: {
      status: (str(args, "status") as "open" | "stale" | "closed" | "any") ?? "open",
      minScore: num(args, "min-score"),
      countries: csv(args, "countries"),
      seniority: csv(args, "seniority"),
      since: str(args, "since"),
      limit: num(args, "limit"),
    },
  };

  switch (args.command) {
    case "scrape":
      reportScrape(await runScrape(scrapeOpts));
      break;

    case "enrich": {
      const r = await runEnrich(enrichOpts);
      log.step("Enrichment summary");
      log.plain(`  schools enriched     ${r.enriched}`);
      log.plain(`  with a careers email ${r.withCareerEmail}`);
      break;
    }

    case "export": {
      const r = await runExport(exportOpts);
      if (r.rows) log.ok(`${r.rows} rows exported`);
      break;
    }

    case "run": {
      reportScrape(await runScrape(scrapeOpts));
      const e = await runEnrich(enrichOpts);
      log.step("Enrichment summary");
      log.plain(`  schools enriched     ${e.enriched}`);
      log.plain(`  with a careers email ${e.withCareerEmail}`);
      await runExport(exportOpts);
      printStats();
      break;
    }

    case "fields":
      showFields(args);
      break;

    case "locations": {
      if (str(args, "on")) setCountries(csv(args, "on")!, true);
      else if (str(args, "only")) setCountries(csv(args, "only")!, true, true);
      else if (str(args, "off")) setCountries(csv(args, "off")!, false);
      else if (str(args, "region")) {
        const n = setRegion(str(args, "region")!, !bool(args, "off"));
        log.ok(`${n} countries updated in ${str(args, "region")}`);
      } else if (bool(args, "clear")) {
        clearCountries();
        log.ok("all countries unticked");
      }
      printLocations(bool(args, "cities"));
      break;
    }

    case "directory": {
      const r = await runDirectory({
        ...enrichOpts,
        countries: csv(args, "countries"),
        cities: csv(args, "cities"),
        top: num(args, "top"),
        listOnly: bool(args, "list-only"),
      });
      log.step("Directory summary");
      log.plain(`  countries            ${r.countries}`);
      log.plain(`  schools found        ${r.found}`);
      log.plain(`  enriched             ${r.enriched}`);
      log.plain(`  with a careers email ${r.withCareerEmail}`);
      if (r.skipped.length) log.warn(`no directory page for: ${r.skipped.join(", ")}`);
      break;
    }

    case "watch": {
      const everyRaw = str(args, "every") ?? "24h";
      const everyMs = parseEvery(everyRaw);
      if (everyMs == null) {
        log.error(`could not read --every "${everyRaw}". Try 30m, 6h or 2d.`);
        process.exitCode = 1;
        break;
      }
      await watch({
        everyMs,
        maxRuns: num(args, "max-runs"),
        task: async () => {
          reportScrape(await runScrape(scrapeOpts));
          const e = await runEnrich(enrichOpts);
          log.info(`enriched ${e.enriched} schools, ${e.withCareerEmail} with a careers email`);
          await runExport(exportOpts);
        },
      });
      break;
    }

    case "schedule": {
      if (bool(args, "remove")) {
        await removeSchedule();
        break;
      }
      if (bool(args, "list") || args.flags.size === 0) {
        await listSchedule();
        break;
      }
      const passthrough = bool(args, "deep") ? ["--deep"] : [];
      if (str(args, "daily")) {
        await installSchedule({ cadence: "daily", at: str(args, "daily")!, args: passthrough });
      } else if (str(args, "weekly")) {
        await installSchedule({
          cadence: "weekly",
          day: str(args, "weekly")!,
          at: str(args, "at") ?? "07:00",
          args: passthrough,
        });
      } else if (str(args, "hourly")) {
        await installSchedule({ cadence: "hourly", at: str(args, "hourly")!, args: passthrough });
      } else {
        log.error("say when: --daily 07:00, --weekly MON --at 07:00, or --remove");
        process.exitCode = 1;
      }
      break;
    }

    case "site": {
      const r = runSite(str(args, "out"), csv(args, "fields"));
      log.plain(`  open ${join(r.dir, "index.html")}`);
      break;
    }

    case "report":
      openLatestReport(str(args, "out"));
      break;

    case "stats":
      printStats();
      break;

    case "help":
    case "--help":
    case "-h":
      log.plain(HELP);
      break;

    default:
      log.error(`unknown command "${args.command}"`);
      log.plain(HELP);
      process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  log.error((err as Error).stack ?? String(err));
  process.exitCode = 1;
} finally {
  closeDb();
}
