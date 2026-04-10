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

  // Track which keys are currently held so we don't double-fire keydown
  const held = new Set();

  function fireKey(action, type) {
    const k = KEY[action];
    if (!k) return;
    if (type === 'keydown' && held.has(action)) return;
    if (type === 'keydown') held.add(action);
    if (type === 'keyup') held.delete(action);

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

    // Each touch point that started on this button
    const activeTouches = new Set();

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) activeTouches.add(t.identifier);
      btn.classList.add('pressed');
      fireKey(action, 'keydown');
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

    // Poll once per second — lightweight and reliable across all browsers
    setInterval(update, 800);
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
