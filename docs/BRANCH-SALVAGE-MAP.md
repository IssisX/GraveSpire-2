# GRAVESPIRE branch salvage map

## Decision frame

Baseline for the first consolidation pass: `ChatGPT` at `f8e4705ab9f6bf9427fb768c60caa771fe099724`.
`docs/GRAVESPIRE-GDD.md` remains the design authority. The live MC-01→12 WebView APK and the Godot/C++ Bay 07 slice are distinct execution substrates; neither is permitted to silently replace the other's authority.

This map is a hand-port record, not a merge plan. “Newer” did not decide any outcome. Each decision used ancestry, source ownership, integration surface, and passing source-branch evidence.

| Branch | Evidence reviewed | KEEP | PORT into ChatGPT | SUPERSEDED | REJECT from current port |
| --- | --- | --- | --- | --- | --- |
| `main` (`7c4138a`) | GDD-aligned Godot/C++ foundation | C++ authority boundary, reference tests, Godot project baseline | None: it is the common ancestor | No branch-only advancement | N/A |
| `Claude` (`3b89456`) | Android SDK/remediation commit | Runner Android SDK fix and Grok APK base | None: this head is already an ancestor of `ChatGPT` | None | N/A |
| `Grok` (`e4b353f`) | Gait, local pendant, dock, live power, people | Inhabited Bay 07 and touch-first Act I foundations | None: all are already ancestral to `ChatGPT` | Its smaller MC-01-only presentation is extended by the current MC-01→12 tower | No history merge needed |
| `claude/gravespire-player-ux-sdtja4` (`2486667`) | 117 authority checks; successful verify and Android APK CI | Its branch remains the record of the generic rigid-body and UX experiment | Bounded dust field, live-light shafts, lamp-output ownership, and a user-facing airborne-dust control | Contextual action, machine panels, fall/chute, gait, inspection, and touch controls: current `context.ts`, `operate.ts`, `player.ts`, and UI extend them across the actual tower | `sim/bodies.ts` as a direct replacement: it would create a competing body authority outside the current shared MC network/save model. Its pre-Grok level replacement would erase the dock, power, NPC, and later tower additions. |
| `godot-bay07` (`45b82324`) | Successful native reference / Godot Android lineage; latest hoist authority commit | Valid GDD-directed native Bay 07 acceptance slice | Godot first-person player/gait/HUD, C++ derived traversal facts, Android export configuration, extension ABI aliases, plus the later tension-only hoist, unstretched cable state, finite/thermal holding brake, overload slip, cable visualization, and derived Act I competence predicate | It cannot replace the MC-01→12 WebView tower: its authored playable geography ends at Bay 07 | No blind migration of its lower-slice state into the web shared network |
| `ChatGPT` | Current MC-01→12 mechanical tower, recovery/parkour/composition systems, atmosphere, WebView APK path, and retained native Bay 07 slice | Sole consolidation target | Receives only owner-correct strata from divergent branches | Earlier MC-only and Bay-07-only forms remain historical evidence | No merge of divergent histories |

## Actual port manifest

- `web/src/game/atmosphere.ts` carries the selected atmospheric evolution: bounded camera-centred dust, geometry-occluded light shafts, and non-compounding ballast flicker.
- `web/src/game/level.ts`, `coupling.ts`, `graphics.ts`, `runtime.ts`, and settings wire that presentation to existing physical electrical output. It does not write mechanical state or create collision/trigger geometry.
- `game/`, `native/`, and `.github/workflows/godot-android.yml` retain the proven Godot/C++ Bay 07 substrate beside—not in place of—the WebView tower.
- Late salvage delta: `godot-bay07` advanced from `cd09e39` to `45b82324` immediately before the first consolidation commit. Commit `2e63c656` ports that missed delta exactly: `game/hud.gd`, `game/main.gd`, `native/godot/simulation_bridge.cpp`, `native/include/gravespire/simulation.hpp`, `native/src/simulation.cpp`, `native/tests/simulation_tests.cpp`, and the native engine contract.
- The native hoist now changes unstretched cable length instead of teleporting carrier height. Cable force is tension-only; the brake has finite temperature-dependent holding capacity and overload slip. Act I local competence is derived from physical route and receiving-envelope predicates.

## Guardrails kept

1. No divergent branch was merged wholesale.
2. No existing MC-01→12 source was replaced by the older Bay 07 web layout.
3. The candidate generic body solver was not layered beside the existing shared mechanical authority.
4. The Godot APK remains explicitly labelled as a native Bay 07 acceptance slice, not as a substitute for the current skyscraper APK.
5. Native Bay 07 consequential state remains C++ authority; Godot renders snapshots and issues commands.
6. Every selected port must pass the current reference/build pipeline before publication.
