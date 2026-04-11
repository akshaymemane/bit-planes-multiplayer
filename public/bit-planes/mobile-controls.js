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
      <!-- Left: Virtual joystick -->
      <div class="mc-joystick">
        <div class="mc-joystick-knob"></div>
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

  // Virtual joystick: slide thumb to steer and throttle simultaneously
  function wireJoystick(container) {
    const knob = container.querySelector('.mc-joystick-knob');
    const MAX_TRAVEL = 42; // px from center
    const THRESHOLD  = 14; // px before a key activates

    let activeKeys = new Set();
    let touchId    = null;

    function setKey(action, shouldBeActive) {
      const isActive = activeKeys.has(action);
      if (shouldBeActive && !isActive) {
        activeKeys.add(action);
        fireKey(action, 'keydown');
      } else if (!shouldBeActive && isActive) {
        activeKeys.delete(action);
        fireKey(action, 'keyup');
      }
    }

    function applyPosition(rawDx, rawDy) {
      // Clamp knob to circular boundary
      const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
      const scale = dist > MAX_TRAVEL ? MAX_TRAVEL / dist : 1;
      const dx = rawDx * scale;
      const dy = rawDy * scale;

      knob.style.transform = `translate(${dx}px, ${dy}px)`;

      setKey('up',    dy < -THRESHOLD);
      setKey('down',  dy >  THRESHOLD);
      setKey('left',  dx < -THRESHOLD);
      setKey('right', dx >  THRESHOLD);
    }

    function releaseAll() {
      for (const action of activeKeys) fireKey(action, 'keyup');
      activeKeys.clear();
      knob.style.transform = 'translate(0, 0)';
      touchId = null;
    }

    function getCenter() {
      const r = container.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }

    container.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (touchId !== null) return;
      const t = e.changedTouches[0];
      touchId = t.identifier;
      const { cx, cy } = getCenter();
      applyPosition(t.clientX - cx, t.clientY - cy);
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== touchId) continue;
        const { cx, cy } = getCenter();
        applyPosition(t.clientX - cx, t.clientY - cy);
        break;
      }
    }, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === touchId) { releaseAll(); break; }
      }
    };
    container.addEventListener('touchend',    end, { passive: false });
    container.addEventListener('touchcancel', end, { passive: false });
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

    wireJoystick(root.querySelector('.mc-joystick'));
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
