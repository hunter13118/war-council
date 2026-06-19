/**
 * WCSfx — Animal Crossing-style babble for the War Council dashboards.
 *
 * Extracted from war-table.html's babble system so other pages (Command
 * Center's Dialogue Theatre) get the talking noises too.
 *
 * Usage:
 *   <script src="assets/sfx.js"></script>
 *   WCSfx.tick(char, basePitch)   // call per typewriter character
 *   WCSfx.speech(text, basePitch) // full babble "sentence" (returns Promise)
 *   WCSfx.setEnabled(bool)        // persisted in localStorage('wc-sfx')
 */
(function () {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) { window.WCSfx = { enabled: false, tick() {}, speech() { return Promise.resolve(); }, setEnabled() {} }; return; }

  let ctx = null;
  let enabled = localStorage.getItem('wc-sfx') !== '0'; // on by default

  function ensureCtx() {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Browsers require a user gesture before audio — resume on first interaction.
  ['click', 'keydown', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, () => { if (enabled) ensureCtx(); }, { once: true, passive: true }),
  );

  /** One babble blip — short triangle chirp with a tiny downward glide. */
  function blip(pitch, duration = 0.055, volume = 0.09) {
    const c = ensureCtx();
    if (c.state !== 'running') return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, pitch * 0.82), c.currentTime + duration);
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration + 0.01);
  }

  let speechTimer = null;

  window.WCSfx = {
    get enabled() { return enabled; },
    setEnabled(v) {
      enabled = !!v;
      localStorage.setItem('wc-sfx', enabled ? '1' : '0');
      if (enabled) ensureCtx(); else if (speechTimer) { clearTimeout(speechTimer); speechTimer = null; }
    },
    /** Per-character babble for typewriters. Skips spaces, thins density. */
    tick(char, basePitch = 350) {
      if (!enabled || !char || char === ' ' || char === '\n') return;
      if (Math.random() < 0.5) return; // every other char, roughly — denser sounds robotic
      blip(basePitch + (Math.random() - 0.5) * 150);
    },
    /** Full babble "sentence" — one blip per syllable-ish. Resolves when done. */
    speech(text, basePitch = 350) {
      if (!enabled || !text) return Promise.resolve();
      const syllables = Math.min(60, Math.max(3, Math.round(text.length / 4)));
      return new Promise((resolve) => {
        let i = 0;
        const next = () => {
          if (i >= syllables || !enabled) { speechTimer = null; resolve(); return; }
          blip(basePitch + (Math.random() - 0.5) * 170, 0.05 + Math.random() * 0.03);
          i++;
          speechTimer = setTimeout(next, 45 + Math.random() * 50);
        };
        next();
      });
    },
  };
})();
