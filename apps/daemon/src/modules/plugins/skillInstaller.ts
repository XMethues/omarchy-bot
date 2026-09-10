import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { unzipSync } from "fflate";
import { Parser, x as extractTar } from "tar";
import type { CatalogSkillDetailDto } from "@omarchy-bot/protocol";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 2000;

function relativeFile(value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)
    || value.split("/").some((part) => part === ".." || part === ".git")) throw new Error("Skill contains an unsafe file path");
  const normalized = path.posix.normalize(value).replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized === "." || !normalized) throw new Error("Skill contains an empty file path");
  return normalized;
}

export function skillFrontmatter(contents: string): { name: string; description: string } {
  const header = contents.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!header) throw new Error("SKILL.md has no YAML frontmatter");
  const fields: unknown = parseYaml(header[1]!, { maxAliasCount: 0 });
  if (!fields || typeof fields !== "object" || !("name" in fields) || !("description" in fields)
    || typeof fields.name !== "string" || typeof fields.description !== "string" || !fields.name.trim() || !fields.description.trim()) {
    throw new Error("SKILL.md must declare a name and description");
  }
  return { name: fields.name.trim(), description: fields.description.trim() };
}

async function download(url: URL): Promise<Uint8Array> {
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Skill sources must use HTTPS without embedded credentials");
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!response.ok) throw new Error(`Skill source returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Skill source exceeds the 100 MiB installation limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Skill source returned no content");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_BYTES) throw new Error("Skill source exceeds the 100 MiB installation limit");
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks, size);
}

async function git(args: string[], cwd: string, home: string): Promise<Buffer> {
  const process = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", ...args], {
    cwd, stdout: "pipe", stderr: "pipe", timeout: 120_000,
    env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin", HOME: home, XDG_CONFIG_HOME: home, LANG: "C", LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
  });
  const [stdout, stderr, status] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited]);
  if (status !== 0) throw new Error(`Git skill retrieval failed: ${stderr.slice(-1000).trim() || `exit ${status}`}`);
  if (stdout.byteLength > MAX_BYTES) throw new Error("Skill file exceeds the installation limit");
  return Buffer.from(stdout);
}

async function installGithub(detail: CatalogSkillDetailDto, staging: string, target: string): Promise<string> {
  const source = new URL(detail.installUrl);
  if (source.hostname !== "github.com" || source.protocol !== "https:" || source.username || source.password || source.search || source.hash
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(detail.source)
    || source.pathname.replace(/^\//, "").replace(/\.git$/, "").replace(/\/$/, "") !== detail.source) throw new Error("Catalog GitHub source identity does not match its repository");
  const repository = path.join(staging, "repository");
  await git(["clone", "--depth=1", "--no-checkout", "--filter=blob:limit=1048576", "--template=", `https://github.com/${detail.source}.git`, repository], staging, staging);
  const commit = (await git(["rev-parse", "HEAD"], repository, staging)).toString().trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Git did not resolve an immutable source revision");
  const tree = (await git(["ls-tree", "-rz", "--full-tree", commit], repository, staging)).toString();
  const entries = tree.split("\0").filter(Boolean).map((entry) => {
    const match = entry.match(/^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/);
    if (!match) throw new Error("Invalid Git tree entry");
    return { mode: match[1]!, type: match[2]!, hash: match[3]!, file: relativeFile(match[4]!) };
  });
  const slug = detail.id.split("/").at(-1)!;
  const candidates = entries.filter((entry) => entry.file === "SKILL.md" || entry.file.endsWith("/SKILL.md"));
  if (candidates.length > MAX_FILES) throw new Error("Repository contains too many skill definitions");
  const matches: typeof candidates = [];
  for (const candidate of candidates) {
    if (candidate.type !== "blob" || !["100644", "100755"].includes(candidate.mode)) continue;
    const contents = (await git(["cat-file", "blob", candidate.hash], repository, staging)).toString();
    let metadata: { name: string; description: string };
    try { metadata = skillFrontmatter(contents); } catch { continue; }
    const normalizedName = metadata.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (normalizedName === slug || metadata.name === slug) matches.push(candidate);
  }
  if (matches.length !== 1) throw new Error(matches.length ? "Skill name is ambiguous within its repository" : "The exact catalog skill was not found in the current repository revision");
  const skillFile = matches[0]!.file;
  const directory = path.posix.dirname(skillFile);
  const prefix = directory === "." ? "" : `${directory}/`;
  const assets = entries.filter((entry) => entry.file.startsWith(prefix));
  if (assets.length > MAX_FILES) throw new Error("Skill contains more than 2000 supporting files");
  let total = 0;
  for (const asset of assets) {
    if (asset.type !== "blob" || !["100644", "100755"].includes(asset.mode)) throw new Error("Skill contains symlinks or submodules; those cannot be installed safely as a self-contained folder");
    const size = Number((await git(["cat-file", "-s", asset.hash], repository, staging)).toString());
    if (!Number.isSafeInteger(size) || size < 0 || total + size > MAX_BYTES) throw new Error("Skill exceeds the 100 MiB installation limit");
    const bytes = await git(["cat-file", "blob", asset.hash], repository, staging);
    if (bytes.subarray(0, 128).toString().startsWith("version https://git-lfs.github.com/spec/v1")) throw new Error("Skill uses Git LFS assets; the complete asset is required, not an LFS pointer");
    total += bytes.length;
    const destination = path.join(target, relativeFile(asset.file.slice(prefix.length)));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { mode: asset.mode === "100755" ? 0o700 : 0o600, flag: "wx" });
  }
  return `git:${commit}:${directory}`;
}

async function extractArchive(bytes: Uint8Array, staging: string, target: string): Promise<void> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let total = 0;
    const names = new Set<string>();
    const files = unzipSync(bytes, { filter: (entry) => {
      const file = relativeFile(entry.name);
      if (names.has(file)) throw new Error("Skill archive contains duplicate paths");
      names.add(file);
      total += entry.originalSize;
      if (total > MAX_BYTES || names.size > MAX_FILES) throw new Error("Skill archive exceeds installation limits");
      return !entry.name.endsWith("/");
    } });
    for (const [name, content] of Object.entries(files)) {
      const destination = path.join(target, relativeFile(name));
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, content, { flag: "wx", mode: 0o600 });
    }
  } else {
    // Validate before extracting: throwing from tar's asynchronous filter escapes
    // its Promise, while aborting an active unpack can race pending file writes.
    await new Promise<void>((resolve, reject) => {
      let total = 0;
      const entries = new Map<string, string>();
      const parser = new Parser({
        strict: true,
        filter: (name, entry) => {
          try {
            if (!("type" in entry)) throw new Error("Tar parser did not provide archive entry metadata");
            if (entry.type === "Directory" && (name === "." || name === "./")) return false;
            const safe = relativeFile(name);
            if (!["File", "Directory", "OldFile"].includes(entry.type)) throw new Error("Skill archive contains links or unsupported filesystem entries");
            if (entries.has(safe) && (entry.type !== "Directory" || entries.get(safe) !== "Directory")) throw new Error("Skill archive contains duplicate paths");
            entries.set(safe, entry.type);
            if (entry.type !== "Directory") total += entry.size;
            if (entries.size > MAX_FILES || total > MAX_BYTES) throw new Error("Skill archive exceeds installation limits");
          } catch (error) {
            parser.abort(error instanceof Error ? error : new Error(String(error)));
          }
          return false;
        },
      });
      parser.on("error", reject);
      parser.on("end", resolve);
      parser.end(Buffer.from(bytes));
    });
    const archive = path.join(staging, "artifact.tar");
    await writeFile(archive, bytes, { mode: 0o600 });
    await extractTar({ file: archive, cwd: target, preservePaths: false, noChmod: true, noMtime: true, strict: true });
  }
}

async function installWellKnown(detail: CatalogSkillDetailDto, staging: string, target: string): Promise<string> {
  const base = new URL(detail.installUrl);
  if (base.hostname !== detail.source || base.protocol !== "https:") throw new Error("Catalog well-known source identity does not match its origin");
  let indexUrl = new URL("/.well-known/agent-skills/index.json", base);
  let response = await fetch(indexUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) {
    indexUrl = new URL("/.well-known/skills/index.json", base);
    response = await fetch(indexUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok) throw new Error(`Skill discovery returned HTTP ${response.status}`);
  const index = await response.json() as { skills?: unknown[] };
  if (!Array.isArray(index.skills)) throw new Error("Skill source has no valid discovery index");
  const slug = detail.id.split("/").at(-1)!;
  const matches = index.skills.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && "name" in entry && entry.name === slug);
  if (matches.length !== 1) throw new Error("The exact skill is missing or ambiguous in its source index");
  const skill = matches[0]!;
  if (typeof skill.url === "string" && typeof skill.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(skill.digest)) {
    const bytes = await download(new URL(skill.url, indexUrl));
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== skill.digest) throw new Error("Skill artifact does not match its published SHA-256 digest");
    if (skill.type === "skill-md") await writeFile(path.join(target, "SKILL.md"), bytes, { mode: 0o600, flag: "wx" });
    else if (skill.type === "archive") await extractArchive(bytes, staging, target);
    else throw new Error("Unsupported skill artifact type");
    return digest;
  }
  if (!Array.isArray(skill.files) || !skill.files.length || skill.files.length > MAX_FILES || skill.files.some((file) => typeof file !== "string")) throw new Error("Unsupported or incomplete skill discovery record");
  const names = new Set<string>();
  const hash = createHash("sha256");
  let size = 0;
  for (const name of [...skill.files].sort()) {
    const safe = relativeFile(name);
    if (names.has(safe)) throw new Error("Skill index contains duplicate file paths");
    names.add(safe);
    const bytes = await download(new URL(`${encodeURIComponent(slug)}/${safe.split("/").map(encodeURIComponent).join("/")}`, indexUrl));
    size += bytes.length;
    if (size > MAX_BYTES) throw new Error("Skill exceeds the 100 MiB installation limit");
    const destination = path.join(target, safe);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    hash.update(safe).update("\0").update(bytes).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function secureTree(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error("Skill installation contains an unsafe filesystem entry");
    const info = await lstat(file);
    await chmod(file, entry.isDirectory() || (info.mode & 0o111) !== 0 ? 0o700 : 0o600);
    if (entry.isDirectory()) await secureTree(file);
  }
}

export async function materializeSkill(detail: CatalogSkillDetailDto, rootDir: string): Promise<{ directory: string; revision: string; name: string; description: string }> {
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  const staging = path.join(rootDir, `.staging-${randomUUID()}`);
  const target = path.join(staging, "skill");
  await mkdir(target, { recursive: true, mode: 0o700 });
  try {
    const revision = detail.sourceType === "github" ? await installGithub(detail, staging, target) : await installWellKnown(detail, staging, target);
    const metadata = skillFrontmatter(await readFile(path.join(target, "SKILL.md"), "utf8"));
    await secureTree(target);
    const directory = path.join(rootDir, createHash("sha256").update(detail.id).update("\0").update(revision).digest("hex"));
    try { await rename(target, directory); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && ["EEXIST", "ENOTEMPTY"].includes(String(error.code)))) throw error;
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Existing skill revision has an unsafe destination");
    }
    return { directory, revision, ...metadata };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
