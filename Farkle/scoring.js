// Pure scoring rules. Keeping this module free of UI and physics makes it reusable for bots or a future server.
const TRIPLET_BASE = { 1: 1000, 2: 200, 3: 300, 4: 400, 5: 500, 6: 600 };
const KIND_MULTIPLIER = { 3: 1, 4: 2, 5: 4, 6: 8 };

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
  if (faces.length === 5 && [1, 2].includes(Math.min(...faces)) && distinct === 5) {
    if ([1, 2, 3, 4, 5].every(face => counts[face] === 1)) return { valid: true, points: 750, label: 'Straight 1–5', used: faces.length };
    if ([2, 3, 4, 5, 6].every(face => counts[face] === 1)) return { valid: true, points: 1000, label: 'Straight 2–6', used: faces.length };
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
    } else if (face === 1 && count > 0) {
      points += count * 100; used += count; groups.push(`${count}× 1`);
    } else if (face === 5 && count > 0) {
      points += count * 50; used += count; groups.push(`${count}× 5`);
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

