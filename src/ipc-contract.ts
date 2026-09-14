import type { CatalogCard } from "./catalog.ts";
import type { BatchReport, ExportedCard, OutputLayout } from "./exporter.ts";
import type { CatalogFilters } from "./filters.ts";

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
  folderOpenCard: "folder:open-card"
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
}

declare global {
  interface Window {
    axieCards: DesktopApi;
  }
}
