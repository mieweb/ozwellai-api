import '@mieweb/page-controller/style.css';

const wait = (milliseconds) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

// Presentation stays outside the indexed app: painting an action must not
// invalidate the snapshot that authorized it.
export function createActionVisuals(controller) {
  let options = { mode: 'mask', speed: 'normal' };
  let activeOptions;
  let depth = 0;
  let opening;
  let closing;
  let mask;
  let maskShown = false;
  let animationFrame;
  const marker = document.createElement('div');
  marker.className = 'demo-action-highlight';
  marker.dataset.demoHighlight = '';
  marker.dataset.pageAgentIgnore = 'true';
  marker.setAttribute('aria-hidden', 'true');
  marker.hidden = true;
  const label = document.createElement('span');
  label.className = 'demo-action-label';
  marker.append(label);
  document.body.append(marker);

  // Native modal dialogs paint above every z-index. A manual popover lets the
  // visual layer follow the confirm button into the top layer without focus.
  function promote(element) {
    if (typeof element.showPopover !== 'function') return;
    element.setAttribute('popover', 'manual');
    if (element.matches(':popover-open')) element.hidePopover();
    element.showPopover();
  }

  function hideMarker() {
    cancelAnimationFrame(animationFrame);
    if (marker.matches(':popover-open')) marker.hidePopover();
    marker.hidden = true;
  }

  function highlight(element, text) {
    label.textContent = text;
    marker.hidden = false;
    promote(marker);
    const follow = () => {
      if (!element.isConnected) return hideMarker();
      const rect = element.getBoundingClientRect();
      const left = Math.max(4, rect.left - 4);
      const top = Math.max(4, rect.top - 4);
      const right = Math.min(window.innerWidth - 4, rect.right + 4);
      const bottom = Math.min(window.innerHeight - 4, rect.bottom + 4);
      Object.assign(marker.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(0, right - left)}px`,
        height: `${Math.max(0, bottom - top)}px`,
      });
      label.style.bottom = top < 45 ? 'auto' : '';
      label.style.top = top < 45 ? 'calc(100% + 7px)' : '';
      animationFrame = requestAnimationFrame(follow);
    };
    follow();
  }

  // The upstream mask captures pointer events on itself. This also covers an
  // already-focused input and the native modal, which makes outside nodes inert.
  function blockManualInput(event) {
    if (!maskShown || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  const inputEvents = ['click', 'pointerdown', 'keydown', 'wheel'];
  inputEvents.forEach((name) =>
    document.addEventListener(name, blockManualInput, {
      capture: true,
      passive: false,
    }),
  );

  async function withSession(work) {
    // Guided sessions and queued live calls can overlap. Share initialization,
    // and let the last user of the visuals finish their fade before reopening.
    while (closing) await closing;
    if (depth++ === 0) {
      activeOptions = { ...options };
      opening = (async () => {
        if (['mask', 'both'].includes(activeOptions.mode)) {
          await controller.showMask();
          mask = document.getElementById('page-agent-runtime_simulator-mask');
          mask.setAttribute('aria-hidden', 'true');
          maskShown = true;
          promote(mask);
        }
      })();
    }
    try {
      await opening;
      return await work();
    } finally {
      if (--depth === 0) {
        closing = (async () => {
          hideMarker();
          try {
            if (maskShown) {
              await controller.hideMask();
              // hideMask returns before its 800ms fade finishes. Waiting here
              // prevents its old timer from hiding the next step's new mask.
              await wait(850);
              if (mask.matches(':popover-open')) mask.hidePopover();
            }
          } finally {
            maskShown = false;
            activeOptions = undefined;
          }
        })();
        try {
          await closing;
        } finally {
          closing = undefined;
        }
      }
    }
  }

  return {
    setOptions(next) {
      if (!['mask', 'highlight', 'both', 'none'].includes(next.mode))
        throw new Error('Unknown action display mode.');
      if (!['normal', 'slow'].includes(next.speed))
        throw new Error('Unknown demo run speed.');
      options = { ...next };
    },
    withSession,
    withAction(element, text, work, scrollIntoView = true) {
      return withSession(async () => {
        const visible = activeOptions.mode !== 'none';
        const slow = activeOptions.speed === 'slow';
        if (visible) {
          if (scrollIntoView)
            element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          if (maskShown) {
            promote(mask);
            const rect = element.getBoundingClientRect();
            window.dispatchEvent(
              new CustomEvent('PageAgent::MovePointerTo', {
                detail: {
                  x: Math.min(
                    window.innerWidth - 20,
                    rect.left + rect.width / 2,
                  ),
                  y: Math.min(
                    window.innerHeight - 20,
                    rect.top + rect.height / 2,
                  ),
                },
              }),
            );
          }
          if (['highlight', 'both'].includes(activeOptions.mode))
            highlight(element, text);
          await wait(slow ? 1100 : 450);
        }
        try {
          return await work();
        } finally {
          if (visible) await wait(slow ? 700 : 250);
          hideMarker();
        }
      });
    },
    dispose() {
      hideMarker();
      marker.remove();
      inputEvents.forEach((name) =>
        document.removeEventListener(name, blockManualInput, true),
      );
    },
  };
}
