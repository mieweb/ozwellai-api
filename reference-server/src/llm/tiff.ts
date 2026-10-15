/**
 * Vision models (OpenAI, Anthropic, Ollama) don't accept TIFF, so TIFF inputs are
 * converted to one PNG `image_url` part per page before reaching the provider.
 */
import sharp from 'sharp';

const TIFF_DATA_URL = /^data:image\/tiff?;base64,/i;
const MAX_TIFF_PAGES = 20;
const MAX_DIMENSION = 2048;
// ~600 DPI US Letter page; anything larger is rejected before decoding.
const MAX_INPUT_PIXELS = 40_000_000;
// Total source pixels decoded per request, across all TIFF pages.
const MAX_REQUEST_PIXELS = 200_000_000;

type Budget = { pages: number; pixels: number };

type Part = { type: string; image_url?: { url: string; detail?: string }; file?: { file_data?: string } };
type MessageLike = { content?: unknown };

export class TiffConversionError extends Error {}

export function isTiffDataUrl(value: unknown): value is string {
  return typeof value === 'string' && TIFF_DATA_URL.test(value);
}

export async function tiffDataUrlToPngDataUrls(
  dataUrl: string,
  budget: Budget = { pages: MAX_TIFF_PAGES, pixels: MAX_REQUEST_PIXELS }
): Promise<string[]> {
  const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  try {
    // Header-only read; the explicit pixel checks below give callers a clear error.
    const { pages = 1, width = 0, height = 0, pageHeight } = await sharp(input, { limitInputPixels: false }).metadata();
    if (pages > budget.pages) {
      throw new TiffConversionError(
        `TIFF has ${pages} pages but only ${budget.pages} of the ${MAX_TIFF_PAGES}-page per-request limit remain`
      );
    }
    const pagePixels = width * (pageHeight ?? height);
    if (pagePixels > MAX_INPUT_PIXELS) {
      throw new TiffConversionError(`TIFF page exceeds the ${MAX_INPUT_PIXELS}-pixel limit`);
    }
    if (pagePixels * pages > budget.pixels) {
      throw new TiffConversionError(`TIFF images exceed the ${MAX_REQUEST_PIXELS}-pixel per-request limit`);
    }
    budget.pages -= pages;
    budget.pixels -= pagePixels * pages;
    const urls: string[] = [];
    for (let page = 0; page < pages; page++) {
      const png = await sharp(input, { page, limitInputPixels: MAX_INPUT_PIXELS })
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

/** Replaces TIFF `image_url` / `file` parts in place, with page and pixel budgets shared across the request. */
export async function convertTiffParts(messages: MessageLike[]): Promise<boolean> {
  let changed = false;
  const budget: Budget = { pages: MAX_TIFF_PAGES, pixels: MAX_REQUEST_PIXELS };
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
      const urls = await tiffDataUrlToPngDataUrls(tiffUrl, budget);
      for (const url of urls) {
        next.push({ type: 'image_url', image_url: { url, ...(detail && { detail }) } });
      }
    }
    message.content = next;
    changed = true;
  }
  return changed;
}
