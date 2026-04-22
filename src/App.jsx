import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateStations, runIteration, rms, VP, MAX_ITER, CONV_LIMIT } from './utils/algorithm.js';
import { dist3, mean } from './utils/math.js';
import './App.css';

// ── Google Fonts
if (!document.getElementById('gfonts')) {
  const l = document.createElement('link'); l.id = 'gfonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';
  document.head.appendChild(l);
}

// ── Canvas Helpers
function drawStar(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.4;
    i === 0 ? ctx.moveTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a))
      : ctx.lineTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

function drawTri(ctx, cx, cy, size, color) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx - size * 0.866, cy + size * 0.5);
  ctx.lineTo(cx + size * 0.866, cy + size * 0.5);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

function drawMap(canvas, { stations, trueCoords, guessCoords, trail, phase, converged, currentCoords }) {
  if (!canvas || !canvas.width) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const tX = (km) => (km / 500) * W;
  const tY = (km) => H - (km / 500) * H;

  // Background Gradient
  const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W);
  bgGrad.addColorStop(0, '#111115'); bgGrad.addColorStop(1, '#050505');
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

  // Stippled Light Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
  for (let km = 0; km <= 500; km += 50) {
    ctx.beginPath(); ctx.moveTo(tX(km), 0); ctx.lineTo(tX(km), H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, tY(km)); ctx.lineTo(W, tY(km)); ctx.stroke();
    if (km > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; ctx.font = '9px Inter,sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(`${km}`, tX(km), H - 4);
      ctx.textAlign = 'left'; ctx.fillText(`${km}`, 4, tY(km) - 4);
    }
  }
  ctx.setLineDash([]);

  // Trail
  if (trail && trail.length >= 2) {
    const tc = phase === 2 ? 'rgba(59,130,246,0.6)' : 'rgba(161,161,170,0.6)';
    ctx.strokeStyle = tc; ctx.lineWidth = 1.5; ctx.setLineDash([2, 5]);
    ctx.beginPath();
    trail.forEach((pt, i) => { i === 0 ? ctx.moveTo(tX(pt[0]), tY(pt[1])) : ctx.lineTo(tX(pt[0]), tY(pt[1])); });
    ctx.stroke(); ctx.setLineDash([]);
  }

  // Stations (No labels)
  if (stations && stations.length) {
    stations.forEach(s => drawTri(ctx, tX(s.x), tY(s.y), 4, '#52525b'));
  }

  // Initial Guess (Lightly)
  if (guessCoords) {
    ctx.beginPath(); ctx.arc(tX(guessCoords[0]), tY(guessCoords[1]), 5, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(161,161,170,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // Target Crosshairs
  if (trueCoords) {
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tX(trueCoords[0]), 0); ctx.lineTo(tX(trueCoords[0]), H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, tY(trueCoords[1])); ctx.lineTo(W, tY(trueCoords[1])); ctx.stroke();
    drawStar(ctx, tX(trueCoords[0]), tY(trueCoords[1]), 6, '#ef4444');
  }

  // Current Estimate
  if (currentCoords) {
    const ex = tX(currentCoords[0]), ey = tY(currentCoords[1]);
    const glowC = converged ? '#22c55e' : '#3b82f6';
    ctx.shadowColor = glowC; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(ex, ey, converged ? 5 : 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = glowC; ctx.fill();
    ctx.shadowBlur = 0; // Reset
  }
}

// ── Depth Chart
function DepthChart({ depthHistory, trueDepth, guessDepth, phase1Count }) {
  const ref = useRef(null);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const update = () => { c.width = c.offsetWidth * (window.devicePixelRatio || 1); c.height = c.offsetHeight * (window.devicePixelRatio || 1); };
    const ro = new ResizeObserver(update); ro.observe(c);
    setTimeout(update, 50);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current; if (!c || !c.width) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.width / dpr, H = c.height / dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);

    if (!depthHistory || depthHistory.length === 0) return;

    const pL = 30, pR = 10, pT = 20, pB = 20;
    const cW = W - pL - pR, cH = H - pT - pB;
    const allD = [...depthHistory.map(d => d.z), trueDepth || 10, guessDepth || 10].filter(Boolean);
    const maxD = Math.max(...allD) * 1.25 || 20;
    const maxI = Math.max(depthHistory.length, 10);
    const tX = i => pL + (i / maxI) * cW;
    const tY = d => pT + (d / maxD) * cH;

    // Grid
    ctx.strokeStyle = '#1f1f1f'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pL, pT); ctx.lineTo(pL, pT + cH); ctx.lineTo(pL + cW, pT + cH); ctx.stroke();
    for (let d = 0; d <= maxD; d += Math.ceil(maxD / 5)) {
      ctx.beginPath(); ctx.moveTo(pL, tY(d)); ctx.lineTo(pL + cW, tY(d)); ctx.stroke();
      ctx.fillStyle = '#52525b'; ctx.font = '9px Inter'; ctx.textAlign = 'right'; ctx.fillText(d.toFixed(0), pL - 4, tY(d) + 3);
    }

    // True
    if (trueDepth != null) {
      const ty = tY(trueDepth);
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(pL, ty); ctx.lineTo(pL + cW, ty); ctx.stroke(); ctx.setLineDash([]);
    }

    // Lines Phase 1
    const p1 = depthHistory.slice(0, phase1Count);
    if (p1.length >= 2) {
      ctx.strokeStyle = '#a1a1aa'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); p1.forEach((pt, i) => i === 0 ? ctx.moveTo(tX(i + 1), tY(pt.z)) : ctx.lineTo(tX(i + 1), tY(pt.z)));
      ctx.stroke(); ctx.setLineDash([]);
    }
    // Lines Phase 2
    const p2 = depthHistory.slice(phase1Count);
    if (p2.length >= 2) {
      ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5;
      ctx.beginPath(); p2.forEach((pt, i) => { const xi = tX(phase1Count + i + 1); i === 0 ? ctx.moveTo(xi, tY(pt.z)) : ctx.lineTo(xi, tY(pt.z)); });
      ctx.stroke();
    }

    // Points
    depthHistory.forEach((pt, i) => {
      ctx.beginPath(); ctx.arc(tX(i + 1), tY(pt.z), 2, 0, 2 * Math.PI);
      ctx.fillStyle = i < phase1Count ? '#a1a1aa' : '#3b82f6'; ctx.fill();
    });
  }, [depthHistory, trueDepth, guessDepth, phase1Count]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ── Metric Box
function MetricBox({ label, value }) {
  return (
    <div className="metric-box">
      <div className="metric-lbl">{label}</div>
      <div className="metric-val">{value}</div>
    </div>
  );
}

// ── App
export default function App() {
  // Inputs
  const [trueX, setTrueX] = useState(150); const [trueY, setTrueY] = useState(150);
  const [trueZ, setTrueZ] = useState(10); const [trueT0, setTrueT0] = useState(0);
  const [guessX, setGuessX] = useState(180); const [guessY, setGuessY] = useState(180);
  const [guessZ, setGuessZ] = useState(20);

  // State
  const [stations, setStations] = useState([]); const [obsTimes, setObsTimes] = useState([]);
  const [currentCoords, setCurrentCoords] = useState(null); const [trail, setTrail] = useState([]);
  const [depthHistory, setDepthHistory] = useState([]); const [phase1Count, setPhase1Count] = useState(0);
  const [phase, setPhase] = useState(1); const [converged, setConverged] = useState(false);
  const [finalResult, setFinalResult] = useState(null); const [metrics, setMetrics] = useState({ rms: null, theta: null, stepSz: null, iter: null });
  const [logs, setLogs] = useState([]); const [paused, setPaused] = useState(false);

  // Refs
  const termRef = useRef(null); const mapRef = useRef(null);
  const invRef = useRef(null); const pausedRef = useRef(false); const timerRef = useRef(null);
  const algData = useRef({ stations: [], obsTimes: [] });
  const mapStateRef = useRef({});

  // Logging
  const tStr = () => new Date().toISOString().substring(11, 19);
  const addLog = useCallback((lvl, msg) => setLogs(p => [...p, { t: tStr(), lvl, msg }]), []);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [logs]);

  const animRef = useRef(null);
  const visualCoordsRef = useRef(null);

  // Map Drawing
  mapStateRef.current = { stations, trueCoords: [trueX, trueY, trueZ], trail, phase, converged, currentCoords, guessCoords: [guessX, guessY, guessZ] };

  const redraw = useCallback(() => {
    const state = { ...mapStateRef.current };
    if (visualCoordsRef.current) state.currentCoords = visualCoordsRef.current;
    drawMap(mapRef.current, state);
  }, []);

  // Visual tweening loop to make jumps smooth and cinematic
  useEffect(() => {
    if (!currentCoords) { visualCoordsRef.current = null; redraw(); return; }
    if (!visualCoordsRef.current) { visualCoordsRef.current = [...currentCoords]; redraw(); return; }

    const startC = [...visualCoordsRef.current];
    const targetC = [...currentCoords];
    const duration = 450; //ms
    const startT = performance.now();

    const animate = (now) => {
      let p = (now - startT) / duration; if (p > 1) p = 1;
      const ease = 1 - Math.pow(1 - p, 4); // Quartic ease out
      visualCoordsRef.current = [
        startC[0] + (targetC[0] - startC[0]) * ease,
        startC[1] + (targetC[1] - startC[1]) * ease,
        startC[2] + (targetC[2] - startC[2]) * ease,
      ];
      redraw();
      if (p < 1) animRef.current = requestAnimationFrame(animate);
    };

    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(animate);

    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [currentCoords, redraw]);

  useEffect(() => { redraw(); }, [stations, trueX, trueY, guessX, guessY, trail, phase, converged, redraw]);
  useEffect(() => {
    const canvas = mapRef.current; if (!canvas) return; const dpr = window.devicePixelRatio || 1;
    const update = () => { canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr; redraw(); };
    const ro = new ResizeObserver(update); ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  // Generators & Loop
  const handleGenerate = useCallback(() => {
    const { stations: st, obsTimes: ot } = generateStations([trueX, trueY, trueZ], trueT0);
    algData.current = { stations: st, obsTimes: ot };
    setStations(st); setObsTimes(ot);
    setTrail([]); setDepthHistory([]); setPhase1Count(0); setCurrentCoords(null);
    setConverged(false); setFinalResult(null); setLogs([]); setPhase(1);
  }, [trueX, trueY, trueZ, trueT0]);

  // Instantly regenerate stations when TRUE sliders change so visualization matches math
  useEffect(() => { handleGenerate(); }, [handleGenerate]);

  const tickRef = useRef(null);
  tickRef.current = () => {
    if (pausedRef.current) return;
    timerRef.current = setTimeout(() => {
      const inv = invRef.current; if (!inv) return;
      const { stations: sts, obsTimes: obs } = algData.current;
      if (!sts.length) return;

      const df = inv.currentPhase === 1;
      let res; try { res = runIteration(inv.bestCoords, inv.bestT0, inv.bestRms, inv.thetaSq, inv.succInc, sts, obs, df); }
      catch (e) { addLog('WARN', `Error: ${e.message}`); return; }

      inv.iterNum++;
      res.iterLog.forEach(l => addLog(l.level, l.msg));

      if (res.accepted) {
        inv.bestCoords = res.testCoords; inv.bestT0 = res.testT0; inv.bestRms = res.testRms; inv.succInc = 0;
      } else { inv.succInc = res.successiveIncreases; }
      inv.thetaSq = res.thetaSq;

      setCurrentCoords([...res.testCoords]); setTrail(p => [...p, [...res.testCoords]]);
      setDepthHistory(p => [...p, { z: res.testCoords[2], iter: inv.iterNum }]);
      setMetrics({ rms: res.testRms, theta: res.thetaSq, stepSz: res.stepSize, iter: inv.iterNum });

      const phaseOver = res.successiveIncreases >= 5 || (res.accepted && res.stepSize < CONV_LIMIT) || inv.iterNum >= MAX_ITER;
      if (phaseOver) {
        if (inv.currentPhase === 1) {
          inv._p1 = inv.iterNum; setPhase1Count(inv.iterNum);
          inv.currentPhase = 2; inv.thetaSq = 2.0; inv.succInc = 0; setPhase(2);
          addLog('INFO', 'Phase 2: Depth Free');
          tickRef.current();
        } else {
          setConverged(true);
          setFinalResult({
            trueX: inv._tX, trueY: inv._tY, trueZ: inv._tZ, trueT0: inv._tT0,
            calcX: inv.bestCoords[0], calcY: inv.bestCoords[1], calcZ: inv.bestCoords[2], calcT0: inv.bestT0,
            rms: inv.bestRms, iters: inv.iterNum, p1: inv._p1 || 0, p2: inv.iterNum - (inv._p1 || 0)
          });
          addLog('DONE', 'Converged.');
        }
        return;
      }
      if (!pausedRef.current) tickRef.current();
    }, 500); // Fixed 0.5s delay
  };

  const handleStart = useCallback(() => {
    const { stations: sts, obsTimes: obs } = algData.current;
    if (!sts.length) return;
    pausedRef.current = false; setPaused(false); setConverged(false); setFinalResult(null);
    setTrail([[guessX, guessY, guessZ]]); setDepthHistory([]); setPhase1Count(0); setPhase(1);

    const c0 = [guessX, guessY, guessZ];
    const d0 = sts.map(s => dist3(c0, [s.x, s.y, s.z]));
    const t0_0 = mean(obs) - mean(d0.map(d => d / VP));
    const rms0 = rms(obs.map((o, i) => o - (t0_0 + d0[i] / VP)));

    invRef.current = { bestCoords: c0, bestT0: t0_0, bestRms: rms0, thetaSq: 2.0, succInc: 0, iterNum: 0, currentPhase: 1, _tX: trueX, _tY: trueY, _tZ: trueZ, _tT0: trueT0 };
    setCurrentCoords([...c0]); setMetrics({ rms: rms0, theta: 2.0, stepSz: 0, iter: 0 });
    addLog('INFO', `Phase 1 started | rms=${rms0.toFixed(4)}`);
    tickRef.current();
  }, [guessX, guessY, guessZ, trueX, trueY, trueZ, trueT0, addLog]);

  const handlePause = () => {
    if (paused) { pausedRef.current = false; setPaused(false); tickRef.current(); }
    else { pausedRef.current = true; setPaused(true); clearTimeout(timerRef.current); }
  };

  const SliderRow = ({ lbl, val, set, min, max, fixed = 0 }) => (
    <div className="slider-row">
      <div className="slider-labels"><span>{lbl}</span><span className="mono text-white">{val.toFixed(fixed)}</span></div>
      <input type="range" className="range-input" min={min} max={max} step={fixed === 0 ? 1 : 0.1} value={val} onChange={e => set(parseFloat(e.target.value))} />
    </div>
  );

  return (
    <div className="layout">
      {/* ── LEFT PANE (40%) ── */}
      <div className="left-pane">

        {/* Header / Attribution */}
        <div className="flex justify-between items-baseline px-2 pb-2">
          <div className="text-white tracking-widest text-xs font-bold uppercase">Seismic Inversion HUD</div>
          <div className="text-secondary mono text-[9px] uppercase">Made by Ayush, Devendra & Suryansh</div>
        </div>

        {/* Controls */}
        <div className="panel" style={{ flexShrink: 0 }}>
          <div className="panel-header">Settings & Controls</div>
          <div className="p-3 flex flex-col gap-3">
            <div className="text-secondary text-xs uppercase tracking-widest mb-1">True Hypocenter</div>
            <div className="grid-2">
              <SliderRow lbl="X (km)" val={trueX} set={setTrueX} min={10} max={490} />
              <SliderRow lbl="Y (km)" val={trueY} set={setTrueY} min={10} max={490} />
              <SliderRow lbl="Z (km)" val={trueZ} set={setTrueZ} min={1} max={40} />
              <SliderRow lbl="t₀ (s)" val={trueT0} set={setTrueT0} min={0} max={100} />
            </div>
            <div className="divider" />
            <div className="text-secondary text-xs uppercase tracking-widest mb-1">Initial Guess</div>
            <div className="grid-2">
              <SliderRow lbl="Guess X" val={guessX} set={setGuessX} min={10} max={490} />
              <SliderRow lbl="Guess Y" val={guessY} set={setGuessY} min={10} max={490} />
              <SliderRow lbl="Guess Z" val={guessZ} set={setGuessZ} min={1} max={40} />
              <div className="flex items-end"><button className="btn btn-blue w-full" disabled={!stations.length} onClick={handleStart}>START INVERSION</button></div>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="panel" style={{ flexShrink: 0 }}>
          <div className="panel-header flex justify-between">
            <span>Live Telemetry</span>
            <div className="flex gap-2">
              <button className="btn-sm" onClick={handlePause}>{paused ? 'RESUME' : 'PAUSE'}</button>
            </div>
          </div>

          <div className="pt-2 px-6 flex flex-col gap-2">
            <div className="flex justify-between items-center bg-[#050505] py-2 px-3 border border-[#18181b] rounded text-xs mono">
              <span className="text-secondary uppercase tracking-widest text-[10px]">True Target</span>
              <span className="text-[#ef4444] font-medium">{trueX.toFixed(2)}, {trueY.toFixed(2)}, {trueZ.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center bg-[#050505] py-2 px-3 border border-[#18181b] rounded text-xs mono">
              <span className="text-secondary uppercase tracking-widest text-[10px]">Algorithm Est</span>
              <span className={converged ? "text-[#22c55e] font-medium" : "text-[#3b82f6] font-medium"}>
                {currentCoords ? `${currentCoords[0].toFixed(2)}, ${currentCoords[1].toFixed(2)}, ${currentCoords[2].toFixed(2)}` : 'Awaiting...'}
              </span>
            </div>
          </div>

          <div className="p-2 pt-1 metrics-grid">
            <MetricBox label="RMS Error" value={metrics.rms != null ? metrics.rms.toFixed(6) : '—'} />
            <MetricBox label="Iteration" value={metrics.iter != null ? metrics.iter : '—'} />
            <MetricBox label="Damping θ²" value={metrics.theta != null ? metrics.theta.toExponential(2) : '—'} />
            <MetricBox label="Step Size ‖dX‖" value={metrics.stepSz != null ? metrics.stepSz.toFixed(3) : '—'} />
          </div>
        </div>

        {/* Depth Chart Square */}
        <div className="panel flex-1 min-h-0">
          <div className="panel-header">Depth Convergence</div>
          <div className="flex-1 w-full h-full flex items-center justify-center p-3">
            <div className="square-wrapper">
              <DepthChart depthHistory={depthHistory} trueDepth={trueZ} guessDepth={guessZ} phase1Count={phase1Count} />
            </div>
          </div>
        </div>

      </div>

      {/* ── RIGHT PANE (60%) ── */}
      <div className="right-pane">

        {/* Map Area */}
        <div className="panel flex-1 min-h-0 map-panel">
          <div className="panel-header">2D Epicenter Map</div>
          <div className="flex-1 flex flex-row min-h-0 relative">
            <div className="flex-1 flex items-center justify-center p-3 min-w-0 min-h-0 border-r border-[#27272a]">
              <div className="square-wrapper bg-black border border-[#27272a] rounded">
                <canvas ref={mapRef} style={{ width: '100%', height: '100%', display: 'block' }} />
              </div>
            </div>

            {/* Legend */}
            <div className="w-[140px] p-4 flex flex-col gap-3 text-xs text-secondary shrink-0">
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded bg-[#ef4444] shadow-[0_0_8px_#ef4444]" /><span>True Hypo</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 border border-[#a1a1aa] rounded-full" /><span>Initial Guess</span></div>
              <div className="flex items-center gap-2">
                <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[7px] border-l-transparent border-r-transparent border-b-[#52525b]" />
                <span>Station</span>
              </div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded bg-[#3b82f6]" /><span>Estimate</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-1 border-b border-dashed border-[#3b82f6]" /><span>Path</span></div>
              <div className="mt-auto opacity-50 text-[10px]">Scale: 0–500 km</div>
            </div>
          </div>
        </div>

        {/* Bottom Panel: Logs or Results + Stations */}
        <div className="flex h-[35%] gap-3 shrink-0">
          {finalResult && (
            <div className="panel w-[25%] shrink-0 animate-slide">
              <div className="panel-header text-[#22c55e]">Result Details</div>
              <div className="p-3 overflow-auto">
                <table className="w-full text-[10px] text-left mb-3">
                  <thead><tr className="text-secondary border-b border-[#27272a]"><th className="pb-1 text-left">Param</th><th className="pb-1 text-right">True</th><th className="pb-1 text-right">Calc</th><th className="pb-1 text-right">Err</th></tr></thead>
                  <tbody className="mono text-[#a1a1aa]">
                    <tr className="border-b border-[#18181b]"><td className="py-1 text-left">X</td><td className="text-right">{finalResult.trueX.toFixed(2)}</td><td className="text-white text-right">{finalResult.calcX.toFixed(2)}</td><td className="text-secondary text-right">{Math.abs(finalResult.trueX - finalResult.calcX).toFixed(3)}</td></tr>
                    <tr className="border-b border-[#18181b]"><td className="py-1 text-left">Y</td><td className="text-right">{finalResult.trueY.toFixed(2)}</td><td className="text-white text-right">{finalResult.calcY.toFixed(2)}</td><td className="text-secondary text-right">{Math.abs(finalResult.trueY - finalResult.calcY).toFixed(3)}</td></tr>
                    <tr className="border-b border-[#18181b]"><td className="py-1 text-left">Z</td><td className="text-right">{finalResult.trueZ.toFixed(2)}</td><td className="text-white text-right">{finalResult.calcZ.toFixed(2)}</td><td className="text-secondary text-right">{Math.abs(finalResult.trueZ - finalResult.calcZ).toFixed(3)}</td></tr>
                    <tr className="border-b border-[#18181b]"><td className="py-1 text-left">t₀</td><td className="text-right">{finalResult.trueT0.toFixed(2)}</td><td className="text-white text-right">{finalResult.calcT0.toFixed(2)}</td><td className="text-secondary text-right">{Math.abs(finalResult.trueT0 - finalResult.calcT0).toFixed(3)}</td></tr>
                  </tbody>
                </table>
                <div className="text-[10px] text-secondary">Final RMS: <span className="mono text-white text-xs">{finalResult.rms.toFixed(6)}</span></div>
              </div>
            </div>
          )}
          <div className={`panel min-w-0 ${finalResult ? 'w-[50%]' : 'flex-1'}`}>
            <div className="panel-header flex justify-between">
              <span>Terminal</span>
              <div className="text-[10px] cursor-pointer" onClick={() => setLogs([])}>CLEAR</div>
            </div>
            <div className="flex-1 p-2 bg-[#050505] overflow-y-auto mono text-[10px] leading-relaxed" ref={termRef}>
              {logs.length === 0 ? <span className="text-secondary">Waiting...</span> : logs.map((l, i) => (
                <div key={i} className="flex gap-2 animate-log">
                  <span className="text-[#3f3f46] shrink-0">[{l.t}]</span>
                  <span className="text-white w-10 shrink-0">[{l.lvl}]</span>
                  <span className="text-[#a1a1aa] whitespace-pre-wrap">{l.msg}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={`panel shrink-0 ${finalResult ? 'w-[25%]' : 'w-[30%]'}`}>
            <div className="panel-header">Stations ({stations.length})</div>
            <div className="flex-1 overflow-y-auto" style={{ paddingLeft: '10px', paddingRight: '10px' }}>
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-[#0a0a0b] text-left"><tr className="text-secondary border-b border-[#27272a]"><th className="p-2">#</th><th>X</th><th>Y</th><th>t (s)</th></tr></thead>
                <tbody className="mono text-[#a1a1aa] text-left">
                  {stations.map((s, i) => (
                    <tr key={s.id} className="border-b border-[#18181b]"><td className="p-2 text-secondary">{s.id}</td><td>{s.x.toFixed(1)}</td><td>{s.y.toFixed(1)}</td><td>{(obsTimes[i] || 0).toFixed(2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

      </div>
    </div >
  );
}
