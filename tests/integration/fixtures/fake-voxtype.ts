#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.dirname(import.meta.path);
const controlPath = path.join(root, "control.json");
const logPath = path.join(root, "commands.ndjson");
const args = process.argv.slice(2);
appendFileSync(logPath, `${JSON.stringify(args)}\n`);

const control = JSON.parse(readFileSync(controlPath, "utf8")) as {
  outcome?: "success" | "empty" | "timeout" | "failure" | "hang";
  text?: string;
};

if (args[0] === "status") {
  console.log(JSON.stringify({ text: "idle", alt: "idle", class: "idle", tooltip: "idle" }));
  process.exit(0);
}

if (args[0] !== "record") process.exit(1);

if (args[1] === "start") process.exit(0);
if (args[1] === "cancel") process.exit(0);
if (args[1] !== "stop") process.exit(1);

const waitFileIndex = args.indexOf("--wait-file");
const transcriptPath = waitFileIndex >= 0 ? args[waitFileIndex + 1] : undefined;
const outcome = control.outcome ?? "success";

if (outcome === "hang") {
  await Bun.sleep(10_000);
  process.exit(4);
}

if (outcome === "success") {
  const text = control.text ?? "dictated words";
  if (transcriptPath !== undefined) {
    writeFileSync(transcriptPath, text);
    writeFileSync(`${transcriptPath}.done`, JSON.stringify({ status: "ok", text }));
  }
  console.log(JSON.stringify({ status: "ok", text, chars: text.length, message: null }));
  process.exit(0);
}

if (transcriptPath !== undefined) {
  writeFileSync(`${transcriptPath}.done`, JSON.stringify({ status: outcome, message: outcome }));
}
console.log(JSON.stringify({ status: outcome === "failure" ? "error" : outcome, text: null, chars: 0, message: outcome }));
process.exit(outcome === "empty" ? 3 : outcome === "timeout" ? 4 : 1);
