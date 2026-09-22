/**
 * Classifier checks. Run: node --experimental-strip-types --test test/
 *
 * Cases are real titles pulled from TES / Teach Away plus the look-alikes that
 * a naive "contains PE" match gets wrong.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classify, detectSeniority } from "../src/match/classify.ts";

const SHOULD_MATCH: string[] = [
  // Real TES international listings
  "Head of Sports",
  "PE Teacher - Talent Pool | Academic Year 2027–2028",
  "Outstanding Teacher of PE - Maternity Cover",
  "Whole School PE Teacher",
  "A level PE Teacher - January start date",
  "Physical Education Teacher | Maternity Cover",
  "Primary PE Teacher - Starting January 2027",
  "PE Teacher [Female Primary Specialist]",
  "Teacher of Physical Education and Sport",
  "Basketball Coach – Fortes Schools, Dubai (Performance-Oriented Role)",
  // Real Teach Away listings
  "Sports Coordinator",
  "Physical Education Teacher - Primary and Middle School",
  // Leadership variants the user cares about most
  "Head of PE",
  "Head of Physical Education",
  "HOD Physical Education",
  "Director of Sport",
  "Athletic Director",
  "Head of Department - PE",
  "Second in Department (PE)",
  "Subject Leader for Physical Education",
  "Head of Games",
  "Teacher of Games and Games Coach",
  "Sports Science Teacher",
  "IB Sports, Exercise and Health Science Teacher",
  "BTEC Sport Lecturer",
  "Swimming Instructor",
  "Strength and Conditioning Coach",
  "P.E. Teacher",
  "Physics and PE Teacher",
];

const SHOULD_NOT_MATCH: string[] = [
  "Teacher of Physics",
  "Head of Physics",
  "Physics Teacher (IGCSE and A Level)",
  "Physical Science Teacher",
  "Physiotherapist",
  "Head of Special Educational Needs",
  "SENCO",
  "Teacher of Mathematics",
  "Primary Class Teacher",
  "Head of English",
  "Admissions Officer",
  "Pension and Payroll Administrator",
  "Head of Performing Arts",
  "Business Studies Teacher",
  "Grounds Keeper",
  "Head of Chemistry",
];

test("recognises PE-linked roles", () => {
  const missed: string[] = [];
  for (const title of SHOULD_MATCH) {
    if (!classify(title).isPe) missed.push(title);
  }
  assert.deepEqual(missed, [], "these should have matched");
});

test("rejects look-alike roles", () => {
  const wrong: string[] = [];
  for (const title of SHOULD_NOT_MATCH) {
    const r = classify(title);
    if (r.isPe) wrong.push(`${title} (score ${r.score}, ${r.matched.join(",")})`);
  }
  assert.deepEqual(wrong, [], "these should NOT have matched");
});

test("PE beats Physics when both appear", () => {
  assert.ok(classify("Physics and PE Teacher").isPe);
  assert.ok(!classify("Teacher of Physics").isPe);
});

test("does not fire on PE as a Brazilian state code", () => {
  // Real titles from a group careers site. "PE" here is Pernambuco, written
  // "City/PE" in Brazilian adverts — none of these are PE roles.
  for (const t of [
    "Jovem Aprendiz - Recife/PE",
    "Enfermeiro(a) Escolar - Recife/PE",
    "Auxiliar de Professor - Infantil - Recife/PE",
    "Professor(a) de Música - Infantil e Fundamental - Recife/PE",
  ]) {
    assert.ok(!classify(t).isPe, `${t} should not match`);
  }
  // But a genuine PE role in Pernambuco still matches: a real subject term
  // outweighs the state-code veto.
  assert.ok(classify("Professor de Educação Física - Recife/PE").isPe);
  // And an ordinary dash before PE is English titling, not a state code.
  assert.ok(classify("Head of Department - PE").isPe);
  assert.ok(classify("Teacher of Games/PE").isPe);
});

test("recognises the subject in Spanish and Portuguese", () => {
  for (const t of [
    "Profesor de Educación Física",
    "Professor de Educação Física",
    "Docente de Educación Física - Primaria",
  ]) {
    assert.ok(classify(t).isPe, `${t} should match`);
  }
});

test("does not fire on PE inside a longer word", () => {
  for (const t of ["Pension Administrator", "Head of People", "Performance Analyst", "Pedagogy Lead"]) {
    assert.ok(!classify(t).isPe, `${t} should not match`);
  }
});

test("places leadership roles on the ladder", () => {
  assert.equal(detectSeniority("Director of Sport"), "director_of_sport");
  assert.equal(detectSeniority("Athletic Director"), "director_of_sport");
  assert.equal(detectSeniority("Head of Sports"), "director_of_sport");
  assert.equal(detectSeniority("Head of PE"), "head_of_department");
  assert.equal(detectSeniority("HOD Physical Education"), "head_of_department");
  assert.equal(detectSeniority("Subject Leader for Physical Education"), "head_of_department");
  assert.equal(detectSeniority("Second in Department (PE)"), "second_in_department");
  assert.equal(detectSeniority("Sports Coordinator"), "coordinator");
  assert.equal(detectSeniority("PE Teacher"), "teacher");
  assert.equal(detectSeniority("Basketball Coach"), "coach");
});

test("leadership roles outrank classroom roles", () => {
  const hod = classify("Head of PE");
  const teacher = classify("PE Teacher");
  assert.ok(hod.score >= teacher.score - 5);
  assert.equal(hod.seniority, "head_of_department");
  assert.equal(teacher.seniority, "teacher");
});
