export const CARD_TYPE_DEFINITIONS = [
  { id: "physical_attack", label: "Physical Attack" },
  { id: "magical_attack", label: "Magical Attack" },
  { id: "heal", label: "Heal" },
  { id: "shield", label: "Shield" },
  { id: "status", label: "Status" },
  { id: "utility", label: "Utility" }
] as const;

export const LEGACY_CARD_TYPE_DEFINITIONS = [
  { id: "attack", label: "Attack" },
  { id: "skill", label: "Skill" },
  { id: "secret", label: "Secret" },
  { id: "power", label: "Power" }
] as const;

export type CanonicalCardType = (typeof CARD_TYPE_DEFINITIONS)[number]["id"];

export function cardTypeLabel(id: string): string | null {
  return CARD_TYPE_DEFINITIONS.find((definition) => definition.id === id)?.label
    ?? LEGACY_CARD_TYPE_DEFINITIONS.find((definition) => definition.id === id)?.label
    ?? null;
}

export function isCanonicalCardType(id: string): id is CanonicalCardType {
  return CARD_TYPE_DEFINITIONS.some((definition) => definition.id === id);
}
