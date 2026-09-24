import { appendFile, readFile } from "node:fs/promises";

const files = process.argv.slice(2);
let total = 0;
let failed = 0;
const rows = [];
const failures = [];
const casesByFile = [];
const missing = [];

for (const file of files) {
  let xml;
  try { xml = await readFile(file, "utf8"); } catch {
    missing.push(file);
    continue;
  }
  const cases = [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)];
  let fileFailed = 0;
  const fileCases = [];
  for (const [, attributes, body = ""] of cases) {
    const name = (attributes.match(/\bname="([^"]*)"/)?.[1] ?? "unnamed test")
      .replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
    const isFailure = /<failure\b|<error\b/.test(body);
    fileCases.push(`${isFailure ? "❌" : "✅"} ${name}`);
    if (isFailure) {
      fileFailed++;
      failures.push(`${file}: ${name}`);
    }
  }
  total += cases.length;
  failed += fileFailed;
  rows.push(`| ${file} | ${cases.length} | ${fileFailed} |`);
  casesByFile.push({ file, fileCases });
}

const summary = [
  "## Automated test results",
  "",
  "| Suite | Tests | Failed |",
  "| --- | ---: | ---: |",
  ...rows,
  "",
  `**${total - failed} passed, ${failed} failed, ${total} total.**`,
  ...(failures.length ? ["", "Failed cases:", ...failures.map((name) => `- ${name}`)] : []),
  ...(missing.length ? ["", "Missing reports:", ...missing.map((file) => `- ${file}`)] : []),
  ...casesByFile.flatMap(({ file, fileCases }) => [
    "", `<details><summary>Cases in ${file}</summary>`, "",
    ...fileCases.map((name) => `- ${name}`), "", "</details>",
  ]),
  "",
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if (total === 0 || failed > 0 || missing.length > 0) process.exitCode = 1;
