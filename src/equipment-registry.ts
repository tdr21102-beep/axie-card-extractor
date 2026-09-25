import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CatalogCard, EquipmentSlot } from "./catalog.ts";

export const EQUIPMENT_SLOTS = ["weapon", "shield", "helmet", "boots"] as const satisfies readonly EquipmentSlot[];

export const WOODEN_SWORD_ASSET_RELATIVE_PATH = ["assets", "cards", "equipment", "weapon", "wooden_sword_card.png"] as const;

export function equipmentAssetPath(card: Pick<CatalogCard, "card_origin" | "equipment_slot" | "local_name">, root = "."): string | null {
  if (card.card_origin !== "equipment" || !card.equipment_slot) return null;
  return resolve(root, "assets", "cards", "equipment", card.equipment_slot, `${card.local_name}.png`);
}

function woodenSword(assetSize: number): CatalogCard {
  return {
    name: "Wooden Sword",
    id: "equipment:weapon:wooden_sword_card",
    slug: "wooden_sword_card",
    local_name: "wooden_sword_card",
    card_origin: "equipment",
    equipment_slot: "weapon",
    class: null,
    class_id: null,
    part: null,
    part_id: null,
    // This stable local URI is intentionally not a remote download target.
    image_url: "asset://equipment/weapon/wooden_sword_card.png",
    image_asset_id: "equipment:weapon:wooden_sword_card",
    image_original_filename: "wooden_sword_card.png",
    image_mime_type: "image/png",
    image_size: assetSize,
    image_sha1: null,
    image_dimensions: null,
    cost: null,
    effect: null,
    card_type: null,
    body_text: [],
    created_at: "",
    updated_at: "",
    source: {
      provider: "Equipment Registry",
      project_id: "local",
      dataset: "equipment",
      api_version: "v1",
      document_id: "equipment:weapon:wooden_sword_card"
    }
  };
}

/**
 * Local equipment is opt-in through its committed clean card asset. Do not
 * synthesize a placeholder: a missing source keeps the registry entry out of
 * the catalog and any manually supplied equipment export fails explicitly.
 */
export async function loadEquipmentRegistry(root = "."): Promise<CatalogCard[]> {
  const card: Pick<CatalogCard, "card_origin" | "equipment_slot" | "local_name"> = {
    card_origin: "equipment",
    equipment_slot: "weapon",
    local_name: "wooden_sword_card"
  };
  const asset = equipmentAssetPath(card, root);
  if (!asset) return [];
  try {
    await access(asset);
    return [woodenSword((await stat(asset)).size)];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function equipmentSourcePath(card: CatalogCard, root = "."): string | null {
  return equipmentAssetPath(card, root);
}
