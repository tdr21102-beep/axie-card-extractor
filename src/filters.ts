import type { CatalogCard } from "./catalog.ts";

export interface CatalogFilters {
  search: string;
  className: string | null;
  part: string | null;
}

export function filterCatalog(cards: CatalogCard[], filters: CatalogFilters): CatalogCard[] {
  const query = filters.search.trim().toLowerCase();
  return cards.filter((card) => {
    if (filters.className && card.class?.toLowerCase() !== filters.className.toLowerCase()) return false;
    if (filters.part && card.part?.toLowerCase() !== filters.part.toLowerCase()) return false;
    if (!query) return true;
    return [card.name, card.slug, card.local_name, card.id].some((value) => value.toLowerCase().includes(query));
  });
}
