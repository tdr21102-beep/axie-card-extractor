import { useEffect, useMemo, useState } from "react";
import type { CatalogCard } from "../src/catalog.ts";
import type { BatchReport, OutputLayout } from "../src/exporter.ts";
import { filterCatalog, type CatalogFilters } from "../src/filters.ts";
import type { BatchPlan, PreviewPayload, StudioCardPayload, StudioPreviewPayload } from "../src/ipc-contract.ts";

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

function cloneStudioMetadata(metadata: StudioMetadata): StudioMetadata {
  return { ...metadata };
}

function StudioTab({ cards, onDirtyChange }: { cards: CatalogCard[]; onDirtyChange: (dirty: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [studioCard, setStudioCard] = useState<StudioCardPayload | null>(null);
  const [draft, setDraft] = useState<StudioMetadata | null>(null);
  const [saved, setSaved] = useState<StudioMetadata | null>(null);
  const [preview, setPreview] = useState<StudioPreviewPayload | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<"save" | "import" | "export" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const filtered = useMemo(
    () => filterCatalog(cards, { ...EMPTY_FILTERS, search }),
    [cards, search]
  );
  const hasUnsavedChanges = useMemo(
    () => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)),
    [draft, saved]
  );
  const canSave = Boolean(studioCard && (studioCard.metadataStatus === "default" || hasUnsavedChanges));

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
    if (selectedId && !cards.some((card) => card.id === selectedId)) setSelectedId(null);
  }, [cards, selectedId]);

  useEffect(() => {
    setStudioCard(null);
    setDraft(null);
    setSaved(null);
    setPreview(null);
    setMessage(null);
    setIsError(false);
    if (!selectedId) return;

    let active = true;
    setLoadingCard(true);
    window.axieCards.loadStudioCard(selectedId)
      .then((payload) => {
        if (!active) return;
        setStudioCard(payload);
        setDraft(cloneStudioMetadata(payload.metadata));
        setSaved(cloneStudioMetadata(payload.metadata));
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
    if (!selectedId || !draft || !studioCard?.clean.available) {
      setPreview(null);
      setPreviewBusy(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setPreviewBusy(true);
      window.axieCards.renderStudioPreview({ cardId: selectedId, metadata: draft })
        .then((payload) => {
          if (!active) return;
          setPreview(payload);
          setIsError(false);
        })
        .catch((error) => {
          if (!active) return;
          setPreview(null);
          setMessage(`Preview could not be rendered. ${errorMessage(error)}`);
          setIsError(true);
        })
        .finally(() => { if (active) setPreviewBusy(false); });
    }, 280);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedId, draft, studioCard?.clean.available, studioCard?.clean.sha256]);

  const updateDraft = <K extends keyof StudioMetadata>(key: K, value: StudioMetadata[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setMessage(null);
    setIsError(false);
  };

  const selectStudioCard = (cardId: string) => {
    if (cardId === selectedId) return;
    if (hasUnsavedChanges && !window.confirm("Discard unsaved Card Studio changes and open another card?")) return;
    setSelectedId(cardId);
  };

  const saveMetadata = async () => {
    if (!selectedId || !draft) return;
    setActionBusy("save");
    setMessage(null);
    setIsError(false);
    try {
      const payload = await window.axieCards.saveStudioMetadata({ cardId: selectedId, metadata: draft });
      setStudioCard(payload);
      setDraft(cloneStudioMetadata(payload.metadata));
      setSaved(cloneStudioMetadata(payload.metadata));
      setMessage("Game metadata saved. The JSON is now the source of truth for this card.");
    } catch (error) {
      setMessage(`Metadata could not be saved. Check the fields and try again. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setActionBusy(null);
    }
  };

  const resetMetadata = () => {
    if (!saved) return;
    setDraft(cloneStudioMetadata(saved));
    setMessage("Unsaved changes reset to the last saved or default metadata.");
    setIsError(false);
  };

  const importClean = async () => {
    if (!selectedId) return;
    const currentDraft = draft ? cloneStudioMetadata(draft) : null;
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
      setSaved(cloneStudioMetadata(payload.metadata));
      setDraft(currentDraft ?? cloneStudioMetadata(payload.metadata));
      setPreview(null);
      setMessage("Clean base imported. The original PNG remains unchanged while previews render separately.");
    } catch (error) {
      setMessage(`Clean base could not be imported. Select a readable PNG and try again. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setActionBusy(null);
    }
  };

  const exportRendered = async () => {
    if (!selectedId || !draft || !studioCard?.clean.available) return;
    setActionBusy("export");
    setMessage(null);
    setIsError(false);
    try {
      const payload = await window.axieCards.exportStudioRendered({ cardId: selectedId, metadata: draft });
      setMessage(`Rendered card exported to ${payload.path}.`);
    } catch (error) {
      setMessage(`Rendered card could not be exported. ${errorMessage(error)}`);
      setIsError(true);
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="studio-layout">
      <aside className="panel studio-browser">
        <div className="panel-heading row">
          <div><span className="eyebrow">Card Studio</span><h2>Card browser</h2></div>
          <span className="count-pill">{filtered.length}</span>
        </div>
        <label className="field studio-search">
          <span>Search</span>
          <input value={search} placeholder="Name, slug, local name or ID" onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="studio-card-list">
          {filtered.map((card) => (
            <button key={card.id} disabled={actionBusy !== null} className={`card-row ${selectedId === card.id ? "selected" : ""}`} onClick={() => selectStudioCard(card.id)}>
              <span className="card-name">{card.name}</span>
              <span className="card-traits">{card.class ?? "Unknown"} <b>•</b> {card.part ?? "Unknown"}</span>
              <code>{card.local_name}</code>
            </button>
          ))}
          {!filtered.length && <div className="empty">No cards match this search.</div>}
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
            <div className="panel-heading row studio-preview-heading">
              <div><span className="eyebrow">Deterministic composition</span><h2>{draft.name || studioCard.source.name}</h2><p>Clean visual + current game metadata</p></div>
              <span className={`status-pill ${studioCard.clean.available ? "ready" : "missing"}`}>{studioCard.clean.available ? "Clean ready" : "Clean missing"}</span>
            </div>
            <div className={`studio-preview-frame ${!studioCard.clean.available ? "missing" : ""}`}>
              {preview && <img src={preview.dataUrl} alt={`${draft.name || studioCard.source.name} rendered preview`} />}
              {!studioCard.clean.available && (
                <div className="clean-missing">
                  <div className="card-glyph">◇</div>
                  <h3>Clean visual not available</h3>
                  <p>Import a clean PNG containing only artwork, frame, backgrounds and non-variable decoration.</p>
                  <button className="primary" disabled={actionBusy !== null} onClick={importClean}>{actionBusy === "import" ? "Importing…" : "Select / Import Clean Base PNG"}</button>
                </div>
              )}
              {studioCard.clean.available && !preview && !previewBusy && <div className="loading">Preview unavailable. Edit a field or import the clean base again.</div>}
              {previewBusy && <div className="rendering-overlay"><div className="spinner" /><span>Rendering preview…</span></div>}
            </div>
            <div className="studio-preview-meta">
              <span><b>Clean SHA-256</b><code>{studioCard.clean.sha256 ?? "Available after import"}</code></span>
              <span><b>Preview SHA-256</b><code>{preview?.sha256 ?? "Available after render"}</code></span>
            </div>
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
            <section className="metadata-section game-metadata">
              <div className="section-title"><div><span className="eyebrow">Editable JSON</span><h2>Game Metadata</h2></div><span className={`status-pill ${hasUnsavedChanges ? "missing" : "ready"}`}>{hasUnsavedChanges ? "Unsaved" : studioCard.metadataStatus === "saved" ? "Saved" : "Defaults"}</span></div>
              <div className="identity-note"><code>{draft.id}</code><span>{draft.class} • {draft.part}</span></div>
              <label className="field"><span>Name</span><input disabled={actionBusy !== null} value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></label>
              <div className="number-fields">
                <label className="field"><span>Cost</span><input disabled={actionBusy !== null} type="number" step="1" value={draft.cost ?? ""} placeholder="—" onChange={(event) => updateDraft("cost", event.target.value === "" ? null : Number(event.target.value))} /></label>
                <label className="field"><span>Value</span><input disabled={actionBusy !== null} type="number" step="1" value={draft.value ?? ""} placeholder="—" onChange={(event) => updateDraft("value", event.target.value === "" ? null : Number(event.target.value))} /></label>
              </div>
              <label className="field"><span>Card Type</span><input disabled={actionBusy !== null} list="studio-card-types" value={draft.card_type} placeholder="attack, skill, secret, power…" onChange={(event) => updateDraft("card_type", event.target.value)} /><datalist id="studio-card-types"><option value="attack" /><option value="skill" /><option value="secret" /><option value="power" /></datalist></label>
              <label className="field"><span>Description</span><textarea disabled={actionBusy !== null} rows={5} value={draft.description} placeholder="Visible card description" onChange={(event) => updateDraft("description", event.target.value)} /></label>
              <div className="studio-editor-actions">
                <button className="primary" disabled={actionBusy !== null || !canSave} onClick={saveMetadata}>{actionBusy === "save" ? "Saving…" : "Save Metadata"}</button>
                <button className="ghost" disabled={actionBusy !== null || !hasUnsavedChanges} onClick={resetMetadata}>Reset Unsaved Changes</button>
                <button className="ghost export-rendered" disabled={actionBusy !== null || !studioCard.clean.available} onClick={exportRendered}>{actionBusy === "export" ? "Exporting…" : "Export Rendered Card"}</button>
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
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
      {loading ? <div className="app-loading"><div className="spinner" /><h2>Loading catalog metadata</h2><p>Using the local cache when available.</p></div> : tab === "catalog" ? <CatalogTab cards={cards} catalogCache={catalogCache} exportRoot={exportRoot} onChooseFolder={chooseFolder} /> : tab === "batch" ? <BatchTab cards={cards} exportRoot={exportRoot} onChooseFolder={chooseFolder} /> : <StudioTab cards={cards} onDirtyChange={setStudioDirty} />}
    </main>
  );
}
