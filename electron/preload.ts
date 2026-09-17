import { contextBridge, ipcRenderer } from "electron";
import { IPC, type BatchRequest, type CatalogPayload, type DesktopApi, type PreviewPayload, type StudioCardPayload, type StudioExportPayload, type StudioGameExportPayload, type StudioGameExportRequest, type StudioLayoutReloadPayload, type StudioMetadataRequest, type StudioPreviewPayload } from "../src/ipc-contract.ts";
import type { BatchReport, ExportedCard } from "../src/exporter.ts";
import type { CatalogFilters } from "../src/filters.ts";
import type { AxieSlotCardRequest, AxieSlotCreateRequest, AxieSlotRenameRequest, AxieSlotRequest, CardSetCardRequest, CardSetDocument, CardSetNameRequest, CardSetRenameRequest, GameSetExportRequest, GameSetExportResult, ProductionDashboard, ProductionDashboardRequest, StudioDraftResult, StudioDraftSaveRequest } from "../src/production-contract.ts";

const api: DesktopApi = {
  getCatalog: () => ipcRenderer.invoke(IPC.catalogList) as Promise<CatalogPayload>,
  refreshCatalog: () => ipcRenderer.invoke(IPC.catalogRefresh) as Promise<CatalogPayload>,
  chooseExportFolder: () => ipcRenderer.invoke(IPC.exportChooseFolder) as Promise<string | null>,
  getExportFolder: () => ipcRenderer.invoke(IPC.exportGetFolder) as Promise<string | null>,
  loadPreview: (cardId: string) => ipcRenderer.invoke(IPC.previewLoad, cardId) as Promise<PreviewPayload>,
  exportCard: (cardId: string) => ipcRenderer.invoke(IPC.exportCard, cardId) as Promise<ExportedCard>,
  getBatchPlan: (filters: CatalogFilters) => ipcRenderer.invoke(IPC.batchPlan, filters),
  exportBatch: (request: BatchRequest) => ipcRenderer.invoke(IPC.batchExport, request) as Promise<BatchReport>,
  openExportFolder: () => ipcRenderer.invoke(IPC.folderOpenExport) as Promise<void>,
  openCardFolder: (cardId: string) => ipcRenderer.invoke(IPC.folderOpenCard, cardId) as Promise<void>,
  loadStudioCard: (cardId: string) => ipcRenderer.invoke(IPC.studioLoad, cardId) as Promise<StudioCardPayload>,
  saveStudioMetadata: (request: StudioMetadataRequest) => ipcRenderer.invoke(IPC.studioSaveMetadata, request) as Promise<StudioCardPayload>,
  importStudioClean: (cardId: string) => ipcRenderer.invoke(IPC.studioImportClean, cardId) as Promise<StudioCardPayload | null>,
  reloadStudioLayout: () => ipcRenderer.invoke(IPC.studioReloadLayout) as Promise<StudioLayoutReloadPayload>,
  renderStudioPreview: (request: StudioMetadataRequest) => ipcRenderer.invoke(IPC.studioRenderPreview, request) as Promise<StudioPreviewPayload>,
  exportStudioRendered: (request: StudioMetadataRequest) => ipcRenderer.invoke(IPC.studioExportRendered, request) as Promise<StudioExportPayload>,
  exportStudioGameCard: (request: StudioGameExportRequest) => ipcRenderer.invoke(IPC.studioExportGameCard, request) as Promise<StudioGameExportPayload>,
  listCardSets: () => ipcRenderer.invoke(IPC.studioListSets) as Promise<CardSetDocument[]>,
  createCardSet: (request: CardSetNameRequest) => ipcRenderer.invoke(IPC.studioCreateSet, request) as Promise<CardSetDocument>,
  renameCardSet: (request: CardSetRenameRequest) => ipcRenderer.invoke(IPC.studioRenameSet, request) as Promise<CardSetDocument>,
  deleteCardSet: (setId: string) => ipcRenderer.invoke(IPC.studioDeleteSet, setId) as Promise<void>,
  addCardToSet: (request: CardSetCardRequest) => ipcRenderer.invoke(IPC.studioAddCardToSet, request) as Promise<CardSetDocument>,
  removeCardFromSet: (request: CardSetCardRequest) => ipcRenderer.invoke(IPC.studioRemoveCardFromSet, request) as Promise<CardSetDocument>,
  createAxieSlot: (request: AxieSlotCreateRequest) => ipcRenderer.invoke(IPC.studioCreateAxieSlot, request) as Promise<CardSetDocument>,
  renameAxieSlot: (request: AxieSlotRenameRequest) => ipcRenderer.invoke(IPC.studioRenameAxieSlot, request) as Promise<CardSetDocument>,
  deleteAxieSlot: (request: AxieSlotRequest) => ipcRenderer.invoke(IPC.studioDeleteAxieSlot, request) as Promise<CardSetDocument>,
  assignCardToAxieSlot: (request: AxieSlotCardRequest) => ipcRenderer.invoke(IPC.studioAssignCardToSlot, request) as Promise<CardSetDocument>,
  removeCardFromAxieSlot: (request: AxieSlotCardRequest) => ipcRenderer.invoke(IPC.studioRemoveCardFromSlot, request) as Promise<CardSetDocument>,
  getProductionDashboard: (request: ProductionDashboardRequest) => ipcRenderer.invoke(IPC.studioProductionDashboard, request) as Promise<ProductionDashboard>,
  loadStudioDraft: (cardId: string) => ipcRenderer.invoke(IPC.studioLoadDraft, cardId) as Promise<StudioDraftResult>,
  saveStudioDraft: (request: StudioDraftSaveRequest) => ipcRenderer.invoke(IPC.studioSaveDraft, request) as Promise<StudioDraftResult>,
  discardStudioDraft: (cardId: string) => ipcRenderer.invoke(IPC.studioDiscardDraft, cardId) as Promise<void>,
  exportStudioGameSet: (request: GameSetExportRequest) => ipcRenderer.invoke(IPC.studioExportGameSet, request) as Promise<GameSetExportResult>
};

contextBridge.exposeInMainWorld("axieCards", Object.freeze(api));
