import { buildCatalog } from "./catalog.ts";
import type { CatalogPayload } from "./ipc-contract.ts";
import { fetchCards } from "./source.ts";

export function createCatalogLoader(options: { cachePath: string; fetchImpl?: typeof fetch }) {
  let current: CatalogPayload | null = null;
  let inFlight: { refresh: boolean; promise: Promise<CatalogPayload> } | null = null;

  const perform = async (refresh: boolean): Promise<CatalogPayload> => {
    const source = await fetchCards({ cachePath: options.cachePath, refresh, fetchImpl: options.fetchImpl });
    const payload = { cards: buildCatalog(source.cards), cache: source.cache, fetchedAt: source.fetchedAt };
    current = payload;
    return payload;
  };

  const load = (refresh = false): Promise<CatalogPayload> => {
    if (!refresh && current) return Promise.resolve(current);
    if (inFlight) {
      if (!refresh || inFlight.refresh) return inFlight.promise;
      return inFlight.promise.then(() => load(true), () => load(true));
    }
    const pending = perform(refresh);
    const state = { refresh, promise: pending };
    inFlight = state;
    const cleanup = () => {
      if (inFlight === state) inFlight = null;
    };
    void pending.then(cleanup, cleanup);
    return pending;
  };

  return { load };
}
