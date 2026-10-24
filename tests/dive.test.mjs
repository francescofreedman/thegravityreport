// Daily Dive: every day file is playable, and answer matching behaves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// match.js is a browser script; in this ES-module package it attaches itself to globalThis.
await import("../dive/match.js");
const M = globalThis.DiveMatch;
const root = new URL("../dive/days/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", root)));
const TIER_POINTS = [10, 15, 30, 60, 85, 100];

for (const date of index.days) {
  test(`day ${date} is a full, well-formed dive`, () => {
    const day = JSON.parse(readFileSync(new URL(`${date}.json`, root)));
    assert.equal(day.date, date);
    assert.equal(day.secondsPerPrompt, 25);
    assert.equal(day.prompts.length, 7);
    assert.deepEqual(day.prompts.map((p) => p.slot), [1, 2, 3, 4, 5, 6, 7]);
    for (const p of day.prompts) {
      assert.ok(p.text && p.rule, `${p.id} needs text and rule`);
      assert.deepEqual(p.tiers.map((t) => t.points), TIER_POINTS, p.id);
      const byName = new Map(p.tiers.map((t) => [t.name, t.points]));
      assert.ok(p.answers.length >= 8, `${p.id} has only ${p.answers.length} answers`);
      for (const a of p.answers) assert.equal(byName.get(a.tier), a.points, `${p.id}: ${a.name}`);
      // one or two Buzzer Beaters, each with the story behind it
      const top = p.answers.filter((a) => a.points === 100);
      assert.ok(top.length >= 1 && top.length <= 2, `${p.id} has ${top.length} answers at 100`);
      for (const a of top) assert.ok(a.note && a.note.length > 20, `${p.id}: ${a.name} needs a note`);
      const P = M.prepare(p);
      // every answer is reachable by its own name
      p.answers.forEach((a) => {
        const r = M.lookup(a.name, P);
        assert.ok(r.i !== undefined && P.answers[r.i].points >= a.points, `${p.id}: "${a.name}" doesn't match`);
      });
    }
  });
}

const mvp = M.prepare({
  text: "Name an MVP", tiers: TIER_POINTS.map((points, i) => ({ name: "t" + i, points })),
  answers: [
    { name: "Michael Jordan", points: 10, tier: "t0", aliases: ["mj"] },
    { name: "Karl Malone", points: 60, tier: "t3" },
    { name: "Moses Malone", points: 60, tier: "t3" },
    { name: "Shaquille O'Neal", points: 10, tier: "t0", aliases: ["shaq"] },
    { name: "Nikola Jokić", points: 30, tier: "t2" },
    { name: "Kareem Abdul-Jabbar", points: 30, tier: "t2" },
    { name: "J.R. Smith", points: 30, tier: "t2" },
  ],
  traps: { "chris paul": "Chris Paul never won MVP." },
});
const name = (r) => mvp.answers[r.i].name;

test("exact names, aliases, accents and punctuation match", () => {
  assert.equal(name(M.lookup("michael jordan", mvp)), "Michael Jordan");
  assert.equal(name(M.lookup("MJ", mvp)), "Michael Jordan");
  assert.equal(name(M.lookup("Shaquille ONeal", mvp)), "Shaquille O'Neal");
  assert.equal(name(M.lookup("nikola jokic", mvp)), "Nikola Jokić");
  assert.equal(name(M.lookup("kareem abdul jabbar", mvp)), "Kareem Abdul-Jabbar");
  assert.equal(name(M.lookup("JR Smith", mvp)), "J.R. Smith");
});

test("a unique last name counts; a shared one asks for more, and unique first names stand in", () => {
  assert.equal(name(M.lookup("Jordan", mvp)), "Michael Jordan");
  assert.equal(name(M.lookup("abdul-jabbar", mvp)), "Kareem Abdul-Jabbar");
  assert.ok(M.lookup("Malone", mvp).free);
  assert.equal(name(M.lookup("Moses", mvp)), "Moses Malone");
  assert.equal(name(M.lookup("karl", mvp)), "Karl Malone");
});

test("near misses ask to confirm, traps explain, the rest is not on the board", () => {
  assert.equal(mvp.answers[M.lookup("Micheal Jordon", mvp).guess].name, "Michael Jordan");
  assert.equal(M.lookup("Chris Paul", mvp).err, "Chris Paul never won MVP.");
  const r = M.lookup("Steve Nash", mvp);
  assert.ok(r.err && !r.free && r.i === undefined && r.guess === undefined);
  assert.ok(M.lookup("   ", mvp).free);
});
