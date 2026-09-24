import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const suite = process.argv[2];
if (suite !== "unit" && suite !== "functional") {
  throw new Error("Choose the unit or functional test suite.");
}

const testDirectory = path.join("tests", suite);
const files = (await readdir(testDirectory))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => path.join(testDirectory, file));
if (!files.length) throw new Error(`No ${suite} tests found in ${testDirectory}.`);

const resultsDirectory = path.join("test-results", suite);
await mkdir(resultsDirectory, { recursive: true });

const child = spawn(process.execPath, [
  "--test",
  "--experimental-test-isolation=none",
  "--test-reporter=spec",
  "--test-reporter=junit",
  "--test-reporter-destination=stdout",
  `--test-reporter-destination=${path.join(resultsDirectory, "results.xml")}`,
  ...files,
], { stdio: "inherit" });

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve(signal ? 1 : code ?? 1));
});
process.exitCode = exitCode;
