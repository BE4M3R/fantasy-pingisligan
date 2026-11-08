import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { competitionRuleSections, splitCompetitionRules } from "../../lib/competition-rules.ts";

test("rules split at their section headings without losing links, lists or conditions", () => {
  const sections = splitCompetitionRules("## Participation\n\nFree entry.\n\n## How the winner is selected\n\n1. Net points.\n2. Raw captain points.\n\n## Winner announcement and claiming\n\nClaim within **five calendar days**.\n\n## Prize delivery\n\nOnly necessary delivery data is shared.\n\n## Taxation\n\nRead [official guidance](https://www.skatteverket.se/).");
  assert.deepEqual(sections.map(({ title }) => title), [...competitionRuleSections]);
  assert.ok(sections[1].body.includes("1. Net points.\n2. Raw captain points."));
  assert.ok(sections[2].body.includes("**five calendar days**"));
  assert.ok(sections[4].body.includes("[official guidance](https://www.skatteverket.se/)"));
});

test("legacy text, preambles and unknown headings remain available", () => {
  assert.deepEqual(splitCompetitionRules("Legacy terms and [contact](/about)."), [
    { title: "Participation", body: "Legacy terms and [contact](/about)." },
  ]);
  const sections = splitCompetitionRules("Introduction.\n## Participation\nOriginal rules.\n## Important exception\nKeep this condition.\n## Participation\nAdditional rules.");
  assert.equal(sections.length, 1);
  for (const text of ["Introduction.", "Original rules.", "## Important exception", "Keep this condition.", "Additional rules."])
    assert.ok(sections[0].body.includes(text));
  assert.deepEqual(splitCompetitionRules(" \n"), []);
});

test("headings inside fenced Markdown are preserved as content", () => {
  const sections = splitCompetitionRules("## Participation\nExample:\n```text\n## Taxation\nNot a section.\n```\n## Prize delivery\nDelivery terms.");
  assert.deepEqual(sections.map(({ title }) => title), ["Participation", "Prize Delivery"]);
  assert.ok(sections[0].body.includes("```text\n## Taxation\nNot a section.\n```"));
});

test("both prepared shared documents provide all five sections with every condition retained", async () => {
  for (const name of ["weekly-smash", "season-competition"]) {
    const body = await readFile(new URL(`../../docs/competition-rules/${name}.md`, import.meta.url), "utf8");
    const sections = splitCompetitionRules(body);
    assert.deepEqual(sections.map(({ title }) => title), [...competitionRuleSections]);
    const combined = sections.map(({ body }) => body).join("\n\n");
    for (const line of body.split("\n").filter((line) => line.trim() && !line.startsWith("## ")))
      assert.ok(combined.includes(line), `${name} lost a rule or link: ${line}`);
  }
});
