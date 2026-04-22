import { dot, norm, matMul, transpose, inv3, gaussianRandom, dist3, mean } from './math.js';

export const VP = 5.6; // km/s
export const MAX_ITER = 250;
export const CONV_LIMIT = 0.001;

/** Generate 20 stations around the true hypocenter */
export function generateStations(trueCoords, t0) {
  const [tx, ty, tz] = trueCoords;
  const stations = [];
  for (let i = 0; i < 20; i++) {
    let sx, sy;
    do {
      const angle = Math.random() * 2 * Math.PI;
      const r = 20 + Math.random() * 130;
      sx = tx + r * Math.cos(angle);
      sy = ty + r * Math.sin(angle);
    } while (sx < 0 || sx > 500 || sy < 0 || sy > 500);
    stations.push({ id: `S${String(i + 1).padStart(2, '0')}`, x: sx, y: sy, z: 0 });
  }

  // Compute observed travel times with noise
  const obsTimesArr = stations.map((s) => {
    const d = dist3([tx, ty, tz], [s.x, s.y, s.z]);
    return t0 + d / VP + gaussianRandom(0.01);
  });

  return { stations, obsTimes: obsTimesArr };
}

/** Compute predicted arrival times and distances from a candidate hypocenter */
export function calcTravelTimes(hypo, t0, stations) {
  const distances = stations.map((s) => dist3(hypo, [s.x, s.y, s.z]));
  const arrivalTimes = distances.map((d) => t0 + d / VP);
  return { arrivalTimes, distances };
}

/** Compute RMS of residuals */
export function rms(residuals) {
  return Math.sqrt(mean(residuals.map((r) => r * r)));
}

/**
 * Run ONE iteration of the Levenberg-Marquardt damped least-squares.
 * Returns { accepted, stepSize, dX, testCoords, testT0, testRms, thetaSq, successiveIncreases, iterLog }
 */
export function runIteration(bestCoords, bestT0, bestRms, thetaSq, successiveIncreases, stations, obsTimes, depthFixed) {
  const N = stations.length;
  const iterLog = [];

  // 1. Build Jacobian T  (N×3)
  const { arrivalTimes: predTimes, distances } = calcTravelTimes(bestCoords, bestT0, stations);
  const residuals = obsTimes.map((o, i) => o - predTimes[i]);

  const T = [];
  for (let i = 0; i < N; i++) {
    const d = distances[i];
    T.push(
      (bestCoords[0] - stations[i].x) / (VP * d),
      (bestCoords[1] - stations[i].y) / (VP * d),
      (bestCoords[2] - stations[i].z) / (VP * d),
    );
  }
  iterLog.push({ level: 'DATA', msg: `Jacobian T built — shape (${N}, 3)` });

  // 2. Center T columns and residuals
  const colMeans = [0, 1, 2].map((j) => mean(T.filter((_, idx) => idx % 3 === j)));
  const Tc = T.map((v, idx) => v - colMeans[idx % 3]);
  const residMean = mean(residuals);
  const residC = residuals.map((r) => r - residMean);
  iterLog.push({ level: 'MATH', msg: `Centering — col means: [${colMeans.map((v) => v.toFixed(4)).join(', ')}]` });

  // 3. Scale: column norms of Tc
  const colNorms = [0, 1, 2].map((j) => {
    const col = Tc.filter((_, idx) => idx % 3 === j);
    return Math.max(Math.sqrt(dot(col, col)), 1e-10);
  });
  const S = colNorms.map((cn) => 1 / cn); // diagonal of scale matrix
  const Tcs = Tc.map((v, idx) => v * S[idx % 3]);
  iterLog.push({ level: 'MATH', msg: `Scaling — col norms: [${colNorms.map((v) => v.toFixed(4)).join(', ')}]` });

  // 4. Retry loop
  let localTheta = thetaSq;
  let localSucc = successiveIncreases;
  let accepted = false;
  let testCoords = [...bestCoords];
  let testT0 = bestT0;
  let testRms = bestRms;
  let dX = [0, 0, 0];

  for (let attempt = 0; attempt < 10; attempt++) {
    // G = Tcs^T × Tcs + theta_sq × I3
    const TcsT = transpose(Tcs, N, 3);
    const GBase = matMul(TcsT, 3, N, Tcs, N, 3);
    const G = [...GBase];
    G[0] += localTheta; G[4] += localTheta; G[8] += localTheta;

    const Ginv = inv3(G);
    if (!Ginv) { localTheta *= 4; localSucc++; if (localSucc >= 5) break; continue; }

    // dX_scaled = Ginv × Tcs^T × residC  (Tcs^T is 3×N, residC is N×1 → result 3×1)
    const rhs = [0, 1, 2].map((r) => Tcs.reduce((s, v, idx) => idx % 3 === r ? s + v * residC[Math.floor(idx / 3)] : s, 0));
    const dXscaled = [
      dot(Ginv.slice(0, 3), rhs),
      dot(Ginv.slice(3, 6), rhs),
      dot(Ginv.slice(6, 9), rhs),
    ];
    dX = dXscaled.map((v, i) => v * S[i]);
    if (depthFixed) dX[2] = 0;



    const tc = [bestCoords[0] + dX[0], bestCoords[1] + dX[1], bestCoords[2] + dX[2]];
    if (tc[2] < 0) {
      iterLog.push({ level: 'REJT', msg: `Depth < 0 — damping ×4 → θ²=${(localTheta * 4).toExponential(3)}` });
      localTheta *= 4; localSucc++; if (localSucc >= 5) break; continue;
    }

    const dists2 = stations.map((s) => dist3(tc, [s.x, s.y, s.z]));
    const tT0 = mean(obsTimes) - mean(dists2.map((d) => d / VP));
    const predT2 = dists2.map((d) => tT0 + d / VP);
    const res2 = obsTimes.map((o, i) => o - predT2[i]);
    const tRms = rms(res2);

    iterLog.push({ level: 'EVAL', msg: `test_rms=${tRms.toFixed(6)} ${tRms < bestRms ? '<' : '>='} current=${bestRms.toFixed(6)} ${tRms < bestRms ? '✓' : '✗'}` });

    if (tRms >= bestRms) {
      localTheta *= 4; localSucc++;
      iterLog.push({ level: 'REJT', msg: `Step rejected — θ²×4 → ${(localTheta).toExponential(3)}` });
      if (localSucc >= 5) break; continue;
    }

    // Accept
    testCoords = tc; testT0 = tT0; testRms = tRms;
    localTheta *= 0.6; localSucc = 0; accepted = true;
    iterLog.push({ level: 'ACPT', msg: `Step accepted — θ²×0.6 → ${localTheta.toExponential(3)} | dX=[${dX.map((v) => v.toFixed(3)).join(', ')}]` });
    break;
  }

  return {
    accepted,
    stepSize: norm(dX),
    dX,
    testCoords,
    testT0,
    testRms,
    thetaSq: localTheta,
    successiveIncreases: localSucc,
    iterLog,
    residuals: accepted
      ? obsTimes.map((o, i) => o - (testT0 + dist3(testCoords, [stations[i].x, stations[i].y, stations[i].z]) / VP))
      : obsTimes.map((o, i) => o - predTimes[i]),
  };
}
