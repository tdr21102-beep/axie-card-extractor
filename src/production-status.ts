import { readFile } from "node:fs/promises";
import type { CatalogCard } from "./catalog.ts";
import { assertMetadataIdentity, assertValidPng, cardStudioPaths } from "./card-studio.ts";
import { gameMetadataReadinessIssues, validateGameMetadataDocument, type CardGameMetadata } from "./game-metadata.ts";
import type {
  CardSetDocument,
  ProductionCardState,
  ProductionCounts,
  ProductionDashboard,
  ProductionIssueSummary
} from "./production-contract.ts";

export interface ProductionReadinessRule {
  id: string;
  evaluate(metadata: CardGameMetadata, card: CatalogCard): ProductionIssueSummary | null;
}

export interface ProductionInspectionOptions {
  root: string;
  imageCache?: string;
  readinessRules?: readonly ProductionReadinessRule[];
}

export const requireEffectsRule: ProductionReadinessRule = {
  id: "require_effects",
  evaluate(metadata) {
    return metadata.effects.length > 0
      ? null
      : { path: "effects", message: "At least one effect is required for game export", severity: "error" };
  }
};

export const requireAttackGameplayRule: ProductionReadinessRule = {
  id: "attack_requires_gameplay_effect",
  evaluate(metadata) {
    const issue = gameMetadataReadinessIssues(metadata)[0];
    return issue ? { ...issue } : null;
  }
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function realPngExists(path: string): Promise<boolean> {
  try {
    const bytes = await readFile(path);
    try {
      await assertValidPng(bytes);
      return true;
    } catch {
      return false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function originalExists(card: CatalogCard): boolean {
  if (!card.image_url || !card.image_asset_id) return false;
  try {
    const url = new URL(card.image_url);
    return (url.protocol === "https:" || url.protocol === "http:") && card.image_asset_id.trim().length > 0;
  } catch {
    return false;
  }
}

export function isGameReady(input: {
  metadataValid: boolean;
  exportableVisualSources: readonly ("original" | "rendered")[];
  readinessIssues?: readonly ProductionIssueSummary[];
}): boolean {
  return input.metadataValid
    && input.exportableVisualSources.length > 0
    && !(input.readinessIssues ?? []).some((issue) => issue.severity === "error");
}

export async function inspectProductionCard(
  card: CatalogCard,
  options: ProductionInspectionOptions
): Promise<ProductionCardState> {
  const paths = cardStudioPaths(card, options.root);
  const [originalAvailable, cleanAvailable, renderedAvailable] = await Promise.all([
    originalExists(card),
    realPngExists(paths.clean),
    realPngExists(paths.rendered)
  ]);
  const exportableVisualSources: ("original" | "rendered")[] = [];
  if (originalAvailable) exportableVisualSources.push("original");
  // The current rendered export is reproducible from a real clean base. Never
  // treat the original placeholder as clean, and never infer clean from metadata.
  if (cleanAvailable) exportableVisualSources.push("rendered");

  let metadataExists = true;
  let rawMetadata: unknown;
  try {
    rawMetadata = JSON.parse(await readFile(paths.data, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      metadataExists = false;
    } else {
      const issues = [{ path: "$", message: `Cannot read Game Metadata: ${errorMessage(error)}`, severity: "error" as const }];
      return {
        card_id: card.id,
        status: "DRAFT",
        metadata_exists: true,
        effect_count: 0,
        errors: 1,
        warnings: 0,
        issues,
        original_available: originalAvailable,
        clean_available: cleanAvailable,
        rendered_available: renderedAvailable,
        game_ready: false,
        exportable_visual_sources: exportableVisualSources
      };
    }
  }

  if (!metadataExists) {
    return {
      card_id: card.id,
      status: "UNCONFIGURED",
      metadata_exists: false,
      effect_count: 0,
      errors: 0,
      warnings: 0,
      issues: [],
      original_available: originalAvailable,
      clean_available: cleanAvailable,
      rendered_available: renderedAvailable,
      game_ready: false,
      exportable_visual_sources: exportableVisualSources
    };
  }

  const effectCount = rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
    && Array.isArray((rawMetadata as Record<string, unknown>).effects)
    ? (rawMetadata as { effects: unknown[] }).effects.length
    : 0;
  const validation = validateGameMetadataDocument(rawMetadata);
  const issues: ProductionIssueSummary[] = validation.issues.map((issue) => ({ ...issue }));
  let metadataValid = validation.metadata !== null && validation.status !== "invalid";
  if (metadataValid && validation.metadata) {
    try {
      assertMetadataIdentity(validation.metadata, card);
    } catch (error) {
      metadataValid = false;
      issues.push({ path: "id", message: errorMessage(error), severity: "error" });
    }
  }

  const readinessRules = [requireAttackGameplayRule, ...(options.readinessRules ?? [])];
  const readinessIssues = metadataValid && validation.metadata
    ? readinessRules.map((rule) => rule.evaluate(validation.metadata!, card)).filter((issue): issue is ProductionIssueSummary => issue !== null)
    : [];
  issues.push(...readinessIssues);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const gameReady = isGameReady({ metadataValid, exportableVisualSources, readinessIssues });
  return {
    card_id: card.id,
    status: !metadataValid || errors > 0 ? "DRAFT" : gameReady ? "GAME_READY" : "VALID",
    metadata_exists: true,
    effect_count: effectCount,
    errors,
    warnings,
    issues,
    original_available: originalAvailable,
    clean_available: cleanAvailable,
    rendered_available: renderedAvailable,
    game_ready: gameReady,
    exportable_visual_sources: exportableVisualSources
  };
}

export function productionCounts(cards: readonly ProductionCardState[]): ProductionCounts {
  return {
    total: cards.length,
    unconfigured: cards.filter((card) => card.status === "UNCONFIGURED").length,
    draft: cards.filter((card) => card.status === "DRAFT").length,
    valid: cards.filter((card) => card.status === "VALID").length,
    game_ready: cards.filter((card) => card.status === "GAME_READY").length,
    warnings: cards.reduce((sum, card) => sum + card.warnings, 0),
    blocked: cards.filter((card) => !card.game_ready).length
  };
}

export async function buildProductionDashboard(input: {
  catalog: readonly CatalogCard[];
  sets: readonly CardSetDocument[];
  currentSetId: string | null;
  options: ProductionInspectionOptions;
}): Promise<ProductionDashboard> {
  const sets: CardSetDocument[] = input.sets
    .map((set) => structuredClone(set))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  const currentSet = input.currentSetId === null ? null : sets.find((set) => set.id === input.currentSetId) ?? null;
  if (input.currentSetId !== null && currentSet === null) throw new Error(`Card set not found: ${input.currentSetId}`);
  const cards = await Promise.all(input.catalog.map((card) => inspectProductionCard(card, input.options)));
  const stateById = new Map(cards.map((state) => [state.card_id, state]));
  const countedCards = currentSet
    ? currentSet.cards.map((cardId) => stateById.get(cardId)).filter((card): card is ProductionCardState => card !== undefined)
    : cards;
  return { sets, current_set: currentSet, cards, counts: productionCounts(countedCards) };
}
