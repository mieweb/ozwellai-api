/* Packaged page tools run in the extension's isolated world, never the page's JS. */
(() => {
  if (globalThis.__ozwellCreatePageTools) return;

  const OWNED = '[data-ozwell-owned],#ozwell-extension-root,[data-page-agent-ignore="true"],[id^="page-agent-runtime_"]';
  const PRIVATE = '[data-ozwell-private],iframe,frame,embed,object';
  const BLOCKED_INPUT = new Set(['password', 'hidden', 'file', 'submit', 'image', 'reset']);
  const PRIVATE_NAME = /password|passcode|secret|token|apikey|credential|onetimecode|verificationcode|securitycode|cvv|cvc|otp|csrf/i;
  const MAX_CONTENT = 100000;

  function privateElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest(`${OWNED},${PRIVATE}`)) return true;
    if (!element.matches('input,textarea,select')) return false;
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (['password', 'hidden', 'file'].includes(type)) return true;
    const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
    if (autocomplete.some(value => ['current-password', 'new-password', 'one-time-code'].includes(value) || value.startsWith('cc-'))) return true;
    const name = ['name', 'id', 'aria-label', 'placeholder'].map(key => element.getAttribute(key) || '').join(' ');
    return PRIVATE_NAME.test(name) || PRIVATE_NAME.test(name.replace(/[^a-z0-9]/gi, ''));
  }

  function safeURL(value) {
    const url = new URL(value);
    url.username = url.password = url.search = url.hash = '';
    return url.href;
  }

  globalThis.__ozwellCreatePageTools = ({ root = document.body, isAuthorized = () => true } = {}) => {
    if (!(root instanceof HTMLElement) || root.ownerDocument !== document || !root.isConnected) throw new Error('The page is not ready for page control.');
    const Controller = globalThis.OzwellPageController?.PageController;
    if (!Controller) throw new Error('The packaged page controller is unavailable.');
    const controller = new Controller({
      rootElement: root, enableMask: false,
      highlightOpacity: 0, highlightLabelOpacity: 0,
      viewportExpansion: -1, keepSemanticTags: true,
      excludeElements: privateElement, omitAttributes: ['value'],
    });
    const initialURL = location.href;
    const session = Array.from(crypto.getRandomValues(new Uint32Array(4)), number => number.toString(16).padStart(8, '0')).join('');
    const pending = new Set();
    let disposed = false;
    let revision = 0;
    let sequence = 0;
    let snapshotId;
    let snapshotRevision;
    let references = new Map();
    let queue = Promise.resolve();
    let marker;
    let action;

    const isOwned = node => {
      const element = node instanceof Element ? node : node?.parentElement;
      return Boolean(element?.closest(OWNED));
    };
    function observeChanges(records) {
      // Detached overlay removals have a page parent; inspect their nodes too.
      if (records.some(record => !isOwned(record.target) && !(record.type === 'childList' &&
        [...record.addedNodes, ...record.removedNodes].length &&
        [...record.addedNodes, ...record.removedNodes].every(isOwned)))) revision++;
    }
    const observer = new MutationObserver(observeChanges);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    const changed = event => { if (!isOwned(event.target)) revision++; };
    root.addEventListener('input', changed, true);
    root.addEventListener('change', changed, true);
    const flushChanges = () => observeChanges(observer.takeRecords());

    function assertAccess(signal) {
      if (disposed || signal?.aborted) throw new DOMException('Page tool execution was stopped.', 'AbortError');
      if (isAuthorized() !== true) throw new Error('Page control is not enabled for this site.');
      if (!root.isConnected || location.href !== initialURL) throw new Error('The page changed. Reopen ozwell and take a new snapshot.');
      if (!['https:', 'http:'].includes(location.protocol)) throw new Error('Page control is available only on regular websites.');
    }

    function checkSnapshot(id) {
      flushChanges();
      if (!id || id !== snapshotId || snapshotRevision !== revision) throw new Error('Stale snapshot. Call browser_snapshot and use its new snapshotId and indices.');
    }

    function fingerprint(element) {
      return JSON.stringify([element.outerHTML, 'value' in element ? element.value : null, 'checked' in element ? element.checked : null]);
    }

    function checkReference(args, name, signal) {
      assertAccess(signal);
      checkSnapshot(args.snapshotId);
      if (!Number.isSafeInteger(args.index) || args.index < 0) throw new Error('Invalid element index.');
      const reference = references.get(args.index);
      const element = reference?.element;
      if (!element || !element.isConnected || !root.contains(element) || privateElement(element) || reference.fingerprint !== fingerprint(element)) throw new Error('Stale or private element. Refresh the snapshot.');
      if (element.closest('[inert]') || element.matches(':disabled,[aria-disabled="true"]') || element.readOnly) throw new Error('This element is unavailable for actions.');
      if (element.closest('a[href],area[href]') || !element.matches('button,input,select,textarea') ||
        (element.matches('button') && element.type !== 'button') ||
        (element.matches('input') && BLOCKED_INPUT.has(element.type))) throw new Error('Links, form submission, and unsupported controls are blocked.');
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') throw new Error('This element is not visible.');
      if (name === 'browser_fill' && (!element.matches('input,textarea') || ['checkbox', 'radio', 'button'].includes(element.type) || element.readOnly)) throw new Error('browser_fill requires an editable text field.');
      if (name === 'browser_select' && !element.matches('select')) throw new Error('browser_select requires a native select control.');
      return element;
    }

    async function snapshot(signal) {
      assertAccess(signal);
      flushChanges();
      const before = revision;
      const state = await controller.getBrowserState();
      assertAccess(signal);
      flushChanges();
      if (revision !== before) throw new Error('The page changed while reading. Call browser_snapshot again.');
      const content = String(state.content || '').slice(0, MAX_CONTENT);
      const next = new Map();
      for (const match of content.matchAll(/\[(\d+)\]/g)) {
        const index = Number(match[1]);
        if (next.size >= 2000) break;
        try {
          const element = await controller.resolveElement(index);
          if (!privateElement(element)) next.set(index, { element, fingerprint: fingerprint(element) });
        } catch { /* Bracketed page text does not necessarily identify a control. */ }
      }
      assertAccess(signal);
      flushChanges();
      if (revision !== before) throw new Error('The page changed while reading. Call browser_snapshot again.');
      references = next;
      snapshotRevision = revision;
      snapshotId = `page-${session}-${++sequence}-${revision}`;
      const url = safeURL(initialURL);
      const title = String(state.title || document.title || '');
      return {
        snapshotId, url, title, header: `Current page: ${title}\n${url}`,
        content, footer: String(state.footer || ''),
        scope: 'Current website, excluding ozwell, private controls, and embedded frames',
        elementCount: references.size,
        ...(String(state.content || '').length > MAX_CONTENT ? { truncated: true } : {}),
      };
    }

    function removeMarker() { marker?.remove(); marker = undefined; }
    function preview(element, signal) {
      const rect = element.getBoundingClientRect();
      marker = document.createElement('div');
      marker.setAttribute('data-ozwell-owned', 'action-preview');
      marker.setAttribute('data-page-agent-ignore', 'true');
      marker.setAttribute('aria-hidden', 'true');
      Object.assign(marker.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
        left: `${rect.left - 3}px`, top: `${rect.top - 3}px`,
        width: `${rect.width + 6}px`, height: `${rect.height + 6}px`,
        border: '3px solid #00aede', borderRadius: '5px', boxSizing: 'border-box',
        boxShadow: '0 0 0 2px #ffcc00', background: 'transparent',
      });
      document.documentElement.appendChild(marker);
      return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Page tool execution was stopped.', 'AbortError')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 150);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }).finally(removeMarker);
    }

    // A click may hit a descendant; never allow its default form/link action.
    function guardClick(event) {
      if (!action) return;
      try {
        assertAccess(action.signal);
        const target = event.target instanceof Element ? event.target : null;
        if (!target || !action.element.contains(target) || target.closest('a[href],area[href]') || privateElement(target)) throw new Error('An unexpected or private click target was blocked.');
      } catch (error) {
        event.preventDefault();
        event.stopImmediatePropagation();
        action.error = error;
      }
    }
    function guardSubmit(event) {
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      action.error = new Error('Form submission is blocked.');
    }
    document.addEventListener('click', guardClick, true);
    document.addEventListener('submit', guardSubmit, true);

    const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
    const token = { type: 'string', description: 'snapshotId from the latest snapshot or successful action.' };
    const index = { type: 'integer', minimum: 0, description: 'Element index in that snapshot.' };
    const tools = [
      { name: 'browser_snapshot', description: 'Read the current website and indexed controls. Private fields, embedded frames, and ozwell are excluded. Input values are omitted. Read first and use the latest snapshotId.', inputSchema: schema({}), annotations: { readOnlyHint: true } },
      { name: 'browser_click', description: 'Click a visible supported control. Links, form submission, and sensitive controls are blocked. Returns a fresh snapshot.', inputSchema: schema({ snapshotId: token, index }) },
      { name: 'browser_fill', description: 'Replace an editable text field, excluding sensitive fields. Returns a fresh snapshot. Values are omitted from snapshots.', inputSchema: schema({ snapshotId: token, index, value: { type: 'string', maxLength: 4000 } }) },
      { name: 'browser_select', description: 'Choose a native select option by its exact visible label. Returns a fresh snapshot.', inputSchema: schema({ snapshotId: token, index, value: { type: 'string', maxLength: 200 } }) },
      { name: 'browser_scroll', description: 'Scroll the current page up or down and return a fresh snapshot.', inputSchema: schema({ snapshotId: token, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer', minimum: 1, maximum: 2000 } }, ['snapshotId', 'direction']) },
    ];

    async function execute(name, args, signal) {
      assertAccess(signal);
      const tool = tools.find(value => value.name === name);
      if (!tool) throw new Error('Unknown page tool.');
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key)) || tool.inputSchema.required.some(key => !Object.hasOwn(args, key))) throw new Error('Invalid tool arguments.');
      if (name === 'browser_snapshot') return snapshot(signal);
      checkSnapshot(args.snapshotId);
      if (name === 'browser_scroll') {
        if (!['up', 'down'].includes(args.direction) || (args.amount !== undefined && (!Number.isInteger(args.amount) || args.amount < 1 || args.amount > 2000))) throw new Error('Invalid scroll arguments.');
        assertAccess(signal);
        checkSnapshot(args.snapshotId);
        window.scrollBy({ top: (args.amount || 600) * (args.direction === 'down' ? 1 : -1), behavior: 'instant' });
        return snapshot(signal);
      }
      if (['browser_fill', 'browser_select'].includes(name) && (typeof args.value !== 'string' || args.value.length > (name === 'browser_fill' ? 4000 : 200))) throw new Error('Invalid field value.');
      const element = checkReference(args, name, signal);
      // Check the controller mapping too; never implicitly rebuild its index.
      if (await controller.resolveElement(args.index) !== element) throw new Error('The indexed element changed. Refresh the snapshot.');
      checkReference(args, name, signal);
      await preview(element, signal);
      checkReference(args, name, signal);
      action = { element, signal };
      try {
        if (name === 'browser_click') element.click();
        else if (name === 'browser_fill') {
          element.focus({ preventScroll: true });
          checkReference(args, name, signal);
          const prototype = element.matches('textarea') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          if (!setter) throw new Error('This field cannot be filled.');
          setter.call(element, args.value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          assertAccess(signal);
          if (element.isConnected) element.dispatchEvent(new Event('change', { bubbles: true }));
          if (element.value !== args.value) throw new Error('The field did not retain the requested text. Refresh the snapshot.');
        } else {
          const option = Array.from(element.options).find(value => value.textContent.trim() === args.value.trim());
          if (!option || option.disabled || option.parentElement?.matches('optgroup:disabled')) throw new Error('The requested option is unavailable.');
          const selectedIndex = option.index;
          element.selectedIndex = selectedIndex;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          assertAccess(signal);
          if (element.isConnected) element.dispatchEvent(new Event('change', { bubbles: true }));
          if (!element.isConnected || element.selectedIndex !== selectedIndex || element.options[selectedIndex] !== option || !option.selected) throw new Error('The field did not retain the requested option. Refresh the snapshot.');
        }
        if (action.error) throw action.error;
      } finally { action = undefined; }
      return snapshot(signal);
    }

    function callTool(name, args = {}, { signal } = {}) {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
      pending.add(abort);
      const result = queue.then(async () => {
        try { return { content: [{ type: 'text', text: JSON.stringify(await execute(name, args, abort.signal)) }] }; }
        catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.message || 'Page tool execution failed.' }) }] }; }
        finally { pending.delete(abort); signal?.removeEventListener('abort', cancel); }
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    }

    return {
      tools, callTool,
      dispose() {
        if (disposed) return;
        disposed = true;
        pending.forEach(value => value.abort());
        observer.disconnect();
        root.removeEventListener('input', changed, true);
        root.removeEventListener('change', changed, true);
        document.removeEventListener('click', guardClick, true);
        document.removeEventListener('submit', guardSubmit, true);
        references.clear();
        removeMarker();
        controller.dispose();
      },
    };
  };
})();
