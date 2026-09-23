import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogCard } from "../src/catalog.ts";
import type { BatchReport, OutputLayout } from "../src/exporter.ts";
import { filterCatalog, type CatalogFilters } from "../src/filters.ts";
import {
  adjacentCardId,
  copyGameplay as copyGameplayData,
  createEditorHistory,
  pasteGameplay as pasteGameplayData,
  pushEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
  type EditorHistory
} from "../src/editor-session.ts";
import { filterProductionCards, type ProductionFilterScope } from "../src/production-filters.ts";
import {
  EFFECT_TYPES as GAME_EFFECT_TYPES,
  TARGET_VOCABULARY,
  addCardEffect,
  deleteCardEffect,
  duplicateCardEffect,
  moveCardEffect,
  parseAdvancedGameMetadata,
  replaceCardEffectType,
  statusDefinitionsForEffectType,
  validateGameMetadataDocument
} from "../src/game-metadata.ts";
import { CARD_TYPE_DEFINITIONS } from "../src/card-type-definitions.ts";
import type { BatchPlan, PreviewPayload, StudioCardPayload, StudioPreviewPayload } from "../src/ipc-contract.ts";
import {
  CARD_VISUAL_LAYOUT_FIELDS,
  resetVisualLayoutPosition,
  updateVisualLayoutCoordinate,
  type CardVisualLayoutField
} from "../src/card-layout-overrides.ts";
import {
  draggedLogicalPosition,
  isVisualLayoutNudgeKey,
  logicalTextLayoutToDisplayStyle,
  visualLayoutGhostPosition,
  VISUAL_LAYOUT_LOGICAL_SIZE
} from "../src/visual-layout-editor.ts";
import type {
  CardSetDocument,
  GameSetExportResult,
  ProductionDashboard,
  ProductionStatus,
  StudioDraftDocument
} from "../src/production-contract.ts";

const CLASSES = ["Aqua", "Beast", "Bird", "Bug", "Plant", "Reptile"];
const PARTS = ["Eyes", "Ears", "Mouth", "Horn", "Back", "Tail"];
const EMPTY_FILTERS: CatalogFilters = { search: "", className: null, part: null };

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function SelectFilter({ label, value, options, allLabel, onChange }: {
  label: string;
  value: string | null;
  options: string[];
  allLabel: string;
  onChange(value: string | null): void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{allLabel}</option>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function SourceBadge() {
  return (
    <div className="source-note">
      <span>Metadata source: <strong>Sanity public dataset</strong></span>
      <span>Image source: <strong>Sanity CDN</strong></span>
    </div>
  );
}

function CatalogTab({ cards, catalogCache, exportRoot, onChooseFolder }: {
  cards: CatalogCard[];
  catalogCache: "hit" | "miss" | null;
  exportRoot: string | null;
  onChooseFolder(): Promise<string | null>;
}) {
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<CatalogCard | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const filtered = useMemo(() => filterCatalog(cards, filters), [cards, filters]);

  useEffect(() => {
    setSelected((current) => current ? cards.find((card) => card.id === current.id) ?? null : null);
  }, [cards]);

  useEffect(() => {
    setPreview(null);
    setMessage(null);
    if (!selected) return;
    let active = true;
    setPreviewBusy(true);
    window.axieCards.loadPreview(selected.id)
      .then((result) => { if (active) setPreview(result); })
      .catch((error) => { if (active) setMessage(errorMessage(error)); })
      .finally(() => { if (active) setPreviewBusy(false); });
    return () => { active = false; };
  }, [selected]);

  const exportSelected = async () => {
    if (!selected) return;
    setActionBusy(true);
    setMessage(null);
    try {
      if (!exportRoot && !await onChooseFolder()) return;
      const result = await window.axieCards.exportCard(selected.id);
      setMessage(result.status === "failed" ? result.error : result.status === "skipped" ? "Identical file already exists — skipped safely." : `Exported ${result.local_filename}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="catalog-layout">
      <aside className="panel filters-panel">
        <div className="panel-heading"><span className="eyebrow">Catalog controls</span><h2>Filters</h2></div>
        <label className="field">
          <span>Search</span>
          <input value={filters.search} placeholder="Name, slug, local name or ID" onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
        </label>
        <SelectFilter label="Class" value={filters.className} options={CLASSES} allLabel="All" onChange={(className) => setFilters({ ...filters, className })} />
        <SelectFilter label="Part" value={filters.part} options={PARTS} allLabel="All" onChange={(part) => setFilters({ ...filters, part })} />
        <button className="ghost full" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
        <div className="stat-block"><strong>{filtered.length}</strong><span>cards shown</span></div>
        <div className="small-status">Catalog cache: {catalogCache === "hit" ? "Cached" : catalogCache === "miss" ? "Fresh download" : "—"}</div>
      </aside>

      <section className="panel list-panel">
        <div className="panel-heading row"><div><span className="eyebrow">Metadata first</span><h2>Card list</h2></div><span className="count-pill">{filtered.length} / {cards.length}</span></div>
        <div className="card-list">
          {filtered.map((card) => (
            <button key={card.id} className={`card-row ${selected?.id === card.id ? "selected" : ""}`} onClick={() => setSelected(card)}>
              <span className="card-name">{card.name}</span>
              <span className="card-traits">{card.class ?? "Unknown"} <b>•</b> {card.part ?? "Unknown"}</span>
              <code>{card.local_name}</code>
            </button>
          ))}
          {!filtered.length && <div className="empty">No cards match these filters.</div>}
        </div>
      </section>

      <aside className="panel preview-panel">
        {!selected ? (
          <div className="preview-empty"><div className="card-glyph">◇</div><h2>Select a card</h2><p>Only the selected card preview will be loaded.</p></div>
        ) : (
          <>
            <div className="panel-heading"><span className="eyebrow">Selected card</span><h2>{selected.name}</h2><p>{selected.class} • {selected.part}</p></div>
            <div className="preview-frame">
              {previewBusy && <div className="loading">Loading original…</div>}
              {preview && <img src={preview.dataUrl} alt={`${selected.name} original card`} />}
            </div>
            <div className="preview-facts">
              <span><b>Dimensions</b>{selected.image_dimensions ? `${selected.image_dimensions.width}×${selected.image_dimensions.height}` : "Not structured in source"}</span>
              <span><b>Cache</b>{preview ? (preview.cache === "hit" ? "Cached" : "Downloaded") : "—"}</span>
              <span className="wide"><b>SHA-256</b><code>{preview?.sha256 ?? "Available after preview loads"}</code></span>
            </div>
            <div className="metadata">
              <Meta label="Sanity ID" value={selected.id} mono />
              <Meta label="Slug" value={selected.slug} mono />
              <Meta label="Local Name" value={selected.local_name} mono />
              <Meta label="Image URL" value={selected.image_url} mono />
              {selected.body_text.length > 0 && <Meta label="Body text" value={selected.body_text.join("\n")} />}
              <Meta label="Mana" value={selected.cost} />
              <Meta label="Cost" value={selected.cost} />
              <Meta label="Effect" value={selected.effect} />
              <Meta label="Card Type" value={selected.card_type} />
            </div>
            {message && <div className="notice">{message}</div>}
            <div className="actions">
              <button className="primary" disabled={actionBusy} onClick={exportSelected}>{actionBusy ? "Exporting…" : "Export Raw Card"}</button>
              <button className="ghost" onClick={() => window.axieCards.openCardFolder(selected.id).catch((error) => setMessage(errorMessage(error)))}>Open Card Folder</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return <div className="meta-row"><span>{label}</span><div className={mono ? "mono" : ""}>{empty ? <em>Not structured in source</em> : String(value)}</div></div>;
}

function BatchTab({ cards, exportRoot, onChooseFolder }: {
  cards: CatalogCard[];
  exportRoot: string | null;
  onChooseFolder(): Promise<string | null>;
}) {
  const [filters, setFilters] = useState<CatalogFilters>({ ...EMPTY_FILTERS });
  const [layout, setLayout] = useState<OutputLayout>("by-class");
  const [exportMetadata, setExportMetadata] = useState(true);
  const [plan, setPlan] = useState<BatchPlan>({ total: cards.length, cached: 0, needDownload: cards.length });
  const [report, setReport] = useState<BatchReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.axieCards.getBatchPlan(filters)
      .then((value) => { if (active) setPlan(value); })
      .catch((error) => { if (active) setMessage(errorMessage(error)); });
    return () => { active = false; };
  }, [filters, cards.length]);

  const runBatch = async () => {
    setBusy(true);
    setMessage(null);
    setReport(null);
    try {
      if (!exportRoot && !await onChooseFolder()) return;
      const result = await window.axieCards.exportBatch({ filters, layout, exportMetadata });
      setReport(result);
      setMessage(`Batch complete: ${result.success} success, ${result.skipped} skipped, ${result.failed} failed.`);
      setPlan(await window.axieCards.getBatchPlan(filters));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="batch-wrap">
      <section className="panel batch-settings">
        <div className="panel-heading"><span className="eyebrow">Bulk workflow</span><h2>Batch Export</h2><p>Export matching original PNGs without transformation.</p></div>
        <div className="batch-grid">
          <SelectFilter label="Class" value={filters.className} options={CLASSES} allLabel="All Classes" onChange={(className) => setFilters({ ...filters, className })} />
          <SelectFilter label="Part" value={filters.part} options={PARTS} allLabel="All Parts" onChange={(part) => setFilters({ ...filters, part })} />
          <label className="field"><span>Output Layout</span><select value={layout} onChange={(event) => setLayout(event.target.value as OutputLayout)}><option value="by-class">By Class</option><option value="flat">Flat Folder</option></select></label>
        </div>
        <label className="check"><input type="checkbox" checked={exportMetadata} onChange={(event) => setExportMetadata(event.target.checked)} /><span>Export metadata JSON</span><small>Real source fields and verified SHA-256</small></label>
        <div className="folder-box"><span>Export folder</span><code>{exportRoot ?? "No folder selected"}</code><button className="ghost" onClick={onChooseFolder}>Choose Folder</button></div>
        <div className="batch-actions"><button className="primary large" disabled={busy || plan.total === 0} onClick={runBatch}>{busy ? "Exporting asynchronously…" : "Export Matching Cards"}</button><button className="ghost" disabled={!exportRoot} onClick={() => window.axieCards.openExportFolder().catch((error) => setMessage(errorMessage(error)))}>Open Export Folder</button></div>
        {message && <div className="notice">{message}</div>}
      </section>
      <aside className="panel batch-summary">
        <span className="eyebrow">Before export</span><h2>Selection summary</h2>
        <div className="metric"><strong>{plan.total}</strong><span>Cards selected</span></div>
        <div className="metric"><strong>{plan.cached}</strong><span>Cached</span></div>
        <div className="metric accent"><strong>{plan.needDownload}</strong><span>Need download</span></div>
        {report && <div className="report-mini"><h3>Latest report</h3><p><b>{report.success}</b> success</p><p><b>{report.skipped}</b> skipped</p><p><b>{report.failed}</b> failed</p><code>{report.report_path.split(/[\\/]/).at(-1)}</code></div>}
      </aside>
    </div>
  );
}

type StudioMetadata = StudioCardPayload["metadata"];
type StudioVisualLayoutOverrides = StudioCardPayload["visualLayoutOverrides"];
type StudioEffect = StudioMetadata["effects"][number];
type EffectType = StudioEffect["type"];
type TargetMode = StudioMetadata["targeting"]["mode"];
type VisualSource = "original" | "rendered";
type VisualLayoutGhost = {
  field: CardVisualLayoutField;
  x: number;
  y: number;
};

function cloneStudioMetadata(metadata: StudioMetadata): StudioMetadata {
  return structuredClone(metadata);
}

interface StudioEditorState {
  metadata: StudioMetadata;
  visualLayoutOverrides: StudioVisualLayoutOverrides;
}

function cloneStudioEditorState(state: StudioEditorState): StudioEditorState {
  return structuredClone(state);
}

type ProductionScope = ProductionFilterScope;

type ProductionDialogKind = "create-set" | "rename-set" | "create-slot" | "rename-slot";

type ProductionDialog = {
  kind: ProductionDialogKind;
  value: string;
  error: string | null;
};

type VisualLayoutDrag = {
  pointerId: number;
  field: CardVisualLayoutField;
  startPoint: { clientX: number; clientY: number };
  startPosition: { x: number; y: number };
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}

function recoverableMetadata(value: unknown, expected: StudioMetadata): StudioMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StudioMetadata>;
  if (candidate.id !== expected.id || candidate.class !== expected.class || candidate.part !== expected.part || candidate.schema_version !== 2) return null;
  if (!candidate.targeting || typeof candidate.targeting !== "object" || !Array.isArray(candidate.effects)) return null;
  return cloneStudioMetadata(candidate as StudioMetadata);
}

function StudioTab({ cards, exportRoot, onChooseFolder, onDirtyChange }: {
  cards: CatalogCard[];
  exportRoot: string | null;
  onChooseFolder(): Promise<string | null>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<ProductionScope>("all");
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [partFilter, setPartFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProductionStatus | null>(null);
  const [hasEffectsFilter, setHasEffectsFilter] = useState(false);
  const [hasCleanFilter, setHasCleanFilter] = useState(false);
  const [gameReadyFilter, setGameReadyFilter] = useState(false);
  const [sets, setSets] = useState<CardSetDocument[]>([]);
  const [currentSetId, setCurrentSetId] = useState<string | null>(null);
  const [currentSlotId, setCurrentSlotId] = useState<string | null>(null);
  const [assignmentSlotId, setAssignmentSlotId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ProductionDashboard | null>(null);
  const [productionBusy, setProductionBusy] = useState(false);
  const [productionDialog, setProductionDialog] = useState<ProductionDialog | null>(null);
  const [gameSetExport, setGameSetExport] = useState<GameSetExportResult | null>(null);
  const [setExportVisualSource, setSetExportVisualSource] = useState<VisualSource>("original");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [studioCard, setStudioCard] = useState<StudioCardPayload | null>(null);
  const [editHistory, setEditHistory] = useState<EditorHistory<StudioEditorState> | null>(null);
  const [saved, setSaved] = useState<StudioEditorState | null>(null);
  const [selectedVisualLayoutField, setSelectedVisualLayoutField] = useState<CardVisualLayoutField>("name");
  const [preview, setPreview] = useState<StudioPreviewPayload | null>(null);
  const [originalPreview, setOriginalPreview] = useState<PreviewPayload | null>(null);
  const [visualSource, setVisualSource] = useState<VisualSource>("original");
  const [newEffectType, setNewEffectType] = useState<EffectType>("damage");
  const [advancedText, setAdvancedText] = useState("");
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [gameplayClipboard, setGameplayClipboard] = useState<Pick<StudioMetadata, "targeting" | "effects"> | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<StudioDraftDocument | null>(null);
  const [draftTouched, setDraftTouched] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loadingCard, setLoadingCard] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [originalBusy, setOriginalBusy] = useState(false);
  const [layoutReloadBusy, setLayoutReloadBusy] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [actionBusy, setActionBusy] = useState<"save" | "import" | "export" | "game-export" | "draft" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const dashboardRequestRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const draftEpochRef = useRef(0);
  const draftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const visualLayoutDragRef = useRef<VisualLayoutDrag | null>(null);
  const [visualLayoutGhost, setVisualLayoutGhost] = useState<VisualLayoutGhost | null>(null);

  const editorState = editHistory?.present ?? null;
  const draft = editorState?.metadata ?? null;
  const visualLayoutOverrides = editorState?.visualLayoutOverrides ?? null;
  const undoStack = editHistory?.past ?? [];
  const redoStack = editHistory?.future ?? [];

  const currentSet = useMemo(() => sets.find((set) => set.id === currentSetId) ?? null, [sets, currentSetId]);
  const currentSlot = useMemo(() => currentSet?.axies.find((slot) => slot.id === currentSlotId) ?? null, [currentSet, currentSlotId]);
  const productionByCard = useMemo(() => new Map((dashboard?.cards ?? []).map((state) => [state.card_id, state])), [dashboard]);
  const filtered = useMemo(() => filterProductionCards(cards, productionByCard, {
    search,
    scope,
    setCardIds: currentSet?.cards ?? [],
    slotCardIds: currentSlot?.cards ?? [],
    className: classFilter,
    part: partFilter,
    status: statusFilter,
    hasEffects: hasEffectsFilter,
    hasClean: hasCleanFilter,
    gameReady: gameReadyFilter
  }), [cards, classFilter, currentSet, currentSlot, gameReadyFilter, hasCleanFilter, hasEffectsFilter, partFilter, productionByCard, scope, search, statusFilter]);
  const hasUnsavedChanges = useMemo(
    () => Boolean(editorState && saved && (JSON.stringify(editorState) !== JSON.stringify(saved) || advancedText !== JSON.stringify(draft, null, 2))),
    [advancedText, draft, editorState, saved]
  );
  const validation = useMemo(() => draft ? validateGameMetadataDocument(draft) : null, [draft]);
  const previewBusy = visualSource === "original" ? originalBusy : renderBusy;
  const shownPreview = visualSource === "original" ? originalPreview?.dataUrl : preview?.dataUrl;
  const shownPreviewHash = visualSource === "original" ? originalPreview?.sha256 : preview?.sha256;
  const selectedProduction = selectedId ? productionByCard.get(selectedId) ?? null : null;
  const selectedVisualLayout = studioCard?.effectiveVisualLayout[selectedVisualLayoutField] ?? null;
  const selectedVisualLayoutOverride = visualLayoutOverrides?.fields[selectedVisualLayoutField] ?? null;
  const displayedVisualLayoutX = visualLayoutGhost?.field === selectedVisualLayoutField ? visualLayoutGhost.x : selectedVisualLayoutOverride?.x ?? selectedVisualLayout?.x ?? 0;
  const displayedVisualLayoutY = visualLayoutGhost?.field === selectedVisualLayoutField ? visualLayoutGhost.y : selectedVisualLayoutOverride?.y ?? selectedVisualLayout?.y ?? 0;
  const validationErrors = validation?.issues.filter((issue) => issue.severity === "error") ?? [];
  const validationWarnings = validation?.issues.filter((issue) => issue.severity === "warning") ?? [];
  const editorLockedByRecovery = recoveryDraft !== null;
  const filteredCardIds = useMemo(() => filtered.map((card) => card.id), [filtered]);
  const currentIndex = selectedId ? filteredCardIds.indexOf(selectedId) : -1;
  const previousId = adjacentCardId(filteredCardIds, selectedId, "previous");
  const nextId = adjacentCardId(filteredCardIds, selectedId, "next");
  const navigationEnabled = scope !== "all";
  const currentSetProduction = useMemo(() => {
    const ids = new Set(currentSet?.cards ?? []);
    return (dashboard?.cards ?? []).filter((state) => ids.has(state.card_id));
  }, [currentSet, dashboard]);
  const setExportReady = currentSetProduction.filter((state) => state.game_ready && state.exportable_visual_sources.includes(setExportVisualSource)).length;
  const setExportBlocked = Math.max(0, (currentSet?.cards.length ?? 0) - setExportReady);
  const setExportWarnings = currentSetProduction.reduce((total, state) => total + state.warnings, 0);

  const queueDraftWrite = (operation: () => Promise<void>): Promise<void> => {
    const queued = draftWriteQueueRef.current.catch(() => undefined).then(operation);
    draftWriteQueueRef.current = queued;
    return queued;
  };

  const refreshDashboard = async (setId: string | null) => {
    const requestId = ++dashboardRequestRef.current;
    const next = await window.axieCards.getProductionDashboard({ setId });
    if (requestId === dashboardRequestRef.current) {
      setDashboard(next);
      setSets(next.sets);
    }
    return next;
  };

  useEffect(() => {
    let active = true;
    window.axieCards.listCardSets()
      .then(async (availableSets) => {
        if (!active) return;
        setSets(availableSets);
        const initialSetId = availableSets[0]?.id ?? null;
        setCurrentSetId(initialSetId);
        const requestId = ++dashboardRequestRef.current;
        const next = await window.axieCards.getProductionDashboard({ setId: initialSetId });
        if (!active || requestId !== dashboardRequestRef.current) return;
        setDashboard(next);
        setSets(next.sets);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(`Production workspace could not be loaded. ${errorMessage(error)}`);
        setIsError(true);
      });
    return () => {
      active = false;
      dashboardRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    onDirtyChange(hasUnsavedChanges);
  }, [hasUnsavedChanges]);

  useEffect(() => () => onDirtyChange(false), []);

  useEffect(() => {
    const guardUnsavedChanges = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guardUnsavedChanges);
    return () => window.removeEventListener("beforeunload", guardUnsavedChanges);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (selectedId && !cards.some((card) => card.id === selectedId)) {
      selectedIdRef.current = null;
      setSelectedId(null);
    }
  }, [cards, selectedId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    draftEpochRef.current += 1;
    setStudioCard(null);
    setEditHistory(null);
    setSaved(null);
    setPreview(null);
    setOriginalPreview(null);
    setAdvancedText("");
    setAdvancedError(null);
    setMessage(null);
    setIsError(false);
    if (!selectedId) return;

    let active = true;
    setLoadingCard(true);
    setRecoveryDraft(null);
    setDraftTouched(false);
    setDraftStatus("idle");
    Promise.all([window.axieCards.loadStudioCard(selectedId), window.axieCards.loadStudioDraft(selectedId)])
      .then(([payload, recovery]) => {
        if (!active) return;
        setStudioCard(payload);
        const initialState: StudioEditorState = { metadata: payload.metadata, visualLayoutOverrides: payload.visualLayoutOverrides };
        setEditHistory(createEditorHistory(initialState));
        setSaved(cloneStudioEditorState(initialState));
        setAdvancedText(JSON.stringify(payload.metadata, null, 2));
        setVisualSource(payload.clean.available ? "rendered" : "original");
        setRecoveryDraft(recovery.available ? recovery.draft : null);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(`Could not load Card Studio data. ${errorMessage(error)}`);
        setIsError(true);
      })
      .finally(() => { if (active) setLoadingCard(false); });

    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !draft || !saved || !visualLayoutOverrides || !draftTouched || recoveryDraft) return;
    const changed = JSON.stringify(editorState) !== JSON.stringify(saved);
    const cardId = selectedId;
    const draftEpoch = draftEpochRef.current;
    const metadata = cloneStudioMetadata(draft);
    const layoutOverrides = structuredClone(visualLayoutOverrides);
    const timer = window.setTimeout(() => {
      if (selectedIdRef.current !== cardId || draftEpochRef.current !== draftEpoch) return;
      setDraftStatus("saving");
      queueDraftWrite(async () => {
        if (selectedIdRef.current !== cardId || draftEpochRef.current !== draftEpoch) return;
        if (changed) await window.axieCards.saveStudioDraft({ cardId, metadata, visualLayoutOverrides: layoutOverrides });
        else await window.axieCards.discardStudioDraft(cardId);
      })
        .then(() => {
          if (selectedIdRef.current !== cardId || draftEpochRef.current !== draftEpoch) return;
          setDraftStatus(changed ? "saved" : "idle");
        })
        .catch((error) => {
          if (selectedIdRef.current !== cardId || draftEpochRef.current !== draftEpoch) return;
          setDraftStatus("error");
          setMessage(`Recovery draft could not be written. ${errorMessage(error)}`);
          setIsError(true);
        });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [draft, draftTouched, editorState, recoveryDraft, saved, selectedId, visualLayoutOverrides]);

  useEffect(() => {
    setOriginalPreview(null);
    if (!selectedId || visualSource !== "original") {
      setOriginalBusy(false);
      return;
    }

    let active = true;
    setOriginalBusy(true);
    window.axieCards.loadPreview(selectedId)
      .then((payload) => {
        if (!active) return;
        setOriginalPreview(payload);
        setIsError(false);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(`Original placeholder could not be loaded. ${errorMessage(error)}`);
        setIsError(true);
      })
      .finally(() => { if (active) setOriginalBusy(false); });

    return () => { active = false; };
  }, [selectedId, visualSource]);

  useEffect(() => {
    if (visualSource !== "rendered" || !selectedId || !draft || !visualLayoutOverrides || !studioCard?.clean.available) {
      setPreview(null);
      setRenderBusy(false);
      return;
    }
    if (validation?.status === "invalid") {
      setRenderBusy(false);
      return;
    }

    let active = true;
    const renderDelay = 280;
    const timer = window.setTimeout(() => {
      setRenderBusy(true);
      window.axieCards.renderStudioPreview({ cardId: selectedId, metadata: draft, visualLayoutOverrides })
        .then((payload) => {
          if (!active) return;
          setPreview(payload);
          setStudioCard((current) => current ? { ...current, effectiveVisualLayout: payload.effectiveVisualLayout } : current);
          setIsError(false);
        })
        .catch((error) => {
          if (!active) return;
          setPreview(null);
          setMessage(`Preview could not be rendered. ${errorMessage(error)}`);
          setIsError(true);
        })
        .finally(() => { if (active) setRenderBusy(false); });
    }, renderDelay);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedId, draft, visualLayoutOverrides, studioCard?.clean.available, studioCard?.clean.sha256, validation?.status, visualSource, layoutRevision]);

  const reloadLayout = async () => {
    setLayoutReloadBusy(true);
    setMessage(null);
    setIsError(false);
    try {
      await window.axieCards.reloadStudioLayout();
      if (selectedId) {
        // Refresh backend-authoritative inherited coordinates while retaining
        // the current unsaved sparse patch in editor history.
        setStudioCard(await window.axieCards.loadStudioCard(selectedId));
      }
      // Incrementing this revision re-runs the existing backend render path.
      // It does not alter metadata, gameplay, or any asset on disk.
      setLayoutRevision((revision) => revision + 1);
      setMessage("Layout reloaded.");
    } catch (error) {
      setMessage(`Layout reload failed. Fix config/card_layout.json and try again. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setLayoutReloadBusy(false);
    }
  };

  const acceptEditorState = (next: StudioEditorState, allowPendingAdvanced = false) => {
    if (editorLockedByRecovery) return false;
    const serializedDraft = draft ? JSON.stringify(draft, null, 2) : "";
    if (!allowPendingAdvanced && draft && advancedText !== serializedDraft && !window.confirm("Discard unapplied Advanced JSON and continue with the visual editor change?")) {
      return false;
    }
    if (editHistory && JSON.stringify(editHistory.present) !== JSON.stringify(next)) {
      setEditHistory(pushEditorHistory(editHistory, next));
    } else if (!editHistory) {
      setEditHistory(createEditorHistory(next));
    }
    draftEpochRef.current += 1;
    setDraftTouched(true);
    setDraftStatus("idle");
    setAdvancedText(JSON.stringify(next.metadata, null, 2));
    setAdvancedError(null);
    setMessage(null);
    setIsError(false);
    return true;
  };

  const acceptDraft = (next: StudioMetadata, allowPendingAdvanced = false) => {
    if (!visualLayoutOverrides) return false;
    return acceptEditorState({ metadata: next, visualLayoutOverrides }, allowPendingAdvanced);
  };

  const acceptVisualLayoutOverrides = (next: StudioVisualLayoutOverrides) => {
    if (!draft) return false;
    return acceptEditorState({ metadata: draft, visualLayoutOverrides: next });
  };

  const commitVisualLayoutGhost = (ghost: VisualLayoutGhost | null = visualLayoutGhost) => {
    if (!ghost || !visualLayoutOverrides) return false;
    const withX = updateVisualLayoutCoordinate(visualLayoutOverrides, ghost.field, "x", ghost.x);
    const next = updateVisualLayoutCoordinate(withX, ghost.field, "y", ghost.y);
    const changed = JSON.stringify(next) !== JSON.stringify(visualLayoutOverrides);
    setVisualLayoutGhost(null);
    return changed ? acceptVisualLayoutOverrides(next) : false;
  };

  const restoreHistory = (direction: "undo" | "redo") => {
    if (!draft || editorLockedByRecovery) return;
    if (advancedText !== JSON.stringify(draft, null, 2) && !window.confirm("Discard unapplied Advanced JSON before changing edit history?")) return;
    if (!editHistory) return;
    const nextHistory = direction === "undo" ? undoEditorHistory(editHistory) : redoEditorHistory(editHistory);
    if (JSON.stringify(nextHistory.present) === JSON.stringify(editHistory.present)) return;
    draftEpochRef.current += 1;
    setEditHistory(nextHistory);
    setAdvancedText(JSON.stringify(nextHistory.present.metadata, null, 2));
    setAdvancedError(null);
    setDraftTouched(true);
    setDraftStatus("idle");
  };

  useEffect(() => {
    const keyboardHistory = (event: KeyboardEvent) => {
      if (editorLockedByRecovery || event.altKey || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey && undoStack.length) {
        event.preventDefault();
        restoreHistory("undo");
      } else if ((event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey)) && redoStack.length) {
        event.preventDefault();
        restoreHistory("redo");
      } else if (visualLayoutOverrides && isVisualLayoutNudgeKey({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        targetIsEditable: isEditableTarget(event.target)
      })) {
        const axis = event.key === "ArrowLeft" || event.key === "ArrowRight" ? "x" : "y";
        const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
        event.preventDefault();
        const effective = studioCard?.effectiveVisualLayout[selectedVisualLayoutField];
        if (!effective) return;
        const current = visualLayoutGhost?.field === selectedVisualLayoutField
          ? visualLayoutGhost[axis]
          : visualLayoutOverrides.fields[selectedVisualLayoutField]?.[axis] ?? effective[axis];
        setVisualLayoutGhost(visualLayoutGhostPosition(selectedVisualLayoutField, {
          x: axis === "x" ? current + direction * (event.shiftKey ? 10 : 1) : (visualLayoutGhost?.field === selectedVisualLayoutField ? visualLayoutGhost.x : visualLayoutOverrides.fields[selectedVisualLayoutField]?.x ?? effective.x),
          y: axis === "y" ? current + direction * (event.shiftKey ? 10 : 1) : (visualLayoutGhost?.field === selectedVisualLayoutField ? visualLayoutGhost.y : visualLayoutOverrides.fields[selectedVisualLayoutField]?.y ?? effective.y)
        }));
      } else if (visualLayoutGhost && event.key === "Enter") {
        event.preventDefault();
        commitVisualLayoutGhost();
      } else if (visualLayoutGhost && event.key === "Escape") {
        event.preventDefault();
        setVisualLayoutGhost(null);
      }
    };
    window.addEventListener("keydown", keyboardHistory);
    return () => window.removeEventListener("keydown", keyboardHistory);
  }, [advancedText, commitVisualLayoutGhost, draft, editorLockedByRecovery, redoStack, undoStack, visualLayoutGhost, visualLayoutOverrides, selectedVisualLayoutField, studioCard]);

  const beginVisualLayoutDrag = (event: React.PointerEvent<HTMLButtonElement>, field: CardVisualLayoutField) => {
    if (visualSource !== "rendered" || editorLockedByRecovery || actionBusy !== null || !studioCard || !previewFrameRef.current) return;
    const effective = studioCard.effectiveVisualLayout[field];
    if (!effective) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedVisualLayoutField(field);
    visualLayoutDragRef.current = {
      pointerId: event.pointerId,
      field,
      startPoint: { clientX: event.clientX, clientY: event.clientY },
      startPosition: {
        x: visualLayoutOverrides?.fields[field]?.x ?? effective.x,
        y: visualLayoutOverrides?.fields[field]?.y ?? effective.y
      }
    };
    setVisualLayoutGhost(null);
  };

  const updateVisualLayoutDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = visualLayoutDragRef.current;
    const bounds = previewFrameRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;
    const position = draggedLogicalPosition(drag.startPosition, drag.startPoint, event, bounds);
    setVisualLayoutGhost(visualLayoutGhostPosition(drag.field, position));
  };

  const finishVisualLayoutDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = visualLayoutDragRef.current;
    const bounds = previewFrameRef.current?.getBoundingClientRect();
    visualLayoutDragRef.current = null;
    setVisualLayoutGhost(null);
    if (!drag || drag.pointerId !== event.pointerId || !bounds || !visualLayoutOverrides) return;
    const position = draggedLogicalPosition(drag.startPosition, drag.startPoint, event, bounds);
    if (position.x === drag.startPosition.x && position.y === drag.startPosition.y) {
      setVisualLayoutGhost({ field: drag.field, ...drag.startPosition });
      return;
    }
    const withX = updateVisualLayoutCoordinate(visualLayoutOverrides, drag.field, "x", position.x);
    acceptVisualLayoutOverrides(updateVisualLayoutCoordinate(withX, drag.field, "y", position.y));
  };

  const cancelVisualLayoutDrag = () => {
    visualLayoutDragRef.current = null;
    setVisualLayoutGhost(null);
  };

  const updateDraft = <K extends keyof StudioMetadata>(key: K, value: StudioMetadata[K]) => {
    if (draft) acceptDraft({ ...draft, [key]: value });
  };

  const updateEffect = (index: number, patch: Record<string, unknown>) => {
    if (!draft) return;
    const effects = draft.effects.map((effect, effectIndex) => effectIndex === index ? { ...effect, ...patch } : effect) as StudioEffect[];
    acceptDraft({ ...draft, effects });
  };

  const changeEffectType = (index: number, type: EffectType) => {
    if (!draft) return;
    acceptDraft(replaceCardEffectType(draft, index, type));
  };

  const applyEffectOperation = (operation: () => StudioMetadata) => {
    try {
      acceptDraft(operation());
    } catch (error) {
      setMessage(`Effect operation could not be applied. Fix invalid fields first. ${errorMessage(error)}`);
      setIsError(true);
    }
  };

  const addEffect = () => {
    if (draft) applyEffectOperation(() => addCardEffect(draft, newEffectType));
  };

  const applyAdvancedJson = () => {
    if (!draft) return;
    const parsed = parseAdvancedGameMetadata(advancedText, draft);
    if (!parsed.ok) {
      setAdvancedError(parsed.error);
      return;
    }
    if (parsed.metadata.id !== draft.id || parsed.metadata.class !== draft.class || parsed.metadata.part !== draft.part) {
      setAdvancedError("Advanced JSON cannot change id, class, or part for the selected source card.");
      return;
    }
    acceptDraft(cloneStudioMetadata(parsed.metadata), true);
    setMessage("Advanced JSON applied to the current draft. Save Metadata to persist it.");
  };

  const selectStudioCard = async (cardId: string, skipGuard = false): Promise<boolean> => {
    if (cardId === selectedId) return true;
    if (!skipGuard && hasUnsavedChanges) {
      const pendingAdvancedJson = Boolean(draft && advancedText !== JSON.stringify(draft, null, 2));
      const acceptedDraftChanged = Boolean(editorState && saved && JSON.stringify(editorState) !== JSON.stringify(saved));
      const prompt = pendingAdvancedJson
        ? "Open another card? Accepted editor changes will be kept as a recovery draft, but unapplied Advanced JSON will be discarded."
        : "Keep this card's recovery draft and open another card without saving confirmed metadata?";
      if (!window.confirm(prompt)) return false;
      if (acceptedDraftChanged && selectedId && draft && visualLayoutOverrides) {
        const previousCardId = selectedId;
        const metadata = cloneStudioMetadata(draft);
        const layoutOverrides = structuredClone(visualLayoutOverrides);
        const flushEpoch = ++draftEpochRef.current;
        setActionBusy("draft");
        setDraftStatus("saving");
        try {
          await queueDraftWrite(() => window.axieCards.saveStudioDraft({ cardId: previousCardId, metadata, visualLayoutOverrides: layoutOverrides }).then(() => undefined));
          if (selectedIdRef.current !== previousCardId || draftEpochRef.current !== flushEpoch) return false;
          setDraftStatus("saved");
        } catch (error) {
          if (selectedIdRef.current === previousCardId && draftEpochRef.current === flushEpoch) {
            setDraftStatus("error");
            setMessage(`The recovery draft could not be saved, so the current card remains open. ${errorMessage(error)}`);
            setIsError(true);
          }
          return false;
        } finally {
          setActionBusy(null);
        }
      }
    }
    selectedIdRef.current = cardId;
    draftEpochRef.current += 1;
    setSelectedId(cardId);
    return true;
  };

  const saveMetadata = async (): Promise<boolean> => {
    if (!selectedId || !draft || !visualLayoutOverrides) return false;
    if (advancedText !== JSON.stringify(draft, null, 2)) {
      setAdvancedError("Apply or reset the pending Advanced JSON before saving.");
      return false;
    }
    if (validation?.status === "invalid") return false;
    setActionBusy("save");
    setMessage(null);
    setIsError(false);
    try {
    let payload: StudioCardPayload;
    try {
      payload = await window.axieCards.saveStudioMetadata({ cardId: selectedId, metadata: draft, visualLayoutOverrides });
    } catch (error) {
      setMessage(`Metadata could not be saved. Check the fields and try again. ${errorMessage(error)}`);
      setIsError(true);
      return false;
    }

    draftEpochRef.current += 1;
    setStudioCard(payload);
    const savedState: StudioEditorState = { metadata: payload.metadata, visualLayoutOverrides: payload.visualLayoutOverrides };
    setEditHistory(createEditorHistory(savedState));
    setSaved(cloneStudioEditorState(savedState));
    setAdvancedText(JSON.stringify(payload.metadata, null, 2));
    setDraftTouched(false);
    setDraftStatus("idle");

    const followUpErrors: string[] = [];
    try {
      await queueDraftWrite(() => window.axieCards.discardStudioDraft(selectedId));
    } catch (error) {
      followUpErrors.push(`the recovery draft could not be cleared (${errorMessage(error)})`);
    }
    try {
      await refreshDashboard(currentSetId);
    } catch (error) {
      followUpErrors.push(`production indicators could not be refreshed (${errorMessage(error)})`);
    }
    if (followUpErrors.length > 0) {
      setMessage(`Game metadata was saved, but ${followUpErrors.join(" and ")}.`);
      setIsError(true);
    } else {
      setMessage("Game metadata saved. The JSON is now the source of truth for this card.");
      setIsError(false);
    }
    return true;
    } finally {
      setActionBusy(null);
    }
  };

  const saveAndNext = async () => {
    if (!nextId) return;
    if (await saveMetadata()) await selectStudioCard(nextId, true);
  };

  const resetMetadata = async () => {
    if (!saved || !selectedId) return;
    const cardId = selectedId;
    const resetEpoch = ++draftEpochRef.current;
    setEditHistory(createEditorHistory(saved));
    setAdvancedText(JSON.stringify(saved.metadata, null, 2));
    setAdvancedError(null);
    setDraftTouched(false);
    setDraftStatus("saving");
    try {
      await queueDraftWrite(() => window.axieCards.discardStudioDraft(cardId));
      if (selectedIdRef.current !== cardId || draftEpochRef.current !== resetEpoch) return;
      setDraftStatus("idle");
      setMessage("Unsaved changes reset to the last saved or default metadata.");
      setIsError(false);
    } catch (error) {
      if (selectedIdRef.current !== cardId || draftEpochRef.current !== resetEpoch) return;
      setDraftStatus("error");
      setMessage(`The editor was reset, but its recovery draft could not be discarded. ${errorMessage(error)}`);
      setIsError(true);
    }
  };

  const restoreRecoveryDraft = () => {
    if (!recoveryDraft || !selectedId || !draft || !visualLayoutOverrides) return;
    if (recoveryDraft.card_id !== selectedId) {
      setMessage("The recovery draft belongs to another source card. Discard it to continue safely.");
      setIsError(true);
      return;
    }
    const restored = recoverableMetadata(recoveryDraft.metadata, draft);
    if (!restored) {
      setMessage("The recovery draft is malformed or belongs to another card. Discard it to continue safely.");
      setIsError(true);
      return;
    }
    draftEpochRef.current += 1;
    const restoredState: StudioEditorState = {
      metadata: restored,
      visualLayoutOverrides: recoveryDraft.visual_layout ?? visualLayoutOverrides
    };
    setEditHistory(pushEditorHistory(createEditorHistory({ metadata: draft, visualLayoutOverrides }), restoredState));
    setAdvancedText(JSON.stringify(restored, null, 2));
    setAdvancedError(null);
    setRecoveryDraft(null);
    setDraftTouched(true);
    setDraftStatus("idle");
    setMessage("Unsaved draft restored. Save Metadata to confirm it.");
    setIsError(false);
  };

  const discardRecoveryDraft = async () => {
    if (!selectedId) return;
    const cardId = selectedId;
    try {
      await queueDraftWrite(() => window.axieCards.discardStudioDraft(cardId));
      if (selectedIdRef.current !== cardId) return;
      setRecoveryDraft(null);
      setDraftStatus("idle");
      setMessage("Recovery draft discarded. Confirmed metadata was not changed.");
      await refreshDashboard(currentSetId);
    } catch (error) {
      setMessage(`Recovery draft could not be discarded. ${errorMessage(error)}`);
      setIsError(true);
    }
  };

  const copyGameplay = () => {
    if (!draft) return;
    setGameplayClipboard(copyGameplayData(draft));
    setMessage(`Gameplay copied for this session (${draft.effects.length} effect${draft.effects.length === 1 ? "" : "s"}).`);
    setIsError(false);
  };

  const pasteGameplay = () => {
    if (!draft || !gameplayClipboard) return;
    if (draft.effects.length && !window.confirm(`Paste Gameplay will replace targeting and ${draft.effects.length} existing effect${draft.effects.length === 1 ? "" : "s"}. Continue?`)) return;
    acceptDraft(pasteGameplayData(draft, gameplayClipboard));
    setMessage("Gameplay pasted. Card identity and visual metadata were preserved.");
  };

  const focusIssue = (path: string) => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-validation-path]"));
    let candidate = candidates.find((element) => element.dataset.validationPath === path);
    let parentPath = path;
    while (!candidate && parentPath !== "$") {
      const nextParent = parentPath.replace(/(?:\.[^.\[]+|\[\d+\])$/, "");
      if (nextParent === parentPath) break;
      parentPath = nextParent || "$";
      candidate = candidates.find((element) => element.dataset.validationPath === parentPath);
    }
    candidate ??= candidates.find((element) => element.dataset.validationPath?.startsWith(`${path}.`));
    candidate ??= candidates.find((element) => element.dataset.validationPath === "$");
    const details = candidate?.closest("details");
    if (details instanceof HTMLDetailsElement) details.open = true;
    candidate?.focus();
    candidate?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const importClean = async () => {
    if (!selectedId) return;
    const currentDraft = draft ? cloneStudioMetadata(draft) : null;
    const hasPendingAdvancedJson = Boolean(draft && advancedText !== JSON.stringify(draft, null, 2));
    setActionBusy("import");
    setMessage(null);
    setIsError(false);
    try {
      const payload = await window.axieCards.importStudioClean(selectedId);
      if (!payload) {
        setMessage("Clean base import cancelled. Select a PNG when you are ready.");
        return;
      }
      setStudioCard(payload);
      const savedState: StudioEditorState = { metadata: payload.metadata, visualLayoutOverrides: payload.visualLayoutOverrides };
      setSaved(cloneStudioEditorState(savedState));
      const nextState: StudioEditorState = currentDraft && visualLayoutOverrides
        ? { metadata: currentDraft, visualLayoutOverrides }
        : savedState;
      setEditHistory((current) => current ?? createEditorHistory(nextState));
      if (!hasPendingAdvancedJson) setAdvancedText(JSON.stringify(nextState.metadata, null, 2));
      setPreview(null);
      setVisualSource("rendered");
      try {
        await refreshDashboard(currentSetId);
        setMessage("Clean base imported. The original PNG remains unchanged while previews render separately.");
      } catch (error) {
        setMessage(`Clean base imported, but production indicators could not be refreshed. ${errorMessage(error)}`);
        setIsError(true);
      }
    } catch (error) {
      setMessage(`Clean base could not be imported. Select a readable PNG and try again. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setActionBusy(null);
    }
  };

  const exportRendered = async () => {
    if (!selectedId || !draft || !visualLayoutOverrides || !studioCard?.clean.available) return;
    setActionBusy("export");
    setMessage(null);
    setIsError(false);
    try {
      const payload = await window.axieCards.exportStudioRendered({ cardId: selectedId, metadata: draft, visualLayoutOverrides });
      try {
        await refreshDashboard(currentSetId);
        setMessage(`Rendered card exported to ${payload.path}.`);
      } catch (error) {
        setMessage(`Rendered card was exported to ${payload.path}, but production indicators could not be refreshed. ${errorMessage(error)}`);
        setIsError(true);
      }
    } catch (error) {
      setMessage(`Rendered card could not be exported. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setActionBusy(null);
    }
  };

  const exportGameCard = async () => {
    if (!selectedId || !draft || !visualLayoutOverrides || validation?.status === "invalid") return;
    if (advancedText !== JSON.stringify(draft, null, 2)) {
      setAdvancedError("Apply or reset the pending Advanced JSON before exporting.");
      return;
    }
    if (visualSource === "rendered" && !studioCard?.clean.available) return;
    setActionBusy("game-export");
    setMessage(null);
    setIsError(false);
    try {
      if (!exportRoot && !await onChooseFolder()) {
        setMessage("Game card export cancelled. Choose an export folder when you are ready.");
        return;
      }
      const payload = await window.axieCards.exportStudioGameCardFlat({ cardId: selectedId, metadata: draft, visualSource, visualLayoutOverrides });
      setMessage(payload.status === "skipped" ? `Identical game card files already exist at ${payload.directory}.` : `Game card exported to ${payload.directory}.`);
    } catch (error) {
      setMessage(`Game card package could not be exported. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setActionBusy(null);
    }
  };

  const changeCurrentSet = async (setId: string | null) => {
    if (setId === currentSetId) return;
    if (hasUnsavedChanges && !window.confirm("Keep the recovery draft and change Card Set without saving confirmed metadata?")) return;
    setCurrentSetId(setId);
    setCurrentSlotId(null);
    setAssignmentSlotId(null);
    setGameSetExport(null);
    if (!setId && scope !== "all") setScope("all");
    else if (setId && scope === "slot") setScope("set");
    try {
      await refreshDashboard(setId);
    } catch (error) {
      setMessage(`Card Set could not be selected. ${errorMessage(error)}`);
      setIsError(true);
    }
  };

  const changeCurrentSlot = (slotId: string | null) => {
    if (slotId === currentSlotId) return;
    if (hasUnsavedChanges && !window.confirm("Keep the recovery draft and change Axie Slot without saving confirmed metadata?")) return;
    setCurrentSlotId(slotId);
    if (slotId) setScope("slot");
    else if (scope === "slot") setScope(currentSet ? "set" : "all");
  };

  const openProductionDialog = (kind: ProductionDialogKind) => {
    if ((kind === "create-slot" || kind === "rename-slot") && !currentSet) return;
    if ((kind === "rename-set" || kind === "rename-slot") && !currentSet) return;
    const value = kind === "create-set"
      ? "First Battle Set"
      : kind === "create-slot"
        ? `Axie Slot ${(currentSet?.axies.length ?? 0) + 1}`
        : kind === "rename-set"
          ? currentSet?.name ?? ""
          : currentSlot?.name ?? "";
    setProductionDialog({ kind, value, error: null });
  };

  const submitProductionDialog = async () => {
    const dialog = productionDialog;
    if (!dialog || productionBusy) return;
    const name = dialog.value.trim();
    const optional = dialog.kind === "create-slot" || dialog.kind === "rename-slot";
    if (!name && !optional) {
      setProductionDialog({ ...dialog, error: "Enter a name before continuing." });
      return;
    }
    if (dialog.kind === "rename-set" && (!currentSet || name === currentSet.name)) {
      setProductionDialog(null);
      return;
    }
    if (dialog.kind === "rename-slot" && (!currentSet || !currentSlot || name === (currentSlot.name ?? ""))) {
      setProductionDialog(null);
      return;
    }
    setProductionBusy(true);
    try {
      if (dialog.kind === "create-set") {
        const created = await window.axieCards.createCardSet({ name });
        setCurrentSetId(created.id);
        setCurrentSlotId(null);
        setScope("set");
        await refreshDashboard(created.id);
        setMessage(`Card Set “${created.name}” created.`);
      } else if (dialog.kind === "rename-set" && currentSet) {
        const updated = await window.axieCards.renameCardSet({ setId: currentSet.id, name });
        await refreshDashboard(updated.id);
        setMessage(`Card Set renamed to “${updated.name}”.`);
      } else if (dialog.kind === "create-slot" && currentSet) {
        const updated = await window.axieCards.createAxieSlot({ setId: currentSet.id, name: name || null });
        await refreshDashboard(updated.id);
        const created = updated.axies.at(-1) ?? null;
        setCurrentSlotId(created?.id ?? null);
        setAssignmentSlotId(created?.id ?? null);
        setScope(created ? "slot" : "set");
        setMessage("Axie Slot created.");
      } else if (dialog.kind === "rename-slot" && currentSet && currentSlot) {
        const updated = await window.axieCards.renameAxieSlot({ setId: currentSet.id, slotId: currentSlot.id, name: name || null });
        await refreshDashboard(updated.id);
        setMessage("Axie Slot renamed.");
      }
      setProductionDialog(null);
      setIsError(false);
    } catch (error) {
      setProductionDialog({ ...dialog, error: errorMessage(error) });
      setMessage(`Production workspace action could not be completed. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setProductionBusy(false);
    }
  };

  const createSet = () => openProductionDialog("create-set");
  const renameSet = () => openProductionDialog("rename-set");

  const deleteSet = async () => {
    if (!currentSet || !window.confirm(`Delete Card Set “${currentSet.name}”? Game Metadata and RAW assets will not be deleted.`)) return;
    if (hasUnsavedChanges && !window.confirm("This card still has unsaved edits. Keep its recovery draft and delete only the Card Set?")) return;
    setProductionBusy(true);
    try {
      await window.axieCards.deleteCardSet(currentSet.id);
      const availableSets = await window.axieCards.listCardSets();
      const nextSetId = availableSets[0]?.id ?? null;
      setSets(availableSets);
      setCurrentSetId(nextSetId);
      setCurrentSlotId(null);
      setScope(nextSetId ? "set" : "all");
      await refreshDashboard(nextSetId);
      setMessage("Card Set deleted. Card metadata and source assets were preserved.");
      setIsError(false);
    } catch (error) {
      setMessage(`Card Set could not be deleted. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setProductionBusy(false);
    }
  };

  const createSlot = () => openProductionDialog("create-slot");
  const renameSlot = () => openProductionDialog("rename-slot");

  const deleteSlot = async () => {
    if (!currentSet || !currentSlot || !window.confirm(`Delete ${currentSlot.name || currentSlot.id}? Cards remain in the Card Set and their metadata is preserved.`)) return;
    if (hasUnsavedChanges && !window.confirm("This card still has unsaved edits. Keep its recovery draft and delete only the slot?")) return;
    setProductionBusy(true);
    try {
      const updated = await window.axieCards.deleteAxieSlot({ setId: currentSet.id, slotId: currentSlot.id });
      setCurrentSlotId(null);
      setAssignmentSlotId(null);
      setScope("set");
      await refreshDashboard(updated.id);
      setMessage("Axie Slot deleted. Cards remain in the set.");
      setIsError(false);
    } catch (error) {
      setMessage(`Axie Slot could not be deleted. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setProductionBusy(false);
    }
  };

  const setMembership = async (add: boolean) => {
    if (!currentSet || !selectedId) return;
    setProductionBusy(true);
    try {
      const updated = add
        ? await window.axieCards.addCardToSet({ setId: currentSet.id, cardId: selectedId })
        : await window.axieCards.removeCardFromSet({ setId: currentSet.id, cardId: selectedId });
      await refreshDashboard(updated.id);
      setMessage(add ? "Card added to Current Set." : "Card removed from Current Set and its slots. Metadata was preserved.");
      setIsError(false);
    } catch (error) {
      setMessage(`Card Set membership could not be updated. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setProductionBusy(false);
    }
  };

  const slotMembership = async (add: boolean) => {
    if (!currentSet || !selectedId) return;
    const slotId = add ? assignmentSlotId : currentSlotId;
    if (!slotId) return;
    setProductionBusy(true);
    try {
      const request = { setId: currentSet.id, slotId, cardId: selectedId };
      const updated = add
        ? await window.axieCards.assignCardToAxieSlot(request)
        : await window.axieCards.removeCardFromAxieSlot(request);
      await refreshDashboard(updated.id);
      setMessage(add ? "Card assigned to Axie Slot." : "Card removed from Axie Slot; it remains in the set.");
      setIsError(false);
    } catch (error) {
      setMessage(`Axie Slot assignment could not be updated. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setProductionBusy(false);
    }
  };

  const exportGameSet = async () => {
    if (!currentSet || !dashboard) return;
    const ready = setExportReady;
    const blocked = setExportBlocked;
    const readyOnly = blocked > 0;
    const summary = [
      `Export Card Set “${currentSet.name}”?`,
      `Total cards: ${currentSet.cards.length}`,
      `Game Ready: ${ready}`,
      `Warnings: ${setExportWarnings}`,
      `Blocked: ${blocked}`,
      readyOnly ? "Only Game Ready cards will be exported; blocked cards will be skipped." : "All cards are Game Ready."
    ].join("\n");
    if (!window.confirm(summary)) return;
    if (!exportRoot && !await onChooseFolder()) return;
    setProductionBusy(true);
    setGameSetExport(null);
    try {
      const result = await window.axieCards.exportStudioGameSet({ setId: currentSet.id, visualSource: setExportVisualSource, readyOnly });
      setGameSetExport(result);
      setMessage(`Game Set export complete: ${result.report.success} success, ${result.report.failed} failed, ${result.report.skipped} skipped.`);
      setIsError(result.report.failed > 0);
    } catch (error) {
      setMessage(`Game Set could not be exported. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setProductionBusy(false);
    }
  };

  const dialogTitle = productionDialog?.kind === "create-set" ? "Create Card Set"
    : productionDialog?.kind === "rename-set" ? "Rename Card Set"
      : productionDialog?.kind === "create-slot" ? "Create Axie Slot" : "Rename Axie Slot";
  const dialogDescription = productionDialog?.kind === "create-slot" || productionDialog?.kind === "rename-slot"
    ? "Choose a display name for this slot. Leave it empty to use the default label."
    : "Choose a name for this production Card Set.";
  const dialogSubmitLabel = productionDialog?.kind.startsWith("create") ? "Create" : "Save";

  return (
    <>
    <div className="studio-layout">
      <aside className="panel studio-browser">
        <div className="production-workspace">
          <div className="section-title"><div><span className="eyebrow">Production workspace</span><h2>Card Sets</h2></div><button className="ghost compact" disabled={productionBusy} onClick={createSet}>+ Create</button></div>
          <label className="field compact-field"><span>Current Set</span><select disabled={productionBusy} value={currentSetId ?? ""} onChange={(event) => void changeCurrentSet(event.target.value || null)}><option value="">No set selected</option>{sets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
          <div className="compact-actions"><button className="ghost" disabled={!currentSet || productionBusy} onClick={renameSet}>Rename</button><button className="ghost danger" disabled={!currentSet || productionBusy} onClick={deleteSet}>Delete</button></div>
          {currentSet && dashboard && <div className="production-dashboard">
            <div className="dashboard-title"><strong>{currentSet.name}</strong><span>{dashboard.counts.total} cards · {currentSet.axies.length} Axies</span></div>
            <span><b>{dashboard.counts.unconfigured}</b> Unconfigured</span><span><b>{dashboard.counts.draft}</b> Draft</span><span><b>{dashboard.counts.valid}</b> Valid</span><span className="ready"><b>{dashboard.counts.game_ready}</b> Game Ready</span>
          </div>}
          <div className="slot-controls">
            <label className="field compact-field"><span>Axie Slot</span><select disabled={!currentSet || productionBusy} value={currentSlotId ?? ""} onChange={(event) => changeCurrentSlot(event.target.value || null)}><option value="">All slots</option>{currentSet?.axies.map((slot, index) => <option key={slot.id} value={slot.id}>{slot.name || `Axie Slot ${index + 1}`}</option>)}</select></label>
            <div className="compact-actions"><button className="ghost" disabled={!currentSet || productionBusy} onClick={createSlot}>+ Slot</button><button className="ghost" disabled={!currentSlot || productionBusy} onClick={renameSlot}>Rename</button><button className="ghost danger" disabled={!currentSlot || productionBusy} onClick={deleteSlot}>Delete</button></div>
          </div>
        </div>
        <div className="panel-heading row compact-heading">
          <div><span className="eyebrow">Production browser</span><h2>Cards</h2></div>
          <span className="count-pill">{filtered.length} / {cards.length}</span>
        </div>
        <label className="field studio-search">
          <span>Search</span>
          <input value={search} placeholder="Name, slug, local name or ID" onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="production-filters">
          <label className="field compact-field"><span>View</span><select value={scope} onChange={(event) => {
            const next = event.target.value as ProductionScope;
            if (next === "slot" && !currentSlot) return;
            if (next === "set" && !currentSet) return;
            setScope(next);
          }}><option value="all">All Cards</option><option value="set" disabled={!currentSet}>Current Set</option><option value="slot" disabled={!currentSlot}>Axie Slot</option></select></label>
          <div className="filter-pair">
            <SelectFilter label="Class" value={classFilter} options={CLASSES} allLabel="All" onChange={setClassFilter} />
            <SelectFilter label="Part" value={partFilter} options={PARTS} allLabel="All" onChange={setPartFilter} />
          </div>
          <label className="field compact-field"><span>Status</span><select value={statusFilter ?? ""} onChange={(event) => setStatusFilter((event.target.value || null) as ProductionStatus | null)}><option value="">All</option><option>UNCONFIGURED</option><option>DRAFT</option><option>VALID</option><option>GAME_READY</option></select></label>
          <div className="filter-checks"><label><input type="checkbox" checked={hasEffectsFilter} onChange={(event) => setHasEffectsFilter(event.target.checked)} /> Effects</label><label><input type="checkbox" checked={hasCleanFilter} onChange={(event) => setHasCleanFilter(event.target.checked)} /> Clean</label><label><input type="checkbox" checked={gameReadyFilter} onChange={(event) => setGameReadyFilter(event.target.checked)} /> Game Ready</label></div>
          <button className="ghost clear-production-filters" onClick={() => { setSearch(""); setClassFilter(null); setPartFilter(null); setStatusFilter(null); setHasEffectsFilter(false); setHasCleanFilter(false); setGameReadyFilter(false); }}>Clear filters</button>
        </div>
        <div className="studio-card-list">
          {filtered.map((card) => {
            const state = productionByCard.get(card.id);
            return <button key={card.id} disabled={actionBusy !== null} className={`card-row production-card-row ${selectedId === card.id ? "selected" : ""}`} onClick={() => selectStudioCard(card.id)}>
              <span className="card-name">{card.name}</span>
              <span className={`production-status status-${(state?.status ?? "UNCONFIGURED").toLowerCase()}`}>{state?.status ?? "UNCONFIGURED"}</span>
              <span className="card-traits">{card.class ?? "Unknown"} <b>•</b> {card.part ?? "Unknown"}</span>
              <span className="production-indicators" aria-label="Production indicators"><i className={state?.metadata_exists ? "on" : ""} title="Metadata">M</i><i className={state?.effect_count ? "on" : ""} title={`${state?.effect_count ?? 0} effects`}>E{state?.effect_count ?? 0}</i><i className={state?.original_available ? "on" : ""} title="Original available">O</i><i className={state?.clean_available ? "on" : ""} title="Clean available">C</i><i className={state?.rendered_available ? "on" : ""} title="Rendered available">R</i><i className={state?.game_ready ? "on ready" : ""} title="Game ready">G</i>{Boolean(state?.errors) && <i className="issue" title={`${state?.errors} errors`}>!{state?.errors}</i>}{Boolean(state?.warnings) && <i className="warning" title={`${state?.warnings} warnings`}>△{state?.warnings}</i>}</span>
            </button>;
          })}
          {!filtered.length && <div className="empty">No cards match the combined production filters.</div>}
        </div>
      </aside>

      <section className="panel studio-preview-panel">
        {!selectedId ? (
          <div className="preview-empty"><div className="card-glyph">◇</div><h2>Select a card</h2><p>Choose a source card to begin composing its editable version.</p></div>
        ) : loadingCard ? (
          <div className="preview-empty"><div className="spinner" /><h2>Loading Card Studio</h2><p>Reading clean asset and game metadata.</p></div>
        ) : !studioCard || !draft ? (
          <div className="preview-empty"><div className="card-glyph">!</div><h2>Card unavailable</h2><p>Choose the card again or review the error below.</p></div>
        ) : (
          <>
            {recoveryDraft && <div className="draft-recovery-banner"><div><b>Unsaved draft found</b><span>Restore it into the editor or discard it. Confirmed metadata has not changed.</span></div><button className="primary" onClick={restoreRecoveryDraft}>Restore Draft</button><button className="ghost" onClick={() => void discardRecoveryDraft()}>Discard Draft</button></div>}
            <div className="production-card-toolbar">
              <div className="card-navigation"><button className="ghost" disabled={!navigationEnabled || !previousId || actionBusy !== null} onClick={() => previousId && selectStudioCard(previousId)}>← Previous</button><span>{navigationEnabled && currentIndex >= 0 ? `${currentIndex + 1} / ${filtered.length}` : "Select a Set or Slot view for sequence navigation"}</span><button className="ghost" disabled={!navigationEnabled || !nextId || actionBusy !== null} onClick={() => nextId && selectStudioCard(nextId)}>Next →</button></div>
              {currentSet && <div className="membership-row">
                <button className="ghost" disabled={productionBusy} onClick={() => void setMembership(!currentSet.cards.includes(selectedId))}>{currentSet.cards.includes(selectedId) ? "Remove from Set" : "Add to Current Set"}</button>
                <select disabled={!currentSet.cards.includes(selectedId) || productionBusy} value={assignmentSlotId ?? ""} onChange={(event) => setAssignmentSlotId(event.target.value || null)}><option value="">Assign to slot…</option>{currentSet.axies.map((slot, index) => <option key={slot.id} value={slot.id}>{slot.name || `Axie Slot ${index + 1}`}</option>)}</select>
                <button className="ghost" disabled={!assignmentSlotId || !currentSet.cards.includes(selectedId) || productionBusy} onClick={() => void slotMembership(true)}>Assign</button>
                {currentSlot?.cards.includes(selectedId) && <button className="ghost danger" disabled={productionBusy} onClick={() => void slotMembership(false)}>Remove from Slot</button>}
              </div>}
            </div>
            <div className="panel-heading row studio-preview-heading">
              <div><span className="eyebrow">Visual source</span><h2>{draft.name || studioCard.source.name}</h2><p>{visualSource === "original" ? "Byte-preserving source placeholder" : "Clean Base + current game metadata"}</p></div>
              <span className={`status-pill ${studioCard.clean.available ? "ready" : "missing"}`}>{studioCard.clean.available ? "Clean Base ready" : "Clean Base missing"}</span>
            </div>
            <div className="visual-source-switch" role="group" aria-label="Visual Source">
              <button className={visualSource === "original" ? "active" : ""} onClick={() => setVisualSource("original")}>Original / Placeholder</button>
              <button disabled={!studioCard.clean.available} title={!studioCard.clean.available ? "No Clean Base available" : undefined} className={visualSource === "rendered" ? "active" : ""} onClick={() => setVisualSource("rendered")}>{studioCard.clean.available ? "Clean Base / Rendered" : "Clean Base unavailable"}</button>
              <button className="ghost" disabled={layoutReloadBusy} onClick={() => void reloadLayout()}>{layoutReloadBusy ? "Reloading…" : "Reload Layout"}</button>
            </div>
            {visualSource === "original" && <div className="visual-warning">Original placeholder — embedded text may not match Game Metadata</div>}
            <div ref={previewFrameRef} className={`studio-preview-frame ${visualSource === "rendered" && !studioCard.clean.available ? "missing" : ""}`}>
              {shownPreview && <img src={shownPreview} alt={`${draft.name || studioCard.source.name} ${visualSource === "original" ? "original placeholder" : "rendered preview"}`} />}
              {visualLayoutGhost && visualSource === "rendered" && preview ? (() => {
                const ghostLayout = studioCard.effectiveVisualLayout[visualLayoutGhost.field];
                const frame = previewFrameRef.current?.getBoundingClientRect();
                const display = logicalTextLayoutToDisplayStyle(ghostLayout, visualLayoutGhost, { width: frame?.width ?? 400, height: frame?.height ?? 600 });
                const ghostValue = visualLayoutGhost.field === "cost" ? String(draft.cost)
                  : visualLayoutGhost.field === "value" ? String(draft.value ?? "")
                  : visualLayoutGhost.field === "card_type"
                    ? studioCard.visualLayoutRendering.card_type_display[draft.card_type.trim().toLowerCase()] ?? draft.card_type
                    : draft[visualLayoutGhost.field];
                return <div className="visual-layout-ghost" aria-label={`Editing ${visualLayoutGhost.field}`} style={{
                  left: `${display.left}px`, top: `${display.top}px`, width: `${display.width}px`, height: `${display.height}px`,
                  color: ghostLayout.color, fontFamily: `"${studioCard.visualLayoutRendering.default_font_family}"`, fontWeight: ghostLayout.font_weight,
                  fontSize: `${display.fontSize}px`, lineHeight: `${display.lineHeight}px`, textAlign: display.textAlign,
                  WebkitTextStrokeColor: ghostLayout.stroke_color, WebkitTextStrokeWidth: `${display.strokeWidth}px`,
                  justifyContent: display.verticalAlign === "bottom" ? "flex-end" : display.verticalAlign === "middle" ? "center" : "flex-start"
                }}><span style={{ width: `${display.contentWidth}px`, marginLeft: `${display.contentOffsetX}px` }}>{ghostValue}</span></div>;
              })() : null}
              {visualSource === "rendered" && studioCard.clean.available && preview && (
                <div className="visual-layout-overlay" aria-label="Visual layout editor overlay">
                  {CARD_VISUAL_LAYOUT_FIELDS.map((field) => {
                    const layout = studioCard.effectiveVisualLayout[field];
                    if (!layout) return null;
                    const dragged = visualLayoutGhost?.field === field ? visualLayoutGhost : null;
                    const x = dragged?.x ?? visualLayoutOverrides?.fields[field]?.x ?? layout.x;
                    const y = dragged?.y ?? visualLayoutOverrides?.fields[field]?.y ?? layout.y;
                    return <button
                      key={field}
                      type="button"
                      className={`visual-layout-target ${selectedVisualLayoutField === field ? "selected" : ""}`}
                      aria-label={`Select and drag ${field === "card_type" ? "card type" : field}`}
                      title={`Drag ${field === "card_type" ? "Card Type" : field}`}
                      style={{
                        left: `${x / VISUAL_LAYOUT_LOGICAL_SIZE.width * 100}%`,
                        top: `${y / VISUAL_LAYOUT_LOGICAL_SIZE.height * 100}%`,
                        width: `${layout.width / VISUAL_LAYOUT_LOGICAL_SIZE.width * 100}%`,
                        height: `${layout.height / VISUAL_LAYOUT_LOGICAL_SIZE.height * 100}%`
                      }}
                      onPointerDown={(event) => beginVisualLayoutDrag(event, field)}
                      onPointerMove={updateVisualLayoutDrag}
                      onPointerUp={finishVisualLayoutDrag}
                      onPointerCancel={cancelVisualLayoutDrag}
                    ><span>{field === "card_type" ? "Card Type" : field}</span></button>;
                  })}
                </div>
              )}
              {visualSource === "rendered" && !studioCard.clean.available && (
                <div className="clean-missing">
                  <div className="card-glyph">◇</div>
                  <h3>Clean Base not available</h3>
                  <p>Import a clean PNG containing only artwork, frame, backgrounds and non-variable decoration.</p>
                  <button className="primary" disabled={actionBusy !== null} onClick={importClean}>{actionBusy === "import" ? "Importing…" : "Select / Import Clean Base PNG"}</button>
                </div>
              )}
              {visualSource === "rendered" && studioCard.clean.available && !preview && !previewBusy && <div className="loading">Preview unavailable. Edit a field or import the clean base again.</div>}
              {visualSource === "original" && !originalPreview && !previewBusy && <div className="loading">Original placeholder unavailable. Check the notice below and try again.</div>}
              {previewBusy && <div className="rendering-overlay"><div className="spinner" /><span>Rendering preview…</span></div>}
            </div>
            <div className="studio-preview-meta">
              <span><b>Visual state</b><code>{selectedProduction?.original_available ? "Original available" : "Original unavailable"} · {studioCard.clean.available ? `Clean Base ${studioCard.clean.width}×${studioCard.clean.height} (${studioCard.clean.compatibility})` : "Clean Base missing"} · {selectedProduction?.rendered_available ? "Rendered available" : "Rendered missing"}</code></span>
              <span><b>{visualSource === "original" ? "Original" : "Preview"} SHA-256</b><code>{shownPreviewHash ?? "Available after load"}</code></span>
            </div>
            {visualSource === "rendered" && preview?.warnings.length ? <div className="render-warnings"><b>Renderer warnings</b>{preview.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}
            {!studioCard.clean.available && visualSource === "original" && (
                  <div className="clean-inline-missing"><span><b>Clean Base not available</b><small>Original remains usable as a temporary game visual.</small></span><button className="ghost" disabled={actionBusy !== null} onClick={importClean}>{actionBusy === "import" ? "Importing…" : "Select / Import Clean Base PNG"}</button></div>
            )}
            {studioCard.clean.available && (
              <button className="ghost replace-clean" disabled={actionBusy !== null} onClick={importClean}>{actionBusy === "import" ? "Importing…" : "Replace Clean Base PNG"}</button>
            )}
          </>
        )}
        {message && <div className={`notice studio-notice ${isError ? "error" : ""}`}>{message}</div>}
      </section>

      <aside className="panel studio-editor">
        {!studioCard || !draft ? (
          <div className="editor-empty"><span className="eyebrow">Metadata editor</span><h2>No card selected</h2><p>Source and editable game metadata will stay clearly separated here.</p></div>
        ) : (
          <>
            <section className="metadata-section source-metadata">
              <div className="section-title"><div><span className="eyebrow">Read only</span><h2>Source Metadata</h2></div><span className="status-pill">Sanity</span></div>
              <Meta label="Original name" value={studioCard.source.name} />
              <Meta label="Class" value={studioCard.source.class} />
              <Meta label="Part" value={studioCard.source.part} />
              <Meta label="Sanity ID" value={studioCard.source.id} mono />
              <Meta label="Local name" value={studioCard.source.local_name} mono />
            </section>
            <section className="metadata-section game-metadata" inert={editorLockedByRecovery ? true : undefined} aria-disabled={editorLockedByRecovery}>
              <div className="section-title"><div><span className="eyebrow">Visual fields</span><h2>Game Metadata</h2></div><span className={`status-pill ${hasUnsavedChanges ? "missing" : "ready"}`}>{hasUnsavedChanges ? "Unsaved" : studioCard.metadataStatus === "saved" ? "Saved" : "Defaults"}</span></div>
              <div className="identity-note"><code>{draft.id}</code><span>{draft.class} • {draft.part}</span></div>
              <label className="field"><span>Name</span><input data-validation-path="name" disabled={actionBusy !== null} value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></label>
              <div className="number-fields">
                <label className="field"><span>Cost</span><input data-validation-path="cost" disabled={actionBusy !== null} type="number" step="1" value={draft.cost ?? ""} placeholder="—" onChange={(event) => updateDraft("cost", event.target.value === "" ? null : Number(event.target.value))} /></label>
                <label className="field"><span>Value</span><input data-validation-path="value" disabled={actionBusy !== null} type="number" step="1" value={draft.value ?? ""} placeholder="—" onChange={(event) => updateDraft("value", event.target.value === "" ? null : Number(event.target.value))} /></label>
              </div>
              <label className="field"><span>Card Type</span><select data-validation-path="card_type" disabled={actionBusy !== null} value={draft.card_type} onChange={(event) => updateDraft("card_type", event.target.value)}>{!CARD_TYPE_DEFINITIONS.some((definition) => definition.id === draft.card_type) && draft.card_type.trim() !== "" && <option value={draft.card_type}>Legacy: {draft.card_type}</option>}<option value="">Unset</option>{CARD_TYPE_DEFINITIONS.map((definition) => <option key={definition.id} value={definition.id}>{definition.label}</option>)}</select></label>
              <label className="field"><span>Description</span><textarea data-validation-path="description" disabled={actionBusy !== null} rows={5} value={draft.description} placeholder="Visible card description" onChange={(event) => updateDraft("description", event.target.value)} /></label>
            </section>
            <section className="metadata-section visual-layout-editor" inert={editorLockedByRecovery ? true : undefined} aria-disabled={editorLockedByRecovery}>
              <div className="section-title"><div><span className="eyebrow">Visual only</span><h2>Visual Layout</h2></div><span className="status-pill">This Card</span></div>
              <label className="field"><span>Element</span><select disabled={actionBusy !== null} value={selectedVisualLayoutField} onChange={(event) => setSelectedVisualLayoutField(event.target.value as CardVisualLayoutField)}>{CARD_VISUAL_LAYOUT_FIELDS.map((field) => <option key={field} value={field}>{field === "card_type" ? "Card Type" : field[0].toUpperCase() + field.slice(1)}</option>)}</select></label>
              <div className="number-fields">
                <label className="field"><span>X <small>{selectedVisualLayoutOverride?.x === undefined ? "Global" : "This Card"}</small></span><input aria-label="Visual layout X" disabled={actionBusy !== null} type="number" step="1" value={displayedVisualLayoutX} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && visualLayoutOverrides) acceptVisualLayoutOverrides(updateVisualLayoutCoordinate(visualLayoutOverrides, selectedVisualLayoutField, "x", value)); }} /></label>
                <label className="field"><span>Y <small>{selectedVisualLayoutOverride?.y === undefined ? "Global" : "This Card"}</small></span><input aria-label="Visual layout Y" disabled={actionBusy !== null} type="number" step="1" value={displayedVisualLayoutY} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && visualLayoutOverrides) acceptVisualLayoutOverrides(updateVisualLayoutCoordinate(visualLayoutOverrides, selectedVisualLayoutField, "y", value)); }} /></label>
              </div>
              <p className="visual-layout-help">Arrow keys nudge 1 logical pixel; Shift + Arrow nudges 10. Inputs keep their normal keyboard behavior.</p>
              <div className="visual-layout-actions"><button className="ghost" disabled={actionBusy !== null || !visualLayoutGhost} onClick={() => commitVisualLayoutGhost()}>Apply &amp; Render</button><button className="ghost" disabled={actionBusy !== null || !visualLayoutGhost} onClick={() => setVisualLayoutGhost(null)}>Cancel</button><button className="ghost" disabled={actionBusy !== null || selectedVisualLayoutOverride?.x === undefined} onClick={() => visualLayoutOverrides && acceptVisualLayoutOverrides(updateVisualLayoutCoordinate(visualLayoutOverrides, selectedVisualLayoutField, "x", undefined))}>Reset X</button><button className="ghost" disabled={actionBusy !== null || selectedVisualLayoutOverride?.y === undefined} onClick={() => visualLayoutOverrides && acceptVisualLayoutOverrides(updateVisualLayoutCoordinate(visualLayoutOverrides, selectedVisualLayoutField, "y", undefined))}>Reset Y</button><button className="ghost" disabled={actionBusy !== null || !selectedVisualLayoutOverride} onClick={() => visualLayoutOverrides && acceptVisualLayoutOverrides(resetVisualLayoutPosition(visualLayoutOverrides, selectedVisualLayoutField))}>Reset Position</button></div>
            </section>
            <section className="metadata-section gameplay-metadata" inert={editorLockedByRecovery ? true : undefined} aria-disabled={editorLockedByRecovery}>
              <div className="section-title"><div><span className="eyebrow">Structured data</span><h2>Gameplay</h2></div><span className={`status-pill validation-${validation?.status ?? "invalid"}`}>{validation?.status === "valid" ? "Valid" : validation?.status === "warnings" ? "Warnings" : "Invalid"}</span></div>
              <div className="schema-note"><span>Schema</span><code>v{draft.schema_version}</code></div>
              {studioCard.metadataMigrated && <div className="migration-note">Loaded from V1 and migrated in memory. Save Metadata to persist schema_version 2.</div>}
              <div className="editor-productivity"><button className="ghost" disabled={!undoStack.length || actionBusy !== null} onClick={() => restoreHistory("undo")}>Undo <small>Ctrl+Z</small></button><button className="ghost" disabled={!redoStack.length || actionBusy !== null} onClick={() => restoreHistory("redo")}>Redo <small>Ctrl+Y</small></button><button className="ghost" disabled={actionBusy !== null} onClick={copyGameplay}>Copy Gameplay</button><button className="ghost" disabled={!gameplayClipboard || actionBusy !== null} onClick={pasteGameplay}>Paste Gameplay</button></div>
              <div className="validation-panel">
                <div className="validation-summary"><span className={validationErrors.length ? "bad" : "good"}><b>{validationErrors.length}</b> Errors</span><span className={validationWarnings.length ? "warn" : "good"}><b>{validationWarnings.length}</b> Warnings</span><span className={selectedProduction?.game_ready && !hasUnsavedChanges ? "good" : "bad"}><b>{selectedProduction?.game_ready && !hasUnsavedChanges ? "Yes" : "No"}</b> Game Ready</span></div>
                {(validationErrors.length > 0 || validationWarnings.length > 0) && <div className="validation-groups">{validationErrors.length > 0 && <section><b>ERRORS</b>{validationErrors.map((issue, index) => <button key={`error-${issue.path}-${index}`} onClick={() => focusIssue(issue.path)}><code>{issue.path}</code><span>{issue.message}</span></button>)}</section>}{validationWarnings.length > 0 && <section><b>WARNINGS</b>{validationWarnings.map((issue, index) => <button key={`warning-${issue.path}-${index}`} onClick={() => focusIssue(issue.path)}><code>{issue.path}</code><span>{issue.message}</span></button>)}</section>}</div>}
                {!validationErrors.length && <div className="validation-ready"><b>READY</b><span>Schema V2 is valid{hasUnsavedChanges ? "; save explicitly before export readiness is recalculated." : "."}</span></div>}
              </div>
              <label className="field"><span>Targeting Mode</span><select data-validation-path="targeting.mode" disabled={actionBusy !== null} value={draft.targeting.mode} onChange={(event) => acceptDraft({ ...draft, targeting: { mode: event.target.value as TargetMode } })}>{TARGET_VOCABULARY.map((mode) => <option key={mode} value={mode}>{mode.replaceAll("_", " ")}</option>)}</select></label>
              <div className="effects-heading"><div><h3>Effects</h3><small>Execution order is preserved.</small></div><span className="count-pill">{draft.effects.length}</span></div>
              <div className="add-effect-row"><select disabled={actionBusy !== null} value={newEffectType} onChange={(event) => setNewEffectType(event.target.value as EffectType)}>{GAME_EFFECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select><button className="ghost" disabled={actionBusy !== null} onClick={addEffect}>+ Add Effect</button></div>
              <div className="effects-list">
                {draft.effects.map((effect, index) => (
                  <article className="effect-card" key={effect.id} data-validation-path={`effects[${index}]`} tabIndex={-1}>
                    <div className="effect-card-heading"><div><span className="effect-order">{index + 1}</span><strong>{effect.type}</strong></div><code title={effect.id}>{effect.id}</code></div>
                    <div className="effect-base-fields">
                      <label className="field"><span>Type</span><select data-validation-path={`effects[${index}].type`} disabled={actionBusy !== null} value={effect.type} onChange={(event) => changeEffectType(index, event.target.value as EffectType)}>{GAME_EFFECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                      <label className="field"><span>Target</span><select data-validation-path={`effects[${index}].target`} disabled={actionBusy !== null} value={effect.target} onChange={(event) => updateEffect(index, { target: event.target.value as TargetMode })}>{(effect.type === "splash_damage" ? ["selected", "single_enemy"] : TARGET_VOCABULARY).map((target) => <option key={target} value={target}>{target.replaceAll("_", " ")}</option>)}</select></label>
                    </div>
                    {(effect.type === "damage" || effect.type === "splash_damage") && <label className="field"><span>Damage Type</span><select data-validation-path={`effects[${index}].damage_type`} disabled={actionBusy !== null} value={effect.damage_type ?? ""} onChange={(event) => updateEffect(index, { damage_type: event.target.value as "physical" | "magical" })}><option value="">Legacy: unspecified</option><option value="physical">Physical</option><option value="magical">Magical</option></select></label>}
                    {(effect.type === "damage" || effect.type === "splash_damage" || effect.type === "heal" || effect.type === "shield") && <label className="field"><span>Amount</span><input data-validation-path={`effects[${index}].amount`} disabled={actionBusy !== null} type="number" step="1" min="1" value={effect.amount} onChange={(event) => updateEffect(index, { amount: Number(event.target.value) })} /></label>}
                    {effect.type === "splash_damage" && <><label className="field"><span>Splash Ratio</span><input data-validation-path={`effects[${index}].splash_ratio`} disabled={actionBusy !== null} type="number" step="0.05" min="0.01" max="1" value={effect.splash_ratio} onChange={(event) => updateEffect(index, { splash_ratio: Number(event.target.value) })} /><small>Derived pool ratio (0 &lt; ratio ≤ 1)</small></label><label className="field"><span>Target Scope</span><select data-validation-path={`effects[${index}].target_scope`} disabled={actionBusy !== null} value={effect.target_scope} onChange={(event) => updateEffect(index, { target_scope: event.target.value })}><option value="other_enemies">Other enemies (exclude primary)</option></select></label><label className="field"><span>Distribution Mode</span><select data-validation-path={`effects[${index}].distribution.mode`} disabled={actionBusy !== null} value={effect.distribution.mode} onChange={(event) => updateEffect(index, { distribution: { mode: event.target.value } })}><option value="adjacent">Adjacent positional</option></select></label></>}
                    {effect.type === "damage" && <label className="field"><span>Hits</span><input data-validation-path={`effects[${index}].hits`} disabled={actionBusy !== null} type="number" step="1" min="1" value={effect.hits} onChange={(event) => updateEffect(index, { hits: Number(event.target.value) })} /></label>}
                    {(effect.type === "buff" || effect.type === "debuff") && <><label className="field"><span>Status</span><select data-validation-path={`effects[${index}].status`} disabled={actionBusy !== null} value={effect.status} onChange={(event) => updateEffect(index, { status: event.target.value })}>{!statusDefinitionsForEffectType(effect.type).some((definition) => definition.id === effect.status) && <option value={effect.status}>Legacy status: {effect.status}</option>}{statusDefinitionsForEffectType(effect.type).map((definition) => <option key={definition.id} value={definition.id}>{definition.label}</option>)}</select></label><div className="number-fields"><label className="field"><span>Stacks</span><input data-validation-path={`effects[${index}].stacks`} disabled={actionBusy !== null} type="number" step="1" min="1" value={effect.stacks} onChange={(event) => updateEffect(index, { stacks: Number(event.target.value) })} /></label><label className="field"><span>Duration</span><input data-validation-path={`effects[${index}].duration`} disabled={actionBusy !== null} type="number" step="1" min="1" value={effect.duration} onChange={(event) => updateEffect(index, { duration: Number(event.target.value) })} /></label></div></>}
                    {effect.type === "cleanse" && <label className="field"><span>Count</span><input data-validation-path={`effects[${index}].count`} disabled={actionBusy !== null} type="number" step="1" min="1" value={effect.count} onChange={(event) => updateEffect(index, { count: Number(event.target.value) })} /></label>}
                    <div className="effect-actions"><button className="ghost" disabled={actionBusy !== null || index === 0} onClick={() => applyEffectOperation(() => moveCardEffect(draft, index, "up"))}>Move Up</button><button className="ghost" disabled={actionBusy !== null || index === draft.effects.length - 1} onClick={() => applyEffectOperation(() => moveCardEffect(draft, index, "down"))}>Move Down</button><button className="ghost" disabled={actionBusy !== null} onClick={() => applyEffectOperation(() => duplicateCardEffect(draft, index))}>Duplicate</button><button className="ghost danger" disabled={actionBusy !== null} onClick={() => applyEffectOperation(() => deleteCardEffect(draft, index))}>Delete</button></div>
                  </article>
                ))}
                {!draft.effects.length && <div className="effects-empty">No structured effects yet. Add one without changing the visible description.</div>}
              </div>
              <details className="advanced-json">
                <summary>Advanced JSON</summary>
                <p>Edit the complete V2 document. Changes are validated before replacing the current draft.</p>
                <textarea data-validation-path="$" spellCheck={false} value={advancedText} onChange={(event) => { setAdvancedText(event.target.value); setAdvancedError(null); }} />
                {advancedError && <div className="advanced-error">{advancedError}</div>}
                <button className="ghost" disabled={actionBusy !== null} onClick={applyAdvancedJson}>Apply JSON</button>
              </details>
              <div className={`draft-status draft-${draftStatus}`}><span>Recovery draft</span><b>{draftStatus === "saving" ? "Saving…" : draftStatus === "saved" ? "Saved separately" : draftStatus === "error" ? "Write failed" : "No pending recovery write"}</b></div>
              <div className="studio-editor-actions">
                <button className="primary" disabled={actionBusy !== null || validation?.status === "invalid"} onClick={saveMetadata}>{actionBusy === "save" ? "Saving…" : "Save Metadata"}</button>
                <button className="primary save-next" disabled={actionBusy !== null || validation?.status === "invalid" || !navigationEnabled || !nextId} onClick={() => void saveAndNext()}>{actionBusy === "save" ? "Saving…" : "Save & Next"}</button>
                <button className="ghost" disabled={actionBusy !== null || !hasUnsavedChanges} onClick={() => void resetMetadata()}>Reset Unsaved Changes</button>
                <button className="ghost export-rendered" disabled={actionBusy !== null || !studioCard.clean.available} onClick={exportRendered}>{actionBusy === "export" ? "Exporting…" : "Export Rendered Card"}</button>
                <button className="ghost game-export" disabled={actionBusy !== null || validation?.status === "invalid" || (visualSource === "rendered" && !studioCard.clean.available)} onClick={exportGameCard}>{actionBusy === "game-export" ? "Exporting Game Card…" : "Export Game Card"}<small>{visualSource === "original" ? "Original placeholder + V2 JSON" : "Rendered PNG + V2 JSON"}</small></button>
              </div>
              {currentSet && dashboard && <div className="game-set-export">
                <div className="section-title"><div><span className="eyebrow">Current Set</span><h2>Export Game Set</h2></div><span className="status-pill">{setExportReady} / {currentSet.cards.length} ready</span></div>
                <div className="export-plan"><span><b>{currentSet.cards.length}</b>Total</span><span><b>{setExportReady}</b>Game Ready</span><span><b>{setExportWarnings}</b>Warnings</span><span><b>{setExportBlocked}</b>Blocked</span></div>
              <label className="field"><span>Visual source</span><select value={setExportVisualSource} onChange={(event) => setSetExportVisualSource(event.target.value as VisualSource)}><option value="original">Original / Placeholder</option><option value="rendered">Clean Base / Rendered</option></select></label>
                {setExportVisualSource === "rendered" && currentSetProduction.some((card) => !card.clean_available) && <div className="visual-warning">Some cards in this set have no real clean visual. They will not be presented as rendered-ready.</div>}
                <button className="ghost game-export" disabled={productionBusy || setExportReady === 0} onClick={() => void exportGameSet()}>{productionBusy ? "Working…" : "Review Plan & Export"}</button>
                {gameSetExport && <div className="export-result"><b>Latest result</b><span>{gameSetExport.report.success} success</span><span>{gameSetExport.report.failed} failed</span><span>{gameSetExport.report.skipped} skipped</span><code>{gameSetExport.directory}</code></div>}
              </div>}
            </section>
          </>
        )}
      </aside>
    </div>
    {productionDialog && <div className="production-dialog-backdrop" role="presentation">
      <form className="production-dialog" role="dialog" aria-modal="true" aria-labelledby="production-dialog-title" onSubmit={(event) => { event.preventDefault(); void submitProductionDialog(); }}>
        <div className="eyebrow">Production workspace</div>
        <h2 id="production-dialog-title">{dialogTitle}</h2>
        <p>{dialogDescription}</p>
        <label className="field"><span>{productionDialog.kind.includes("slot") ? "Axie Slot name" : "Card Set name"}</span>
          <input autoFocus value={productionDialog.value} onChange={(event) => setProductionDialog({ ...productionDialog, value: event.target.value, error: null })} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setProductionDialog(null); } }} />
        </label>
        {productionDialog.error && <div className="dialog-error" role="alert">{productionDialog.error}</div>}
        <div className="production-dialog-actions"><button type="button" className="ghost" disabled={productionBusy} onClick={() => setProductionDialog(null)}>Cancel</button><button type="submit" className="primary" disabled={productionBusy}>{productionBusy ? "Working…" : dialogSubmitLabel}</button></div>
      </form>
    </div>}
    </>
  );
}

export function App() {
  const [tab, setTab] = useState<"catalog" | "batch" | "studio">("catalog");
  const [studioDirty, setStudioDirty] = useState(false);
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [catalogCache, setCatalogCache] = useState<"hit" | "miss" | null>(null);
  const [exportRoot, setExportRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    Promise.all([window.axieCards.getCatalog(), window.axieCards.getExportFolder()])
      .then(([payload, folder]) => { setCards(payload.cards); setCatalogCache(payload.cache); setExportRoot(folder); })
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setLoading(false));
  }, []);

  const refresh = async () => {
    setRefreshing(true); setError(null);
    try { const payload = await window.axieCards.refreshCatalog(); setCards(payload.cards); setCatalogCache(payload.cache); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setRefreshing(false); }
  };
  const chooseFolder = async () => {
    const folder = await window.axieCards.chooseExportFolder();
    if (folder) setExportRoot(folder);
    return folder;
  };
  const changeTab = (nextTab: "catalog" | "batch" | "studio") => {
    if (nextTab === tab) return;
    if (tab === "studio" && studioDirty && !window.confirm("Discard unsaved Card Studio changes and leave this tab?")) return;
    setTab(nextTab);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="mark">A</div><div><span>AXIE TOOLS</span><h1>AXIE / CARD EXTRACTOR</h1></div></div>
        <nav><button className={tab === "catalog" ? "active" : ""} onClick={() => changeTab("catalog")}>Card Catalog</button><button className={tab === "batch" ? "active" : ""} onClick={() => changeTab("batch")}>Batch Export</button><button className={tab === "studio" ? "active" : ""} onClick={() => changeTab("studio")}>Card Studio</button></nav>
        <button className="refresh" disabled={refreshing} onClick={refresh}>{refreshing ? "Refreshing…" : "↻ Refresh Catalog"}</button>
      </header>
      <div className="subbar"><SourceBadge /><span className="folder-summary">Export: {exportRoot ?? "choose a folder when ready"}</span></div>
      {error && <div className="global-error"><b>Catalog unavailable</b><span>{error}</span><button onClick={refresh}>Try again</button></div>}
      {loading ? <div className="app-loading"><div className="spinner" /><h2>Loading catalog metadata</h2><p>Using the local cache when available.</p></div> : tab === "catalog" ? <CatalogTab cards={cards} catalogCache={catalogCache} exportRoot={exportRoot} onChooseFolder={chooseFolder} /> : tab === "batch" ? <BatchTab cards={cards} exportRoot={exportRoot} onChooseFolder={chooseFolder} /> : <StudioTab cards={cards} exportRoot={exportRoot} onChooseFolder={chooseFolder} onDirtyChange={setStudioDirty} />}
    </main>
  );
}
