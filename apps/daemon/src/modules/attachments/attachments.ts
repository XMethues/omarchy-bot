import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { Database } from "bun:sqlite";
import type { WorkerUserMessage } from "@omarchy-bot/agent-contract";
import type { AttachmentDto } from "@omarchy-bot/protocol";
import type { AgentId } from "@omarchy-bot/domain";
import { HttpError } from "../bots/bots.ts";

export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const MAX_INLINE_TEXT_BYTES = 64 * 1024;
const STAGED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface AttachmentRow {
  id: string;
  kind: "staged" | "managed";
  bot_id: string;
  thread_id: string | null;
  message_id: string | null;
  name: string;
  media_type: string;
  size: number;
  rel_path: string;
  source_sha256: string | null;
  created_at: string;
}

export interface ManagedAttachmentFile {
  path: string;
  mediaType: string;
  size: number;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 32 && character !== "\n" && character !== "\r" && character !== "\t" && character !== "\f") return false;
  }
  return true;
}

/** Authoritative media type derived from content, never from a browser-provided filename or MIME type. */
export function sniffAttachmentMediaType(bytes: Uint8Array): string | undefined {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (!isUtf8Text(bytes)) return undefined;

  const text = new TextDecoder().decode(bytes).trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      JSON.parse(text);
      return "application/json";
    } catch {
      // Invalid JSON remains plain UTF-8 text; the bytes, not the extension, are authoritative.
    }
  }
  return "text/plain";
}

function assertAgentSupportsAttachment(agentId: AgentId, attachment: AttachmentRow): void {
  const isPiImage = attachment.media_type === "image/png" ||
    attachment.media_type === "image/jpeg" ||
    attachment.media_type === "image/gif" ||
    attachment.media_type === "image/webp";
  const isPiText = attachment.media_type === "text/plain" || attachment.media_type === "application/json";
  if (agentId === "pi" && (isPiImage || (isPiText && attachment.size <= MAX_INLINE_TEXT_BYTES))) return;

  if (agentId === "pi" && isPiText) {
    throw new HttpError(400, `pi cannot consume attachment media type ${attachment.media_type} larger than 64 KB (${attachment.name})`);
  }
  throw new HttpError(400, `${agentId} cannot consume attachment media type ${attachment.media_type} (${attachment.name})`);
}

/** Owns local staged copies and their one-way, immutable promotion into message history. */
export class AttachmentsService {
  readonly #stagedDir: string;
  readonly #managedDir: string;

  constructor(
    private readonly db: Database,
    private readonly attachmentsDir: string,
  ) {
    this.#stagedDir = path.join(attachmentsDir, "staged");
    this.#managedDir = path.join(attachmentsDir, "managed");
    mkdirSync(this.#stagedDir, { recursive: true });
    mkdirSync(this.#managedDir, { recursive: true });
  }

  async stage(botId: string, file: File): Promise<AttachmentDto> {
    const bot = this.db.query("SELECT id FROM bots WHERE id = ? AND archived = 0").get(botId);
    if (!bot) throw new HttpError(404, `unknown bot ${botId}`);
    if (file.size > MAX_ATTACHMENT_BYTES) throw new HttpError(400, "attachments must be 32 MB or smaller");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = sniffAttachmentMediaType(bytes);
    if (mediaType === undefined) throw new HttpError(400, "unsupported or invalid file content");

    const id = `att_${randomUUID().replaceAll("-", "")}`;
    const relPath = path.join("staged", id);
    const target = path.join(this.attachmentsDir, relPath);
    const name = file.name.trim() || "attachment";
    await Bun.write(target, bytes);
    try {
      this.db.query(
        `INSERT INTO attachments (id, kind, bot_id, thread_id, message_id, name, media_type, size, rel_path, source_sha256, created_at)
         VALUES (?, 'staged', ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        botId,
        name,
        mediaType,
        bytes.byteLength,
        relPath,
        createHash("sha256").update(bytes).digest("hex"),
        new Date().toISOString(),
      );
    } catch (error) {
      try { unlinkSync(target); } catch { /* the database error remains authoritative */ }
      throw error;
    }
    return { id, kind: "staged", name, mediaType, size: bytes.byteLength };
  }

  getStaged(id: string): AttachmentDto | undefined {
    const row = this.#row(id);
    return row?.kind === "staged" ? this.#dto(row) : undefined;
  }

  deleteStaged(id: string): boolean {
    const row = this.#row(id);
    if (row === undefined || row.kind !== "staged") return false;
    try { unlinkSync(path.join(this.attachmentsDir, row.rel_path)); } catch { /* deleting the row prevents stale ownership */ }
    this.db.query("DELETE FROM attachments WHERE id = ? AND kind = 'staged'").run(id);
    return true;
  }

  managedFile(id: string): ManagedAttachmentFile | undefined {
    const row = this.#row(id);
    if (row === undefined || row.kind !== "managed") return undefined;
    return { path: path.join(this.attachmentsDir, row.rel_path), mediaType: row.media_type, size: row.size };
  }

  /** Validate everything before atomically renaming files in the caller's SQLite send transaction. */
  promoteForMessage(input: {
    attachmentIds: readonly string[];
    botId: string;
    threadId: string;
    messageId: string;
    agentId: AgentId;
  }): NonNullable<WorkerUserMessage["attachments"]> {
    if (input.attachmentIds.length === 0) return [];
    if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
      throw new HttpError(400, "attachmentIds must not contain duplicates");
    }

    const rows = input.attachmentIds.map((id) => {
      const row = this.#row(id);
      if (row === undefined || row.kind !== "staged" || row.bot_id !== input.botId) {
        throw new HttpError(400, `attachment ${id} is not staged for this bot`);
      }
      assertAgentSupportsAttachment(input.agentId, row);
      return row;
    });

    const moved: Array<{ source: string; target: string }> = [];
    try {
      for (const row of rows) {
        const source = path.join(this.attachmentsDir, row.rel_path);
        const relPath = path.join("managed", row.id);
        const target = path.join(this.attachmentsDir, relPath);
        renameSync(source, target);
        moved.push({ source, target });
        this.db.query(
          `UPDATE attachments SET kind = 'managed', thread_id = ?, message_id = ?, rel_path = ?
           WHERE id = ? AND kind = 'staged' AND bot_id = ?`,
        ).run(input.threadId, input.messageId, relPath, row.id, input.botId);
      }
    } catch (error) {
      for (const move of moved.reverse()) {
        try { renameSync(move.target, move.source); } catch { /* preserve the original promotion error */ }
      }
      throw error;
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: path.join(this.#managedDir, row.id),
      mediaType: row.media_type,
    }));
  }

  /** Remove local bytes while retaining rows until the caller commits Bot deletion. */
  deleteOwnedFiles(botId: string): { removed: number; failures: Array<{ resource: string; message: string }> } {
    const rows = this.db.query(`SELECT * FROM attachments WHERE bot_id = ?`).all(botId) as AttachmentRow[];
    const failures: Array<{ resource: string; message: string }> = [];
    let removed = 0;
    const root = path.resolve(this.attachmentsDir);
    for (const row of rows) {
      try {
        const fullPath = path.resolve(root, row.rel_path);
        if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
          throw new Error("stored attachment path escapes the managed root");
        }
        rmSync(fullPath, { force: true });
        removed += 1;
      } catch (error) {
        failures.push({
          resource: row.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { removed, failures };
  }

  gcStaged(maxAgeMs = STAGED_MAX_AGE_MS): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = this.db.query("SELECT * FROM attachments WHERE kind = 'staged' AND created_at < ?").all(cutoff) as AttachmentRow[];
    for (const row of rows) this.deleteStaged(row.id);
    return rows.length;
  }

  #row(id: string): AttachmentRow | undefined {
    return this.db.query("SELECT * FROM attachments WHERE id = ?").get(id) as AttachmentRow | null ?? undefined;
  }

  #dto(row: AttachmentRow): AttachmentDto {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      mediaType: row.media_type,
      size: row.size,
      ...(row.kind === "managed" ? { url: `/api/attachments/${row.id}` } : {}),
    };
  }
}
