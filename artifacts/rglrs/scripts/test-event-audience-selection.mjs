import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/audience-selection.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

assert.deepEqual(
  helpers.normalizeAudienceSubjectIds("events", ["event-one", "event-two"]),
  ["event-one"],
  "event audiences must contain exactly one selected event",
);
assert.deepEqual(
  helpers.toggleAudienceSubjectId("events", ["event-one"], "event-two"),
  ["event-two"],
  "selecting a second event must replace the first event",
);
assert.deepEqual(
  helpers.toggleAudienceSubjectId("events", ["event-one"], "event-one"),
  [],
  "selecting the active event again must clear it",
);
assert.deepEqual(
  helpers.toggleAudienceSubjectId("circles", ["circle-one"], "circle-two"),
  ["circle-one", "circle-two"],
  "multi-select audiences must continue to allow multiple subjects",
);

console.log("✓ event audience controls enforce one valid event selection");