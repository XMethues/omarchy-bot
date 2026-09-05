import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkingTreeDetailDto, WorkingTreeSummaryDto } from "../../packages/protocol/src/index.ts";
import {
  api,
  apiStatus,
  makeBot,
  startDaemon,
  type Harness,
} from "./helpers/harness.ts";

const roots: string[] = [];
let h: Harness;
let wrapperRoot: string;

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), `omarchy-bot-${label}-`));
  roots.push(root);
  return root;
}

function git(root: string, ...args: string[]): Uint8Array {
  const result = Bun.spawnSync({
    cmd: ["/usr/bin/git", "-c", "user.name=Changes Test", "-c", "user.email=changes@example.test", ...args],
    cwd: root,
    env: { ...process.env, LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
  return result.stdout;
}

function initRepository(): string {
  const root = temporaryRoot("changes-repo");
  git(root, "init", "-b", "main");
  return root;
}

function commitAll(root: string, message = "fixture"): void {
  git(root, "add", "--all");
  git(root, "commit", "-m", message);
}

function threadFor(botId: string, cwd: string): string {
  return h.svc.threads.createThread(botId, { title: "Changes fixture", cwd }).id;
}

function summary(botId: string, threadId?: string): Promise<WorkingTreeSummaryDto> {
  const query = threadId === undefined ? "" : `?threadId=${encodeURIComponent(threadId)}`;
  return api(h, "GET", `/api/bots/${botId}/changes${query}`);
}

function detail(botId: string, threadId: string, filePath: string): Promise<WorkingTreeDetailDto> {
  const query = new URLSearchParams({ threadId, path: filePath });
  return api(h, "GET", `/api/bots/${botId}/changes/detail?${query}`);
}

function repositorySnapshot(root: string): {
  head: string;
  status: Uint8Array;
  staged: Uint8Array;
  unstaged: Uint8Array;
  index: Uint8Array;
} {
  return {
    head: new TextDecoder().decode(git(root, "rev-parse", "HEAD")),
    status: git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all"),
    staged: git(root, "diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv"),
    unstaged: git(root, "diff", "--binary", "--no-ext-diff", "--no-textconv"),
    index: readFileSync(path.join(root, ".git", "index")),
  };
}

beforeAll(async () => {
  wrapperRoot = temporaryRoot("changes-git-wrapper");
  const wrapper = path.join(wrapperRoot, "git");
  writeFileSync(wrapper, `#!/bin/sh
is_detail_diff=0
for arg in "$@"; do
  if [ "$arg" = "diff" ]; then is_detail_diff=1; fi
  if [ "$arg" = "--numstat" ]; then is_detail_diff=0; break; fi
done
if [ "$is_detail_diff" = 1 ] && [ -e .git-detail-timeout ]; then sleep 2; fi
if [ "$is_detail_diff" = 1 ] && [ -e .git-detail-fail ]; then printf 'injected detail failure\\n' >&2; exit 23; fi
if [ "$is_detail_diff" = 1 ] && [ -e .git-detail-loud-stderr ]; then yes 'bounded detail failure' | head -c 8192 >&2; exit 24; fi
if [ -e .git-timeout ]; then sleep 2; fi
if [ -e .git-fail ]; then printf 'injected git failure\\n' >&2; exit 23; fi
if [ -e .git-loud-stderr ]; then yes 'bounded git failure' | head -c 8192 >&2; exit 24; fi
if [ -e .git-loud-stdout ]; then yes 'bounded git output' | head -c 8192; exit 0; fi
exec /usr/bin/git "$@"
`);
  chmodSync(wrapper, 0o755);
  h = await startDaemon(undefined, {
    workingTree: {
      gitBin: wrapper,
      timeoutMs: 150,
      maxOutputBytes: 4_096,
      maxDiffBytes: 512,
      maxFiles: 12,
    },
  });
}, 30_000);

afterAll(async () => {
  await h?.stop();
  for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true });
});

describe("working-tree Changes HTTP API", () => {
  test("reports clean and bounded mixed working-tree truth without mutating the repository or index", async () => {
    const botId = await makeBot(h, "Working Tree Bot");
    const root = initRepository();
    for (const [name, contents] of [
      ["modified.txt", "base\n"],
      ["staged-modified.txt", "base\n"],
      ["deleted.txt", "remove me\n"],
      ["old name.txt", "rename me\n"],
    ] as const) writeFileSync(path.join(root, name), contents);
    writeFileSync(path.join(root, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    commitAll(root, "base");
    const threadId = threadFor(botId, root);

    const clean = await summary(botId, threadId);
    expect(clean).toMatchObject({ state: "clean", generatedAt: expect.any(String) });

    writeFileSync(path.join(root, "modified.txt"), "base\nworking tree\n");
    writeFileSync(path.join(root, "staged-modified.txt"), "base\nstaged\n");
    git(root, "add", "staged-modified.txt");
    unlinkSync(path.join(root, "deleted.txt"));
    git(root, "mv", "old name.txt", "renamed name.txt");
    writeFileSync(path.join(root, "added.txt"), "new\nfile\n");
    git(root, "add", "added.txt");
    writeFileSync(path.join(root, "binary.dat"), Buffer.from([0, 4, 5, 6]));
    const untrackedText: Record<string, string> = {
      "space name.txt": "first\nsecond\n",
      "tab\tname.txt": "untracked\n",
      "line\nname.txt": "untracked\n",
      "!leading.txt": "untracked\n",
    };
    for (const [name, contents] of Object.entries(untrackedText)) writeFileSync(path.join(root, name), contents);
    writeFileSync(path.join(root, "untracked.bin"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(path.join(root, "oversized.txt"), `${"wide".repeat(200)}\n`);

    const before = repositorySnapshot(root);
    const result = await summary(botId, threadId);
    const after = repositorySnapshot(root);

    expect(result).toMatchObject({
      state: "ready",
      changedFileCount: 12,
      additions: 9,
      deletions: 1,
      truncated: false,
    });
    if (result.state !== "ready") throw new Error(`expected ready, received ${result.state}`);
    const files = new Map(result.files.map((file) => [file.path, file]));
    expect(files.get("modified.txt")).toMatchObject({
      status: "modified",
      counts: { kind: "known", additions: 1, deletions: 0 },
    });
    expect(files.get("staged-modified.txt")).toMatchObject({
      status: "modified",
      counts: { kind: "known", additions: 1, deletions: 0 },
    });
    expect(files.get("deleted.txt")).toMatchObject({
      status: "deleted",
      counts: { kind: "known", additions: 0, deletions: 1 },
    });
    expect(files.get("renamed name.txt")).toMatchObject({
      status: "renamed",
      previousPath: "old name.txt",
      counts: { kind: "known", additions: 0, deletions: 0 },
    });
    expect(files.get("added.txt")).toMatchObject({
      status: "added",
      counts: { kind: "known", additions: 2, deletions: 0 },
    });
    expect(files.get("binary.dat")).toMatchObject({ status: "modified", counts: { kind: "binary" } });
    for (const [name, contents] of Object.entries(untrackedText)) {
      expect(files.get(name)).toEqual({
        path: name,
        status: "untracked",
        counts: {
          kind: "known",
          additions: contents.split("\n").length - 1,
          deletions: 0,
        },
      });
    }
    expect(files.get("untracked.bin")).toEqual({
      path: "untracked.bin",
      status: "untracked",
      counts: { kind: "binary" },
    });
    expect(files.get("oversized.txt")).toEqual({
      path: "oversized.txt",
      status: "untracked",
      counts: { kind: "unknown" },
    });
    expect(after).toEqual(before);
  });

  test("opens an authorized tracked change as a read-only patch against HEAD", async () => {
    const botId = await makeBot(h, "Tracked Detail Bot");
    const root = initRepository();
    writeFileSync(path.join(root, "tracked.txt"), "before\n");
    commitAll(root);
    const threadId = threadFor(botId, root);
    writeFileSync(path.join(root, "tracked.txt"), "after\n");
    const before = repositorySnapshot(root);

    const result = await detail(botId, threadId, "tracked.txt");

    expect(result).toMatchObject({
      kind: "text",
      path: "tracked.txt",
      status: "modified",
      truncated: false,
    });
    if (result.kind !== "text") throw new Error(`expected text detail, received ${result.kind}`);
    expect(result.patch).toContain("diff --git a/tracked.txt b/tracked.txt");
    expect(result.patch).toContain("-before");
    expect(result.patch).toContain("+after");
    expect(repositorySnapshot(root)).toEqual(before);
  });

  test("combines staged and unstaged edits against HEAD", async () => {
    const botId = await makeBot(h, "Combined Detail Bot");
    const root = initRepository();
    writeFileSync(path.join(root, "both.txt"), "base\n");
    commitAll(root);
    const threadId = threadFor(botId, root);
    writeFileSync(path.join(root, "both.txt"), "staged\n");
    git(root, "add", "both.txt");
    writeFileSync(path.join(root, "both.txt"), "staged\nunstaged\n");

    const result = await detail(botId, threadId, "both.txt");

    expect(result).toMatchObject({ kind: "text", path: "both.txt", status: "modified", truncated: false });
    if (result.kind !== "text") throw new Error(`expected text detail, received ${result.kind}`);
    expect(result.patch).toContain("-base");
    expect(result.patch).toContain("+staged");
    expect(result.patch).toContain("+unstaged");
  });

  test("opens added, deleted, and renamed paths with truthful attribution", async () => {
    const botId = await makeBot(h, "Path State Detail Bot");
    const root = initRepository();
    writeFileSync(path.join(root, "deleted.txt"), "gone\n");
    writeFileSync(path.join(root, "before name.txt"), "moved\n");
    commitAll(root);
    const threadId = threadFor(botId, root);
    unlinkSync(path.join(root, "deleted.txt"));
    git(root, "mv", "before name.txt", "after name.txt");
    writeFileSync(path.join(root, "added.txt"), "added\n");
    git(root, "add", "added.txt");

    const added = await detail(botId, threadId, "added.txt");
    const deleted = await detail(botId, threadId, "deleted.txt");
    const renamed = await detail(botId, threadId, "after name.txt");

    expect(added).toMatchObject({ kind: "text", path: "added.txt", status: "added", truncated: false });
    expect(deleted).toMatchObject({ kind: "text", path: "deleted.txt", status: "deleted", truncated: false });
    expect(renamed).toMatchObject({
      kind: "text",
      path: "after name.txt",
      previousPath: "before name.txt",
      status: "renamed",
      truncated: false,
    });
    if (added.kind !== "text" || deleted.kind !== "text" || renamed.kind !== "text") {
      throw new Error("expected textual added, deleted, and renamed detail");
    }
    expect(added.patch).toContain("+added");
    expect(deleted.patch).toContain("-gone");
    expect(renamed.patch).toContain("rename from before name.txt");
    expect(renamed.patch).toContain("rename to after name.txt");
  });

  test("opens unusual and empty untracked text safely and identifies binary detail", async () => {
    const botId = await makeBot(h, "Untracked Detail Bot");
    const root = initRepository();
    writeFileSync(path.join(root, "base.txt"), "base\n");
    commitAll(root);
    const threadId = threadFor(botId, root);
    const unusual = " !odd\tline\nname.txt";
    writeFileSync(path.join(root, unusual), "untracked detail\n");
    writeFileSync(path.join(root, "untracked.bin"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(path.join(root, "empty.txt"), "");

    const text = await detail(botId, threadId, unusual);
    const binary = await detail(botId, threadId, "untracked.bin");
    const empty = await detail(botId, threadId, "empty.txt");

    expect(text).toMatchObject({ kind: "text", path: unusual, status: "untracked", truncated: false });
    if (text.kind !== "text") throw new Error(`expected text detail, received ${text.kind}`);
    expect(text.patch).toContain("+untracked detail");
    expect(binary).toEqual({ kind: "binary", path: "untracked.bin", status: "untracked" });
    expect(empty).toMatchObject({ kind: "text", path: "empty.txt", status: "untracked", truncated: false });
    if (empty.kind !== "text") throw new Error(`expected empty text detail, received ${empty.kind}`);
    expect(empty.patch).toContain("new file mode");
  });

  test("opens conflicted and unborn changes with explicit truthful detail", async () => {
    const botId = await makeBot(h, "Conflict Bot");
    const conflicted = initRepository();
    writeFileSync(path.join(conflicted, "conflict.txt"), "base\n");
    commitAll(conflicted, "base");
    git(conflicted, "checkout", "-b", "other");
    writeFileSync(path.join(conflicted, "conflict.txt"), "other\n");
    commitAll(conflicted, "other");
    git(conflicted, "checkout", "main");
    writeFileSync(path.join(conflicted, "conflict.txt"), "main\n");
    commitAll(conflicted, "main");
    const merge = Bun.spawnSync({ cmd: ["/usr/bin/git", "merge", "other"], cwd: conflicted, stdout: "pipe", stderr: "pipe" });
    expect(merge.exitCode).not.toBe(0);

    const conflictThreadId = threadFor(botId, conflicted);
    const conflictResult = await summary(botId, conflictThreadId);
    expect(conflictResult.state).toBe("ready");
    if (conflictResult.state !== "ready") throw new Error("expected conflict summary");
    expect(conflictResult.files).toContainEqual(expect.objectContaining({ path: "conflict.txt", status: "conflicted" }));
    const conflictDetail = await detail(botId, conflictThreadId, "conflict.txt");
    expect(conflictDetail).toMatchObject({ kind: "text", path: "conflict.txt", status: "conflicted", truncated: false });
    if (conflictDetail.kind !== "text") throw new Error(`expected conflict text, received ${conflictDetail.kind}`);
    expect(conflictDetail.patch).toContain("+<<<<<<< HEAD");

    const unborn = initRepository();
    writeFileSync(path.join(unborn, "staged new.txt"), "first\nsecond\n");
    git(unborn, "add", "staged new.txt");
    writeFileSync(path.join(unborn, "untracked.txt"), "later\n");
    const unbornThreadId = threadFor(botId, unborn);
    const unbornResult = await summary(botId, unbornThreadId);
    expect(unbornResult).toMatchObject({ state: "ready", changedFileCount: 2, additions: 3, deletions: 0 });
    if (unbornResult.state !== "ready") throw new Error("expected unborn summary");
    expect(unbornResult.files).toContainEqual({
      path: "staged new.txt",
      status: "added",
      counts: { kind: "known", additions: 2, deletions: 0 },
    });
    const unbornDetail = await detail(botId, unbornThreadId, "staged new.txt");
    expect(unbornDetail).toMatchObject({ kind: "text", path: "staged new.txt", status: "added", truncated: false });
    if (unbornDetail.kind !== "text") throw new Error(`expected unborn text, received ${unbornDetail.kind}`);
    expect(unbornDetail.patch).toContain("+first");
    expect(unbornDetail.patch).toContain("+second");
  });

  test("uses daemon cwd fallback and distinguishes non-repositories from retryable Git failures and timeouts", async () => {
    const botId = await makeBot(h, "Unavailable Bot");
    const fallback = await summary(botId);
    expect(["clean", "ready"]).toContain(fallback.state);

    const plain = temporaryRoot("changes-not-repository");
    expect(await summary(botId, threadFor(botId, plain))).toMatchObject({ state: "not_repository" });

    for (const [marker, expected] of [
      [".git-fail", /failed/i],
      [".git-timeout", /timed out/i],
      [".git-loud-stderr", /output limit/i],
      [".git-loud-stdout", /output limit/i],
    ] as const) {
      const root = temporaryRoot("changes-unavailable");
      writeFileSync(path.join(root, marker), "fixture");
      const result = await summary(botId, threadFor(botId, root));
      expect(result).toMatchObject({ state: "unavailable", retryable: true });
      if (result.state !== "unavailable") throw new Error("expected unavailable summary");
      expect(result.message).toMatch(expected);
      expect(result.message.length).toBeLessThan(512);
    }
  });

  test("authorizes Thread identity within the route Bot and rejects every client root/path attempt", async () => {
    const firstBot = await makeBot(h, "Authorized Bot");
    const secondBot = await makeBot(h, "Other Bot");
    const root = initRepository();
    const threadId = threadFor(firstBot, root);

    expect((await summary(firstBot, threadId)).state).toBe("clean");
    for (const requestPath of [
      `/api/bots/${secondBot}/changes?threadId=${encodeURIComponent(threadId)}`,
      `/api/bots/${firstBot}/changes?threadId=missing_thread`,
      `/api/bots/${firstBot}/changes?root=${encodeURIComponent(root)}`,
      `/api/bots/${firstBot}/changes?path=${encodeURIComponent("../secret")}`,
      `/api/bots/${firstBot}/changes?threadId=${encodeURIComponent("/absolute/thread")}`,
      `/api/bots/${firstBot}/changes?threadId=${encodeURIComponent("../parent")}`,
      `/api/bots/${firstBot}/changes?threadId=${encodeURIComponent("nul\0thread")}`,
    ]) {
      const response = await apiStatus(h, "GET", requestPath);
      expect([400, 404]).toContain(response.status);
    }
  });

  test("rejects unsafe, absent, and cross-Bot detail paths with bounded safe errors", async () => {
    const firstBot = await makeBot(h, "Detail Authorization Bot");
    const secondBot = await makeBot(h, "Detail Other Bot");
    const root = initRepository();
    writeFileSync(path.join(root, "present.txt"), "before\n");
    commitAll(root);
    writeFileSync(path.join(root, "present.txt"), "after\n");
    const threadId = threadFor(firstBot, root);
    const endpoint = (botId: string, candidatePath: string, candidateThread = threadId): string => {
      const query = new URLSearchParams({ threadId: candidateThread, path: candidatePath });
      return `/api/bots/${botId}/changes/detail?${query}`;
    };

    for (const [requestPath, expectedStatus] of [
      [endpoint(secondBot, "present.txt"), 404],
      [endpoint(firstBot, "present.txt", "missing_thread"), 404],
      [endpoint(firstBot, "absent.txt"), 404],
      [endpoint(firstBot, "/etc/passwd"), 400],
      [endpoint(firstBot, "../secret"), 400],
      [endpoint(firstBot, "folder/../../secret"), 400],
      [endpoint(firstBot, "nul\0name"), 400],
      [`${endpoint(firstBot, "present.txt")}&path=other.txt`, 400],
      [`${endpoint(firstBot, "present.txt")}&root=${encodeURIComponent(root)}`, 400],
    ] as const) {
      const response = await apiStatus(h, "GET", requestPath);
      expect(response.status).toBe(expectedStatus);
      expect(response.body).toMatchObject({ error: expect.any(String) });
      expect(JSON.stringify(response.body).length).toBeLessThan(600);
    }
  });

  test("maps detail Git failure, timeout, and stderr overflow to bounded safe errors", async () => {
    const botId = await makeBot(h, "Detail Failure Bot");
    for (const [marker, expected] of [
      [".git-detail-fail", /failed/i],
      [".git-detail-timeout", /timed out/i],
      [".git-detail-loud-stderr", /output limit/i],
    ] as const) {
      const root = initRepository();
      writeFileSync(path.join(root, "tracked.txt"), "before\n");
      commitAll(root);
      writeFileSync(path.join(root, "tracked.txt"), "after\n");
      writeFileSync(path.join(root, marker), "fixture");
      const query = new URLSearchParams({ threadId: threadFor(botId, root), path: "tracked.txt" });

      const response = await apiStatus(h, "GET", `/api/bots/${botId}/changes/detail?${query}`);

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ error: expect.stringMatching(expected) });
      expect(JSON.stringify(response.body).length).toBeLessThan(600);
    }
  });

  test("bounds diff bytes, discloses truncation, disables color, and does not mutate repository state", async () => {
    const botId = await makeBot(h, "Detail Truncation Bot");
    const root = initRepository();
    writeFileSync(path.join(root, "large.txt"), "base\n");
    commitAll(root);
    writeFileSync(path.join(root, "large.txt"), `${Array.from({ length: 120 }, (_, index) => `changed-${index}`).join("\n")}\n`);
    const threadId = threadFor(botId, root);
    const before = repositorySnapshot(root);

    const result = await detail(botId, threadId, "large.txt");

    expect(result).toMatchObject({ kind: "text", path: "large.txt", status: "modified", truncated: true });
    if (result.kind !== "text") throw new Error(`expected truncated text, received ${result.kind}`);
    expect(new TextEncoder().encode(result.patch).byteLength).toBeLessThanOrEqual(512);
    expect(result.patch).not.toContain("\u001b[");
    expect(repositorySnapshot(root)).toEqual(before);
  });

  test("caps the file list, reports total truth, and never presents a bounded list as complete", async () => {
    const botId = await makeBot(h, "Truncation Bot");
    const root = initRepository();
    writeFileSync(path.join(root, "base.txt"), "base\n");
    commitAll(root);
    for (let index = 0; index < 15; index += 1) {
      writeFileSync(path.join(root, `untracked-${String(index).padStart(2, "0")}.txt`), "new\n");
    }

    const result = await summary(botId, threadFor(botId, root));
    expect(result).toMatchObject({ state: "ready", changedFileCount: 15, truncated: true });
    if (result.state !== "ready") throw new Error("expected truncated summary");
    expect(result.files).toHaveLength(12);
  });
});
