// ── Pure JS matrix / vector helpers ──────────────────────────────────────────

/** dot product of two 1-D arrays */
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

/** L2 norm of a vector */
export const norm = (v) => Math.sqrt(dot(v, v));

/** matrix multiply  A(m×k) × B(k×n) → C(m×n), stored as flat row-major arrays with shape info */
export const matMul = (A, rA, cA, B, rB, cB) => {
  const C = new Array(rA * cB).fill(0);
  for (let i = 0; i < rA; i++)
    for (let j = 0; j < cB; j++)
      for (let k = 0; k < cA; k++)
        C[i * cB + j] += A[i * cA + k] * B[k * cB + j];
  return C;
};

/** transpose of A(m×n) → A^T (n×m) */
export const transpose = (A, m, n) => {
  const T = new Array(n * m).fill(0);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++)
      T[j * m + i] = A[i * n + j];
  return T;
};

/** invert a 3×3 matrix (returns null if singular) */
export const inv3 = (M) => {
  const [a, b, c, d, e, f, g, h, k] = M;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  return [
    (e * k - f * h) * inv, (c * h - b * k) * inv, (b * f - c * e) * inv,
    (f * g - d * k) * inv, (a * k - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
};

/** Box-Muller Gaussian random  N(0, sigma) */
export const gaussianRandom = (sigma = 1) => {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  v = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Euclidean distance between two 3-D points */
export const dist3 = (a, b) =>
  Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);

/** arithmetic mean of array */
export const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
