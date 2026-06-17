// Unit test for the N64AudioPullEngine in script.js (Task #41/#42 sink).
// Extracts the engine from script.js, feeds a 440Hz sine, and measures the
// OUTPUT pitch via zero crossings — the audible quantity. Asserts:
//   - pitch never exceeds 1.06x input (no chipmunk), even on bursty arrival
//   - pitch tracks production speed when below real time (continuous slow audio)
//   - no post-warmup silence gaps at steady production, no NaNs
const fs = require('fs');
const src = fs.readFileSync('script.js', 'utf8');
const a = src.indexOf('function N64AudioPullEngine');
const b = src.indexOf('const workletSrc');
if (a < 0 || b < 0) { console.log('FAIL: engine not found'); process.exit(1); }
const N64AudioPullEngine = eval('(' + src.slice(a, src.lastIndexOf('}', b) + 1) + ')');

const OUT = 44100, IN = 31367, F = 440, BLK = 128;
// prodFactor: avg production speed; burstSec: deliver in bursts every burstSec (0 = smooth)
function simulate(prodFactor, seconds, burstSec) {
  const eng = N64AudioPullEngine(OUT);
  const L = new Float32Array(BLK), R = new Float32Array(BLK);
  let prodAcc = 0, phase = 0, t = 0, burstAcc = 0;
  let blocks = 0, silentLate = 0, nan = 0, maxPitch = 0;
  let zc = 0, zcT = 0, prevS = 0, pitchSum = 0, pitchN = 0;
  const emit = (frames) => {
    const pcm = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      const s = Math.sin(phase += 2 * Math.PI * F / IN) * 0.5;
      pcm[i * 2] = s; pcm[i * 2 + 1] = s;
    }
    eng.push(pcm, IN);
  };
  while (t < seconds) {
    prodAcc += IN * prodFactor * (BLK / OUT);
    if (burstSec > 0) {
      burstAcc += BLK / OUT;
      if (burstAcc >= burstSec) { burstAcc -= burstSec; while (prodAcc >= 624) { prodAcc -= 624; emit(624); } }
    } else {
      while (prodAcc >= 624) { prodAcc -= 624; emit(624); }
    }
    eng.pull(L, R, BLK); blocks++; t += BLK / OUT;
    let peak = 0;
    for (let i = 0; i < BLK; i++) {
      if (Number.isNaN(L[i])) nan++;
      const v = L[i]; if (Math.abs(v) > peak) peak = Math.abs(v);
      if (prevS <= 0 && v > 0) zc++;   // rising zero crossings
      prevS = v;
    }
    const audible = peak > 0.05;
    if (audible) zcT += BLK / OUT;
    if (t > seconds * 0.5) {
      if (!audible) silentLate++;
      // measure pitch over rolling ~0.5s of audible time
      if (zcT >= 0.5) {
        const pitch = (zc / zcT) / F;
        if (pitch > maxPitch) maxPitch = pitch;
        pitchSum += pitch; pitchN++;
        zc = 0; zcT = 0;
      }
    } else if (zcT >= 0.5) { zc = 0; zcT = 0; } // discard warmup windows
  }
  return { blocks, silentLate, nan, maxPitch, avgPitch: pitchN ? pitchSum / pitchN : 0 };
}

let ok = true;
const check = (name, r, cond) => {
  console.log(name + ':', JSON.stringify(r));
  if (r.nan) { ok = false; console.log('FAIL ' + name + ' (NaN)'); }
  else if (!cond(r)) { ok = false; console.log('FAIL ' + name); }
};
// 1. full speed, smooth: pitch ~1.0, continuous
check('full-speed', simulate(1.0, 6, 0),
  r => r.maxPitch <= 1.06 && r.avgPitch > 0.92 && r.silentLate === 0);
// 2. 40% speed (in-game): continuous, pitch tracks ~0.4
check('40%-speed', simulate(0.4, 10, 0),
  r => r.maxPitch <= 1.06 && r.avgPitch > 0.3 && r.avgPitch < 0.5 && r.silentLate < r.blocks * 0.02);
// 3. full speed, bursty (all audio in one dump every 200ms): NO chipmunk
check('bursty-1.0x', simulate(1.0, 8, 0.2),
  r => r.maxPitch <= 1.06 && r.avgPitch > 0.9 && r.silentLate < r.blocks * 0.02);
// 4. 3x overproduction (unpaced-CPU regression case): playback speed is hard-capped
// at 1.05x; the surplus is discarded (drop-oldest), which the zero-crossing pitch
// estimator counts as up to ~+1 crossing per skip event (~+0.25 apparent pitch at
// 440Hz) — so the bound here is 1.35, vs ~3.0 for the old windup bug.
check('3x-overprod', simulate(3.0, 8, 0),
  r => r.maxPitch <= 1.35 && r.avgPitch > 0.9 && r.silentLate < r.blocks * 0.02);
// 5. 15% extreme: stable, no NaN
check('15%-speed', simulate(0.15, 12, 0), r => r.maxPitch <= 1.06);
// 6. closed loop (the browser mechanism, Task #42): a CPU able to produce at 3x
// real time is throttled whenever fill > 5120 (audio-master sync). Pitch must
// lock to ~1.0 with no gaps and no skip artifacts.
{
  const eng = N64AudioPullEngine(OUT);
  const L = new Float32Array(BLK), R = new Float32Array(BLK);
  let prodAcc = 0, phase = 0, t = 0;
  let blocks = 0, silentLate = 0, nan = 0, zc = 0, zcT = 0, prevS = 0, maxPitch = 0, minPitch = 9, pn = 0;
  while (t < 10) {
    if (eng.fill() <= 5120) prodAcc += IN * 3.0 * (BLK / OUT); // unthrottled: 3x
    while (prodAcc >= 624) {
      prodAcc -= 624;
      const pcm = new Float32Array(624 * 2);
      for (let i = 0; i < 624; i++) { const v = Math.sin(phase += 2 * Math.PI * F / IN) * 0.5; pcm[i*2]=v; pcm[i*2+1]=v; }
      eng.push(pcm, IN);
    }
    eng.pull(L, R, BLK); blocks++; t += BLK / OUT;
    let peak = 0;
    for (let i = 0; i < BLK; i++) {
      if (Number.isNaN(L[i])) nan++;
      const v = L[i]; if (Math.abs(v) > peak) peak = Math.abs(v);
      if (prevS <= 0 && v > 0) zc++;
      prevS = v;
    }
    if (peak > 0.05) zcT += BLK / OUT; else if (t > 5) silentLate++;
    if (t > 5 && zcT >= 0.5) { const pch = (zc/zcT)/F; if (pch>maxPitch) maxPitch=pch; if (pch<minPitch) minPitch=pch; pn++; zc=0; zcT=0; }
    else if (t <= 5 && zcT >= 0.5) { zc = 0; zcT = 0; }
  }
  const r = { blocks, silentLate, nan, maxPitch, minPitch, windows: pn };
  console.log('closed-loop:', JSON.stringify(r));
  if (nan || maxPitch > 1.02 || minPitch < 0.98 || silentLate > 0) { ok = false; console.log('FAIL closed-loop'); }
}
console.log(ok ? 'ALL PASS' : 'FAILED');
process.exit(ok ? 0 : 1);
