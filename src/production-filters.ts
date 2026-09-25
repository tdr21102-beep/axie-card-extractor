import type { CardOrigin, CatalogCard, EquipmentSlot } from "./catalog.ts";
import type { ProductionCardState, ProductionStatus } from "./production-contract.ts";

export type ProductionFilterScope = "all" | "set" | "slot";

export interface ProductionCardFilters {
  search: string;
  scope: ProductionFilterScope;
  setCardIds: readonly string[];
  slotCardIds: readonly string[];
  className: string | null;
  part: string | null;
  /** Optional so callers built against the part-only filter shape remain valid. */
  cardOrigin?: CardOrigin | null;
  equipmentSlot?: EquipmentSlot | null;
  status: ProductionStatus | null;
  hasEffects: boolean;
  hasClean: boolean;
  gameReady: boolean;
}

function containsSearch(card: CatalogCard, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  return [card.name, card.slug, card.local_name, card.id]
    .some((value) => value.toLocaleLowerCase().includes(query));
}

export function filterProductionCards(
  cards: readonly CatalogCard[],
  states: ReadonlyMap<string, ProductionCardState>,
  filters: ProductionCardFilters
): CatalogCard[] {
  const setCards = new Set(filters.setCardIds);
  const slotCards = new Set(filters.slotCardIds);
  return cards.filter((card) => {
    const state = states.get(card.id);
    if (!containsSearch(card, filters.search)) return false;
    if (filters.scope === "set" && !setCards.has(card.id)) return false;
    if (filters.scope === "slot" && !slotCards.has(card.id)) return false;
    if (filters.className && card.class !== filters.className) return false;
    if (filters.part && card.part !== filters.part) return false;
    if (filters.cardOrigin && (card.card_origin ?? "part") !== filters.cardOrigin) return false;
    if (filters.equipmentSlot && card.equipment_slot !== filters.equipmentSlot) return false;
    if (filters.status && state?.status !== filters.status) return false;
    if (filters.hasEffects && (state?.effect_count ?? 0) === 0) return false;
    if (filters.hasClean && !state?.clean_available) return false;
    if (filters.gameReady && !state?.game_ready) return false;
    return true;
  });
}
