/**
 * Finding a person to write to.
 *
 * 447 of the top twenty schools in each country publish no careers address.
 * They are not unreachable — they publish a leadership page. A speculative
 * application needs a name on it, so this is the difference between a letter
 * that gets read and one that gets deleted.
 *
 * The danger is the usual one: a confident wrong name is worse than none,
 * because it goes out on a real application.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bestPerson, findPeople } from "../src/enrich/people.ts";

test("reads a staff list written either way round", () => {
  const html = `<ul>
    <li>Jane Okafor — Director of Sport — j.okafor@school.ac.th</li>
    <li>Head of School: Dr Peter Lindqvist</li>
  </ul>`;
  const people = findPeople(html, "https://school.ac.th/leadership");
  const sport = people.find((p) => p.role === "Director of Sport")!;
  assert.equal(sport.name, "Jane Okafor");
  assert.equal(sport.email, "j.okafor@school.ac.th");
  assert.ok(people.some((p) => p.name === "Dr Peter Lindqvist" && p.role === "Head of School"));
});

test("the Director of Sport outranks the Head", () => {
  // Seniority is not the same as usefulness. The Director of Sport knows
  // whether another PE teacher is needed next August and answers their own
  // email; the Head fields a hundred of these letters.
  const html = `Head of School: Dr Peter Lindqvist. Director of Sport: Jane Okafor.`;
  assert.equal(bestPerson(findPeople(html, "p"))!.role, "Director of Sport");
});

test("an address beats no address at the same usefulness", () => {
  const withNone = `Principal: Anna Meyer`;
  const withOne = `Principal: Anna Meyer anna.meyer@school.edu`;
  assert.equal(bestPerson(findPeople(withNone, "p"))!.email, undefined);
  assert.equal(bestPerson(findPeople(withOne, "p"))!.email, "anna.meyer@school.edu");
});

test("page furniture is not a person", () => {
  // Every one of these sat next to a role word on a real leadership page.
  for (const html of [
    "Senior Leadership Team — Principal",
    "Our School Principal",
    "Meet The Team: Head of School",
    "Principal's Welcome Message",
  ]) {
    assert.deepEqual(findPeople(html, "p"), [], html);
  }
});

test("the school's own name is not the Head's name", () => {
  // "Harare International School — Principal" must not yield a person called
  // Harare International.
  const people = findPeople("Harare International School — Principal", "p", "Harare International School");
  assert.deepEqual(people, []);
});

test("does not attach an address from the other end of the page", () => {
  // A staff page lists many people; pairing a name with a distant address
  // would put the wrong person's name on the letter.
  const far = "Principal: Anna Meyer" + " padding".repeat(120) + " someone.else@school.edu";
  assert.equal(bestPerson(findPeople(far, "p"))!.email, undefined);
});

test("refuses the student careers adviser's address", () => {
  // The same trap the email classifier guards: that address reaches the
  // person who advises pupils on universities.
  const html = `Director of Sport: Jane Okafor careers.adviser@school.ac.th`;
  assert.equal(findPeople(html, "p")[0]?.email, undefined);
});

test("finds nobody rather than guessing", () => {
  assert.deepEqual(findPeople("", "p"), []);
  assert.deepEqual(findPeople("<p>Welcome to our school.</p>", "p"), []);
  assert.equal(bestPerson([]), undefined);
});

test("navigation furniture beside a role word is not a person", () => {
  // Real: "About IICS" sat next to "Head of School" in a nav bar and came
  // back as a person of that name — which would have gone out on a letter.
  assert.deepEqual(findPeople("About IICS | Head of School", "p"), []);
  assert.deepEqual(findPeople("Head of School — Admissions Enquiries", "p"), []);
  assert.deepEqual(findPeople("Principal: Our Community", "p"), []);
});

test("an acronym is not a first name", () => {
  assert.deepEqual(findPeople("Director of Sport: ISB Bangkok", "p"), []);
  // But an ordinary name still passes, including a short one.
  assert.equal(findPeople("Director of Sport: Li Wei", "p")[0]?.name, "Li Wei");
});
