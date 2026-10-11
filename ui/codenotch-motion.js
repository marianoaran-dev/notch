/* Motion vocabulary adapted from Codenotch (MIT, Copyright 2026 Vinz).
   Source: https://github.com/vinzdg/codenotch/blob/main/Sources/Notch/NotchMotion.swift
   Spring integrator: windows/codenotch/ui/carry.html and ui/notch.html.
   See THIRD_PARTY_NOTICES.md for the original MIT licence and attribution. */
(function (global) {
  'use strict';
  const motionQuery = global.matchMedia('(prefers-reduced-motion: reduce)');
  const profiles = Object.freeze({
    unfold: Object.freeze({ response: 0.62, damping: 0.72 }),
    lift: Object.freeze({ response: 0.26, damping: 0.92 }),
    contents: Object.freeze({ response: 0.48, damping: 0.80 }),
    glide: Object.freeze({ response: 0.50, damping: 0.86 }),
    reading: Object.freeze({ response: 0.90, damping: 0.90 })
  });
  const active = new Map();
  const states = new Map();
  let frameId = null, lastFrame = 0;
  function enabled() { return !motionQuery.matches; }
  function paintSlot(slot) {
    if (typeof slot.paint === 'function') slot.paint(slot.value, slot.target);
  }
  function frame(timestamp) {
    frameId = null;
    const elapsed = lastFrame ? Math.min(0.034, Math.max(0.001, (timestamp - lastFrame) / 1000)) : 1 / 60;
    lastFrame = timestamp;
    for (const [key, slot] of active) {
      if (!enabled()) {
        slot.value = slot.target; slot.velocity = 0;
        paintSlot(slot); active.delete(key);
        if (slot.complete) slot.complete();
        continue;
      }
      const p = slot.profile;
      const omega = 2 * Math.PI / p.response;
      // Two half steps, as in Codenotch's Windows carry spring.
      for (let i = 0; i < 2; i++) {
        const dt = elapsed / 2;
        slot.velocity +=
          (omega * omega * (slot.target - slot.value) -
            2 * p.damping * omega * slot.velocity) * dt;
        slot.value += slot.velocity * dt;
      }
      const done = Math.abs(slot.value - slot.target) <= slot.tolerance &&
        Math.abs(slot.velocity) <= slot.velocityTolerance;
      if (done) { slot.value = slot.target; slot.velocity = 0; }
      paintSlot(slot);
      if (done) {
        active.delete(key);
        if (slot.complete) slot.complete();
      }
    }
    if (active.size) frameId = requestAnimationFrame(frame);
    else lastFrame = 0;
  }
  function request() {
    if (frameId == null && active.size) frameId = requestAnimationFrame(frame);
  }
  function snap(key, value, paint) {
    active.delete(key);
    const slot = { value, target: value, velocity: 0,
      profile: profiles.contents, paint, tolerance: 0.02, velocityTolerance: 0.10,
      complete: null };
    states.set(key, slot);
    paintSlot(slot);
    return value;
  }
  function to(key, target, preset, paint, options) {
    options = options || {};
    if (!Number.isFinite(target)) throw new TypeError('Spring target must be finite');
    if (!enabled() || options.immediate) return snap(key, target, paint);
    const profile = typeof preset === 'string' ? profiles[preset] : preset;
    if (!profile) throw new Error('Unknown motion profile: ' + preset);
    let slot = states.get(key);
    if (!slot) {
      slot = { value: options.from == null ? target : options.from,
        target, velocity: 0, profile, paint,
        tolerance: options.tolerance == null ? 0.025 : options.tolerance,
        velocityTolerance: options.velocityTolerance == null ? 0.15 : options.velocityTolerance,
        complete: options.complete || null };
      states.set(key, slot);
    } else {
      slot.target = target; slot.profile = profile; slot.paint = paint;
      slot.complete = options.complete || null;
      if (options.tolerance != null) slot.tolerance = options.tolerance;
      if (options.velocityTolerance != null) slot.velocityTolerance = options.velocityTolerance;
    }
    paintSlot(slot);
    if (Math.abs(slot.value - target) > slot.tolerance || Math.abs(slot.velocity) > slot.velocityTolerance)
      active.set(key, slot);
    else { slot.value = target; slot.velocity = 0; paintSlot(slot); if (slot.complete) slot.complete(); }
    request();
    return slot.value;
  }
  function get(key) { return states.get(key)?.value; }
  // Windows Codenotch: press fast to 0.84 and return with a single soft bounce.
  function press(element) {
    if (!element || !enabled() || typeof element.animate !== 'function') return;
    element.animate([
      { transform: 'scale(1)', easing: 'ease-out' },
      { transform: 'scale(.84)', offset: .21, easing: 'cubic-bezier(.34,1.56,.64,1)' },
      { transform: 'scale(1)' }
    ], { duration: 430 });
  }
  // Content crossfades in 160 ms, as in Codenotch NotchMotion.crossfade.
  function crossfade(element) {
    if (!element || !enabled() || typeof element.animate !== 'function') return;
    element.animate([{opacity:0.35},{opacity:1}], { duration:160, easing:'ease-in-out' });
  }
  function stagger(index) { return Math.min(index * 45, 180); }
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', () => {
    if (!enabled()) {
      for (const [key, slot] of active) {
        slot.value = slot.target; slot.velocity = 0; paintSlot(slot);
        active.delete(key);
        if (slot.complete) slot.complete();
      }
      if (frameId != null) cancelAnimationFrame(frameId);
      frameId = null; lastFrame = 0;
    }
  });
  global.CodenotchMotion = Object.freeze({
    profiles, enabled, to, snap, get, press, crossfade, stagger
  });
})(window);
