/**
 * Vision models (OpenAI, Anthropic, Ollama) don't accept TIFF, so TIFF inputs are
 * converted to one PNG `image_url` part per page before reaching the provider.
 */
import sharp from 'sharp';

const TIFF_DATA_URL = /^data:image\/tiff?;base64,/i;
const MAX_TIFF_PAGES = 20;
const MAX_DIMENSION = 2048;

type Part = { type: string; image_url?: { url: string; detail?: string }; file?: { file_data?: string } };
type MessageLike = { content?: unknown };

export class TiffConversionError extends Error {}

export function isTiffDataUrl(value: unknown): value is string {
  return typeof value === 'string' && TIFF_DATA_URL.test(value);
}

export async function tiffDataUrlToPngDataUrls(dataUrl: string): Promise<string[]> {
  const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  try {
    const { pages = 1 } = await sharp(input).metadata();
    if (pages > MAX_TIFF_PAGES) {
      throw new TiffConversionError(`TIFF has ${pages} pages; maximum is ${MAX_TIFF_PAGES}`);
    }
    const urls: string[] = [];
    for (let page = 0; page < pages; page++) {
      const png = await sharp(input, { page })
        .rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      urls.push(`data:image/png;base64,${png.toString('base64')}`);
    }
    return urls;
  } catch (err) {
    if (err instanceof TiffConversionError) throw err;
    throw new TiffConversionError('Unable to decode TIFF image');
  }
}

/** Replaces TIFF `image_url` / `file` parts in place. Returns true if anything changed. */
export async function convertTiffParts(messages: MessageLike[]): Promise<boolean> {
  let changed = false;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    const parts = message.content as Part[];
    if (!parts.some((p) => isTiffDataUrl(p?.image_url?.url) || isTiffDataUrl(p?.file?.file_data))) continue;

    const next: Part[] = [];
    for (const part of parts) {
      const tiffUrl = part.type === 'image_url' ? part.image_url?.url : part.type === 'file' ? part.file?.file_data : undefined;
      if (!isTiffDataUrl(tiffUrl)) {
        next.push(part);
        continue;
      }
      const detail = part.type === 'image_url' ? part.image_url?.detail : undefined;
      for (const url of await tiffDataUrlToPngDataUrls(tiffUrl)) {
        next.push({ type: 'image_url', image_url: { url, ...(detail && { detail }) } });
      }
    }
    message.content = next;
    changed = true;
  }
  return changed;
}
