# Circuit Planner

Plan an electrical panel in your browser. Pick the service, lay out your panels, and list your loads. For each circuit the app picks the breaker and the copper and aluminum THHN wire sizes. It also shows how much of the service you're using and how evenly the load is spread across the phases.

**Live app:** https://rydanmechfi.github.io/circuit-planner/

## Features

- **Service mode toggle:** split phase 120/240 V or commercial 3-phase 208Y/120 V.
- **Panels:** set each panel's main breaker, number of spaces and max circuits. The default is 20 spaces / 40 circuits, and any circuits beyond the space count go in as tandem breakers.
- **Subpanels:** set where each panel is **fed from**: the service or another panel.
  - A subpanel gets a feeder breaker in its parent, which takes up spaces there, has its wire sized, and shows on the panel picture.
  - The subpanel's load counts toward its parent's totals, and every load counts exactly once against the service.
  - Panels fed directly from the service share the one service rating.
- **Load table:** name, max current, circuit type and continuous flag for each circuit.
  - Split phase: 120 V 1Φ (1-pole) or 240 V 1Φ (2-pole).
  - 3-phase: 120 V 1Φ (1-pole), 208 V 1Φ (2-pole) or 208 V 3Φ (3-pole).
- **Automatic sizing:** the breaker and the Cu/Al THHN wire size for each circuit.
- **Visual panel:** circuits fill slots automatically. You can pin any circuit to a slot, and multi-pole breakers span adjacent rows.
- **⚖ Optimize phases:** moves unlocked circuits between slots to even out the worst-case current on each phase. Locked circuits (🔒) stay where they are.
- **Utilization:** amps on each phase, shown as a percentage of the service rating and of each panel's main breaker.
- **Saving and sharing:** your design autosaves in the browser.
  - **Save file** downloads it as `.json` and **Open file** loads it back, so it survives clearing browser data.
  - **Share link** copies a URL containing the whole design.

## Sizing rules

| Step | Rule |
| --- | --- |
| Required ampacity | Load × 1.25 if continuous (NEC 210.19/210.20), otherwise the load |
| Breaker | Smallest NEC 240.6(A) standard rating ≥ the required ampacity |
| Wire | Smallest THHN with a **75 °C** ampacity (110.14(C) termination limit) ≥ the breaker rating, within the 240.4(D) small-conductor limits (#14 Cu = 15 A, #12 Cu = 20 A, #10 Cu = 30 A, #12 Al = 15 A, #10 Al = 25 A) |
| Phase load | Each circuit's current is added to every phase its breaker poles connect to. This is conservative for line-to-line loads. |

The 90 °C THHN ampacity appears in the wire-size tooltip as the starting point for derating. Wire sizes are matched to the breaker, so the 240.4(B) next-size-up allowance is not used. Ampacities come from NEC 2023 Table 310.16.

> Planning aid only. It does not cover ambient or conduit-fill derating, voltage drop, demand factors or local amendments. Check with your AHJ and a licensed electrician.

## Development

```sh
npm install
npm run dev     # local dev server
npm test        # unit tests (Vitest)
npm run build   # type-check + production build
```

Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.
