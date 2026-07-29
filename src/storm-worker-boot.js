// src/storm-worker-boot.js
// Boot script (main-thread) that transfers the canvas to the worker and wires up audio & UI responses.
(function(){
  // Config for the worker (kept minimal; worker has defaults too)
  const WORKER_CFG = {
    rain: { angleDegrees: 18 },
    lightning: {}
  };

  function initWorker(canvasEl){
    if (!window.OffscreenCanvas) {
      console.warn('OffscreenCanvas not supported — worker fallback unavailable.');
      return null;
    }
    try {
      const off = canvasEl.transferControlToOffscreen();
      const worker = new Worker('src/storm-worker.js');
      const w = canvasEl.clientWidth;
      const h = canvasEl.clientHeight;
      worker.postMessage({ type: 'init', canvas: off, width: w, height: h, cfg: WORKER_CFG }, [off]);
      // resize handler
      window.addEventListener('resize', () => {
        try { worker.postMessage({ type: 'resize', width: canvasEl.clientWidth, height: canvasEl.clientHeight }); } catch(e) {}
      }, { passive: true });

      // Listen for 'strike' messages to play thunder and shake UI
      worker.onmessage = function(e){
        const m = e.data;
        if (!m || !m.type) return;
        if (m.type === 'strike'){
          // m: { type:'strike', severity:..., distance:0..1 (0=top,1=bottom), x:..., y:... }
          const sev = Math.max(0, Math.min(1, m.severity || 0.6));
          const distance = (typeof m.distance === 'number') ? Math.max(0, Math.min(1, m.distance)) : 0.5;
          // schedule thunder audio with a realistic delay: further => later
          const delay = 0.08 + distance * 1.4; // seconds
          // ensure AudioManager is initialized (user gesture may be required to hear sounds)
          try { if (window.AudioManager && typeof window.AudioManager.playThunder === 'function') {
              // play with a small delay using WebAudio internal scheduling
              window.AudioManager.playThunder(sev, distance);
          } }
          catch(err){ console.warn('AudioManager playback error', err); }
          // camera shake
          try { doUICameraShake(Math.max(4, Math.round(10 * sev)), 260 + Math.round(320 * sev)); } catch(e){}
        }
      };

      return worker;
    } catch (err){ console.error('Failed to init storm worker', err); return null; }
  }

  // Simple camera shake applied to .glass-container
  function doUICameraShake(strength = 8, duration = 420){
    const glass = document.getElementById('glassContainer');
    if (!glass) return;
    glass.classList.add('shake');
    const start = performance.now();
    const iv = setInterval(()=>{
      const t = performance.now() - start; if (t >= duration) { clearInterval(iv); glass.classList.remove('shake'); glass.style.transform = ''; return; }
      const pct = 1 - (t/duration);
      const x = (Math.random()*2-1) * strength * pct;
      const y = (Math.random()*2-1) * (strength*0.4) * pct;
      const r = (Math.random()*2-1) * 0.6 * pct;
      glass.style.transform = `translate(${x}px, ${-Math.abs(y)}px) rotate(${r}deg)`;
    }, 16);
  }

  // Auto-boot: find #stormCanvas and start worker if supported
  window.addEventListener('load', ()=>{
    const canvas = document.getElementById('stormCanvas');
    if (!canvas) return;
    // ensure AudioManager is available
    if (window.AudioManager && typeof window.AudioManager.init === 'function') window.AudioManager.init();
    const worker = initWorker(canvas);
    // expose handle
    window.StormWorker = { worker };
  });
})();
