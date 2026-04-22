/** Draw grid lines every 50km and axis labels */
export function drawGrid(ctx, W, H) {
  const toC = (km) => (km / 300) * W;
  ctx.strokeStyle = '#111d33';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#6b7fa3';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  for (let km = 0; km <= 300; km += 50) {
    const x = toC(km);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    if (km > 0) ctx.fillText(`${km}`, x, H - 4);
    const y = H - toC(km);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    if (km > 0) { ctx.textAlign = 'right'; ctx.fillText(`${km}`, 26, y + 4); ctx.textAlign = 'center'; }
  }
}

/** Draw 5-pointed star */
export function drawStar(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.4;
    i === 0 ? ctx.moveTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle))
            : ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Draw upward triangle for station */
export function drawTriangle(ctx, cx, cy, size, color) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx - size * 0.866, cy + size * 0.5);
  ctx.lineTo(cx + size * 0.866, cy + size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Full canvas redraw */
export function redrawMap(canvas, state, animPos) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const toX = (km) => (km / 300) * W;
  const toY = (km) => H - (km / 300) * H;

  // Background
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, W, H);

  drawGrid(ctx, W, H);

  const { stations, trueCoords, guessCoords, trail, phase, converged } = state;

  // Trail
  if (trail && trail.length > 1) {
    const trailColor = phase === 2 ? 'rgba(124,58,237,0.35)' : 'rgba(0,200,255,0.3)';
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    trail.forEach((pt, i) => {
      const px = toX(pt[0]), py = toY(pt[1]);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    trail.forEach((pt) => {
      ctx.beginPath();
      ctx.arc(toX(pt[0]), toY(pt[1]), 2, 0, 2 * Math.PI);
      ctx.fillStyle = trailColor;
      ctx.fill();
    });
  }

  // Stations
  if (stations) {
    stations.forEach((s, i) => {
      const sx = toX(s.x), sy = toY(s.y);
      drawTriangle(ctx, sx, sy, 7, '#00c8ff');
      ctx.fillStyle = '#00c8ff';
      ctx.font = 'bold 8px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(s.id, sx, sy - 10);
    });
  }

  // True hypocenter star
  if (trueCoords) {
    const tx = toX(trueCoords[0]), ty = toY(trueCoords[1]);
    ctx.shadowBlur = 12; ctx.shadowColor = '#ff3d71';
    drawStar(ctx, tx, ty, 10, '#ff3d71');
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff3d71';
    ctx.font = '10px Inter';
    ctx.textAlign = 'left';
    ctx.fillText(`TRUE (${trueCoords[0].toFixed(1)}, ${trueCoords[1].toFixed(1)})`, tx + 13, ty + 4);
  }

  // Initial guess circle
  if (guessCoords) {
    const gx = toX(guessCoords[0]), gy = toY(guessCoords[1]);
    ctx.beginPath();
    ctx.arc(gx, gy, 8, 0, 2 * Math.PI);
    ctx.strokeStyle = '#ff8c42';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ff8c42';
    ctx.font = '10px Inter';
    ctx.textAlign = 'left';
    ctx.fillText('GUESS', gx + 12, gy + 4);
  }

  // Current estimate
  if (animPos) {
    const ex = toX(animPos[0]), ey = toY(animPos[1]);
    const dotColor = converged ? '#00e887' : '#ffffff';
    const glowColor = converged ? '#00e887' : '#00c8ff';
    const glowRadius = converged ? 25 : 15;
    ctx.shadowBlur = glowRadius; ctx.shadowColor = glowColor;
    ctx.beginPath();
    ctx.arc(ex, ey, converged ? 11 : 9, 0, 2 * Math.PI);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Legend
  ctx.fillStyle = 'rgba(13,21,38,0.85)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 140, 80, 6);
  ctx.fill();
  ctx.strokeStyle = '#1a2744';
  ctx.lineWidth = 1;
  ctx.stroke();

  const legendItems = [
    { color: '#ff3d71', label: '★ True Hypocenter', shape: 'star' },
    { color: '#ff8c42', label: '○ Initial Guess', shape: 'circle' },
    { color: '#00c8ff', label: '▲ Station', shape: 'tri' },
    { color: '#ffffff', label: '● Estimate', shape: 'dot' },
  ];
  legendItems.forEach((item, i) => {
    ctx.fillStyle = item.color;
    ctx.font = '10px Inter';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, 16, 26 + i * 16);
  });

  ctx.restore && ctx.restore();
}
