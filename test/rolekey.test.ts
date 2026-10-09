/**
 * One opening, worded three ways by three boards, is one job. Every case below
 * is a real pair from the live list — those that must merge, and the ones that
 * looked similar but are different openings and must not.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { collapseRoles, roleSig, sameRoleTitle } from "../src/match/rolekey.ts";

const same = (a: string, b: string) => assert.ok(sameRoleTitle(a, b), `should be one job: "${a}" / "${b}"`);
const different = (a: string, b: string) => assert.ok(!sameRoleTitle(a, b), `should be two jobs: "${a}" / "${b}"`);

test("the same opening worded differently is one job", () => {
  // PBISS: three rows for one post.
  same("Secondary PE Teacher", "Secondary Physical Education (PE) Teacher");
  same("Secondary Physical Education Teacher", "Secondary PE Teacher");
  // Dates and start wording do not make a new opening.
  same("PE Teacher", "PE Teacher - January 2027");
  same("PE Teacher (January start date)", "A level PE Teacher - January start date");
  // Word order and filler.
  same("Teacher - Physical Education (Female)", "Physical Education Teacher - Female");
  same("Netball Coach (Part-Time) | Enrich ME", "Netball Coach | Enrich ME Sports");
  same("Physical Education Primary Teacher", "Job Title Physical Education Primary Teacher");
});

test("a phase named on one side only does not separate them", () => {
  same("PE Teacher [Female Primary Specialist] - Yasmina British Academy - Jan 27", "Teacher - Physical Education [Female]");
  same("Primary Physical Education Teacher", "Physical Education Teacher");
});

test("different openings stay different", () => {
  different("Lead PE Teacher - January 2027", "Physical Education Teacher - January 2027");
  different("Head of PE - Sec(BTEC)", "PE Teacher - Maternity Cover");
  different("Golf Coach (Service Agreement)", "Lead Football Coach");
  different("Lead Football Coach", "Lead Gymnastics Coach");
  different("Head of Sport and Physical Education", "Physical Education and Sports Teacher");
  different("PE Technician - January 2027 Start", "Teacher of PE - August 2027 Start");
});

test("cover, audience and phase separate openings", () => {
  different("Physical Education Teacher | Maternity Cover", "Female Physical Education Teacher");
  different("Physical Education Teacher - Female", "Physical Education Teacher");
  different("Physical Education Teacher (Secondary Girls)", "Physical Education Teacher (Secondary Boys)");
  different("Physical Education Teacher - Middle and High School", "Physical Education Teacher - Primary School");
  different("Primary PE Teacher", "Secondary PE Teacher");
});

test("early years is not primary, in English or in Portuguese", () => {
  different("Early Years PE Teacher", "Primary PE Teacher");
  different("Professor(a) de Educação Fisica - Educação Infantil", "Professor(a) Educação Física - Fund I");
});

test("a leadership post is not the plain post", () => {
  assert.equal(roleSig("Head of Physical Education").kind, "head");
  assert.equal(roleSig("Director of Sport").kind, "director");
  assert.equal(roleSig("PE Teacher - Head of Primary").kind, "teacher");
  assert.equal(roleSig("Lead PE Teacher").kind, "lead");
});

const job = (id: string, source: string, title: string, school_key: string | null, extra: object = {}) => ({
  id, source, title, school_key, first_seen_at: "2026-10-01", ...extra,
});

test("collapsing keeps the fullest record and names the other boards", () => {
  const rows = [
    job("teast:1", "teast", "Secondary PE Teacher", "pbiss|th", { description: "short" }),
    job("tes:9", "tes", "Secondary Physical Education (PE) Teacher", "pbiss|th", { description: "x".repeat(4000), deadline_at: "2026-11-01" }),
    job("teast:2", "teast", "Secondary Physical Education Teacher", "pbiss|th"),
  ];
  const out = collapseRoles(rows, (s) => s.toUpperCase());
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, "tes:9");
  assert.equal(out[0]!.also_on, "TEAST");
  assert.deepEqual([...out[0]!.merged_ids].sort(), ["teast:1", "teast:2", "tes:9"]);
});

test("a role you have marked stays the representative, so its mark is never lost", () => {
  const out = collapseRoles([
    job("a", "tes", "PE Teacher", "s|x", { description: "x".repeat(5000) }),
    job("b", "teachaway", "PE Teacher", "s|x", { my_status: "applied" }),
  ]);
  assert.equal(out[0]!.id, "b");
});

test("roles at different schools, or with no school, are never merged", () => {
  assert.equal(collapseRoles([job("a", "tes", "PE Teacher", "s1"), job("b", "tes", "PE Teacher", "s2")]).length, 2);
  assert.equal(collapseRoles([job("a", "tes", "PE Teacher", null), job("b", "tes", "PE Teacher", null)]).length, 2);
});
