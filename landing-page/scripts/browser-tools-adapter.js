import { PageController } from '@mieweb/page-controller';
import { createActionVisuals } from './browser-tools-visuals.js';

// This demo deliberately exposes a small page API, never arbitrary evaluation.
// The fork scopes both extraction and reference resolution to the sample app.
export function createBrowserTools(root) {
  const controller = new PageController({
    rootElement: root,
    enableMask: true,
    highlightOpacity: 0,
    highlightLabelOpacity: 0,
    viewportExpansion: -1,
    keepSemanticTags: true,
  });
  const visuals = createActionVisuals(controller);
  let revision = 0;
  let sequence = 0;
  let snapshotId;
  let snapshotRevision;
  let references = new Map();
  let queue = Promise.resolve();
  let action;
  const controlValues = new WeakMap();
  const controlValue = (element) =>
    JSON.stringify([element.value, element.checked]);
  const changed = () => {
    revision += 1;
  };
  function fieldChanged(event) {
    const element = event.target;
    if (
      !(element instanceof Element) ||
      !element.matches('input,select,textarea')
    ) {
      changed();
      return;
    }
    const value = controlValue(element);
    // Native blur can emit change after an already-observed input. It must
    // not invalidate a fresh snapshot when the field value stayed the same.
    if (controlValues.get(element) !== value) {
      controlValues.set(element, value);
      changed();
    }
  }
  const observer = new MutationObserver(changed);
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  root.addEventListener('input', fieldChanged, true);
  root.addEventListener('change', fieldChanged, true);

  function flushChanges() {
    if (observer.takeRecords().length) changed();
  }

  function fingerprint(element) {
    return JSON.stringify([
      element.outerHTML,
      'value' in element ? element.value : null,
      'checked' in element ? element.checked : null,
    ]);
  }

  function checkSnapshot(id) {
    flushChanges();
    if (!id || id !== snapshotId || snapshotRevision !== revision) {
      throw new Error(
        'Stale snapshot. Call browser_snapshot and use its new snapshotId and indices.',
      );
    }
  }

  async function snapshot() {
    const state = await controller.getBrowserState();
    flushChanges();
    const next = new Map();
    for (const match of state.content.matchAll(/\[(\d+)\]/g)) {
      const index = Number(match[1]);
      try {
        const element = await controller.resolveElement(index);
        next.set(index, { element, fingerprint: fingerprint(element) });
      } catch {
        /* Text containing [numbers] is not an element reference. */
      }
    }
    references = next;
    for (const element of root.querySelectorAll('input,select,textarea'))
      controlValues.set(element, controlValue(element));
    snapshotRevision = revision;
    snapshotId = `page-${++sequence}-${revision}`;
    return {
      snapshotId,
      ...state,
      scope: 'Service operations desk',
      elementCount: references.size,
    };
  }

  function validateReference(args, operation, element) {
    checkSnapshot(args.snapshotId);
    if (!Number.isSafeInteger(args.index) || args.index < 0)
      throw new Error('Invalid element index.');
    const reference = references.get(args.index);
    if (
      !reference ||
      reference.element !== element ||
      !element.isConnected ||
      !root.contains(element) ||
      reference.fingerprint !== fingerprint(element)
    ) {
      throw new Error('Stale or outside-scope element. Refresh the snapshot.');
    }
    if (
      element.closest('[data-page-agent-ignore="true"]') ||
      element.matches(':disabled,[aria-disabled="true"]')
    ) {
      throw new Error('This element is unavailable for actions.');
    }
    if (
      element.closest('a[href],area[href]') ||
      !element.matches('button[type="button"],input,select,textarea') ||
      element.matches(
        'input[type="submit"],input[type="image"],input[type="file"],input[type="password"],input[type="hidden"]',
      )
    ) {
      throw new Error(
        'Navigation and unsupported controls are blocked in this demo.',
      );
    }
    if (
      operation === 'browser_fill' &&
      (!element.matches('input,textarea') ||
        element.matches(
          'input[type="checkbox"],input[type="radio"],input[type="button"]',
        ) ||
        element.readOnly)
    ) {
      throw new Error('browser_fill requires an editable text field.');
    }
    if (operation === 'browser_select' && !element.matches('select')) {
      throw new Error('browser_select requires a native select control.');
    }
    return element;
  }

  async function resolve(args, operation) {
    checkSnapshot(args.snapshotId);
    if (!Number.isSafeInteger(args.index) || args.index < 0)
      throw new Error('Invalid element index.');
    return validateReference(
      args,
      operation,
      await controller.resolveElement(args.index),
    );
  }

  // Check the actual event target too: the upstream click implementation can
  // hit-test a descendant after scrolling. Only this controlled sample's
  // explicit controls are supported. This is not a universal navigation sandbox.
  function guardClick(event) {
    // Manual interaction remains available in highlight/none modes. The mask
    // has its own trusted-input blocker; this guard checks generated clicks.
    if (!action || event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      !target ||
      !root.contains(target) ||
      !action.element.contains(target) ||
      target.closest('a[href],area[href]')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      action.blocked = new Error(
        'Navigation or an unexpected click target was blocked.',
      );
    }
  }
  function guardSubmit(event) {
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    action.blocked = new Error('Form navigation is blocked.');
  }
  document.addEventListener('click', guardClick, true);
  document.addEventListener('submit', guardSubmit, true);

  const token = {
    type: 'string',
    description: 'snapshotId from the latest successful snapshot or action.',
  };
  const index = {
    type: 'integer',
    minimum: 0,
    description: 'Element index in that snapshot.',
  };
  const schema = (properties, required = Object.keys(properties)) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  const tools = [
    {
      name: 'browser_snapshot',
      description:
        'Read the service desk page and indexed controls. Read first; use only the latest snapshotId. Assistant and tool-console content is excluded.',
      inputSchema: schema({}),
      annotations: { readOnlyHint: true },
    },
    {
      name: 'browser_click',
      description:
        'Click a supported service desk control. Navigation is blocked. Returns a fresh snapshot; old references expire.',
      inputSchema: schema({ snapshotId: token, index }),
    },
    {
      name: 'browser_fill',
      description:
        'Replace text in a service desk field. Returns a fresh snapshot.',
      inputSchema: schema({
        snapshotId: token,
        index,
        value: { type: 'string', maxLength: 4000 },
      }),
    },
    {
      name: 'browser_select',
      description:
        'Select an option by its exact visible label. Returns a fresh snapshot.',
      inputSchema: schema({
        snapshotId: token,
        index,
        value: { type: 'string', maxLength: 200 },
      }),
    },
    {
      name: 'browser_scroll',
      description:
        'Scroll the host page up or down, then return a fresh snapshot.',
      inputSchema: schema(
        {
          snapshotId: token,
          direction: { type: 'string', enum: ['up', 'down'] },
          amount: { type: 'integer', minimum: 1, maximum: 2000 },
        },
        ['snapshotId', 'direction'],
      ),
    },
  ];

  function checkAbort(signal) {
    if (signal?.aborted)
      throw new DOMException('Browser tool execution aborted.', 'AbortError');
  }

  async function execute(name, args, signal) {
    checkAbort(signal);
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw new Error('Arguments must be an object.');
    if (
      Object.keys(args).some((key) => !(key in tool.inputSchema.properties)) ||
      tool.inputSchema.required.some((key) => !(key in args))
    )
      throw new Error('Invalid tool arguments.');
    if (name === 'browser_snapshot') return snapshot();
    checkSnapshot(args.snapshotId);
    if (name === 'browser_scroll') {
      if (
        !['up', 'down'].includes(args.direction) ||
        (args.amount !== undefined &&
          (!Number.isInteger(args.amount) ||
            args.amount < 1 ||
            args.amount > 2000))
      ) {
        throw new Error('Invalid scroll arguments.');
      }
      return visuals.withAction(
        root,
        `Scroll ${args.direction}`,
        async () => {
          checkAbort(signal);
          checkSnapshot(args.snapshotId);
          window.scrollBy({
            top: (args.direction === 'down' ? 1 : -1) * (args.amount || 600),
            left: 0,
            behavior: 'instant',
          });
          return snapshot();
        },
        false,
      );
    }
    const element = await resolve(args, name);
    if (
      ['browser_fill', 'browser_select'].includes(name) &&
      (typeof args.value !== 'string' ||
        args.value.length > (name === 'browser_fill' ? 4000 : 200))
    ) {
      throw new Error('Invalid field value.');
    }
    const targetName =
      element.labels?.[0]?.textContent?.trim() ||
      element.getAttribute('aria-label') ||
      element.textContent.trim() ||
      element.id;
    const verb = {
      browser_click: 'Click',
      browser_fill: 'Fill',
      browser_select: 'Select',
    }[name];
    return visuals.withAction(
      element,
      `${verb} · ${targetName.slice(0, 80)}`,
      async () => {
        // Highlight mode allows manual interaction during the preview delay.
        // Recheck the token before committing an action to a changing page.
        checkAbort(signal);
        await resolve(args, name);
        checkAbort(signal);
        const options = {
          // The controller yields while moving and after clicking. Check
          // synchronously at the actual dispatch/write boundaries too.
          beforeDispatch() {
            checkAbort(signal);
            validateReference(args, name, element);
          },
        };
        action = { element };
        try {
          const result =
            name === 'browser_click'
              ? await controller.clickElement(args.index, options)
              : name === 'browser_fill'
                ? await controller.inputText(args.index, args.value, options)
                : await controller.selectOption(
                    args.index,
                    args.value,
                    options,
                  );
          if (action.blocked) throw action.blocked;
          if (!result.success) throw new Error(result.message);
        } finally {
          action = undefined;
        }
        return snapshot();
      },
    );
  }

  function callTool(name, args = {}, { signal } = {}) {
    const pending = queue.then(async () => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await execute(name, args, signal)),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            { type: 'text', text: JSON.stringify({ error: error.message }) },
          ],
        };
      }
    });
    queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  return {
    tools,
    callTool,
    setVisualOptions: (options) => visuals.setOptions(options),
    runWithVisuals: (work) => visuals.withSession(work),
    // Deterministic demo/test driver only. Agents discover references from snapshots.
    findIndex(selector, id) {
      checkSnapshot(id);
      for (const [index, { element }] of references)
        if (element.matches(selector)) return index;
      throw new Error(`No indexed element matches ${selector}`);
    },
    dispose() {
      observer.disconnect();
      root.removeEventListener('input', fieldChanged, true);
      root.removeEventListener('change', fieldChanged, true);
      document.removeEventListener('click', guardClick, true);
      document.removeEventListener('submit', guardSubmit, true);
      visuals.dispose();
      controller.dispose();
    },
  };
}
