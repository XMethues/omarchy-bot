import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { isSocket, processAlive, privateRuntimeProcesses, ownedProcessRunning, terminateOwnedProcess, type OwnedProcessIdentity } from "./botScreenWaylandHelpers.ts";

/** One-shot teardown of leftover Cage trees. Not a compositor selector. */
export const DESTROY_LEFTOVER_CAGE_ENV = "OMARCHY_BOT_DESTROY_LEFTOVER_CAGE";

export interface LeftoverCageTree {
  surfaceId: string;
  generation: string;
  runtimeDir: string;
  pids: number[];
  identities: OwnedProcessIdentity[];
}

function parseEnviron(raw: Buffer): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of raw.toString("utf8").split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return env;
}

function processRuntimeDir(pid: number): string | undefined {
  try {
    return parseEnviron(readFileSync(`/proc/${pid}/environ`)).XDG_RUNTIME_DIR;
  } catch {
    return undefined;
  }
}

function processCommandLine(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
  } catch {
    return "";
  }
}

function isSwayGeneration(runtimeDir: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(path.join(runtimeDir, "generation.json"), "utf8")) as { compositor?: unknown; generation?: unknown };
    if (marker.compositor === "sway" && String(marker.generation) === path.basename(runtimeDir)) return true;
  } catch { /* Older generations only have session.json. */ }
  if (!existsSync(path.join(runtimeDir, "session.json"))) return false;
  try {
    const parsed = JSON.parse(readFileSync(path.join(runtimeDir, "session.json"), "utf8")) as {
      swaySockName?: unknown;
    };
    return typeof parsed.swaySockName === "string" && parsed.swaySockName !== "";
  } catch {
    return false;
  }
}

function hasWaylandSocket(runtimeDir: string): boolean {
  if (!existsSync(runtimeDir)) return false;
  return readdirSync(runtimeDir).some((entry) =>
    /^wayland-\d+$/.test(entry) && isSocket(path.join(runtimeDir, entry))
  );
}

function pidsUsingRuntimeDir(runtimeDir: string): number[] {
  const pids: number[] = [];
  let procEntries: string[];
  try {
    procEntries = readdirSync("/proc");
  } catch {
    return pids;
  }
  for (const entry of procEntries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (!processAlive(pid)) continue;
    const childRuntime = processRuntimeDir(pid);
    if (childRuntime !== runtimeDir) continue;
    pids.push(pid);
  }
  return pids;
}

/** Leftover Cage trees under the Bot Screen runtime root. Sway generations are ignored. */
export function leftoverCageTrees(runtimeRoot: string): LeftoverCageTree[] {
  if (!existsSync(runtimeRoot)) return [];
  const trees: LeftoverCageTree[] = [];
  for (const surfaceId of readdirSync(runtimeRoot)) {
    if (!surfaceId.startsWith("surf_")) continue;
    const surfaceDir = path.join(runtimeRoot, surfaceId);
    let generations: string[];
    try {
      generations = readdirSync(surfaceDir);
    } catch {
      continue;
    }
    for (const generation of generations) {
      if (!/^\d+$/.test(generation)) continue;
      const runtimeDir = path.join(surfaceDir, generation);
      if (isSwayGeneration(runtimeDir)) continue;
      const pids = pidsUsingRuntimeDir(runtimeDir);
      const looksLikeCage = hasWaylandSocket(runtimeDir)
        || pids.some((pid) => /\bcage\b/.test(processCommandLine(pid)));
      if (!looksLikeCage && pids.length === 0) continue;
      const identities = privateRuntimeProcesses(runtimeDir);
      trees.push({ surfaceId, generation, runtimeDir, pids, identities });
    }
  }
  return trees;
}

export function liveLeftoverCageTrees(runtimeRoot: string): LeftoverCageTree[] {
  return leftoverCageTrees(runtimeRoot).filter((tree) => tree.identities.some(ownedProcessRunning));
}

export function leftoverCageBlockMessage(trees: LeftoverCageTree[]): string {
  const surfaces = [...new Set(trees.map((tree) => tree.surfaceId))].join(", ");
  return [
    "Active Cage Bot Desktop Sessions are still running.",
    "Save work in those sessions before continuing.",
    "This cutover does not move live processes or unsaved in-memory state to Sway.",
    `Wait until those Cage sessions exit, or set ${DESTROY_LEFTOVER_CAGE_ENV}=1 to destroy leftover Cage trees and start a new Sway generation.`,
    `Leftover Cage surfaces: ${surfaces}`,
  ].join(" ");
}

export async function destroyLeftoverCageTrees(trees: LeftoverCageTree[]): Promise<void> {
  for (const tree of trees) {
    await Promise.all(tree.identities.map(terminateOwnedProcess));
    rmSync(tree.runtimeDir, { recursive: true, force: true });
  }
}

export async function prepareSwayProductionCutover(runtimeRoot: string): Promise<void> {
  const live = liveLeftoverCageTrees(runtimeRoot);
  if (live.length === 0) return;
  if (process.env[DESTROY_LEFTOVER_CAGE_ENV] === "1") {
    await destroyLeftoverCageTrees(live);
    return;
  }
  throw new Error(leftoverCageBlockMessage(live));
}
