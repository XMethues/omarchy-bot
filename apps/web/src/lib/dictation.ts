import type { ConversationDraft } from "./drafts.ts";

/** Insert completed speech at the recording's captured cursor without replacing draft text. */
export function insertDictationTranscript(draft: ConversationDraft, transcript: string, anchor: number): ConversationDraft {
  const base: ConversationDraft = { text: draft.text, cursor: draft.cursor, stagedIds: draft.stagedIds };
  const text = transcript.trim();
  if (text.length === 0) return base;

  const cursor = Math.max(0, Math.min(Math.trunc(anchor), draft.text.length));
  const before = draft.text.slice(0, cursor);
  const after = draft.text.slice(cursor);
  const leadingSpace = before.length > 0 && !/\s$/u.test(before) && !/^\s/u.test(text) ? " " : "";
  const trailingSpace = after.length > 0 && !/^\s/u.test(after) && !/\s$/u.test(text) ? " " : "";
  const inserted = `${leadingSpace}${text}${trailingSpace}`;
  return {
    ...base,
    text: `${before}${inserted}${after}`,
    cursor: cursor + inserted.length,
  };
}
