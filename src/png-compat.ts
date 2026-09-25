/**
 * Return PNG bytes suitable for the native image decoder without changing the
 * bytes that are stored as a RAW/Clean Base asset.
 *
 * Some valid PNG producers attach private ancillary chunks (for example
 * `caBX`/C2PA metadata) that the bundled canvas decoder interprets as an
 * unsupported image format. Critical chunks and standard decoder-relevant
 * ancillary chunks are retained; unknown ancillary chunks are omitted only
 * from this in-memory decode copy.
 */
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const PRESERVED_ANCILLARY = new Set([
  "bKGD", "cHRM", "eXIf", "gAMA", "hIST", "iCCP", "pHYs", "sBIT", "sPLT",
  "sRGB", "tEXt", "tIME", "tRNS", "zTXt", "iTXt"
]);

function isCritical(type: string): boolean {
  return type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a;
}

export function pngBytesForDecode(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return bytes;
  }

  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Buffer[] = [input.subarray(0, PNG_SIGNATURE.byteLength)];
  let offset = PNG_SIGNATURE.byteLength;
  let stripped = false;
  while (offset + 12 <= input.byteLength) {
    const length = input.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > input.byteLength) return bytes;
    const type = input.toString("ascii", offset + 4, offset + 8);
    if (isCritical(type) || PRESERVED_ANCILLARY.has(type)) {
      chunks.push(input.subarray(offset, end));
    } else {
      stripped = true;
    }
    offset = end;
    if (type === "IEND") break;
  }
  if (!stripped || offset !== input.byteLength) return bytes;
  return Uint8Array.from(Buffer.concat(chunks));
}
