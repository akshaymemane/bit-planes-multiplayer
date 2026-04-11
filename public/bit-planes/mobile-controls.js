/**
 * mobile-controls.js
 * On-screen touch controls for Bit Planes.
 *
 * Strategy: dispatch synthetic KeyboardEvent on document so the existing
 * minified game code picks them up without any modifications.
 *
 * Controls appear when:
 *   1. The device supports touch input.
 *   2. The game is running (lobby <main> is hidden / display:none).
 */

(function () {
  'use strict';

  if (!('ontouchstart' in window)) return;

  // Key mappings
  const KEY = {
    up:      { code: 'ArrowUp',    key: 'ArrowUp'    },
    down:    { code: 'ArrowDown',  key: 'ArrowDown'  },
    left:    { code: 'ArrowLeft',  key: 'ArrowLeft'  },
    right:   { code: 'ArrowRight', key: 'ArrowRight' },
    fire:    { code: 'Space',      key: ' '          },
    missile: { code: 'KeyX',       key: 'x'          },
    eject:   { code: 'KeyC',       key: 'c'          },
  };

  function fireKey(action, type) {
    const k = KEY[action];
    if (!k) return;

    const event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      code: k.code,
      key: k.key,
    });
    document.dispatchEvent(event);

    // Mirror to audio system (Space = gun, X = cannon)
    if (type === 'keydown' && window.bitplanesAudio) {
      if (action === 'fire')    window.bitplanesAudio.playSound('machine_gun');
      if (action === 'missile') window.bitplanesAudio.playSound('cannon');
    }
  }

  // Build the DOM
  function buildControls() {
    const root = document.createElement('div');
    root.id = 'mobile-controls';
    root.setAttribute('aria-hidden', 'true');

    root.innerHTML = `
      <!-- Left: D-pad -->
      <div class="mc-dpad">
        <button class="mc-btn mc-btn-up"    data-action="up"    type="button">▲</button>
        <button class="mc-btn mc-btn-left"  data-action="left"  type="button">◀</button>
        <div    class="mc-btn mc-btn-center"></div>
        <button class="mc-btn mc-btn-right" data-action="right" type="button">▶</button>
        <button class="mc-btn mc-btn-down"  data-action="down"  type="button">▼</button>
      </div>

      <!-- Right: Action buttons -->
      <div class="mc-actions">
        <button class="mc-btn mc-btn-fire"    data-action="fire"    type="button">
          <span class="mc-btn-inner"><span>🔫</span><span class="mc-btn-label">Fire</span></span>
        </button>
        <button class="mc-btn mc-btn-missile" data-action="missile" type="button">
          <span class="mc-btn-inner"><span>🚀</span><span class="mc-btn-label">Missile</span></span>
        </button>
        <button class="mc-btn mc-btn-eject"   data-action="eject"   type="button">
          <span class="mc-btn-inner"><span>⏏</span><span class="mc-btn-label">Eject / Reload</span></span>
        </button>
      </div>
    `;

    document.body.appendChild(root);
    return root;
  }

  // Wire touch events to a button element
  function wireButton(btn) {
    const action = btn.dataset.action;
    if (!action) return;

    // Count active touch points per button; fire key events only on first/last
    const activeTouches = new Map(); // identifier -> true

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const wasEmpty = activeTouches.size === 0;
      for (const t of e.changedTouches) activeTouches.set(t.identifier, true);
      btn.classList.add('pressed');
      if (wasEmpty) fireKey(action, 'keydown');
    }, { passive: false });

    const release = (e) => {
      for (const t of e.changedTouches) activeTouches.delete(t.identifier);
      if (activeTouches.size === 0) {
        btn.classList.remove('pressed');
        fireKey(action, 'keyup');
      }
    };

    btn.addEventListener('touchend',    release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
  }

  // Show / hide controls based on game state
  function bindVisibility(root) {
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    function update() {
      const style = window.getComputedStyle(mainEl);
      const gameRunning = style.display === 'none' || mainEl.hidden;
      root.classList.toggle('visible', gameRunning);
    }

    // Observe attribute and style changes for fast response
    const observer = new MutationObserver(update);
    observer.observe(mainEl, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    // Fallback poll at 100ms for display changes applied via stylesheet
    setInterval(update, 100);
    update();
  }

  // Bootstrap
  function init() {
    const root = buildControls();

    root.querySelectorAll('.mc-btn[data-action]').forEach(wireButton);

    // Prevent any touch on the control overlay reaching the canvas
    root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
    root.addEventListener('touchmove',  (e) => e.preventDefault(),  { passive: false });

    bindVisibility(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
