/**
 * Reading school facts out of website prose.
 *
 * These numbers go straight into the sheet, so the main risk is confident
 * nonsense — a group-wide roll recorded as one campus, or a phone number read
 * as a student count.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  countPeStaff,
  extractCurriculum,
  extractPackage,
  extractPeTeamSize,
  extractPhase,
  extractStudentCount,
} from "../src/enrich/facts.ts";

test("reads a stated student roll", () => {
  for (const [text, expected] of [
    ["The school has approximately 1,900 students enrolled.", 1900],
    ["Our current enrolment is 850 pupils.", 850],
    ["We educate over 2,400 students from 60 nationalities.", 2400],
  ] as [string, number][]) {
    assert.equal(extractStudentCount(text)?.value, expected, text);
  }
});

test("ignores a group-wide roll", () => {
  // These describe a school group, not the campus being profiled. The first is
  // real copy from a school whose parent group publishes a combined figure.
  for (const text of [
    "An institution supporting over 9,000 students across seven Academies.",
    "We welcome over 9,000 students across our schools in the UAE.",
    "Our network educates 40,000 students worldwide.",
    "Group-wide we have 12,000 students.",
    "Over 5,000 students across 12 campuses.",
  ]) {
    assert.equal(extractStudentCount(text), null, text);
  }
});

test("ignores a figure describing part of the school", () => {
  // Real copy: a boarding-house capacity, not the school roll.
  assert.equal(
    extractStudentCount("Six houses, each accommodating up to 70 students in en-suite bedrooms."),
    null,
  );
  assert.equal(extractStudentCount("Class sizes of 22 students."), null);
  assert.equal(extractStudentCount("An intake of 90 students per year group."), null);
});

test("ignores a multi-school group total", () => {
  // Real copy from a group-owned school's own advert.
  assert.equal(
    extractStudentCount("More than 9,000 students attending our 11 international schools."),
    null,
  );
});

test("ignores figures outside a plausible roll", () => {
  assert.equal(extractStudentCount("A class of 12 students."), null);
  assert.equal(extractStudentCount("We reached 250,000 students online."), null);
});

test("does not mistake a year for a roll", () => {
  // Natural prose where the number next to "students" is a date.
  assert.equal(extractStudentCount("Since 2011 students have enjoyed our new campus."), null);
  assert.equal(extractStudentCount("Founded in 1975 students of all faiths were welcomed."), null);
  // A real roll in the same sentence as a founding year still reads correctly.
  assert.equal(
    extractStudentCount("Founded in 1975, the school now has 900 students.")?.value,
    900,
  );
});

test("reads an explicitly stated PE team size", () => {
  assert.equal(extractPeTeamSize("We have a team of 6 PE teachers.")?.value, 6);
  assert.equal(extractPeTeamSize("The PE department comprises eight specialists.")?.value, 8);
  assert.equal(extractPeTeamSize("There are 4 full-time physical education teachers.")?.value, 4);
});

test("does not infer a team size from a job advert", () => {
  // An advert for a PE role repeats its own job title. Counting those mentions
  // would report the advert's title as the size of the department, so only an
  // explicit statement may produce a number here.
  const advert =
    "PE Teacher required. The PE Teacher will report to the Head of PE. " +
    "We seek an outstanding PE Teacher to join us in August.";
  assert.equal(extractPeTeamSize(advert), null);
});

test("counts PE staff only on a directory-style listing", () => {
  const staffPage =
    "Jane Doe - PE Teacher. John Smith - Head of PE. Ali Khan - Physical Education Teacher.";
  const counted = countPeStaff(staffPage);
  assert.equal(counted?.value, 3);
  // It is a proxy, not a headcount, so confidence stays low.
  assert.ok((counted?.confidence ?? 1) < 0.6);
});

test("ignores a repeated navigation link", () => {
  // The same role string twice is far more often a duplicated menu item than
  // two members of staff.
  assert.equal(countPeStaff("PE Teacher ... PE Teacher"), null);
  // Two different titles, or three mentions, are accepted.
  assert.equal(countPeStaff("PE Teacher and Head of PE")?.value, 2);
  assert.equal(countPeStaff("PE Teacher, PE Teacher, PE Teacher")?.value, 3);
});

test("identifies curricula", () => {
  const found = extractCurriculum("An IB World School offering the IGCSE and A Level pathways.");
  assert.ok(found);
  for (const label of ["IB", "IGCSE", "A Level"]) {
    assert.ok(found!.value.includes(label), `missing ${label}`);
  }
});

test("works out the school phase", () => {
  assert.equal(extractPhase("A secondary school for ages 11-18.")?.value, "secondary");
  assert.equal(extractPhase("Our primary school welcomes children from age 3.")?.value, "primary");
  // Both phases mentioned means an all-through school.
  assert.equal(
    extractPhase("We have a primary school and a secondary school on one campus.")?.value,
    "k12",
  );
});

test("picks up the package terms an expat compares offers on", () => {
  const found = extractPackage(
    "We offer a tax-free salary, free furnished accommodation, annual flights home, " +
      "medical insurance, free school places for dependants and excellent professional development.",
  );
  assert.ok(found);
  for (const label of [
    "Tax-free salary",
    "Housing / accommodation",
    "Flights",
    "Medical insurance",
    "Dependant school places",
    "Professional development",
  ]) {
    assert.ok(found!.value.includes(label), `missing ${label}`);
  }
});

test("returns null rather than inventing a value", () => {
  const nothing = "Welcome to our school. We look forward to meeting you.";
  assert.equal(extractStudentCount(nothing), null);
  assert.equal(extractPeTeamSize(nothing), null);
  assert.equal(extractCurriculum(nothing), null);
  assert.equal(extractPackage(nothing), null);
});
