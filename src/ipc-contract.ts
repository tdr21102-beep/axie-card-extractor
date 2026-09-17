import type { CatalogCard } from "./catalog.ts";
import type { BatchReport, ExportedCard, OutputLayout } from "./exporter.ts";
import type { CatalogFilters } from "./filters.ts";
import type { CardGameMetadata, CleanAssetState } from "./card-studio.ts";
import type { GameCardExportResult, GameVisualSource } from "./game-card-exporter.ts";
import type {
  AxieSlotCardRequest,
  AxieSlotCreateRequest,
  AxieSlotRenameRequest,
  AxieSlotRequest,
  CardSetCardRequest,
  CardSetDocument,
  CardSetNameRequest,
  CardSetRenameRequest,
  GameSetExportRequest,
  GameSetExportResult,
  ProductionDashboard,
  ProductionDashboardRequest,
  StudioDraftResult,
  StudioDraftSaveRequest
} from "./production-contract.ts";

export const IPC = {
  catalogList: "catalog:list",
  catalogRefresh: "catalog:refresh",
  exportChooseFolder: "export:choose-folder",
  exportGetFolder: "export:get-folder",
  previewLoad: "preview:load",
  exportCard: "export:card",
  batchPlan: "batch:plan",
  batchExport: "batch:export",
  folderOpenExport: "folder:open-export",
  folderOpenCard: "folder:open-card",
  studioLoad: "studio:load",
  studioSaveMetadata: "studio:save-metadata",
  studioImportClean: "studio:import-clean",
  studioReloadLayout: "studio:reload-layout",
  studioRenderPreview: "studio:render-preview",
  studioExportRendered: "studio:export-rendered",
  studioExportGameCard: "studio:export-game-card",
  studioListSets: "studio:list-sets",
  studioCreateSet: "studio:create-set",
  studioRenameSet: "studio:rename-set",
  studioDeleteSet: "studio:delete-set",
  studioAddCardToSet: "studio:add-card-to-set",
  studioRemoveCardFromSet: "studio:remove-card-from-set",
  studioCreateAxieSlot: "studio:create-axie-slot",
  studioRenameAxieSlot: "studio:rename-axie-slot",
  studioDeleteAxieSlot: "studio:delete-axie-slot",
  studioAssignCardToSlot: "studio:assign-card-to-slot",
  studioRemoveCardFromSlot: "studio:remove-card-from-slot",
  studioProductionDashboard: "studio:production-dashboard",
  studioLoadDraft: "studio:load-draft",
  studioSaveDraft: "studio:save-draft",
  studioDiscardDraft: "studio:discard-draft",
  studioExportGameSet: "studio:export-game-set"
} as const;

export interface CatalogPayload {
  cards: CatalogCard[];
  cache: "hit" | "miss";
  fetchedAt: string | null;
}

export interface PreviewPayload {
  dataUrl: string;
  sha256: string;
  cache: "hit" | "miss";
}

export interface BatchRequest {
  filters: CatalogFilters;
  layout: OutputLayout;
  exportMetadata: boolean;
}

export interface BatchPlan {
  total: number;
  cached: number;
  needDownload: number;
}

export interface StudioCardPayload {
  source: CatalogCard;
  metadata: CardGameMetadata;
  metadataStatus: "default" | "saved";
  metadataSourceSchemaVersion: 1 | 2 | null;
  metadataMigrated: boolean;
  clean: CleanAssetState;
}

export interface StudioMetadataRequest {
  cardId: string;
  metadata: CardGameMetadata;
}

export interface StudioPreviewPayload {
  dataUrl: string;
  sha256: string;
  cleanSha256: string;
  warnings: string[];
}

export interface StudioExportPayload {
  path: string;
  sha256: string;
  cleanSha256: string;
  warnings: string[];
}

export interface StudioGameExportRequest extends StudioMetadataRequest {
  visualSource: GameVisualSource;
}

export interface StudioLayoutReloadPayload {
  version: number;
  reference_width: number;
  reference_height: number;
}

export type StudioGameExportPayload = GameCardExportResult;

export interface DesktopApi {
  getCatalog(): Promise<CatalogPayload>;
  refreshCatalog(): Promise<CatalogPayload>;
  chooseExportFolder(): Promise<string | null>;
  getExportFolder(): Promise<string | null>;
  loadPreview(cardId: string): Promise<PreviewPayload>;
  exportCard(cardId: string): Promise<ExportedCard>;
  getBatchPlan(filters: CatalogFilters): Promise<BatchPlan>;
  exportBatch(request: BatchRequest): Promise<BatchReport>;
  openExportFolder(): Promise<void>;
  openCardFolder(cardId: string): Promise<void>;
  loadStudioCard(cardId: string): Promise<StudioCardPayload>;
  saveStudioMetadata(request: StudioMetadataRequest): Promise<StudioCardPayload>;
  importStudioClean(cardId: string): Promise<StudioCardPayload | null>;
  reloadStudioLayout(): Promise<StudioLayoutReloadPayload>;
  renderStudioPreview(request: StudioMetadataRequest): Promise<StudioPreviewPayload>;
  exportStudioRendered(request: StudioMetadataRequest): Promise<StudioExportPayload>;
  exportStudioGameCard(request: StudioGameExportRequest): Promise<StudioGameExportPayload>;
  listCardSets(): Promise<CardSetDocument[]>;
  createCardSet(request: CardSetNameRequest): Promise<CardSetDocument>;
  renameCardSet(request: CardSetRenameRequest): Promise<CardSetDocument>;
  deleteCardSet(setId: string): Promise<void>;
  addCardToSet(request: CardSetCardRequest): Promise<CardSetDocument>;
  removeCardFromSet(request: CardSetCardRequest): Promise<CardSetDocument>;
  createAxieSlot(request: AxieSlotCreateRequest): Promise<CardSetDocument>;
  renameAxieSlot(request: AxieSlotRenameRequest): Promise<CardSetDocument>;
  deleteAxieSlot(request: AxieSlotRequest): Promise<CardSetDocument>;
  assignCardToAxieSlot(request: AxieSlotCardRequest): Promise<CardSetDocument>;
  removeCardFromAxieSlot(request: AxieSlotCardRequest): Promise<CardSetDocument>;
  getProductionDashboard(request: ProductionDashboardRequest): Promise<ProductionDashboard>;
  loadStudioDraft(cardId: string): Promise<StudioDraftResult>;
  saveStudioDraft(request: StudioDraftSaveRequest): Promise<StudioDraftResult>;
  discardStudioDraft(cardId: string): Promise<void>;
  exportStudioGameSet(request: GameSetExportRequest): Promise<GameSetExportResult>;
}

declare global {
  interface Window {
    axieCards: DesktopApi;
  }
}
