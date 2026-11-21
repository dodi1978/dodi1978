// Agreement between two coders (you and the AI) on the same units.

// Cohen's kappa for nominal codes. pairs: [[a, b], …] of comparable values.
export function cohensKappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const key = (v) => JSON.stringify(v);
  const agree = pairs.filter(([a, b]) => key(a) === key(b)).length;
  const po = agree / n;
  const countA = new Map();
  const countB = new Map();
  for (const [a, b] of pairs) {
    countA.set(key(a), (countA.get(key(a)) ?? 0) + 1);
    countB.set(key(b), (countB.get(key(b)) ?? 0) + 1);
  }
  let pe = 0;
  for (const [k, ca] of countA) pe += (ca / n) * ((countB.get(k) ?? 0) / n);
  const kappa = pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return { n, percentAgreement: po, kappa };
}

// Weighted kappa for ordered scales (quadratic weights), so near-misses count partly.
export function weightedKappa(pairs, min, max) {
  const n = pairs.length;
  if (!n) return null;
  const k = max - min + 1;
  const observed = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const [a, b] of pairs) observed[a - min][b - min] += 1;
  const rows = observed.map((r) => r.reduce((s, x) => s + x, 0));
  const cols = observed[0].map((_, j) => observed.reduce((s, r) => s + r[j], 0));
  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = k > 1 ? ((i - j) ** 2) / ((k - 1) ** 2) : 0;
      num += w * observed[i][j];
      den += w * (rows[i] * cols[j]) / n;
    }
  }
  const exact = pairs.filter(([a, b]) => a === b).length / n;
  return { n, percentAgreement: exact, kappa: den === 0 ? (num === 0 ? 1 : 0) : 1 - num / den, weighted: "quadratic" };
}

// Landis & Koch (1977) labels, a common (if rough) guide.
export function interpretKappa(kappa) {
  if (kappa === null || kappa === undefined || Number.isNaN(kappa)) return "";
  if (kappa < 0) return "poor (less than chance)";
  if (kappa <= 0.2) return "slight";
  if (kappa <= 0.4) return "fair";
  if (kappa <= 0.6) return "moderate";
  if (kappa <= 0.8) return "substantial";
  return "almost perfect";
}

// Agreement for one code. pairs: [[human, ai], …] where both coded the unit.
// Multi-choice codes are compared option by option (present / absent).
export function agreementFor(code, pairs) {
  if (code.type === "comment" || !pairs.length) return { n: pairs.length, kappa: null, percentAgreement: null };
  if (code.type === "number") {
    const diffs = pairs.map(([a, b]) => Math.abs(a - b));
    return { n: pairs.length, kappa: null, percentAgreement: pairs.filter(([a, b]) => a === b).length / pairs.length, meanAbsoluteDifference: diffs.reduce((s, x) => s + x, 0) / diffs.length };
  }
  if (code.type === "scale") return weightedKappa(pairs, code.scale.min, code.scale.max);
  if (code.type === "multi") {
    const perOption = code.options.map((o) => {
      const r = cohensKappa(pairs.map(([a, b]) => [a.includes(o.value), b.includes(o.value)]));
      return { value: o.value, label: o.label, ...r, interpretation: interpretKappa(r.kappa), used: pairs.some(([a, b]) => a.includes(o.value) || b.includes(o.value)) };
    });
    const used = perOption.filter((o) => o.used);
    const exact = pairs.filter(([a, b]) => JSON.stringify(a) === JSON.stringify(b)).length / pairs.length;
    const mean = used.length ? used.reduce((s, o) => s + o.kappa, 0) / used.length : null;
    return { n: pairs.length, percentAgreement: exact, kappa: mean, meanOverOptions: true, perOption };
  }
  return cohensKappa(pairs);
}
