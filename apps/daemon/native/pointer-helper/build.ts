import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const sourceDir = import.meta.dir;
const outputDir = path.resolve(sourceDir, "../../dist/native-pointer");
const pointerProtocolXml = path.join(sourceDir, "wlr-virtual-pointer-unstable-v1.xml");
const keyboardProtocolXml = path.join(sourceDir, "virtual-keyboard-unstable-v1.xml");
const helperSource = path.join(sourceDir, "main.c");
const pointerProtocolHeader = path.join(outputDir, "wlr-virtual-pointer-unstable-v1-client-protocol.h");
const pointerProtocolCode = path.join(outputDir, "wlr-virtual-pointer-unstable-v1-protocol.c");
const keyboardProtocolHeader = path.join(outputDir, "virtual-keyboard-unstable-v1-client-protocol.h");
const keyboardProtocolCode = path.join(outputDir, "virtual-keyboard-unstable-v1-protocol.c");
export const inputHelperBinary = path.join(outputDir, "omarchy-bot-wayland-input");

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

async function buildInputHelper(): Promise<string> {
  mkdirSync(outputDir, { recursive: true, mode: 0o755 });
  const scanner = Bun.which("wayland-scanner");
  const compiler = Bun.which(process.env.CC ?? "cc");
  const pkgConfig = Bun.which("pkg-config");
  if (scanner === null || compiler === null || pkgConfig === null) {
    throw new Error("wayland-scanner, a C compiler, and pkg-config are required to build Bot Screen input");
  }
  await run([scanner, "client-header", pointerProtocolXml, pointerProtocolHeader]);
  await run([scanner, "private-code", pointerProtocolXml, pointerProtocolCode]);
  await run([scanner, "client-header", keyboardProtocolXml, keyboardProtocolHeader]);
  await run([scanner, "private-code", keyboardProtocolXml, keyboardProtocolCode]);
  const flags = (await run([pkgConfig, "--cflags", "--libs", "wayland-client", "xkbcommon"])).split(/\s+/).filter(Boolean);
  await run([
    compiler,
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    `-I${outputDir}`,
    helperSource,
    pointerProtocolCode,
    keyboardProtocolCode,
    ...flags,
    "-lm",
    "-o",
    inputHelperBinary,
  ]);
  return inputHelperBinary;
}

export function ensureInputHelper(): Promise<string> {
  if (activeBuild !== undefined) return activeBuild;
  const sourcesMtime = Math.max(
    statSync(pointerProtocolXml).mtimeMs,
    statSync(keyboardProtocolXml).mtimeMs,
    statSync(helperSource).mtimeMs,
  );
  if (existsSync(inputHelperBinary) && statSync(inputHelperBinary).mtimeMs >= sourcesMtime) {
    return Promise.resolve(inputHelperBinary);
  }
  activeBuild = buildInputHelper().finally(() => {
    activeBuild = undefined;
  });
  return activeBuild;
}

if (import.meta.main) {
  await ensureInputHelper();
  console.log(inputHelperBinary);
}
