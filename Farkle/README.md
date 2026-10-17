# Farkle Club

A local-first 3D Farkle game with an isometric 100 × 150 cm table, Cannon-es rigid-body throws, Three.js rendering, and a small bot lobby.

## Run locally

ES modules are blocked by browsers when an HTML file is opened directly as `file://`. From the repository root, start a simple static server:

```powershell
py -m http.server 8000
```

Then open <http://localhost:8000/Farkle/>. You can also serve this folder directly with any static web server.

Three.js and Cannon-es are pinned to versioned jsDelivr URLs. An internet connection is needed on the first load (and whenever the browser cache is cleared). Scores and personal statistics are stored in this browser's `localStorage`; the game has no account, backend, or multiplayer connection.

## Game controls

- Click/tap dice to select a scoring combination.
- `Keep selected` locks those dice into the turn and enables the remaining dice to roll again.
- `Bank & end turn` adds the turn total to your score.
- `Space` rolls, `Enter` keeps a valid selection, and `B` banks.
- A roll animates for two seconds. A roll with no scoring selection is a Farkle and clears the current turn total.
- Reach the selected target to win. If all six dice score, Hot Dice returns all six to the hand for another roll.
- Choose 1,000, 3,000, 5,000, 10,000, or a custom target up to 100,000 before the match.
- Easy mode outlines valid scoring dice; the guide shifts from red to black or white if the active skin needs more contrast. Hard mode leaves scoring dice unmarked.
- Pick from ten locally generated cube skins. Several use a slow emissive pulse. Your skin choice is remembered in local storage.
- Choose Low, Medium, or High throw power in the lobby; it scales the dice launch velocities and spin.

## Modules

- `index.html`, `style.css` — responsive lobby, scoreboard, rules, table, and accessible controls.
- `game.js` — match state, player turns, input, rendering, and local statistics.
- `physics.js` — Cannon-es world, dice bodies, throws, and two-second settling.
- `scoring.js` — pure Farkle scoring and scoring-subset enumeration.
- `bot.js` — bot seats and a simple risk-aware move choice.
- `effects.js` — GPU bursts for Hot Dice, Farkles, and wins, plus a cursor-reactive background pixel field.

The scoring module and game state are intentionally separate from rendering and storage so a future API or WebSocket transport can replace the local match coordinator.

