# Milky Way Observatory

A standalone Canvas 2D observatory with 79,950 procedurally generated stars, a 3D camera, and an astrometric HUD. Open `index.html` in a browser. The page runs offline and loads three local scripts with no build step.

## Controls

| Action | Mouse or keyboard | Touch |
| --- | --- | --- |
| Orbit and tilt from edge-on to top-down | Drag or use the arrow keys | Drag with one finger |
| Zoom from 1× to 60× | Wheel at the cursor or use `+` and `-` | Pinch |
| Pause or resume the simulation | Space or the Play/Pause button | Play/Pause button |
| Toggle the coordinate grid and labels | `G` or the Grid button | Grid button |
| Toggle telemetry and framing | `H` or the HUD button | HUD button |
| Reset the camera | `R`, Home, or the Reset button | Reset button |
| Change orbital speed | Orbital speed slider | Orbital speed slider |

## Model

The central bar feeds the stronger Perseus and Scutum–Centaurus arms. The lighter Sagittarius and Norma arms complete the four-arm pattern. The Orion Spur sits between two arms, and a diffuse halo surrounds the disk. The bright disk is roughly 100,000 light-years **across**. The cyan and amber ring marks the requested 100,000-light-year **survey radius**. [NASA structure diagram](https://science.nasa.gov/resource/the-milky-way-galaxy/) · [NASA disk dimensions](https://imagine.gsfc.nasa.gov/science/objects/milkyway1.html)

The three dotted rings mark the inner bar region (12,000 ly), an illustrative habitable-zone reference near the Orion Spur (27,000 ly), and the outer rim of the modeled stellar disk (54,000 ly).

Disk stars orbit at radius-dependent, softened Keplerian rates. The spiral pattern advances independently, changing the brightness of stars as they cross the arm crests and trailing dust lanes. This is an illustrative model. Measured disk rotation is approximately flat over much of the studied range. One simulated galactic year is calibrated to an orbit near the Orion reference radius. [Observed rotation curve](https://doi.org/10.1088/0004-637X/759/2/131)

## Rendering and GitHub Pages

- `js/galaxyEngine.js` generates stellar populations, projects them in perspective, and sums depth-weighted light into a reusable pixel buffer.
- `js/hudRenderer.js` draws the survey ring, grid, bitmap text, and instrument markings on a transparent canvas.
- `js/main.js` handles the camera, input, simulation clock, and display refresh. Rendering is capped at 60 Hz. The FPS readout reports measured throughput, which depends on the display, browser, and hardware.

Publish this directory under the existing GitHub Pages root. The rozcestnik entry points to `galaxy/index.html`. Keep the subdirectory intact so the relative script and stylesheet paths work both locally and on Pages.
