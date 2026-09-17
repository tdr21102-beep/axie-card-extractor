import type { CardGameMetadata } from "./game-metadata.ts";
import type { GameVisualSource } from "./game-card-exporter.ts";

export const CARD_SET_SCHEMA_VERSION = 1 as const;
export const STUDIO_DRAFT_SCHEMA_VERSION = 1 as const;
export const GAME_SET_MANIFEST_SCHEMA_VERSION = 1 as const;

export type ProductionStatus = "UNCONFIGURED" | "DRAFT" | "VALID" | "GAME_READY";

export interface AxieSlot {
  id: string;
  name: string | null;
  cards: string[];
}

export interface CardSetDocument {
  schema_version: typeof CARD_SET_SCHEMA_VERSION;
  id: string;
  name: string;
  cards: string[];
  axies: AxieSlot[];
}

export interface StudioDraftDocument {
  schema_version: typeof STUDIO_DRAFT_SCHEMA_VERSION;
  card_id: string;
  metadata: unknown;
}

export interface StudioDraftResult {
  available: boolean;
  draft: StudioDraftDocument | null;
}

export interface ProductionIssueSummary {
  path: string;
  message: string;
  severity: "warning" | "error";
}

export interface ProductionCardState {
  card_id: string;
  status: ProductionStatus;
  metadata_exists: boolean;
  effect_count: number;
  errors: number;
  warnings: number;
  issues: ProductionIssueSummary[];
  original_available: boolean;
  clean_available: boolean;
  rendered_available: boolean;
  game_ready: boolean;
  exportable_visual_sources: GameVisualSource[];
}

export interface ProductionCounts {
  total: number;
  unconfigured: number;
  draft: number;
  valid: number;
  game_ready: number;
  warnings: number;
  blocked: number;
}

export interface ProductionDashboard {
  sets: CardSetDocument[];
  current_set: CardSetDocument | null;
  cards: ProductionCardState[];
  counts: ProductionCounts;
}

export interface CardSetNameRequest {
  name: string;
}

export interface CardSetRenameRequest extends CardSetNameRequest {
  setId: string;
}

export interface CardSetCardRequest {
  setId: string;
  cardId: string;
}

export interface AxieSlotCreateRequest {
  setId: string;
  name?: string | null;
}

export interface AxieSlotRequest {
  setId: string;
  slotId: string;
}

export interface AxieSlotRenameRequest extends AxieSlotRequest {
  name: string | null;
}

export interface AxieSlotCardRequest extends AxieSlotRequest {
  cardId: string;
}

export interface StudioDraftSaveRequest {
  cardId: string;
  metadata: unknown;
}

export interface ProductionDashboardRequest {
  setId: string | null;
}

export interface GameSetExportRequest {
  setId: string;
  visualSource: GameVisualSource;
  readyOnly: boolean;
}

export interface GameSetManifestCard {
  card_id: string;
  card_json: string;
  card_png: string;
  sha256: string;
  visual_source: "original_placeholder" | "rendered";
}

export interface GameSetManifest {
  schema_version: typeof GAME_SET_MANIFEST_SCHEMA_VERSION;
  set_id: string;
  set_name: string;
  cards: GameSetManifestCard[];
  axies: AxieSlot[];
  export: {
    card_count: number;
  };
}

export interface GameSetExportItem {
  card_id: string;
  status: "success" | "failed" | "skipped";
  result: {
    card_json: string;
    card_png: string;
    sha256: string;
    visual_source: "original_placeholder" | "rendered";
  } | null;
  error: string | null;
}

export interface GameSetExportReport {
  schema_version: 1;
  set_id: string;
  requested: number;
  success: number;
  failed: number;
  skipped: number;
  cards: GameSetExportItem[];
}

export interface GameSetExportResult {
  directory: string;
  manifest_path: string;
  report_path: string;
  manifest: GameSetManifest;
  report: GameSetExportReport;
}

export interface GameplayClipboard {
  targeting: CardGameMetadata["targeting"];
  effects: CardGameMetadata["effects"];
}
