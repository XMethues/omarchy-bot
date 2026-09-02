export const DRAFT_STORAGE_VERSION = 1 as const;
export const DRAFT_STORAGE_PREFIX = `draft:v${DRAFT_STORAGE_VERSION}:`;

export interface ConversationDraft {
  text: string;
  /** Current Composer insertion point, clamped to the draft text. */
  cursor: number;
  stagedIds: string[];
  /** Insertion point captured when dictation starts. */
  dictationAnchor?: number;
}

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function windowSessionStorage(): StorageLike | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function emptyDraft(): ConversationDraft {
  return { text: "", cursor: 0, stagedIds: [] };
}

function normalizePosition(value: unknown, textLength: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(textLength, Math.max(0, Math.trunc(value)));
}

function normalizeDraft(value: unknown): ConversationDraft | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.text !== "string") return undefined;

  const text = candidate.text;
  const cursor = normalizePosition(candidate.cursor, text.length, text.length);
  const stagedIds = Array.isArray(candidate.stagedIds)
    ? [...new Set(candidate.stagedIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  const dictationAnchor = candidate.dictationAnchor === undefined
    ? undefined
    : normalizePosition(candidate.dictationAnchor, text.length, cursor);

  return {
    text,
    cursor,
    stagedIds,
    ...(dictationAnchor !== undefined ? { dictationAnchor } : {}),
  };
}

export function draftStorageKey(botId: string, threadId?: string | null): string {
  return `${DRAFT_STORAGE_PREFIX}${botId}:${threadId === undefined || threadId === null || threadId === "blank" ? "blank" : threadId}`;
}

/** Load one window-local draft. Legacy Foundation plain-text values migrate in place. */
export function loadDraft(
  botId: string,
  threadId?: string | null,
  storage: StorageLike | undefined = windowSessionStorage(),
): ConversationDraft {
  if (storage === undefined) return emptyDraft();
  const key = draftStorageKey(botId, threadId);

  try {
    const raw = storage.getItem(key);
    if (raw === null) return emptyDraft();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const migrated = { text: raw, cursor: raw.length, stagedIds: [] } satisfies ConversationDraft;
      storage.setItem(key, JSON.stringify(migrated));
      return migrated;
    }

    const draft = normalizeDraft(parsed);
    if (draft !== undefined) return draft;

    // Foundation stored raw text at this versioned key. Preserve JSON-shaped
    // user text as text rather than mistaking it for a corrupt object.
    const migrated = { text: raw, cursor: raw.length, stagedIds: [] } satisfies ConversationDraft;
    storage.setItem(key, JSON.stringify(migrated));
    return migrated;
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(
  botId: string,
  threadId: string | null | undefined,
  draft: ConversationDraft,
  storage: StorageLike | undefined = windowSessionStorage(),
): void {
  if (storage === undefined) return;
  const key = draftStorageKey(botId, threadId);
  const normalized = normalizeDraft(draft) ?? emptyDraft();

  try {
    if (normalized.text === "" && normalized.stagedIds.length === 0 && normalized.dictationAnchor === undefined) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, JSON.stringify(normalized));
    }
  } catch {
    // Quota and privacy-mode failures leave the controlled Composer state intact.
  }
}

/** Remove every draft owned by a Bot without touching similarly prefixed IDs. */
export function clearDraftsByBot(
  botId: string,
  storage: StorageLike | undefined = windowSessionStorage(),
): boolean {
  if (storage === undefined) return true;
  const prefix = `${DRAFT_STORAGE_PREFIX}${botId}:`;

  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return true;
  } catch {
    // A caller performing permanent deletion must keep the archived record when cleanup cannot be verified.
    return false;
  }
}
