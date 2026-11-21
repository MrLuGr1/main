# Milky Way Observatory

A standalone Canvas 2D observatory with 79,950 procedurally generated stars, a 3D camera, and an astrometric HUD. Open `index.html` in a browser. The page runs offline with no dependencies or build step.

## Controls

| Action | Mouse or keyboard | Touch |
| --- | --- | --- |
| Orbit and tilt from edge-on to top-down | Drag or use the arrow keys | Drag with one finger |
| Zoom from 1× to 60× | Wheel at the cursor or use `+` and `-` | Pinch |
| Pause or resume the simulation | Space or the Play/Pause button | Play/Pause button |
| Toggle the coordinate grid and labels | `G` or the Grid button | Grid button |
| Toggle telemetry and framing | `H` or the HUD button | HUD button |
| Reset the camera | `R`, Home, or the Reset button | Reset button |
| Change orbital speed | 1×–10× slider in 0.25× steps | Same slider |
| Fly to a preset | Overview, Edge-On, or Core | Same buttons |
| Track the Solar System | Locate Sol | Locate Sol |
| Track a pulsar and inspect its signal | Click a beacon or choose it in Pulsar receiver | Tap a beacon or choose it in Pulsar receiver |
| Cycle Optical, Infrared, and H-Alpha | `F` or the spectral band button | Spectral band button |
| Emphasize the lens around Sagittarius A* | Core lens | Core lens |

## Model

The central bar feeds the stronger Perseus and Scutum–Centaurus arms. The lighter Sagittarius and Norma arms complete the four-arm pattern. The Orion Spur sits between two arms, and a diffuse halo surrounds the disk. The bright disk is roughly 100,000 light-years **across**. The cyan and amber ring marks the requested 100,000-light-year **survey radius**. [NASA structure diagram](https://science.nasa.gov/resource/the-milky-way-galaxy/) · [NASA disk dimensions](https://imagine.gsfc.nasa.gov/science/objects/milkyway1.html)

The three dotted rings mark the inner bar region (12,000 ly), an illustrative habitable-zone reference near the Orion Spur (27,000 ly), and the outer rim of the modeled stellar disk (54,000 ly).

Optical uses amber and ivory in the bulge and bar, blue-white in young stellar associations along the arms, and faint slate and silver in the outer disk and halo. Infrared strengthens the warm bulge and dims the H II knots. H-Alpha boosts the 28 procedural emission knots in rose and magenta. Spectral colors and sensitivities are illustrative. [Hubble's Beautiful Universe](https://science.nasa.gov/mission/hubble/multimedia/e-books/)

Locate Sol tracks a model Solar System placed 26,000 ly out in the Orion Spur. Its circular orbit brightens along the arc it has just traveled. Moving the camera releases tracking and leaves the reticle visible. Select Locate Sol again to resume tracking. Selecting the button while tracking hides the reticle and orbit. Eight representative pulsars flash at distinct rates between 0.82 and 2.81 Hz. Their flash clock runs independently of the orbital multiplier and freezes on Pause. The core lens automatically strengthens on approach and can be emphasized at any zoom. It uses an illustrative radial distortion around Sagittarius A*.

The procedural background stars drift as you turn the camera. The disk-plane inset shows the tilt of the galactic disk and marks its zero-degree direction in amber.

The Pulsar receiver tracks any of the eight simulated beacons and plots the last two seconds of its model pulse signal. The plot and target marker use the same pulse clock as the beacon, so pausing freezes all three. Dragging, zooming, changing viewpoint, or clearing the selection releases the target.

Disk stars orbit at radius-dependent, softened Keplerian rates. The spiral pattern advances independently, changing the brightness of stars as they cross the arm crests and trailing dust lanes. This is an illustrative model. Measured disk rotation is approximately flat over much of the studied range. One simulated galactic year is calibrated to an orbit near the Orion reference radius. [Observed rotation curve](https://doi.org/10.1088/0004-637X/759/2/131)

## Rendering and GitHub Pages

- `js/galaxyEngine.js` generates stellar and gas populations, projects them in perspective, and adds depth-weighted light in linear RGB using precomputed spectral palettes. A shared exposure curve preserves color ratios as overlapping pixels brighten.
- `js/observatoryEffects.js` defines Sol's orbit, draws the timed beacons, and applies integer-coordinate lensing in a patch capped at 129 × 129 raster pixels.
- `js/hudRenderer.js` draws the survey ring, grid, bitmap text, and instrument markings on a transparent canvas.
- `js/main.js` handles the camera, input, simulation clock, and display refresh. Rendering targets 60 Hz with a raster capped at 960 × 640. The FPS readout reports measured throughput, which depends on the display, browser, and hardware. Reduced-motion mode starts paused and applies camera presets immediately.

Publish this directory under the existing GitHub Pages root. The rozcestnik entry points to `galaxy/index.html`. Keep the subdirectory intact so the relative script and stylesheet paths work both locally and on Pages.
