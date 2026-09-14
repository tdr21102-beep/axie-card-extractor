import { contextBridge, ipcRenderer } from "electron";
import { IPC, type BatchRequest, type CatalogPayload, type DesktopApi, type PreviewPayload, type StudioCardPayload, type StudioExportPayload, type StudioMetadataRequest, type StudioPreviewPayload } from "../src/ipc-contract.ts";
import type { BatchReport, ExportedCard } from "../src/exporter.ts";
import type { CatalogFilters } from "../src/filters.ts";

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
  renderStudioPreview: (request: StudioMetadataRequest) => ipcRenderer.invoke(IPC.studioRenderPreview, request) as Promise<StudioPreviewPayload>,
  exportStudioRendered: (request: StudioMetadataRequest) => ipcRenderer.invoke(IPC.studioExportRendered, request) as Promise<StudioExportPayload>
};

contextBridge.exposeInMainWorld("axieCards", Object.freeze(api));
