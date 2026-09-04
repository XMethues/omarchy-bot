import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const sourceDir = import.meta.dir;
const outputDir = path.resolve(sourceDir, "../../dist/native-bot-desktop");
const helperSource = path.join(sourceDir, "main.c");
const protocolHeader = path.join(outputDir, "xdg-shell-client-protocol.h");
const protocolCode = path.join(outputDir, "xdg-shell-protocol.c");
export const botDesktopBinary = path.join(outputDir, "omarchy-bot-desktop");

let activeBuild: Promise<string> | undefined;

async function run(argv: string[]): Promise<string> {
  const process = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (status !== 0) throw new Error(`${argv[0]} failed${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`);
  return stdout.trim();
}

async function buildBotDesktop(): Promise<string> {
  mkdirSync(outputDir, { recursive: true, mode: 0o755 });
  const scanner = Bun.which("wayland-scanner");
  const compiler = Bun.which(process.env.CC ?? "cc");
  const pkgConfig = Bun.which("pkg-config");
  if (scanner === null || compiler === null || pkgConfig === null) {
    throw new Error("wayland-scanner, a C compiler, and pkg-config are required to build Bot Desktop");
  }
  const protocolsDir = await run([pkgConfig, "--variable=pkgdatadir", "wayland-protocols"]);
  const protocolXml = path.join(protocolsDir, "stable", "xdg-shell", "xdg-shell.xml");
  if (!existsSync(protocolXml)) throw new Error("the stable xdg-shell protocol is required to build Bot Desktop");
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
    "-o",
    botDesktopBinary,
  ]);
  return botDesktopBinary;
}

export function ensureBotDesktop(): Promise<string> {
  if (activeBuild !== undefined) return activeBuild;
  if (existsSync(botDesktopBinary) && statSync(botDesktopBinary).mtimeMs >= statSync(helperSource).mtimeMs) {
    return Promise.resolve(botDesktopBinary);
  }
  activeBuild = buildBotDesktop().finally(() => {
    activeBuild = undefined;
  });
  return activeBuild;
}

if (import.meta.main) {
  await ensureBotDesktop();
  console.log(botDesktopBinary);
}
