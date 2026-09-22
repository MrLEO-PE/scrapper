/**
 * Recurring runs.
 *
 * Two ways to keep the sheet current:
 *
 *   `watch`    — an in-process loop. Cross-platform, no permissions needed,
 *                but only runs while the terminal is open.
 *   `schedule` — registers a real OS task (Windows Task Scheduler, or cron on
 *                macOS/Linux) so it runs whether or not you are logged in.
 *
 * Both call the same `run` pipeline, so every execution re-checks which
 * vacancies are still listed and updates their status.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "./core/logger.ts";

const exec = promisify(execFile);

export type Cadence = "daily" | "weekly" | "hourly";

const TASK_NAME = "PE-Schools-Scrapper";

export interface ScheduleSpec {
  cadence: Cadence;
  /** 24h "HH:MM". */
  at: string;
  /** For weekly: MON..SUN. */
  day?: string;
  /** Extra flags appended to the `run` command. */
  args?: string[];
}

/** How the scheduled task should invoke us. */
function runCommand(args: string[] = []): { exe: string; script: string; cwd: string } {
  return {
    exe: process.execPath,
    script: ["--experimental-strip-types", "--no-warnings", "src/cli.ts", "run", ...args].join(" "),
    cwd: process.cwd(),
  };
}

export function parseEvery(input: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i.exec(input.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith("m")) return n * 60_000;
  if (unit.startsWith("h")) return n * 3_600_000;
  return n * 86_400_000;
}

// ---------------------------------------------------------------------------
// In-process loop

export interface WatchOptions {
  everyMs: number;
  /** Stop after this many cycles (0 = forever). */
  maxRuns?: number;
  task: () => Promise<void>;
}

export async function watch(opts: WatchOptions): Promise<void> {
  const every = Math.max(60_000, opts.everyMs);
  let runs = 0;

  log.step(`Watch mode — every ${formatDuration(every)}`);
  log.info("Ctrl+C to stop. Each cycle re-checks whether vacancies are still listed.");

  let stopping = false;
  const onSignal = () => {
    stopping = true;
    log.info("\nstopping after the current cycle…");
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  for (;;) {
    const started = Date.now();
    runs++;
    log.step(`Run ${runs} — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
    try {
      await opts.task();
    } catch (err) {
      // A failed cycle must not kill the loop; the next one may succeed.
      log.error(`run failed: ${(err as Error).message}`);
    }

    if (stopping) break;
    if (opts.maxRuns && runs >= opts.maxRuns) break;

    const wait = Math.max(0, every - (Date.now() - started));
    const next = new Date(Date.now() + wait);
    log.info(`next run at ${next.toISOString().slice(0, 16).replace("T", " ")}`);

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, wait);
      // Let Ctrl+C interrupt the wait rather than hanging until the timer fires.
      const poll = setInterval(() => {
        if (stopping) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }
      }, 500);
      timer.unref?.();
      poll.unref?.();
      setTimeout(() => {
        clearInterval(poll);
        resolve();
      }, wait);
    });
    if (stopping) break;
  }
  log.ok(`watch stopped after ${runs} run${runs === 1 ? "" : "s"}`);
}

function formatDuration(ms: number): string {
  if (ms >= 86_400_000) return `${(ms / 86_400_000).toFixed(ms % 86_400_000 ? 1 : 0)}d`;
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(ms % 3_600_000 ? 1 : 0)}h`;
  return `${Math.round(ms / 60_000)}m`;
}

// ---------------------------------------------------------------------------
// OS-level scheduling

export async function installSchedule(spec: ScheduleSpec): Promise<void> {
  if (process.platform === "win32") return installWindows(spec);
  return installCron(spec);
}

async function installWindows(spec: ScheduleSpec): Promise<void> {
  const { exe, script, cwd } = runCommand(spec.args);
  // Wrapped in cmd so we can cd into the project first.
  const action = `cmd /c cd /d "${cwd}" && "${exe}" ${script} >> "${cwd}\\data\\scheduled.log" 2>&1`;

  const args = ["/Create", "/TN", TASK_NAME, "/TR", action, "/F", "/ST", spec.at];
  if (spec.cadence === "daily") args.push("/SC", "DAILY");
  else if (spec.cadence === "hourly") args.push("/SC", "HOURLY");
  else {
    args.push("/SC", "WEEKLY", "/D", (spec.day ?? "MON").toUpperCase().slice(0, 3));
  }

  try {
    const { stdout } = await exec("schtasks", args, { windowsHide: true });
    log.ok(`scheduled: ${spec.cadence} at ${spec.at}${spec.day ? ` on ${spec.day}` : ""}`);
    log.plain("  " + stdout.trim());
    log.plain(`\n  task name : ${TASK_NAME}`);
    log.plain(`  log file  : ${cwd}\\data\\scheduled.log`);
    log.plain(`  remove    : npm run schedule -- --remove`);
  } catch (err) {
    log.error(`could not create the task: ${(err as Error).message}`);
    log.warn("Task Scheduler usually needs an elevated prompt — try running this from an Administrator terminal,");
    log.warn("or use `npm run watch -- --every 24h` instead, which needs no permissions.");
  }
}

async function installCron(spec: ScheduleSpec): Promise<void> {
  const { exe, script, cwd } = runCommand(spec.args);
  const [hh = "7", mm = "0"] = spec.at.split(":");
  const dayNum = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }[
    (spec.day ?? "MON").toUpperCase().slice(0, 3)
  ] ?? 1;

  const when =
    spec.cadence === "hourly" ? `${mm} * * * *`
    : spec.cadence === "daily" ? `${mm} ${hh} * * *`
    : `${mm} ${hh} * * ${dayNum}`;

  const line = `${when} cd "${cwd}" && "${exe}" ${script} >> "${cwd}/data/scheduled.log" 2>&1 # ${TASK_NAME}`;

  try {
    let existing = "";
    try {
      existing = (await exec("crontab", ["-l"])).stdout;
    } catch {
      /* no crontab yet */
    }
    const kept = existing.split("\n").filter((l) => l && !l.includes(TASK_NAME));
    const next = [...kept, line].join("\n") + "\n";

    await new Promise<void>((resolve, reject) => {
      const child = execFile("crontab", ["-"], (err) => (err ? reject(err) : resolve()));
      child.stdin?.end(next);
    });

    log.ok(`scheduled via cron: ${line.split("#")[0]!.trim()}`);
    log.plain(`  log file : ${cwd}/data/scheduled.log`);
    log.plain(`  remove   : npm run schedule -- --remove`);
  } catch (err) {
    log.error(`could not write crontab: ${(err as Error).message}`);
    log.warn("Use `npm run watch -- --every 24h` instead, which needs no permissions.");
  }
}

export async function removeSchedule(): Promise<void> {
  if (process.platform === "win32") {
    try {
      await exec("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"], { windowsHide: true });
      log.ok(`removed scheduled task ${TASK_NAME}`);
    } catch (err) {
      log.warn(`no task removed: ${(err as Error).message}`);
    }
    return;
  }
  try {
    const existing = (await exec("crontab", ["-l"])).stdout;
    const kept = existing.split("\n").filter((l) => l && !l.includes(TASK_NAME));
    await new Promise<void>((resolve, reject) => {
      const child = execFile("crontab", ["-"], (err) => (err ? reject(err) : resolve()));
      child.stdin?.end(kept.join("\n") + "\n");
    });
    log.ok("removed the cron entry");
  } catch (err) {
    log.warn(`no cron entry removed: ${(err as Error).message}`);
  }
}

export async function listSchedule(): Promise<void> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await exec("schtasks", ["/Query", "/TN", TASK_NAME, "/FO", "LIST"], { windowsHide: true });
      log.step("Scheduled task");
      log.plain(stdout.trim());
    } catch {
      log.info("no scheduled task installed");
      log.plain("  create one with:  npm run schedule -- --daily 07:00");
    }
    return;
  }
  try {
    const { stdout } = await exec("crontab", ["-l"]);
    const lines = stdout.split("\n").filter((l) => l.includes(TASK_NAME));
    if (!lines.length) log.info("no cron entry installed");
    else {
      log.step("Cron entry");
      for (const l of lines) log.plain("  " + l);
    }
  } catch {
    log.info("no crontab for this user");
  }
}
