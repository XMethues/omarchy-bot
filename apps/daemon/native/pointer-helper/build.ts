import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const sourceDir = import.meta.dir;
const outputDir = path.resolve(sourceDir, "../../dist/native-pointer");
const protocolXml = path.join(sourceDir, "wlr-virtual-pointer-unstable-v1.xml");
const helperSource = path.join(sourceDir, "main.c");
const protocolHeader = path.join(outputDir, "wlr-virtual-pointer-unstable-v1-client-protocol.h");
const protocolCode = path.join(outputDir, "wlr-virtual-pointer-unstable-v1-protocol.c");
export const pointerHelperBinary = path.join(outputDir, "omarchy-bot-wlr-pointer");

let activeBuild: Promise<string> | undefined;

async function run(argv: string[]): Promise<string> {
  const process = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (status !== 0) {
    throw new Error(`${argv[0]} failed${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`);
  }
  return stdout.trim();
}

async function buildPointerHelper(): Promise<string> {
  mkdirSync(outputDir, { recursive: true, mode: 0o755 });
  const scanner = Bun.which("wayland-scanner");
  const compiler = Bun.which(process.env.CC ?? "cc");
  const pkgConfig = Bun.which("pkg-config");
  if (scanner === null || compiler === null || pkgConfig === null) {
    throw new Error("wayland-scanner, a C compiler, and pkg-config are required to build Bot Screen pointer input");
  }
  await run([scanner, "client-header", protocolXml, protocolHeader]);
  await run([scanner, "private-code", protocolXml, protocolCode]);
  const flags = (await run([pkgConfig, "--cflags", "--libs", "wayland-client"])).split(/\s+/).filter(Boolean);
  await run([
    compiler,
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    `-I${outputDir}`,
    helperSource,
    protocolCode,
    ...flags,
    "-lm",
    "-o",
    pointerHelperBinary,
  ]);
  return pointerHelperBinary;
}

export function ensurePointerHelper(): Promise<string> {
  if (activeBuild !== undefined) return activeBuild;
  const sourcesMtime = Math.max(statSync(protocolXml).mtimeMs, statSync(helperSource).mtimeMs);
  if (existsSync(pointerHelperBinary) && statSync(pointerHelperBinary).mtimeMs >= sourcesMtime) {
    return Promise.resolve(pointerHelperBinary);
  }
  activeBuild = buildPointerHelper().finally(() => {
    activeBuild = undefined;
  });
  return activeBuild;
}

if (import.meta.main) {
  await ensurePointerHelper();
  console.log(pointerHelperBinary);
}
