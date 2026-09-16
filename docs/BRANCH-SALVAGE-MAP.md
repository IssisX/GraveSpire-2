# GRAVESPIRE branch salvage map

## Decision frame

Baseline: `ChatGPT` at `f8e4705ab9f6bf9427fb768c60caa771fe099724`.
`docs/GRAVESPIRE-GDD.md` remains the design authority. The live
MC-01→12 WebView APK and the Godot/C++ Bay 07 cell are distinct execution
substrates; neither is permitted to silently replace the other's authority.

This map is a hand-port record, not a merge plan. “Newer” did not decide any
outcome. Each decision used ancestry, source ownership, integration surface,
and passing source-branch CI.

| Branch | Evidence reviewed | KEEP | PORT into ChatGPT | SUPERSEDED | REJECT from current port |
| --- | --- | --- | --- | --- | --- |
| `main` (`7c4138a`) | GDD-aligned Godot/C++ foundation | C++ authority boundary, reference tests, Godot project baseline | None: it is the common ancestor | No branch-only advancement | N/A |
| `Claude` (`3b89456`) | Android SDK/remediation commit | Runner Android SDK fix and Grok APK base | None: this head is already an ancestor of `ChatGPT` | None | N/A |
| `Grok` (`e4b353f`) | Gait, local pendant, dock, live power, people | Inhabited Bay 07 and touch-first Act I foundations | None: all are already ancestral to `ChatGPT` | Its smaller MC-01-only presentation is extended by the current MC-01→12 tower | No history merge needed |
| `claude/gravespire-player-ux-sdtja4` (`2486667`) | 117 authority checks; successful verify and Android APK CI | Its branch remains the record of the generic rigid-body and UX experiment | Bounded dust field, live-light shafts, lamp-output ownership, and a user-facing airborne-dust control | Contextual action, machine panels, fall/chute, gait, inspection, and touch controls: current `context.ts`, `operate.ts`, `player.ts`, and UI extend them across the actual tower | `sim/bodies.ts` as a direct replacement: it would create a competing body authority outside the current shared MC network/save model. Its pre-Grok level replacement would erase the dock, power, NPC, and later tower additions. |
| `godot-bay07` (`cd09e39`) | Successful verify and Godot Android APK CI; tagged `godot-bay07-apk` | A valid GDD-directed native Bay 07 acceptance slice | Godot first-person player/gait/HUD, C++ derived traversal facts and reference cases, Android export configuration, extension ABI aliases, and a ChatGPT-scoped Godot APK workflow | It cannot replace the MC-01→12 WebView tower: its authored playable geography ends at Bay 07 | No blind migration of its lower-slice state into the web shared network |
| `ChatGPT` (`f8e4705`) | Current MC-01→12 mechanical, recovery, parkour, sound, and APK path | The sole current skyscraper baseline | Receives only the two isolated strata above | Earlier MC-only forms are already expanded here | No merge of divergent histories |

## Actual port manifest

- `web/src/game/atmosphere.ts` carries the selected atmospheric evolution:
  bounded camera-centred dust, geometry-occluded light shafts, and
  non-compounding ballast flicker.
- `web/src/game/level.ts`, `coupling.ts`, `graphics.ts`, `runtime.ts`,
  and settings wire that presentation to existing physical electrical output.
  It does not write mechanical state or create collision/trigger geometry.
- `game/`, `native/`, and
  `.github/workflows/godot-android.yml` retain the proven Godot/C++ Bay 07
  substrate beside—not in place of—the WebView tower. The workflow is scoped
  to `ChatGPT` and publishes a separate
  `chatgpt-godot-bay07-apk` prerelease.

## Guardrails kept

1. No branch was merged.
2. No existing MC-01→12 source was replaced by the older Bay 07 web layout.
3. The candidate generic body solver was not layered beside the existing
   shared mechanical authority.
4. The Godot APK remains explicitly labelled as a native Bay 07 acceptance
   slice, not as a substitute for the current skyscraper APK.
5. Every selected port must pass the current mechanics/build pipeline before
   publication.
