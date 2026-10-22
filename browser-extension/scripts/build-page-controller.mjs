#!/usr/bin/env node
// Rebuild the checked-in extension artifact from the exact #326 distribution.
// This command reads installed dependencies; it never fetches or executes controller code.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = resolve(extensionDir, '..');
const commit = '6963ab7a183ce38cce3f1bfc29e5c3ff206a1973';
const upstreamCommit = '9eb6b6646500264d9034dd466a4270cb9fc1ef1e';
const dependency = `git+https://github.com/mieweb/page-agent.git#${commit}`;
let packageDir = join(repositoryDir, 'landing-page/node_modules/@mieweb/page-controller');
for (let index = 2; index < process.argv.length; index++) {
  if (process.argv[index] === '--help') {
    process.stdout.write('Usage: node scripts/build-page-controller.mjs [--package-dir PATH]\n');
    process.exit(0);
  }
  if (process.argv[index] !== '--package-dir' || !process.argv[index + 1]) {
    throw new Error(`Unknown or incomplete option: ${process.argv[index]}`);
  }
  packageDir = resolve(process.argv[++index]);
}

const sha256 = content => createHash('sha256').update(content).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const manifest = await json(join(repositoryDir, 'landing-page/package.json'));
const lock = await json(join(repositoryDir, 'landing-page/package-lock.json'));
const lockedPackage = lock.packages['node_modules/@mieweb/page-controller'];
if (manifest.dependencies['@mieweb/page-controller'] !== dependency || lockedPackage?.resolved !== dependency) {
  throw new Error(`Controller dependency must remain pinned to ${commit} in the landing-page manifest and lockfile.`);
}

// These hashes were verified against the files at the pinned Git commit. Check
// the distribution and legal notices rather than trusting a package directory's
// name or its self-reported version. Updating the pin requires reviewing them.
const expectedHashes = {
  'package.json': 'd38f49de0190f894a8225d93f8d28ad827a4490f22172631be9186f676d24167',
  'dist/page-controller.js': '13293aa70c99c89e281bdd029593453f3b9a4dfa4a92632c2524fd5f8b55569c',
  'CONTROLLER-DISTRIBUTION.md': '961b9e18f68ca942d14ec36de34e23bd78cc92730f1ca6baf9e799e0bcf77111',
  LICENSE: '393ad563ce5dd0bbe283ec40f9f5d631817262bc9bbd5eb17ed038a9d9f44803',
  'THIRD_PARTY_NOTICES.md': 'f0b4832cd9b24df11e97f438c7026db73b39dc68040a86cedc678baac52d84d7',
  'licenses/ai-motion-LICENSE': 'df71b50b0d46b282e5ed6fe67c1c23874b10b2a1512a4658d3aafa9fb9d23b76',
};
const files = {};
for (const [name, expected] of Object.entries(expectedHashes)) {
  let content;
  try { content = await readFile(join(packageDir, name), 'utf8'); }
  catch (error) { throw new Error(`Cannot read pinned controller ${name}. Install landing-page dependencies or pass --package-dir PATH.`, { cause: error }); }
  if (sha256(content) !== expected) throw new Error(`Pinned controller file does not match ${commit}: ${name}`);
  files[name] = content;
}
if (!files['CONTROLLER-DISTRIBUTION.md'].includes(upstreamCommit)) {
  throw new Error('Controller upstream provenance is missing.');
}

let source = files['dist/page-controller.js'];
function patch(before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Expected one pinned patch location: ${label}`);
  source = source.replace(before, after);
}

patch(
  '  async executeJavascript(script, signal) {\n    try {\n      const asyncFunction = eval(`(async (signal) => { ${script} })`);\n      const result = await asyncFunction(signal);\n      return {\n        success: true,\n        message: `\\u2705 Executed JavaScript. Result: ${result}`\n      };\n    } catch (error) {\n      return {\n        success: false,\n        message: `\\u274C Error executing JavaScript: ${error}`\n      };\n    }\n  }',
  '  async executeJavascript() {\n    throw new Error("Arbitrary JavaScript execution is unavailable in the browser extension.");\n  }',
  'disable arbitrary JavaScript execution',
);
patch(
  '    if (node.dataset?.browserUseIgnore === "true" || node.dataset?.pageAgentIgnore === "true") {',
  '    if (node.nodeType === Node.ELEMENT_NODE && typeof args.excludeElements === "function" && args.excludeElements(node)) {\n      return null;\n    }\n    if (node.dataset?.browserUseIgnore === "true" || node.dataset?.pageAgentIgnore === "true") {',
  'prune excluded subtrees before traversal and indexing',
);
patch(
  '    rootElement: config.rootElement,\n    doHighlightElements: true,',
  '    rootElement: config.rootElement,\n    excludeElements: config.excludeElements,\n    doHighlightElements: config.doHighlightElements ?? !((config.highlightOpacity ?? 0) === 0 && (config.highlightLabelOpacity ?? 0.1) === 0),',
  'forward exclusion callback and avoid invisible highlight DOM',
);
patch(
  '            highlightElement(node, nodeData.highlightIndex, parentIframe);\n          }\n          return true;\n        }\n      } else {',
  '            highlightElement(node, nodeData.highlightIndex, parentIframe);\n          }\n        }\n        return true;\n      } else {',
  'preserve indexed parent grouping when highlights are disabled',
);
patch(
  'function flatTreeToString(flatTree, includeAttributes = [], keepSemanticTags = false) {',
  'function flatTreeToString(flatTree, includeAttributes = [], keepSemanticTags = false, omitAttributes = []) {',
  'attribute omission parameter',
);
patch(
  '  const includeAttrs = [...includeAttributes, ...DEFAULT_INCLUDE_ATTRIBUTES];',
  '  const omittedAttrs = new Set(omitAttributes);\n  const includeAttrs = [...includeAttributes, ...DEFAULT_INCLUDE_ATTRIBUTES].filter(name => !omittedAttrs.has(name));',
  'remove omitted attributes from defaults and requested attributes',
);
patch(
  '          const attributesToInclude = matchAttributes(node.attributes, includeAttrs);',
  '          const attributesToInclude = matchAttributes(node.attributes, includeAttrs);\n          for (const name of omittedAttrs) delete attributesToInclude[name];',
  'prevent wildcard attribute requests from restoring omitted values',
);
patch(
  '      if (elementNode.children) {\n        for (const childId of elementNode.children) {',
  '      if (elementNode.children && !(omittedAttrs.has("value") && elementNode.tagName === "textarea")) {\n        for (const childId of elementNode.children) {',
  'omit textarea default-value text when values are omitted',
);
// The pinned serializer aggregates descendant text for indexed controls. Its
// visibility flags must be enforced there and for standalone text, too. Range
// geometry retains rendered display:contents text; native option labels are
// semantic control data even while the select's popup is closed.
const textVisibilityStart = '  function isTextNodeVisible(textNode) {';
const textVisibilityEnd = '  function isElementAccepted(element) {';
if (source.split(textVisibilityStart).length !== 2 || source.split(textVisibilityEnd).length !== 2) {
  throw new Error('Expected one pinned text visibility function.');
}
patch(
  source.slice(source.indexOf(textVisibilityStart), source.indexOf(textVisibilityEnd)),
  `  function isElementStyleVisible(element) {
    const ownStyle = getCachedComputedStyle(element);
    if (!ownStyle || ownStyle.visibility === "hidden" || ownStyle.visibility === "collapse") return false;
    // Visibility can be restored on a child. Display, content visibility, and
    // opacity cannot; check every composed ancestor, including slots and hosts.
    for (let ancestor = element; ancestor; ancestor = ancestor.assignedSlot || ancestor.parentElement || ancestor.getRootNode()?.host) {
      const style = getCachedComputedStyle(ancestor);
      if (!style || style.display === "none" || style.contentVisibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  function isNativeOptionVisible(option) {
    const select = option.closest("select");
    return Boolean(select && isElementVisible(select) && isElementStyleVisible(option));
  }
  function isTextNodeVisible(textNode) {
    try {
      const parent = textNode.parentElement;
      if (!parent || !isElementStyleVisible(parent)) return false;
      const option = parent.closest("option");
      const select = option?.closest("select");
      let rects;
      if (select) {
        // Unopened native option lists have no text rectangles. Expose their
        // labels only when their owning select and the option's ancestry render.
        rects = [getCachedBoundingRect(select)];
      } else {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        rects = range.getClientRects();
      }
      for (const rect of rects) {
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        if (viewportExpansion === -1 || !(rect.bottom < -viewportExpansion || rect.top > window.innerHeight + viewportExpansion || rect.right < -viewportExpansion || rect.left > window.innerWidth + viewportExpansion)) return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }
`,
  'measure rendered text and preserve visible native option semantics',
);
patch(
  '  function isElementVisible(element) {\n    const style = getCachedComputedStyle(element);\n    return element.offsetWidth > 0 && element.offsetHeight > 0 && style?.visibility !== "hidden" && style?.display !== "none";\n  }',
  '  function isElementVisible(element) {\n    return element.offsetWidth > 0 && element.offsetHeight > 0 && isElementStyleVisible(element);\n  }',
  'exclude invisible element attributes and action indices using composed ancestor styles',
);
patch(
  '      } else {\n        if (node.shadowRoot) {',
  `      } else if (tagName === "option" && node.closest("select") && node.hasAttribute("label")) {
        // Native controls display option.label, which can replace textContent
        // or exist without a text child. Do not disclose the unused fallback.
        // Implicit labels retain normal child traversal so exclusion callbacks
        // and hidden descendant checks still redact their source text.
        const label = node.label.trim();
        if (label && isNativeOptionVisible(node)) {
          const labelId = String(ID.current++);
          DOM_HASH_MAP[labelId] = { type: "TEXT_NODE", text: label, isVisible: true };
          nodeData.children.push(labelId);
        }
      } else {
        if (node.shadowRoot) {`,
  'serialize explicit visible native option labels without traversing unused fallback text',
);
patch(
  '    if (currentNode.type === "text" && currentNode.text) {',
  '    if (currentNode.type === "text" && currentNode.isVisible && currentNode.text) {',
  'exclude invisible descendants from indexed control descriptions',
);
patch(
  '      if (hasParentWithHighlightIndex(node)) {',
  '      if (!node.isVisible || hasParentWithHighlightIndex(node)) {',
  'exclude invisible standalone text',
);
patch(
  '      this.config.includeAttributes,\n      this.config.keepSemanticTags\n    );',
  '      this.config.includeAttributes,\n      this.config.keepSemanticTags,\n      this.config.omitAttributes\n    );',
  'forward omission configuration from updateTree',
);
patch(
  'export {\n  PageController,\n  clickElement,\n  getElementByIndex,\n  inputTextElement,\n  scrollHorizontally,\n  scrollIntoViewIfNeeded,\n  scrollVertically,\n  selectOptionElement\n};',
  'export { PageController };',
  'export only the controller constructor',
);
source = source.replace('//# sourceMappingURL=page-controller.js.map\n', '');

const require = createRequire(join(repositoryDir, 'package.json'));
const esbuild = require('esbuild');
const buildLock = await json(join(repositoryDir, 'package-lock.json'));
if (esbuild.version !== buildLock.packages['node_modules/esbuild']?.version) {
  throw new Error('Install the repository locked esbuild version before rebuilding the controller.');
}
const result = await esbuild.build({
  absWorkingDir: repositoryDir,
  stdin: { contents: source, sourcefile: 'page-controller.pinned.js', loader: 'js' },
  bundle: true,
  format: 'iife',
  globalName: 'OzwellPageController',
  platform: 'browser',
  target: ['chrome102', 'safari16.4'],
  minify: true,
  legalComments: 'eof',
  write: false,
  // Wrap the complete compiled program: checking only at export time still
  // duplicates the pinned module's navigation listeners and interval fallback.
  banner: { js: `/*! @mieweb/page-controller 1.12.4-mie.2; ${commit}; MIT. See vendor/LICENSE and vendor/THIRD_PARTY_NOTICES.md. */\n(() => { if (globalThis.OzwellPageController?.PageController) return;` },
  footer: { js: 'globalThis.OzwellPageController = Object.freeze(OzwellPageController); })();' },
});
const bundle = result.outputFiles[0].text;
if (/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/.test(bundle)) {
  throw new Error('Controller bundle contains dynamic JavaScript execution.');
}
if (/\bimport\s*\(/.test(bundle)) throw new Error('Controller bundle contains a runtime module import.');

const destination = join(extensionDir, 'vendor');
await mkdir(destination, { recursive: true });
await writeFile(join(destination, 'page-controller.js'), bundle);
for (const [origin, name] of [['LICENSE', 'LICENSE'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'], ['licenses/ai-motion-LICENSE', 'ai-motion-LICENSE']]) {
  await writeFile(join(destination, name), files[origin]);
}
await writeFile(join(destination, 'PROVENANCE.json'), JSON.stringify({
  package: '@mieweb/page-controller', version: '1.12.4-mie.2',
  repository: 'https://github.com/mieweb/page-agent', commit, upstreamCommit,
  lockIntegrity: lockedPackage.integrity,
  sourceFiles: expectedHashes,
  esbuild: esbuild.version, target: ['chrome102', 'safari16.4'],
  patches: [
    'Disable executeJavascript; no evaluation or dynamic module imports in output.',
    'Forward excludeElements(Element) and prune its matching subtrees before extraction/indexing.',
    'Forward omitAttributes and remove matching attributes from defaults, explicit and wildcard serialization; omit textarea default text when value is omitted.',
    'Exclude invisible descendant and standalone text; measure rendered text including display:contents and preserve visibility restored on descendants.',
    'Apply composed ancestor display, content-visibility, and opacity checks before indexing or serializing element attributes, including slots and shadow hosts.',
    'Serialize explicit visible native option.label values, including labels without text children; implicit labels retain descendant exclusion and visibility checks. Omit unused fallback text and hidden option labels.',
    'Skip invisible highlight DOM while preserving indexed parent grouping.',
    'Export only PageController as globalThis.OzwellPageController.PageController.',
    'Guard the entire generated program before any side effects, preserving one controller export and one set of navigation hooks per document.',
  ],
  bundle: { file: 'page-controller.js', bytes: Buffer.byteLength(bundle), sha256: sha256(bundle) },
}, null, 2) + '\n');
process.stdout.write(`Built vendor/page-controller.js (${Buffer.byteLength(bundle)} bytes; sha256 ${sha256(bundle)})\n`);
