import { access, appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { dialog, ipcMain, shell } from "electron";
import {
  addCardToSet,
  assignCardToAxieSlot,
  createAxieSlot,
  createCardSet,
  deleteAxieSlot,
  deleteCardSet,
  getCardSet,
  listCardSets,
  removeCardFromAxieSlot,
  removeCardFromSet,
  renameAxieSlot,
  renameCardSet
} from "../src/card-sets.ts";
import type { CatalogCard } from "../src/catalog.ts";
import { createCatalogLoader } from "../src/catalog-loader.ts";
import { acquireCardImage } from "../src/downloader.ts";
import { batchPlan, exportBatch, exportCard } from "../src/exporter.ts";
import { filterCatalog } from "../src/filters.ts";
import { exportGameSet } from "../src/game-set-exporter.ts";
import { IPC, type CatalogPayload } from "../src/ipc-contract.ts";
import {
  validateAxieSlotCardRequest,
  validateAxieSlotCreateRequest,
  validateAxieSlotRenameRequest,
  validateAxieSlotRequest,
  validateBatchRequest,
  validateCardId,
  validateCardSetCardRequest,
  validateCardSetId,
  validateCardSetNameRequest,
  validateCardSetRenameRequest,
  validateFilters,
  validateGameSetExportRequest,
  validateProductionDashboardRequest,
  validateStudioDraftSaveRequest,
  validateStudioGameExportRequest,
  validateStudioMetadataRequest
} from "../src/ipc-validation.ts";
import { buildProductionDashboard, inspectProductionCard } from "../src/production-status.ts";
import { discardStudioDraft, loadStudioDraft, saveStudioDraft } from "../src/studio-drafts.ts";
import { createCardStudioService } from "../src/studio-service.ts";

export interface DesktopPaths {
  catalogCache: string;
  imageCache: string;
  logFile: string;
  studioRoot: string;
  layoutConfig: string;
  /** App root containing optional assets/cards/equipment registry sources. */
  assetRoot?: string;
  initialExportRoot?: string;
}

export function registerIpc(paths: DesktopPaths): void {
  let catalog: CatalogCard[] = [];
  let exportRoot: string | null = paths.initialExportRoot ?? null;
  const exportedImagePaths = new Map<string, string>();
  const catalogLoader = createCatalogLoader({ cachePath: paths.catalogCache, equipmentRoot: paths.assetRoot });
  const studio = createCardStudioService({ root: paths.studioRoot, layoutPath: paths.layoutConfig, imageCache: paths.imageCache, assetRoot: paths.assetRoot });

  const log = async (message: string) => {
    try {
      await mkdir(dirname(paths.logFile), { recursive: true });
      await appendFile(paths.logFile, `${new Date().toISOString()} ${message}\n`, "utf8");
    } catch {
      // Logging must never replace the actionable error returned to the UI.
    }
  };

  const loadCatalog = async (refresh: boolean): Promise<CatalogPayload> => {
    try {
      const payload = await catalogLoader.load(refresh);
      catalog = payload.cards;
      return payload;
    } catch (error) {
      await log(`catalog error: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(refresh ? "Could not refresh the catalog from Sanity" : "Could not load the catalog. Check your connection and try again.");
    }
  };

  const ensureCatalog = async () => loadCatalog(false);
  const findById = async (value: unknown) => {
    await ensureCatalog();
    const id = validateCardId(value);
    const card = catalog.find((item) => item.id === id);
    if (!card) throw new Error("Card not found");
    return card;
  };
  const requireExportRoot = () => {
    if (!exportRoot) throw new Error("Choose an export folder first");
    return exportRoot;
  };

  ipcMain.handle(IPC.catalogList, () => ensureCatalog());
  ipcMain.handle(IPC.catalogRefresh, () => loadCatalog(true));
  ipcMain.handle(IPC.exportChooseFolder, async () => {
    const result = await dialog.showOpenDialog({ title: "Choose Export Folder", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    exportRoot = resolve(result.filePaths[0]);
    return exportRoot;
  });
  ipcMain.handle(IPC.exportGetFolder, () => exportRoot);
  ipcMain.handle(IPC.previewLoad, async (_event, cardId: unknown) => {
    const card = await findById(cardId);
    try {
      const result = await acquireCardImage(card, { cacheDir: paths.imageCache, assetRoot: paths.assetRoot });
      return {
        dataUrl: `data:${card.image_mime_type ?? "application/octet-stream"};base64,${Buffer.from(result.bytes).toString("base64")}`,
        sha256: result.sha256,
        cache: result.cache
      };
    } catch (error) {
      await log(`preview ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error("Could not load this card preview");
    }
  });
  ipcMain.handle(IPC.exportCard, async (_event, cardId: unknown) => {
    const card = await findById(cardId);
    const result = await exportCard(card, { exportRoot: requireExportRoot(), cacheDir: paths.imageCache, exportMetadata: true });
    if (result.status === "failed") await log(`export ${card.id}: ${result.error}`);
    else if (result.image_path) exportedImagePaths.set(card.id, result.image_path);
    return result;
  });
  ipcMain.handle(IPC.batchPlan, async (_event, filtersValue: unknown) => {
    await ensureCatalog();
    const cards = filterCatalog(catalog, validateFilters(filtersValue));
    return batchPlan(cards, paths.imageCache);
  });
  ipcMain.handle(IPC.batchExport, async (_event, requestValue: unknown) => {
    await ensureCatalog();
    const request = validateBatchRequest(requestValue);
    const cards = filterCatalog(catalog, request.filters);
    const report = await exportBatch(cards, {
      exportRoot: requireExportRoot(),
      cacheDir: paths.imageCache,
      layout: request.layout,
      exportMetadata: request.exportMetadata,
      filters: request.filters
    });
    if (report.failed) await log(`batch completed with ${report.failed} failures`);
    for (const result of report.cards) {
      if (result.status !== "failed" && result.image_path) exportedImagePaths.set(result.sanity_id, result.image_path);
    }
    return report;
  });
  ipcMain.handle(IPC.folderOpenExport, async () => {
    const error = await shell.openPath(requireExportRoot());
    if (error) throw new Error("Could not open the export folder");
  });
  ipcMain.handle(IPC.folderOpenCard, async (_event, cardId: unknown) => {
    const card = await findById(cardId);
    const imagePath = exportedImagePaths.get(card.id);
    if (!imagePath) throw new Error("Export this card before opening its folder");
    try {
      await access(imagePath);
    } catch {
      throw new Error("The exported card is no longer available");
    }
    const folder = dirname(imagePath);
    const error = await shell.openPath(folder);
    if (error) throw new Error("Export this card before opening its folder");
  });
  ipcMain.handle(IPC.studioLoad, async (_event, cardId: unknown) => studio.load(await findById(cardId)));
  ipcMain.handle(IPC.studioSaveMetadata, async (_event, requestValue: unknown) => {
    const request = validateStudioMetadataRequest(requestValue);
    const card = await findById(request.cardId);
    try {
      return await studio.saveMetadata(card, request.metadata, request.visualLayoutOverrides);
    } catch (error) {
      await log(`studio metadata ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error("Could not save game metadata. Check the field values and try again.");
    }
  });
  ipcMain.handle(IPC.studioImportClean, async (_event, cardIdValue: unknown) => {
    const card = await findById(cardIdValue);
    const selection = await dialog.showOpenDialog({
      title: `Select clean visual for ${card.name}`,
      properties: ["openFile"],
      filters: [{ name: "PNG image", extensions: ["png"] }]
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    try {
      return await studio.importClean(card, selection.filePaths[0]);
    } catch (error) {
      if (error instanceof Error && /conflict/i.test(error.message)) {
        const confirmation = await dialog.showMessageBox({
          type: "warning",
          title: "Replace clean visual?",
          message: "A different clean visual is already associated with this card.",
          detail: "Replacing it does not modify RAW, but future previews and rendered exports will use the new clean PNG.",
          buttons: ["Cancel", "Replace Clean Visual"],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        });
        if (confirmation.response === 0) return null;
        return studio.importClean(card, selection.filePaths[0], true);
      }
      await log(`studio clean import ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error("Could not import the clean visual. Select a valid PNG file.");
    }
  });
  ipcMain.handle(IPC.studioReloadLayout, async () => {
    try {
      const layout = studio.reloadLayout();
      return {
        version: layout.version,
        reference_width: layout.reference_width,
        reference_height: layout.reference_height
      };
    } catch (error) {
      await log(`studio layout reload: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Could not reload card layout. Fix config/card_layout.json and try again. ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  ipcMain.handle(IPC.studioRenderPreview, async (_event, requestValue: unknown) => {
    const request = validateStudioMetadataRequest(requestValue);
    const card = await findById(request.cardId);
    try {
      const result = await studio.render(card, request.metadata, request.visualLayoutOverrides);
      return {
        dataUrl: `data:image/png;base64,${Buffer.from(result.bytes).toString("base64")}`,
        sha256: result.sha256,
        cleanSha256: result.cleanSha256,
        warnings: result.warnings,
        effectiveVisualLayout: result.effectiveVisualLayout
      };
    } catch (error) {
      await log(`studio preview ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
  ipcMain.handle(IPC.studioExportRendered, async (_event, requestValue: unknown) => {
    const request = validateStudioMetadataRequest(requestValue);
    const card = await findById(request.cardId);
    try {
      return await studio.exportRendered(card, request.metadata, request.visualLayoutOverrides);
    } catch (error) {
      await log(`studio render export ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
  ipcMain.handle(IPC.studioExportGameCard, async (_event, requestValue: unknown) => {
    const request = validateStudioGameExportRequest(requestValue);
    const card = await findById(request.cardId);
    try {
      return await studio.exportGameCard(card, request.metadata, request.visualSource, requireExportRoot(), request.visualLayoutOverrides);
    } catch (error) {
      await log(`studio game export ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
  ipcMain.handle(IPC.studioExportGameCardFlat, async (_event, requestValue: unknown) => {
    const request = validateStudioGameExportRequest(requestValue);
    const card = await findById(request.cardId);
    try {
      return await studio.exportIndividualGameCardFlat(card, request.metadata, request.visualSource, requireExportRoot(), request.visualLayoutOverrides);
    } catch (error) {
      await log(`studio flat game export ${card.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });

  ipcMain.handle(IPC.studioListSets, () => listCardSets(paths.studioRoot));
  ipcMain.handle(IPC.studioCreateSet, async (_event, requestValue: unknown) => {
    const request = validateCardSetNameRequest(requestValue);
    return createCardSet(paths.studioRoot, request.name);
  });
  ipcMain.handle(IPC.studioRenameSet, async (_event, requestValue: unknown) => {
    const request = validateCardSetRenameRequest(requestValue);
    return renameCardSet(paths.studioRoot, request.setId, request.name);
  });
  ipcMain.handle(IPC.studioDeleteSet, async (_event, setIdValue: unknown) => {
    await deleteCardSet(paths.studioRoot, validateCardSetId(setIdValue));
  });
  ipcMain.handle(IPC.studioAddCardToSet, async (_event, requestValue: unknown) => {
    const request = validateCardSetCardRequest(requestValue);
    await findById(request.cardId);
    return addCardToSet(paths.studioRoot, request.setId, request.cardId);
  });
  ipcMain.handle(IPC.studioRemoveCardFromSet, async (_event, requestValue: unknown) => {
    const request = validateCardSetCardRequest(requestValue);
    return removeCardFromSet(paths.studioRoot, request.setId, request.cardId);
  });
  ipcMain.handle(IPC.studioCreateAxieSlot, async (_event, requestValue: unknown) => {
    const request = validateAxieSlotCreateRequest(requestValue);
    return createAxieSlot(paths.studioRoot, request.setId, request.name ?? null);
  });
  ipcMain.handle(IPC.studioRenameAxieSlot, async (_event, requestValue: unknown) => {
    const request = validateAxieSlotRenameRequest(requestValue);
    return renameAxieSlot(paths.studioRoot, request.setId, request.slotId, request.name);
  });
  ipcMain.handle(IPC.studioDeleteAxieSlot, async (_event, requestValue: unknown) => {
    const request = validateAxieSlotRequest(requestValue);
    return deleteAxieSlot(paths.studioRoot, request.setId, request.slotId);
  });
  ipcMain.handle(IPC.studioAssignCardToSlot, async (_event, requestValue: unknown) => {
    const request = validateAxieSlotCardRequest(requestValue);
    await findById(request.cardId);
    return assignCardToAxieSlot(paths.studioRoot, request.setId, request.slotId, request.cardId);
  });
  ipcMain.handle(IPC.studioRemoveCardFromSlot, async (_event, requestValue: unknown) => {
    const request = validateAxieSlotCardRequest(requestValue);
    return removeCardFromAxieSlot(paths.studioRoot, request.setId, request.slotId, request.cardId);
  });
  ipcMain.handle(IPC.studioProductionDashboard, async (_event, requestValue: unknown) => {
    const request = validateProductionDashboardRequest(requestValue);
    await ensureCatalog();
    return buildProductionDashboard({
      catalog,
      sets: await listCardSets(paths.studioRoot),
      currentSetId: request.setId,
      options: { root: paths.studioRoot, imageCache: paths.imageCache }
    });
  });
  ipcMain.handle(IPC.studioLoadDraft, async (_event, cardIdValue: unknown) => {
    return loadStudioDraft(await findById(cardIdValue), paths.studioRoot);
  });
  ipcMain.handle(IPC.studioSaveDraft, async (_event, requestValue: unknown) => {
    const request = validateStudioDraftSaveRequest(requestValue);
    return saveStudioDraft(await findById(request.cardId), request.metadata, paths.studioRoot, request.visualLayoutOverrides);
  });
  ipcMain.handle(IPC.studioDiscardDraft, async (_event, cardIdValue: unknown) => {
    await discardStudioDraft(await findById(cardIdValue), paths.studioRoot);
  });
  ipcMain.handle(IPC.studioExportGameSet, async (_event, requestValue: unknown) => {
    const request = validateGameSetExportRequest(requestValue);
    await ensureCatalog();
    const set = await getCardSet(paths.studioRoot, request.setId);
    const cardsById = new Map(catalog.map((card) => [card.id, card]));
    const candidates = await Promise.all(
      set.cards.flatMap((cardId) => {
        const card = cardsById.get(cardId);
        return card
          ? [inspectProductionCard(card, { root: paths.studioRoot, imageCache: paths.imageCache }).then((production) => ({ card, production }))]
          : [];
      })
    );
    try {
      return await exportGameSet({
        set,
        candidates,
        visualSource: request.visualSource,
        readyOnly: request.readyOnly,
        exportRoot: requireExportRoot(),
        exportOne: async (card, visualSource, temporaryRoot) => {
          const loaded = await studio.load(card);
          return studio.exportGameCard(card, loaded.metadata, visualSource, temporaryRoot);
        }
      });
    } catch (error) {
      await log(`studio set export ${set.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
}
