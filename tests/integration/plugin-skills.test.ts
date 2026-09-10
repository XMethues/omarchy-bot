import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { materializeSkill } from "../../apps/daemon/src/modules/plugins/skillInstaller.ts";
import { PluginsService } from "../../apps/daemon/src/modules/plugins/plugins.ts";
import type { CatalogSkillDetailDto } from "../../packages/protocol/src/plugins.ts";

test("a linked TAR rejects installation without crashing, leaving files, or poisoning later installs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-skill-regression-"));
  const originalFetch = globalThis.fetch;
  const source = path.join(root, "source");
  const installed = path.join(root, "installed");
  const archive = path.join(root, "skill.tar.gz");
  let artifact: Uint8Array<ArrayBuffer> = new Uint8Array();
  const detail: CatalogSkillDetailDto = {
    id: "skill-regression.invalid/safe-skill",
    name: "safe-skill",
    description: "Read the bundled binary",
    source: "skill-regression.invalid",
    sourceType: "well-known",
    installUrl: "https://skill-regression.invalid",
    content: "",
    url: "https://skills.sh/skill-regression.invalid/safe-skill",
  };
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname !== "skill-regression.invalid") return originalFetch(input, init);
    if (url.pathname.endsWith("/index.json")) {
      return Response.json({ skills: [{
        name: "safe-skill", type: "archive", url: "/artifact",
        digest: `sha256:${createHash("sha256").update(artifact).digest("hex")}`,
      }] });
    }
    return new Response(artifact);
  }, { preconnect: originalFetch.preconnect });
  try {
    await mkdir(source);
    await writeFile(path.join(source, "SKILL.md"), "---\nname: safe-skill\ndescription: Read the bundled binary\n---\nRead data.bin.\n");
    await writeFile(path.join(source, "data.bin"), new Uint8Array([0, 255, 128]));
    await symlink("../outside", path.join(source, "unsafe-link"));
    const unsafeTar = Bun.spawn(["tar", "-czf", archive, "-C", source, "SKILL.md", "unsafe-link"], { stdout: "ignore", stderr: "pipe" });
    if (await unsafeTar.exited !== 0) throw new Error(await new Response(unsafeTar.stderr).text());
    artifact = new Uint8Array(await readFile(archive));
    await expect(materializeSkill(detail, installed)).rejects.toThrow();
    expect(await readdir(installed)).toEqual([]);
    const safeTar = Bun.spawn(["tar", "-czf", archive, "-C", source, "SKILL.md", "data.bin"], { stdout: "ignore", stderr: "pipe" });
    if (await safeTar.exited !== 0) throw new Error(await new Response(safeTar.stderr).text());
    artifact = new Uint8Array(await readFile(archive));
    const result = await materializeSkill(detail, installed);
    expect([...await readFile(path.join(result.directory, "data.bin"))]).toEqual([0, 255, 128]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog names resolve to canonical details without accepting another skill or source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plugin-identity-regression-"));
  const service = new PluginsService(root, root, async () => ({ skills: [] }));
  const originalFetch = globalThis.fetch;
  const id = "owner/repository/react:components";
  let source = "owner/repository";
  let name = "react:components";
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname !== "catalog-identity.invalid") return originalFetch(input, init);
    return Response.json({
      id: `${source}/reactcomponents`, source, slug: "reactcomponents",
      files: [{ path: "SKILL.md", contents: `---\nname: ${name}\ndescription: Build React components\n---\nBuild components.\n` }],
    });
  }, { preconnect: originalFetch.preconnect });
  try {
    service.configure("https://catalog-identity.invalid");
    await expect(service.detail(id)).resolves.toMatchObject({ id });
    source = "another/repository";
    await expect(service.detail(id)).rejects.toMatchObject({ status: 502 });
    source = "owner/repository";
    name = "another-skill";
    await expect(service.detail(id)).rejects.toMatchObject({ status: 502 });
  } finally {
    await service.shutdown();
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
