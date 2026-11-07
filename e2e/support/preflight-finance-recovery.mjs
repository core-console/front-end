import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Discovery loads the Playwright config and test imports without starting any server.
const root = fileURLToPath(new URL("../../", import.meta.url));
const related = [
  "advance-corrections(-integrated)?\\.spec\\.ts",
  "settlement-corrections(-integrated)?\\.spec\\.ts",
  "credit-return(-integrated)?\\.spec\\.ts",
];
const env = { ...process.env };
delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--list",
    "--reporter=json",
    "--project=chromium",
    ...related,
  ],
  { cwd: root, encoding: "utf8", env },
);
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(result.stdout);
assert.deepEqual(report.errors, []);

function titles(suite) {
  return [
    ...(suite.specs ?? []).map((spec) => spec.title),
    ...(suite.suites ?? []).flatMap(titles),
  ];
}
const required = {
  "advance-corrections-integrated.spec.ts": [
    "real P correction restates exact funding/shares and recovers committed response loss by lookup",
    "real P correction restates exact funding/shares and recovers committed response loss by retry",
    "real P retains original and intermediate attribution through repeated and fully owner-funded future-date correction",
  ],
  "advance-corrections.spec.ts": [
    "fresh page automatically recovers the terminal Advance Correction",
    "manual lookup resolves a deliberately unfinished Advance Correction",
    "fresh page recovers original uncertain command through exact-key retry without duplicate Correction",
  ],
};
for (const name of [
  "advance-corrections",
  "settlement-corrections",
  "credit-return",
]) {
  for (const variant of [name, `${name}-integrated`]) {
    const file = `${variant}.spec.ts`;
    const suite = report.suites.find((entry) => entry.file === file);
    assert.ok(suite, `No Chromium suite registered for ${file}`);
    const registered = titles(suite);
    assert.ok(registered.length, `No tests registered for ${file}`);
    for (const title of required[file] ?? [])
      assert.equal(
        registered.filter((entry) => entry === title).length,
        1,
        title,
      );
    process.stdout.write(`${file}: ${registered.length} Chromium scenarios\n`);
  }
}
