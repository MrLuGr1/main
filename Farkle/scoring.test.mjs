import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotMove } from './bot.js';
import { scoreSelection } from './scoring.js';

test('five-die straights can include one extra scoring die', () => {
  const cases = [
    [[1, 2, 3, 4, 5], 750],
    [[2, 3, 4, 5, 6], 1000],
    [[5, 1, 2, 3, 1, 4], 850],
    [[1, 2, 3, 4, 5, 5], 800],
    [[2, 3, 4, 5, 5, 6], 1050],
    [[1, 2, 3, 4, 5, 6], 1500],
    [[1, 2, 2, 3, 4, 5], 0],
  ];
  for (const [faces, expected] of cases) {
    const result = scoreSelection(faces);
    assert.equal(result.points, expected, faces.join(', '));
    assert.equal(result.valid, expected > 0, faces.join(', '));
  }
});

test('the bot keeps all six dice for the same 850-point roll', () => {
  const move = chooseBotMove([1, 1, 2, 3, 4, 5], 0, 0);
  assert.equal(move.selection.points, 850);
  assert.equal(move.remaining, 0);
});
