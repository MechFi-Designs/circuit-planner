# Circuit Planner

Plan an electrical panel in your browser. Pick the service, lay out your panels, and list your loads. For each circuit the app picks the breaker and the copper and aluminum THHN wire sizes. It also shows how much of the service you're using and how evenly the load is spread across the phases.

**Live app:** https://mechfi-designs.github.io/circuit-planner/

## Features

- **Service mode toggle:** split phase 120/240 V or commercial 3-phase 208Y/120 V.
- **Panels:** set each panel's main breaker, number of spaces and max circuits. The default is 20 spaces / 40 circuits; a panel with more circuits than spaces takes tandem breakers.
- **Tandem breakers:** check **Tandem** on any 1-pole circuit.
  - Tandem circuits pair up two to a space (labeled 7A / 7B) and share that space's phase.
  - A tandem circuit without a partner shows a spare half.
  - Circuits that aren't marked tandem never double up. If a panel runs out of spaces, the warning suggests which circuits to mark.
  - ⚖ Optimize picks the pairings and positions for balance and keeps pairs together.
- **Subpanels:** set where each panel is **fed from**: the service or another panel.
  - A subpanel gets a feeder breaker in its parent, which takes up spaces there, has its wire sized, and shows on the panel picture.
  - The subpanel's load counts toward its parent's totals, and every load counts exactly once against the service.
  - Panels fed directly from the service share the one service rating.
- **Load table:** name, max current, circuit type, continuous flag, and an optional estimated running current for each circuit.
  - Split phase: 120 V 1Φ (1-pole) or 240 V 1Φ (2-pole).
  - 3-phase: 120 V 1Φ (1-pole), 208 V 1Φ (2-pole) or 208 V 3Φ (3-pole).
- **Devices tab:** build a circuit up from what's actually on it. For each device you enter a name, quantity, max and estimated draw (in W or A), and whether it's continuous.
  - Pick from common devices (fridge, microwave, space heater, …) to fill in typical wattages, then adjust to the nameplate.
  - Once a circuit has devices, its Max A and Est. A are the sums of its devices.
  - The breaker is sized for 125% of the continuous devices plus 100% of the rest.
  - Watts convert at the circuit's voltage, using √3·V for 3-phase.
  - The 🔌 button on each load-table row jumps to that circuit's devices.
- **Automatic sizing:** for each circuit, the breaker, the copper THHN wire, the copper equipment ground (EGC), and its kW.
- **Visual panel:** circuits fill slots automatically. You can pin any circuit to a slot, and multi-pole breakers span adjacent rows.
- **⚖ Optimize:** moves unlocked circuits between slots to even out the worst-case current on each phase. Locked circuits (🔒) stay where they are.
  - **Balance on** picks which current Optimize evens out across phases. **Max load** uses nameplate current. **Estimated load** uses each circuit's Est. A, which suits equipment that rarely runs near nameplate, like CNC machines on drives. Rating checks always use the sizing load.
  - With **Move circuits between panels** turned on, it can also move circuits to another panel, but only when that takes load off something. Its priorities, in order:
    1. Get every panel's sizing load under its rating (main or feeder breaker), and the service's under its rating.
    2. Bring any panel over 80% down.
    3. Even out panels that are fed directly from the service.
  - If a panel is still over its rating, the warnings say why and what would fix it: what Optimize would get it to, feeding a subpanel from the service, unlocking circuits, or a bigger rating.
  - A subpanel's load still flows through its parent, so it won't shuffle circuits into a subpanel for no benefit.
- **Utilization:** amps and kW on each phase, shown as a percentage of the service rating and of each panel's main or feeder breaker.
  - **Max load** is the real max current: every circuit at its max.
  - **Estimated** uses your Est. A figures, or max current where you left Est. A blank, to show realistic loading.
  - **Sizing** counts continuous loads at 125%. It isn't extra current; it's what breakers, wire, mains, feeders and the service must be rated for. It's shown separately and only when it differs from max load.
  - Phase balancing uses real current. Rating checks use the sizing load.
- **Printable circuit map:** **Export PDF** downloads a letter-size circuit directory with one page per panel, ready to print and tape inside the panel door. Each panel card also has a **PDF** button for just that panel.
  - The page mirrors the panel: odd circuits on the left, even on the right, numbers next to the phase column, multi-pole breakers merged with a tie bar, and tandems split into A/B.
  - Each circuit shows its description, breaker and copper wire size.
  - The header shows the rating, service type and what the panel is fed from (including the parent breaker's spaces). The footer has per-phase load and kW.
- **Saving and sharing:** your design autosaves in the browser.
  - **Save file** downloads it as `.json` and **Open file** loads it back, so it survives clearing browser data.
  - **Share link** copies a URL containing the whole design.

## Sizing rules

| Step | Rule |
| --- | --- |
| Required ampacity | Load × 1.25 if continuous (NEC 210.19/210.20), otherwise the load |
| Breaker | Smallest NEC 240.6(A) standard rating ≥ the required ampacity |
| Wire | Smallest THHN with a **75 °C** ampacity (110.14(C) termination limit) ≥ the breaker rating, within the 240.4(D) small-conductor limits (#14 Cu = 15 A, #12 Cu = 20 A, #10 Cu = 30 A, #12 Al = 15 A, #10 Al = 25 A) |
| Ground (EGC) | Copper per Table 250.122 based on the breaker rating, never larger than the circuit conductors (250.122(A)) |
| kW | V × I for single phase, √3 × V × I for 3-phase |
| Phase load | Each circuit's current is added to every phase its breaker poles connect to. This is conservative for line-to-line loads. |

All wire is copper; aluminum sizing is still in the code but hidden for now. The 90 °C THHN ampacity appears in the wire-size tooltip as the starting point for derating. Wire sizes are matched to the breaker, so the 240.4(B) next-size-up allowance is not used. Ampacities come from NEC 2023 Table 310.16.

> Planning aid only. It does not cover ambient or conduit-fill derating, voltage drop, demand factors or local amendments. Check with your AHJ and a licensed electrician.

## Development

```sh
npm install
npm run dev     # local dev server
npm test        # unit tests (Vitest)
npm run build   # type-check + production build
```

Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.
