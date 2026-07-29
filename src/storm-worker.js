// src/storm-worker.js
// OffscreenCanvas worker that renders the storm (Canvas2D fallback) off the main thread.
// Receives an OffscreenCanvas via postMessage {type:'init', canvas, width, height, cfg}

let canvas = null;
let ctx = null;
let w = 0, h = 0, dpr = 1;
let running = false;
let rafId = null;

// Pools & state (similar to main-thread engine but simplified)
function rand(min,max){return Math.random()*(max-min)+min}
function createPool(n){ const a=new Array(n); for(let i=0;i<n;i++) a[i]={x:0,y:0,len:0,speed:0,alpha:0,w:0}; return a; }
let rainLayers = [];
let lightningBolts = [];
let splashes = [];
let flash = { alpha:0 };
let intensity = 1.0;
let lastLightningAttempt=0, nextLightningDelay=0;
let CONFIG = null;

function resetParticle(layer, p, initial){ const cfg = layer.cfg; p.x = rand(-60, w+60); p.y = initial? rand(-h,h) : rand(-140,-6); p.len = rand(cfg.length[0], cfg.length[1]); p.speed = rand(cfg.speed[0], cfg.speed[1]); p.alpha = rand(cfg.alpha[0], cfg.alpha[1]); p.w = Math.max(0.6,0.85*cfg.z + rand(0.1,1.6)); }

function buildPools(){ rainLayers.length=0; const area100k=(w*h)/100000; CONFIG.rain.layers.forEach(cfg=>{ const count = Math.min(Math.max(4, Math.floor(cfg.countPer100k * area100k * cfg.z * CONFIG.rain.intensity * intensity)), CONFIG.performance.maxFlakesTotal); const pool = createPool(count); for(let i=0;i<count;i++) resetParticle({cfg,pool,poolSize:count}, pool[i], true); rainLayers.push({cfg,pool,poolSize:count}); }); }

function buildBolt(x0,y0,x1,y1,depth){ const dx=x1-x0, dy=y1-y0, dist=Math.hypot(dx,dy); const steps=Math.max(6, Math.floor(dist/10)); const segs=[]; for(let i=1;i<=steps;i++){ const t=i/steps; let cx=x0+dx*t, cy=y0+dy*t; const offset=(Math.sin(t*Math.PI)*(dist*0.08))*(rand(-1,1)); const nx=-dy/dist||0, ny=dx/dist||0; cx += nx*offset; cy += ny*offset; segs.push({x:cx,y:cy,t}); if(depth>0 && Math.random() < CONFIG.lightning.branchChance){ const branchLen=rand(0.12,0.45)*dist; const angle = Math.atan2(dy,dx)+rand(-1.4,1.4); const bx=cx+Math.cos(angle)*branchLen; const by=cy+Math.sin(angle)*branchLen; lightningBolts.push({segments: buildBolt(cx,cy,bx,by,depth-1), life:0.06+Math.random()*0.14, thickness: Math.max(0.6, CONFIG.lightning.mainStrokeWidth*Math.pow(0.66, depth))}); } } return segs; }

function createLightningStrike(major=false){ const startX = rand(0.08*w,0.92*w); const startY = rand(0,0.08*h); const endX = rand(0.12*w,0.88*w); const endY = rand(0.35*h,0.95*h); const main = buildBolt(startX,startY,endX,endY, CONFIG.lightning.branchDepth); lightningBolts.push({segments:[{x:startX,y:startY}, ...main], life:0.08 + rand(0.06,0.22), thickness: CONFIG.lightning.mainStrokeWidth * (major?1.6:1.0)}); if(major){ flash.alpha = Math.max(flash.alpha, CONFIG.lightning.flashMax * rand(0.8,1.0)); // notify main thread so it can play thunder / camera shake
    postMessage({type:'strike', severity: 0.9 + Math.random()*0.6}); // severity 0..1
    // extras
    const extras = 1 + Math.floor(rand(0,3)); for(let i=0;i<extras;i++) setTimeout(()=>createLightningStrike(Math.random()<0.5), rand(60,420)); } else { flash.alpha = Math.max(flash.alpha, 0.12 * rand(0.4,1.0)); postMessage({type:'strike', severity: 0.3 + Math.random()*0.4}); } }

function scheduleNextLightning(){ const [l,hv] = CONFIG.lightning.baseInterval; const base = rand(l,hv); nextLightningDelay = base * (1 - 0.5*intensity); lastLightningAttempt = performance.now(); }

function tryLightning(nowTs){ if(nowTs - lastLightningAttempt < nextLightningDelay) return; if(Math.random() < 0.22 * intensity){ const major = Math.random() < 0.28*intensity; if(Math.random() < CONFIG.lightning.burstChance*intensity){ const burst = 2 + Math.floor(rand(1,4)*intensity); for(let i=0;i<burst;i++) setTimeout(()=>createLightningStrike(Math.random()<0.5||major), rand(i*40, i*180+60)); } else createLightningStrike(major); } scheduleNextLightning(); }

function updateRain(dt){ const angle = CONFIG.rain.angle; rainLayers.forEach(layer=>{ const pool = layer.pool; const z = layer.cfg.z; for(let i=0;i<layer.poolSize;i++){ const p = pool[i]; p.x += Math.cos(angle) * p.speed * dt * z * intensity; p.y += Math.sin(angle) * p.speed * dt * z * intensity; if(p.y > h + 120 || p.x > w + 120 || p.x < -240){ if(p.y > h - 12 && Math.random() < 0.22) spawnSplash(Math.min(Math.max(4, p.x), w-4), h - 10, Math.min(1, p.speed/900)); resetParticle(layer, p, false); } } }); }

function spawnSplash(x,y,intensityScale){ splashes.push({x,y,r:rand(6,22)*intensityScale,alpha:1,life:0.32 + Math.random()*0.5}); }
function updateSplashes(dt){ for(let i=splashes.length-1;i>=0;i--){ const s=splashes[i]; s.life -= dt; s.alpha = Math.max(0, s.life*2); s.r += 32*dt; if(s.life<=0) splashes.splice(i,1); } }

function drawRain(){ rainLayers.forEach(layer=>{ const pool = layer.pool; const z = layer.cfg.z; for(let i=0;i<layer.poolSize;i++){ const p = pool[i]; const dx = Math.cos(CONFIG.rain.angle) * p.len; const dy = Math.sin(CONFIG.rain.angle) * p.len; ctx.save(); ctx.globalAlpha = Math.min(1, p.alpha) * (0.8 + z*0.2); if(z>0.9){ ctx.shadowColor='rgba(176,118,255,0.08)'; ctx.shadowBlur = 10; } ctx.lineWidth = Math.max(1, p.w); const g = ctx.createLinearGradient(p.x, p.y, p.x+dx, p.y+dy); g.addColorStop(0, `rgba(170,180,255,${0.06 * p.alpha})`); g.addColorStop(0.6, `rgba(200,210,255,${0.28 * p.alpha})`); g.addColorStop(1, `rgba(240,245,255,${0.86 * p.alpha})`); ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x+dx, p.y+dy); ctx.stroke(); ctx.restore(); } }); }

function drawSplashes(){ if(!splashes.length) return; ctx.save(); ctx.globalCompositeOperation = 'lighter'; for(const s of splashes){ ctx.beginPath(); ctx.strokeStyle = `rgba(220,200,255,${0.32 * s.alpha})`; ctx.lineWidth = 1.4; ctx.arc(s.x, s.y, s.r*0.5, 0, Math.PI*2); ctx.stroke(); } ctx.restore(); }

function drawBolts(dt){ if(!lightningBolts.length) return; ctx.save(); ctx.globalCompositeOperation='lighter'; for(let i=lightningBolts.length-1;i>=0;i--){ const bolt=lightningBolts[i]; bolt.life -= dt; const lf = Math.max(0, bolt.life/0.3); const alpha = Math.pow(lf,0.6); ctx.lineJoin='round'; ctx.lineCap='round'; ctx.strokeStyle = CONFIG.lightning.outerGlow; ctx.lineWidth = (bolt.thickness*8)*(0.6+lf*0.6); ctx.shadowBlur=22; ctx.shadowColor=CONFIG.lightning.outerGlow; drawBoltPath(bolt.segments, alpha*0.18); ctx.strokeStyle = CONFIG.lightning.midGlow; ctx.lineWidth = (bolt.thickness*4)*(0.6+lf*0.4); ctx.shadowBlur=12; ctx.shadowColor=CONFIG.lightning.midGlow; drawBoltPath(bolt.segments, alpha*0.26); ctx.strokeStyle = CONFIG.lightning.innerGlow; ctx.lineWidth = Math.max(1.2, bolt.thickness*2)*(0.8+lf*0.4); ctx.shadowBlur=8; ctx.shadowColor=CONFIG.lightning.innerGlow; drawBoltPath(bolt.segments, alpha*0.34); ctx.strokeStyle = CONFIG.lightning.coreColor; ctx.lineWidth = Math.max(0.8, bolt.thickness*0.8); ctx.shadowBlur=0; drawBoltPath(bolt.segments, alpha*0.95); if(bolt.life <= 0) lightningBolts.splice(i,1); } ctx.restore(); }
function drawBoltPath(pts, alpha){ if(!pts||pts.length<2) return; ctx.globalAlpha = alpha; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for(let i=1;i<pts.length;i++){ ctx.lineTo(pts[i].x, pts[i].y); } ctx.stroke(); }

// Main loop
let lastTs = 0;
function loop(ts){ if(!running) return; const dt = Math.min(0.06, Math.max(0.0001, (ts - lastTs)/1000 || (1/60))); updateRain(dt); updateSplashes(dt); tryLightning(ts); flash.alpha = Math.max(0, flash.alpha - dt * 1.8); ctx.clearRect(0,0,w,h); drawRain(); drawSplashes(); drawBolts(dt); if(flash.alpha > 0.003) drawFlash(flash.alpha); lastTs = ts; rafId = self.requestAnimationFrame(loop); }

function drawFlash(alpha){ if(alpha <= 0.003) return; ctx.save(); ctx.globalCompositeOperation='lighter'; const cx = w * rand(0.28,0.72); const cy = h * rand(0.08,0.52); const r = Math.max(w,h) * 0.9; const g = ctx.createRadialGradient(cx,cy,20,cx,cy,r); g.addColorStop(0, `rgba(255,255,255,${0.85*alpha})`); g.addColorStop(0.12, `rgba(233,213,255,${0.42*alpha})`); g.addColorStop(0.22, `rgba(192,132,252,${0.28*alpha})`); g.addColorStop(1, `rgba(0,0,0,0)`); ctx.fillStyle = g; ctx.fillRect(0,0,w,h); ctx.restore(); }

// Message handling
self.onmessage = function(e){ const m = e.data; if(!m || !m.type) return; if(m.type === 'init'){ canvas = m.canvas; CONFIG = m.cfg || m.defaultCfg; w = m.width || canvas.width; h = m.height || canvas.height; // ensure canvas size correct
    ctx = canvas.getContext('2d'); // use 2D on worker for broad compatibility
    running = true; buildPools(); scheduleNextLightning(); lastTs = performance.now(); rafId = self.requestAnimationFrame(loop); }
  else if(m.type === 'resize'){ if(m.width && m.height){ w = m.width; h = m.height; canvas.width = m.width; canvas.height = m.height; ctx.setTransform(1,0,0,1,0,0); buildPools(); } }
  else if(m.type === 'setIntensity'){ intensity = m.value; buildPools(); }
  else if(m.type === 'stop'){ running = false; if(rafId) { self.cancelAnimationFrame(rafId); rafId = null; } ctx && ctx.clearRect(0,0,w,h); }
};

// end worker
