import type { Database } from "bun:sqlite";
import type {
  WorkingTreeDetailDto,
  WorkingTreeFileCountsDto,
  WorkingTreeFileDto,
  WorkingTreeSummaryDto,
} from "@omarchy-bot/protocol";
import { HttpError } from "../bots/bots.ts";

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_DIFF_BYTES = 256 * 1024;
const DEFAULT_MAX_FILES = 200;
const decoder = new TextDecoder();

export interface WorkingTreeOptions {
  gitBin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxDiffBytes?: number;
  maxFiles?: number;
  fallbackRoot?: string;
}

interface GitResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  stdoutTruncated: boolean;
}

class GitTimeout extends Error {}
class GitOutputLimit extends Error {}

function splitNul(output: Uint8Array): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < output.byteLength; index += 1) {
    if (output[index] !== 0) continue;
    fields.push(decoder.decode(output.subarray(start, index)));
    start = index + 1;
  }
  if (start !== output.byteLength) throw new Error("Git returned a non-terminated record");
  return fields;
}

function statusKind(code: string): WorkingTreeFileDto["status"] {
  const x = code[0];
  const y = code[1];
  if (
    x === "U"
    || y === "U"
    || code === "DD"
    || code === "AA"
    || code === "AU"
    || code === "UA"
    || code === "DU"
    || code === "UD"
  ) return "conflicted";
  if (code === "??") return "untracked";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

function parseStatus(output: Uint8Array): WorkingTreeFileDto[] {
  const fields = splitNul(output);
  const files: WorkingTreeFileDto[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index]!;
    if (record.length < 4 || record[2] !== " ") throw new Error("Git returned an invalid status record");
    const code = record.slice(0, 2);
    const path = record.slice(3);
    const status = statusKind(code);
    if (path.length === 0) throw new Error("Git returned an empty status path");
    if (status === "renamed") {
      const previousPath = fields[index + 1];
      if (previousPath === undefined || previousPath.length === 0) throw new Error("Git returned an invalid rename record");
      index += 1;
      files.push({ path, previousPath, status, counts: { kind: "unknown" } });
      continue;
    }
    files.push({ path, status, counts: { kind: "unknown" } });
  }
  return files;
}

function parseCount(value: string): number | undefined {
  if (value === "-") return undefined;
  if (!/^\d+$/.test(value)) throw new Error("Git returned an invalid numstat count");
  return Number(value);
}

function parseNumstat(output: Uint8Array): Map<string, WorkingTreeFileCountsDto> {
  const fields = splitNul(output);
  const counts = new Map<string, WorkingTreeFileCountsDto>();
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index]!;
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab < 1 || secondTab < 0) throw new Error("Git returned an invalid numstat record");
    const additions = parseCount(record.slice(0, firstTab));
    const deletions = parseCount(record.slice(firstTab + 1, secondTab));
    let currentPath = record.slice(secondTab + 1);
    if (currentPath === "") {
      const previousPath = fields[index + 1];
      currentPath = fields[index + 2] ?? "";
      if (previousPath === undefined || previousPath.length === 0 || currentPath.length === 0) {
        throw new Error("Git returned an invalid numstat rename record");
      }
      index += 2;
    }
    counts.set(
      currentPath,
      additions === undefined || deletions === undefined
        ? { kind: "binary" }
        : { kind: "known", additions, deletions },
    );
  }
  return counts;
}

function parseUntrackedPatchCounts(patch: string): WorkingTreeFileCountsDto | undefined {
  if (/^Binary files? .+ differ$/m.test(patch)) return { kind: "binary" };

  let additions = 0;
  let sawHunk = false;
  for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+\d+(?:,(\d+))? @@/gm)) {
    additions += match[1] === undefined ? 1 : Number(match[1]);
    sawHunk = true;
  }
  if (sawHunk || /^new file mode \d+$/m.test(patch)) {
    return { kind: "known", additions, deletions: 0 };
  }
  return undefined;
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onLimit: () => void,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      onLimit();
      throw new GitOutputLimit("Git output limit exceeded");
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readTruncated(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onLimit: () => void,
): Promise<{ output: Uint8Array; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const remaining = maxBytes - total;
    if (next.value.byteLength > remaining) {
      if (remaining > 0) chunks.push(next.value.subarray(0, remaining));
      total = maxBytes;
      onLimit();
      await reader.cancel().catch(() => undefined);
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { output, truncated: true };
    }
    chunks.push(next.value);
    total += next.value.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { output, truncated: false };
}

/** Read-only, bounded projection of Git working-tree truth for one Bot workspace. */
export class WorkingTreeService {
  readonly #gitBin: string;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #maxFiles: number;
  readonly #fallbackRoot: string;
  readonly #maxDiffBytes: number;

  constructor(
    private readonly db: Database,
    options: WorkingTreeOptions = {},
  ) {
    this.#gitBin = options.gitBin ?? "git";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.#maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.#maxDiffBytes = options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;
    this.#fallbackRoot = options.fallbackRoot ?? process.cwd();
  }

  async summary(botId: string, threadId?: string): Promise<WorkingTreeSummaryDto> {
    const generatedAt = new Date().toISOString();
    const root = this.#effectiveRoot(botId, threadId);
    try {
      const repository = await this.#git(root, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
      if (repository.exitCode !== 0) {
        const diagnostic = decoder.decode(repository.stderr);
        if (diagnostic.includes("not a git repository")) return { state: "not_repository", generatedAt };
        return this.#unavailable(generatedAt, "Git failed while locating the repository.");
      }
      const repositoryRoot = decoder.decode(repository.stdout).trimEnd();
      if (repositoryRoot.length === 0) return this.#unavailable(generatedAt, "Git returned no repository root.");

      const status = await this.#git(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
      if (status.exitCode !== 0) return this.#unavailable(generatedAt, "Git failed while reading working-tree status.");
      const files = parseStatus(status.stdout);
      if (files.length === 0) return { state: "clean", generatedAt };

      const head = await this.#git(repositoryRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]);
      const diffArgs = head.exitCode === 0
        ? ["diff", "--numstat", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", "HEAD", "--"]
        : ["diff", "--cached", "--numstat", "-z", "--find-renames", "--no-ext-diff", "--no-textconv", "--"];
      const numstat = await this.#git(repositoryRoot, diffArgs);
      if (numstat.exitCode !== 0) return this.#unavailable(generatedAt, "Git failed while reading change counts.");
      const countByPath = parseNumstat(numstat.stdout);
      let additions = 0;
      let deletions = 0;
      let hasKnownCounts = false;
      for (const [index, file] of files.entries()) {
        let counts = countByPath.get(file.path);
        if (counts === undefined && file.status === "untracked" && index < this.#maxFiles) {
          counts = await this.#untrackedCounts(repositoryRoot, file.path);
        }
        if (counts === undefined) continue;
        file.counts = counts;
        if (counts.kind !== "known") continue;
        additions += counts.additions;
        deletions += counts.deletions;
        hasKnownCounts = true;
      }

      return {
        state: "ready",
        generatedAt,
        changedFileCount: files.length,
        ...(hasKnownCounts ? { additions, deletions } : {}),
        files: files.slice(0, this.#maxFiles),
        truncated: files.length > this.#maxFiles,
      };
    } catch (error) {
      if (error instanceof GitTimeout) return this.#unavailable(generatedAt, "Git timed out while reading changes.");
      if (error instanceof GitOutputLimit) return this.#unavailable(generatedAt, "Git output limit was exceeded.");
      return this.#unavailable(generatedAt, "Git changes are temporarily unavailable.");
    }
  }

  async detail(botId: string, threadId: string | undefined, requestedPath: string): Promise<WorkingTreeDetailDto> {
    const summary = await this.summary(botId, threadId);
    if (summary.state === "unavailable") throw new HttpError(503, summary.message);
    if (summary.state !== "ready") throw new HttpError(404, "Changed file is not present in the current working-tree summary.");
    const file = summary.files.find(({ path }) => path === requestedPath);
    if (file === undefined) throw new HttpError(404, "Changed file is not present in the current working-tree summary.");

    const fields = {
      path: file.path,
      ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
      status: file.status,
    };
    if (file.counts.kind === "binary") return { kind: "binary", ...fields };

    const root = this.#effectiveRoot(botId, threadId);
    try {
      const repository = await this.#git(root, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
      if (repository.exitCode !== 0) throw new HttpError(503, "Git failed while locating the changed file.");
      const repositoryRoot = decoder.decode(repository.stdout).trimEnd();
      if (repositoryRoot.length === 0) throw new HttpError(503, "Git returned no repository root.");

      const head = await this.#git(repositoryRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]);
      const useNoIndex = file.status === "untracked" || (head.exitCode !== 0 && file.status === "added");
      const diffOptions = ["--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];
      const pathspecs = file.previousPath === undefined ? [file.path] : [file.previousPath, file.path];
      const diffArgs = useNoIndex
        ? ["diff", "--no-index", ...diffOptions, "--", "/dev/null", file.path]
        : head.exitCode === 0
          ? ["diff", ...diffOptions, "--find-renames", "HEAD", "--", ...pathspecs]
          : ["diff", "--cached", ...diffOptions, "--find-renames", "--", ...pathspecs];
      const diff = await this.#git(repositoryRoot, diffArgs, { truncateStdoutAt: this.#maxDiffBytes });
      const successfulExit = useNoIndex ? diff.exitCode === 0 || diff.exitCode === 1 : diff.exitCode === 0;
      if (!diff.stdoutTruncated && !successfulExit) {
        throw new HttpError(503, "Git failed while reading changed-file detail.");
      }

      const patch = decoder.decode(diff.stdout);
      if (/^Binary files? .+ differ$/m.test(patch)) {
        return { kind: "binary", ...fields };
      }
      if (patch.length === 0) {
        return {
          kind: "unknown",
          ...fields,
          message: "No textual patch is available for this changed file.",
        };
      }
      return { kind: "text", ...fields, patch, truncated: diff.stdoutTruncated };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof GitTimeout) throw new HttpError(503, "Git timed out while reading changed-file detail.");
      if (error instanceof GitOutputLimit) throw new HttpError(503, "Git output limit was exceeded while reading changed-file detail.");
      throw new HttpError(503, "Changed-file detail is temporarily unavailable.");
    }
  }

  async #untrackedCounts(
    repositoryRoot: string,
    filePath: string,
  ): Promise<WorkingTreeFileCountsDto | undefined> {
    try {
      const diff = await this.#git(
        repositoryRoot,
        ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--", "/dev/null", filePath],
        { truncateStdoutAt: this.#maxDiffBytes },
      );
      if (diff.stdoutTruncated || (diff.exitCode !== 0 && diff.exitCode !== 1)) return undefined;
      const patch = decoder.decode(diff.stdout);
      if (patch.length === 0) {
        return diff.exitCode === 0 && diff.stderr.byteLength === 0
          ? { kind: "known", additions: 0, deletions: 0 }
          : undefined;
      }
      return parseUntrackedPatchCounts(patch);
    } catch {
      return undefined;
    }
  }

  #effectiveRoot(botId: string, threadId: string | undefined): string {
    const bot = this.db.query("SELECT id FROM bots WHERE id = ?").get(botId);
    if (bot === null || bot === undefined) throw new HttpError(404, `unknown bot ${botId}`);
    if (threadId === undefined) return this.#fallbackRoot;
    const thread = this.db.query("SELECT bot_id, cwd FROM threads WHERE id = ?").get(threadId) as {
      bot_id: string;
      cwd: string | null;
    } | null;
    if (thread === null || thread.bot_id !== botId) throw new HttpError(404, `unknown thread ${threadId} for bot ${botId}`);
    return thread.cwd ?? this.#fallbackRoot;
  }

  #unavailable(generatedAt: string, message: string): WorkingTreeSummaryDto {
    return { state: "unavailable", generatedAt, message, retryable: true };
  }

  async #git(
    cwd: string,
    args: string[],
    options?: { truncateStdoutAt: number },
  ): Promise<GitResult> {
    const processHandle = Bun.spawn({
      cmd: [
        this.#gitBin,
        "-c",
        "core.quotepath=false",
        "-c",
        "color.ui=false",
        ...args,
      ],
      cwd,
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      processHandle.kill();
    }, this.#timeoutMs);
    try {
      const stdoutPromise = options === undefined
        ? readBounded(processHandle.stdout, this.#maxOutputBytes, () => processHandle.kill())
          .then((output) => ({ output, truncated: false }))
        : readTruncated(processHandle.stdout, options.truncateStdoutAt, () => processHandle.kill());
      const [stdout, stderr, exitCode] = await Promise.all([
        stdoutPromise,
        readBounded(processHandle.stderr, this.#maxOutputBytes, () => processHandle.kill()),
        processHandle.exited,
      ]);
      if (timedOut) throw new GitTimeout("Git timed out");
      return {
        exitCode,
        stdout: stdout.output,
        stderr,
        stdoutTruncated: stdout.truncated,
      };
    } catch (error) {
      processHandle.kill();
      await processHandle.exited.catch(() => undefined);
      if (timedOut) throw new GitTimeout("Git timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
