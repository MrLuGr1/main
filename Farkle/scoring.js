// Pure scoring rules. Keeping this module free of UI and physics makes it reusable for bots or a future server.
const TRIPLET_BASE = { 1: 1000, 2: 200, 3: 300, 4: 400, 5: 500, 6: 600 };
const KIND_MULTIPLIER = { 3: 1, 4: 2, 5: 4, 6: 8 };
const SINGLE_POINTS = { 1: 100, 5: 50 };
const FIVE_DIE_STRAIGHTS = [
  { faces: [1, 2, 3, 4, 5], points: 750, label: 'Straight 1–5' },
  { faces: [2, 3, 4, 5, 6], points: 1000, label: 'Straight 2–6' },
];

/** Evaluate a complete selection. A selection is valid only when every selected die scores. */
export function scoreSelection(faces) {
  if (!Array.isArray(faces) || !faces.length || faces.some(face => !Number.isInteger(face) || face < 1 || face > 6)) {
    return { valid: false, points: 0, label: 'Choose dice that form a scoring combination.' };
  }

  const counts = Array(7).fill(0);
  faces.forEach(face => counts[face]++);
  const distinct = new Set(faces).size;
  if (faces.length === 6 && distinct === 6) return { valid: true, points: 1500, label: 'Straight 1–6', used: faces.length };
  if (faces.length === 6 && counts.slice(1).filter(count => count === 2).length === 3) {
    return { valid: true, points: 1500, label: 'Three pairs', used: faces.length };
  }
  if (faces.length === 5 || faces.length === 6) {
    for (const straight of FIVE_DIE_STRAIGHTS) {
      if (!straight.faces.every(face => counts[face] > 0)) continue;
      if (faces.length === 5) {
        return { valid: true, points: straight.points, label: straight.label, used: 5 };
      }
      // The six-die straight already returned, so the extra die repeats a face.
      const extraFace = faces.find(face => counts[face] === 2);
      const extraPoints = SINGLE_POINTS[extraFace];
      if (!extraPoints) continue;
      return { valid: true, points: straight.points + extraPoints, label: `${straight.label} + ${extraFace}`, used: 6 };
    }
  }

  let points = 0;
  let used = 0;
  const groups = [];
  for (let face = 1; face <= 6; face++) {
    const count = counts[face];
    if (count >= 3) {
      const value = TRIPLET_BASE[face] * KIND_MULTIPLIER[count];
      points += value;
      used += count;
      groups.push(`${count}× ${face}s (${value})`);
    } else if (SINGLE_POINTS[face] && count > 0) {
      points += count * SINGLE_POINTS[face];
      used += count;
      groups.push(`${count}× ${face}`);
    }
  }
  const valid = points > 0 && used === faces.length;
  return {
    valid,
    points: valid ? points : 0,
    label: valid ? groups.join(' · ') : 'This selection does not score as a whole.',
    used: valid ? used : 0,
    groups,
  };
}

/** Enumerate all complete scoring subsets; six dice means at most 63 tiny checks. */
export function findScoringOptions(dice) {
  const options = [];
  for (let mask = 1; mask < (1 << dice.length); mask++) {
    const indices = [];
    const faces = [];
    dice.forEach((die, index) => {
      if (mask & (1 << index)) { indices.push(index); faces.push(typeof die === 'number' ? die : die.face); }
    });
    const result = scoreSelection(faces);
    if (result.valid) options.push({ ...result, indices, mask, diceCount: indices.length });
  }
  return options.sort((a, b) => b.points - a.points || b.diceCount - a.diceCount);
}

export function hasScoringOption(dice) {
  return findScoringOptions(dice).length > 0;
}
