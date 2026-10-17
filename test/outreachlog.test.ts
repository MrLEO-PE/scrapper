import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkipLog, recordSkipped } from "../src/skiplog.ts";
import { loadSentLog, recordSent } from "../src/sentlog.ts";

const tmp = (name: string) => join(mkdtempSync(join(tmpdir(), "outreach-")), name);

test("a not-interested address is remembered, newest decision wins, and the file is only ever appended to", () => {
  const path = tmp("skip.jsonl");
  recordSkipped([{ email: "HR@School.edu", schools: ["school"], date: "2026-10-01" }], path);
  recordSkipped([{ email: "hr@school.edu", schools: ["school"], date: "2026-10-09" }, { email: "b@x.org", schools: [] }], path);
  const log = loadSkipLog(path);
  assert.equal(log.size, 2);
  assert.equal(log.get("hr@school.edu")?.date, "2026-10-09");
  assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 3);
});

test("an imported application keeps the day it was marked, not the day it was imported", () => {
  const path = tmp("sent.jsonl");
  recordSent([{ email: "a@b.edu", schools: ["b"], date: "2026-09-30" }], path);
  assert.equal(loadSentLog(path).get("a@b.edu")?.date, "2026-09-30");
});

test("a missing or damaged log is an empty one, not a crash", () => {
  assert.equal(loadSkipLog(tmp("nothing.jsonl")).size, 0);
  const path = tmp("bad.jsonl");
  recordSkipped([{ email: "ok@x.org", schools: [] }], path);
  appendFileSync(path, "{not json\n");
  assert.equal(loadSkipLog(path).size, 1);
});
