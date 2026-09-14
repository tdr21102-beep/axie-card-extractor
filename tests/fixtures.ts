import type { SanityCard } from "../src/source.ts";

export function card(overrides: Partial<SanityCard> = {}): SanityCard {
  return {
    _id: "id-1",
    _createdAt: "2022-01-01T00:00:00Z",
    _updatedAt: "2022-01-01T00:00:00Z",
    title: "Teal Shell",
    slug: "teal-shell",
    body: null,
    class: { _id: "class-aqua", title: "Aqua" },
    part: { _id: "part-horn", title: "Horn" },
    mainImage: { asset: { _ref: "image-asset" } },
    asset: {
      _id: "image-asset",
      url: "https://cdn.example/asset.png",
      originalFilename: "tealshell.png",
      mimeType: "image/png",
      size: 3,
      sha1hash: "22b1bd4f10536eed1d24735153d7630e4dc1393a",
      dimensions: { width: 900, height: 1350, aspectRatio: 2 / 3 },
      hasAlpha: true,
      isOpaque: false
    },
    ...overrides
  };
}
