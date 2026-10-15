import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import tiffModule from '../dist/reference-server/src/llm/tiff.js';

const { convertTiffParts, TiffConversionError } = tiffModule;

async function tiffDataUrl() {
    const buf = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).tiff().toBuffer();
    return `data:image/tiff;base64,${buf.toString('base64')}`;
}

test('TIFF image_url part becomes PNG image_url', async () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'read' }, { type: 'image_url', image_url: { url: await tiffDataUrl(), detail: 'high' } }] }];
    assert.equal(await convertTiffParts(messages), true);
    assert.equal(messages[0].content.length, 2);
    assert.match(messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
    assert.equal(messages[0].content[1].image_url.detail, 'high');
});

test('TIFF file part becomes PNG image_url', async () => {
    const messages = [{ role: 'user', content: [{ type: 'file', file: { filename: 'a.tif', file_data: await tiffDataUrl() } }] }];
    await convertTiffParts(messages);
    assert.equal(messages[0].content[0].type, 'image_url');
});

test('non-TIFF content is untouched', async () => {
    const messages = [{ role: 'user', content: 'hi' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }];
    assert.equal(await convertTiffParts(messages), false);
});

test('corrupt TIFF throws TiffConversionError', async () => {
    const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/tiff;base64,AAAA' } }] }];
    await assert.rejects(convertTiffParts(messages), TiffConversionError);
});

async function multiPageTiffDataUrl(pages, size = 4) {
    const buf = await sharp(Buffer.alloc(size * size * pages * 3), { raw: { width: size, height: size * pages, channels: 3, pageHeight: size } }).tiff().toBuffer();
    return `data:image/tiff;base64,${buf.toString('base64')}`;
}

test('multi-page TIFF expands to one PNG per page, keeping surrounding order', async () => {
    const messages = [{ role: 'user', content: [
        { type: 'text', text: 'before' },
        { type: 'image_url', image_url: { url: await multiPageTiffDataUrl(2) } },
        { type: 'text', text: 'after' },
    ] }];
    await convertTiffParts(messages);
    const types = messages[0].content.map((p) => p.type);
    assert.deepEqual(types, ['text', 'image_url', 'image_url', 'text']);
    assert.equal(messages[0].content[0].text, 'before');
    assert.equal(messages[0].content[3].text, 'after');
});

test('oversized TIFF is resized to fit within 2048px', async () => {
    const buf = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: '#fff' } }).tiff({ compression: 'lzw' }).toBuffer();
    const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/tiff;base64,${buf.toString('base64')}` } }] }];
    await convertTiffParts(messages);
    const png = Buffer.from(messages[0].content[0].image_url.url.split(',')[1], 'base64');
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, 2048);
    assert.equal(meta.height, 512);
});

test('page budget is shared across all TIFFs in a request', async () => {
    const url = await multiPageTiffDataUrl(15);
    const messages = [
        { role: 'user', content: [{ type: 'image_url', image_url: { url } }] },
        { role: 'user', content: [{ type: 'image_url', image_url: { url } }] },
    ];
    await assert.rejects(convertTiffParts(messages), (err) => {
        assert.ok(err instanceof TiffConversionError);
        assert.match(err.message, /15 pages but only 5/);
        return true;
    });
});

test('request-wide pixel budget is shared across TIFFs', async () => {
    const buf = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#fff' } }).tiff({ compression: 'lzw' }).toBuffer();
    const url = `data:image/tiff;base64,${buf.toString('base64')}`;
    const messages = Array.from({ length: 6 }, () => ({ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }));
    await assert.rejects(convertTiffParts(messages), /pixel per-request limit/);
});

test('TIFF page over the pixel limit is rejected', async () => {
    const buf = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#fff' } }).tiff({ compression: 'lzw' }).toBuffer();
    const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/tiff;base64,${buf.toString('base64')}` } }] }];
    await assert.rejects(convertTiffParts(messages), /pixel limit/);
});
