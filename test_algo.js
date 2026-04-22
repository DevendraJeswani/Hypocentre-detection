import { dist3, mean } from './src/utils/math.js';
import { calcTravelTimes, rms, runIteration, VP } from './src/utils/algorithm.js';

const stations = [
    {id: 'S1', x: 242.2850, y: 51.4601, z: 0.0000},
    {id: 'S2', x: 232.5098, y: 203.2263, z: 0.0000},
    {id: 'S3', x: 194.7250, y: 202.9968, z: 0.0000},
    {id: 'S4', x: 54.1986, y: 25.8443, z: 0.0000},
    {id: 'S5', x: 19.0551, y: 38.8050, z: 0.0000},
    {id: 'S6', x: 24.0318, y: 256.6638, z: 0.0000},
    {id: 'S7', x: 219.8505, y: 141.6513, z: 0.0000},
    {id: 'S8', x: 127.7784, y: 166.5764, z: 0.0000},
    {id: 'S9', x: 18.9269, y: 263.2007, z: 0.0000},
    {id: 'S10', x: 264.0234, y: 28.9548, z: 0.0000},
];

const observed_times = [64.1809, 50.8475, 44.2845, 57.5096, 56.871, 38.1444, 51.4844, 35.9829, 39.4683, 69.7389];

let best_coords = [10.0, 10.0, 15.0];
const d0 = stations.map(s => dist3(best_coords, [s.x, s.y, s.z]));
let best_t0 = mean(observed_times) - mean(d0.map(d => d / VP));
let best_rms = rms(observed_times.map((o, i) => o - (best_t0 + d0[i] / VP)));

let thetaSq = 0.005;
let successiveIncreases = 0;

for (let phase of ['depth_fixed', 'depth_free']) {
  console.log(`>>> Starting Phase: ${phase} <<<`);
  let df = phase === 'depth_fixed';
  
  for (let i = 0; i < 15; i++) {
    const res = runIteration(best_coords, best_t0, best_rms, thetaSq, successiveIncreases, stations, observed_times, df);
    
    if (res.accepted) {
      best_coords = res.testCoords;
      best_t0 = res.testT0;
      best_rms = res.testRms;
      successiveIncreases = 0;
    } else {
      successiveIncreases = res.successiveIncreases;
    }
    thetaSq = res.thetaSq;

    console.log(`Iter ${i+1} | RMS: ${best_rms.toFixed(4)} | ThetaSq: ${thetaSq.toExponential(3)} | Coords: [${best_coords.map(v=>v.toFixed(2)).join(', ')}]`);
    res.iterLog.forEach(l => console.log(`  - ${l.msg}`));
    
    if (res.accepted && res.stepSize < 0.001) break;
  }
}
