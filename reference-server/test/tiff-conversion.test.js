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
