import type { CatalogCard, CardOrigin, EquipmentSlot } from "./catalog.ts";
import { classDirectory, snakeCase } from "./naming.ts";

export interface CardIdentity {
  id: string;
  origin: CardOrigin;
  equipmentSlot?: EquipmentSlot;
  classDirectory?: string;
  part?: string;
  pathSegments: readonly string[];
}

/**
 * Centralizes the local identity used by Card Studio and both game exporters.
 * Part cards deliberately retain their established class/<card> layout;
 * equipment has its own origin/slot namespace and never borrows a class.
 */
export function cardIdentity(card: CatalogCard): CardIdentity {
  const id = snakeCase(card.local_name);
  if (!id) throw new Error("Card has no valid local name");

  const origin = card.card_origin ?? "part";
  if (origin === "equipment") {
    if (!card.equipment_slot) throw new Error("Equipment card has no valid equipment slot");
    return { id, origin, equipmentSlot: card.equipment_slot, pathSegments: ["equipment", card.equipment_slot, id] };
  }

  const directory = classDirectory(card.class);
  return {
    id,
    origin,
    classDirectory: directory,
    ...(card.part ? { part: snakeCase(card.part) } : {}),
    pathSegments: [directory, id]
  };
}
