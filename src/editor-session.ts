import type { CardGameMetadata } from "./game-metadata.ts";
import type { GameplayClipboard } from "./production-contract.ts";

export interface EditorHistory<T> {
  past: T[];
  present: T;
  future: T[];
}

export type EditorNavigationDirection = "previous" | "next";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createEditorHistory<T>(present: T): EditorHistory<T> {
  return { past: [], present: clone(present), future: [] };
}

export function pushEditorHistory<T>(history: EditorHistory<T>, present: T, limit = 100): EditorHistory<T> {
  return {
    past: [...history.past, clone(history.present)].slice(-limit),
    present: clone(present),
    future: []
  };
}

export function undoEditorHistory<T>(history: EditorHistory<T>): EditorHistory<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return clone(history);
  return {
    past: history.past.slice(0, -1).map(clone),
    present: clone(previous),
    future: [clone(history.present), ...history.future.map(clone)]
  };
}

export function redoEditorHistory<T>(history: EditorHistory<T>): EditorHistory<T> {
  const next = history.future[0];
  if (next === undefined) return clone(history);
  return {
    past: [...history.past.map(clone), clone(history.present)],
    present: clone(next),
    future: history.future.slice(1).map(clone)
  };
}

export function adjacentCardId(
  cardIds: readonly string[],
  selectedId: string | null,
  direction: EditorNavigationDirection
): string | null {
  if (selectedId === null) return null;
  const currentIndex = cardIds.indexOf(selectedId);
  if (currentIndex < 0) return null;
  const adjacentIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
  return cardIds[adjacentIndex] ?? null;
}

export function copyGameplay(metadata: CardGameMetadata): GameplayClipboard {
  return {
    targeting: clone(metadata.targeting),
    effects: clone(metadata.effects)
  };
}

export function pasteGameplay(metadata: CardGameMetadata, clipboard: GameplayClipboard): CardGameMetadata {
  return {
    ...clone(metadata),
    targeting: clone(clipboard.targeting),
    effects: clone(clipboard.effects)
  };
}
