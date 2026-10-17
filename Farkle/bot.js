import { findScoringOptions } from './scoring.js';

const BOT_NAMES = ['Moss', 'Rivet', 'Nova'];
const BOT_COLORS = ['#c30000', '#b0aea8', '#ffffff'];

export function makePlayers(humanName, botCount) {
  const name = humanName.trim().slice(0, 18) || 'You';
  const players = [{ id: 'human', name, isHuman: true, score: 0, color: '#ffffff' }];
  for (let index = 0; index < botCount; index++) {
    players.push({ id: `bot-${index + 1}`, name: BOT_NAMES[index], isHuman: false, score: 0, color: BOT_COLORS[index] });
  }
  return players;
}

/** Pick one complete legal scoring selection and decide whether to press the luck. */
export function chooseBotMove(faces, turnPoints, bankedPoints, target = 10000) {
  const options = findScoringOptions(faces);
  if (!options.length) return { farkle: true };
  // Prefer a high-value combination, with a small bonus for freeing extra dice.
  const selection = options.reduce((best, option) => {
    const value = option.points + option.diceCount * 42;
    const bestValue = best.points + best.diceCount * 42;
    return value > bestValue ? option : best;
  });
  const remaining = faces.length - selection.diceCount;
  const projected = bankedPoints + turnPoints + selection.points;
  const shouldBank = projected >= target || turnPoints + selection.points >= 850 || remaining <= 1;
  return { farkle: false, selection, shouldBank, remaining };
}

