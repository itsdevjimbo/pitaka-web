const MAX_ENCODED_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 4096;

const IMAGE_RULES = {
  invalid: 'Choose a valid JPEG, PNG, or WebP image.',
  animated: 'Choose a static image. Animated images are not supported.',
  oversized: 'Choose an image no larger than 2 MB.',
  dimensions: 'Choose an image no larger than 4096 × 4096 pixels.',
} as const;

type SupportedImage = {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  animated: boolean;
};

export type ProfilePictureValidation = { valid: true; preview: Blob } | { valid: false; message: string };

/** Check the encoded image itself before using its dimensions or trusting its MIME type. */
export async function validateProfilePicture(file: File): Promise<ProfilePictureValidation> {
  if (file.size > MAX_ENCODED_BYTES) {
    return { valid: false, message: IMAGE_RULES.oversized };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { valid: false, message: IMAGE_RULES.invalid };
  }

  const image = inspectImageBytes(bytes);
  if (image === null) {
    return { valid: false, message: IMAGE_RULES.invalid };
  }
  if (image.animated) {
    return { valid: false, message: IMAGE_RULES.animated };
  }

  const preview = new Blob([file], { type: image.mimeType });
  try {
    const { width, height } = await decodedDimensions(preview);
    if (width <= 0 || height <= 0) {
      return { valid: false, message: IMAGE_RULES.invalid };
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      return { valid: false, message: IMAGE_RULES.dimensions };
    }
  } catch {
    return { valid: false, message: IMAGE_RULES.invalid };
  }

  return { valid: true, preview };
}

function inspectImageBytes(bytes: Uint8Array): SupportedImage | null {
  if (matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    return { mimeType: 'image/png', animated: hasAnimatedPngChunk(bytes) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', animated: false };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { mimeType: 'image/webp', animated: hasAnimatedWebpChunk(bytes) };
  }
  return null;
}

function matches(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasAnimatedPngChunk(bytes: Uint8Array): boolean {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const chunkLength = uint32BigEndian(bytes, offset);
    const chunkType = ascii(bytes, offset + 4, 4);
    if (chunkType === 'acTL') {
      return true;
    }
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset > bytes.length || nextOffset <= offset || chunkType === 'IEND') {
      return false;
    }
    offset = nextOffset;
  }
  return false;
}

function hasAnimatedWebpChunk(bytes: Uint8Array): boolean {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkLength = uint32LittleEndian(bytes, offset + 4);
    if (chunkType === 'ANIM' || chunkType === 'ANMF') {
      return true;
    }
    if (chunkType === 'VP8X' && offset + 8 < bytes.length && (bytes[offset + 8] & 0x02) !== 0) {
      return true;
    }
    const nextOffset = offset + 8 + chunkLength + (chunkLength % 2);
    if (nextOffset > bytes.length || nextOffset <= offset) {
      return false;
    }
    offset = nextOffset;
  }
  return false;
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

async function decodedDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
