# Act I web client — ownership map and declared reduction

Evidence class: **INSPECTED** against `web/src` on this branch, plus
**EXECUTED** for the checks named at the end. This document describes the
TypeScript/Three.js Act I client that ships inside the Android WebView. It is
not a description of the Godot 4.7 + C++ coupling cell on `main`, and it does
not claim any part of the GDD §16 acceptance table.

## What owns what

| Fact | Owner | File |
|---|---|---|
| Freight, frame, gate, members, cables, electrical, NPC, flags, events | `Simulation` | `web/src/sim/simulation.ts` |
| Whether a route exists | traversal derived from authority | `web/src/sim/missions.ts` |
| Whether a mission succeeded | predicates over authority + traversal | `web/src/sim/missions.ts` |
| What the player can act on from here | context resolver | `web/src/game/context.ts` |
| Which verbs an object offers | action catalog | `web/src/game/actions.ts` |
| Machine command surfaces | machine modes | `web/src/game/machine.ts` |
| Player position, support, collision | character controller | `web/src/game/player.ts` |
| Camera embodiment | gait presentation | `web/src/game/gait.ts` |
| Meshes, lights, HUD, audio | view | `web/src/game/level.ts`, `web/src/game/ui/*` |

There is no second writer. The UI issues typed commands and actions; it never
sets a mission flag, a damage value, or a traversal edge directly. Presentation
cannot decide that a structure broke, a machine succeeded, or a route opened.

### Presentation is not world truth

`gait.ts` produces small camera offsets from authoritative movement state:
stride phase, lateral weight transfer, counter-roll, acceleration lean with an
under-damped recovery, turn lag, landing compression, and idle postural motion.

Those offsets reach the rendered camera only. Interaction rays are cast from
`eyePose(player.x, player.y + player.eye, player.z, player.yaw, player.pitch)` —
the authoritative pose, with no gait term. Collision, support, moving-platform
inheritance, and fall consequence are likewise untouched. Setting
`gaitIntensity` to 0 removes every offset and changes nothing else.

## Declared mechanical reduction

`MODEL_CLASS` in `web/src/sim/types.ts` is the binding statement. As of this
branch it covers:

- a lumped three-body coupling cell (freight + transfer frame + isolation gate);
- declared elastic members with axial, biaxial bending and torsion terms;
- tension-only cables;
- a single-axis pendulum for the suspended load;
- a DC hoist drive with back-EMF, a current limit, and gravity feedforward;
- a fail-safe drum brake with a finite holding force and frictional heating;
- inverse-time overcurrent protection with thermal memory;
- pressure inventory with a latched vent valve;
- persistent plastic set on the frame and on members.

It is **not** co-rotational FEM, not fracture-energy regularised, not
Craig–Bampton reduced, and not a claim of measured device performance.

### What the Act I pass added to the model

Five changes were made to the model, all on top of existing authoritative
state rather than beside it:

1. **The hoist is a real electrical consumer.** Holding a load off the brake
   costs roughly 130 A on the process bus. With the drive cabinet and the hab
   feed also on that island, total demand exceeds the generator breaker's
   400 A rating and the breaker trips on inverse time. Losing control power
   sets the fail-safe brake, so the load is held rather than dropped. Shedding
   a feeder — or moving the hab band onto Chen's west bus so the drive cabinet
   *can* be shed — is what makes a sustained hoist possible.
2. **The load swings.** Traverse acceleration drives a pendulum whose angle is
   a real lateral eccentricity feeding frame torsion. Docking requires letting
   it settle; releasing mid-swing damages cargo.
3. **Venting has a physical cost.** The vent valve latches open, discharges
   over time, and the jet occupies a bounded region west of the seal that
   pushes anything standing in it. The jet is a declared reduced hazard in
   `runtime.ts`; it reads authority state and feeds nothing back into it.
4. **The frame hardens.** The transfer frame was ideally plastic: past its
   elastic limit it flowed without bound, and an abusive load could write
   metres of permanent set. Accumulated set now raises the elastic limit, so
   flow arrests at a finite deflection, and `kFailureDeflectionM` — previously
   declared and unused — is now a real limit state that holds the
   configuration and says so instead of integrating into nonsense.
5. **Docking means the load is down.** `payload_on_neck` was being set while
   the payload was still on the hook, which meant its weight was counted into
   the gallery load while the rope was still carrying it. Holding cleanly over
   the deck is now reported as the condition for a clean release; the flag is
   set when the player actually releases.

Together these make Act I's opening causal rather than a checklist. Venting
the vessel unloads the frame's torsion enough to bring the seal inside dock
tolerance. Shedding a feeder is what lets the hoist run long enough to get the
load across. Releasing the load takes its weight off the transfer frame, and
*that* is what opens the maintenance walk to the drive.

Mission 2 previously read true on the first frame of a new game, because
reaching the neck district through Gallery 12 was counted as the maintenance
walk being open. The walk is the route along the distorted transfer deck to
the drive housing, and it opens by changing support or load — unloading the
carrier, connecting the neck brace, or jacking it. Three routes, all physical.

## Movable mass (`web/src/sim/bodies.ts`)

A rigid-body layer sits alongside the lumped coupling cell: real mass, a full
3D inertia tensor, orientation, and box-corner contact against both the
static world and other bodies, resolved by a sequential-impulse solver with
Coulomb friction. This is what turns "levers, tipping, dragging, stacking,
bridging" from a list of separately-scripted mechanics into things that
happen because a box has weight and a floor pushes back.

Nothing here is a named mechanic. A body tips off a support edge because
torque about the contact point is real, not because a tipping rule fired. A
plate spanning two piers is walkable because its AABB is a walkable
collider, exactly like the floor next to it — there is no `isBridge` flag.
Twelve pieces of salvage (`DEBRIS` in `world-init.ts`) are seeded across Bay
07, Gallery 12, and the Transfer Neck: plates, crates, section beams, a cable
spool, ballast blocks.

The player's own force is one number, `PLAYER_FORCE_N = 900`. Whether a body
lifts, drags, or refuses to move by hand is not authored per object — it
falls out of that budget against the body's own weight and friction. A 26 kg
crate lifts. A 150 kg spool won't lift but drags. A 245 kg beam does neither
and needs the hook or a lever. The verb shown to the player (`Lift` / `Drag`
/ `Grab`) is read off the same numbers, not hand-labeled.

Grab, drag, throw, hook, and unhook are contextual actions like everything
else in Act I — routed through `actions.ts`, performed through
`sim.act({type: "grab_body"|"hook_body"|"unhook_body"|"release_body", ...})`.
Holding a body overrides the normal look-based action target in
`runtime.ts` (the question becomes "what do I do with what's in my hand,"
not "what's in the crosshair"), offering Set down / Throw through the same
tap/hold selector every other action uses. No new HUD chrome.

The hoist hook can carry a body instead of the original payload once it is
released: `hook_body` attaches it kinematically to the sheave, and its mass
becomes the rope's actual load (`supportedMass`, including anything stacked
on it), which the hoist drive, brake, and process-bus current draw all react
to exactly as they do to the original crate.

Structural load from resting mass is measured, not assumed: Gallery 12's
spans and the transfer frame read real contact reaction off bodies resting
on `gal_floor` / `neck_floor` / `drive_box`, including bodies that have gone
to sleep (a settled block does not go structurally invisible just because
the contact solver has stopped needing to re-resolve it every frame —
`sleepingWeightOn` reads its geometric resting weight instead). Drag ballast
onto Gallery 12 and the spans carry more load; cut a neighbour and the
survivor's share visibly changes.

The player's own collider set gains one entry per body every frame,
synthesized from its AABB and disabled while the body is tilted past ~25° or
held in hand — the same `moveCapsule` the player always used, now walking on
debris because debris is genuinely there.

The Bay 07 well (≈7 m across) is bridged the same way — not a scripted
crossing, but one asset (`plank_well`, 320 kg) sized and placed so the
general rules resolve it: too heavy to lift or drag by hand (the force
ladder already refuses it), stored on solid ground with zero overhang so it
never tips before anyone touches it, and oriented with its length already
along world Z so the hoist's hook — whose kinematic point is always at
z = 0, the well's own centreline — lowers it dead-center with no
reorientation needed. Hooked, traversed, and set down, it becomes a walkable
span for the same reason any other resting body is: its AABB is a collider.

Fixed alongside it: `moveCapsule`'s ground re-check (`collision.ts`) used a
strict `y < c.maxy` guard, which a capsule resting at exactly `y === c.maxy`
— precisely where the grounding branch snaps it on landing — fails every
following frame it doesn't move. That flipped `grounded` false for one frame
out of every two once genuinely at rest (gravity reapplies, the capsule sinks
a hair, re-lands, flips true, repeats), invisible during normal play because
the position barely moves and jump coyote-time absorbs it, but real: a
motionless player was never reliably `grounded` on anything. `y <= c.maxy`
fixes it for every resting collider, not just bodies.

Declared reduction: contact is corner-point-against-box, not a general
convex solver (edge-on-edge contact between two tilted boxes is
approximated by whichever corners penetrate), there is no joint/constraint
system yet (no hinges, no pulleys, no rope-as-body), and nothing here
deforms or fractures.

## Contextual interaction

Two resolutions run every frame against different budgets:

- **Look target** — a distance-aware reticle cone (about 20° inside 3.5 m,
  tightening to 16° beyond it) out to each object's declared `lookRange`, with
  line of sight. This is what the player is examining, and what inspection
  reads.
- **Action target** — bounded by the object's declared `reach`, its facing
  cone, line of sight, and whether any action is currently eligible. Candidates
  are scored on alignment, proximity and priority, and the incumbent keeps a
  stickiness bonus so the prompt does not flicker between neighbours.

Seeing Carrier 07-A across the bay identifies it and lets it be inspected. It
does not let it be driven: the carrier is operated from its pulpit, like
everything else in the bay.

The eight-tool rail is gone. Every verb it held — inspect, isolate, sling,
brace, jack, cut, operate, talk — still exists, routed by
`actionsFor(state, interactable, ctx)`. A tap performs the dominant action; a
hold opens a compact selector only when more than one action is genuinely
eligible. Rigging remains a deliberate two-stage sequence.

Machine verbs live in temporary modes. Entering a mode shows that machine's
real commands and its readouts; leaving it, or stepping out of reach, clears
every command it was driving.

## Settings

`web/src/game/settings.ts` is the authority. Every entry is backed by real
input handling or a real renderer/scene control: look and touch sensitivity,
invert Y, movement deadzone, auto sprint, gait intensity, FOV, HUD density,
prompt mode, render scale, shadow enable and resolution, secondary light
fixtures, steam particle budget, master volume.

There is deliberately **no** texture-resolution, reflection, volumetric,
post-processing, or antialiasing setting, because this renderer does not
implement those systems and a control that changes nothing is a lie. Settings
persist to `localStorage` and never alter mechanical world truth.

## Delivery

`web` → `vite build` → `android/app/src/main/assets/www` → WebView APK →
GitHub Actions artifact and prerelease. `.github/workflows/android-apk.yml`
builds from `Grok`, `Claude`, and `claude/**`, publishing to a branch-specific
release tag. No step assumes a desktop workstation.

## Tests

`web/tests/authority.test.ts` holds the Act I reference cases, run with
`npm test` in `web/` and gated in `.github/workflows/verify.yml`. They lock
what a player can see, and every one of them can fail:

- off-axis load twists the frame and misaligns the gate seal;
- venting relieves that misalignment;
- yield writes permanent set, hardening arrests the flow, unloading preserves
  the set;
- the hoist refuses a set brake, costs real current to hold, and stays inside
  its current limit;
- sustained overload trips the generator breaker on inverse time, power loss
  sets the fail-safe brake, and shedding a feeder prevents the trip;
- a traverse swings the load and the swing damps;
- identical command streams produce identical authority state;
- save/load preserves set, damage, payout, brake, pressure, vent position,
  mid-motion velocity and broken connectivity, and a legacy save migrates
  without producing non-finite state;
- cutting gallery supports kills the traversal edge and the NPC route;
- every mission predicate reads world state, including that nothing is
  complete at the start and the act will not close on an undecided drive;
- gait offsets stay bounded and vanish entirely at intensity 0;
- a distant machine is identifiable but not actionable, and line of sight is
  enforced.

## Verified here

- `npm run typecheck` — clean.
- `npm test` — 81/81 authority reference checks.
- `npm run build` — production bundle emitted.
- `make test` — native C++ reference cases still pass, unchanged.
- Headless Chromium against the production build: boot → menu → settings →
  new game → intro → play; contextual targeting probed at eight world poses;
  machine mode entered, refused a hoist against a set brake, hoisted after the
  brake was released, and exited on walking away; hold-to-choose selector and
  inspection opened.
- Headless Chromium against the production build with the body layer live:
  a naturally-resting, untouched body (`plate_a`) reports `grounded: true,
  groundedId: "plate_a"` for the player's own capsule standing on it — the
  collision wiring genuinely works, not just the physics in isolation. Grab
  → drag → release cycled correctly through the context/action system, with
  correct out-of-reach messaging at the body's declared 2.3 m reach.
- Headless Chromium touch emulation at 1344x620 and 880x400, both landscape:
  four persistent controls during traversal, dynamic stick appears on contact
  and releases cleanly, analogue magnitude preserved (full deflection 2.55 m/s
  vs part deflection 0.38 m/s), simultaneous move and look, machine verbs
  present only in-mode, no horizontal overflow, no page errors.
- Headless Chromium against the production build, well-bridging end to end:
  `plank_well` rendered at its seeded rest position; context system offered
  it at range; the full authoritative sequence (dock the original payload →
  traverse the carrier west → hook the plank → traverse east → unhook) ran
  through `sim.act`/`sim.advanceAuthorityTick` inside the live page and
  settled the plank at `z ≈ 0`, spanning the well's ±3.42 m edges; the
  player's own `moveCapsule`, unmodified, reports `grounded: true,
  groundedId: "plank_well"` standing on it.

## Sibling branches surveyed, nothing adopted

`ChatGPT` and `Grok` were checked for anything worth taking into this pass.
`ChatGPT` builds its own Rube-Goldberg-style mechanisms (`rube-mechanics.ts`,
`linked-cascade.ts`, `spring-shuttle.ts`) on a separate `RubeState` tree, with
each mechanism's geometry hand-authored as its own constants (`CASCADE`,
lever/ballast/lift parameters) — a second physics authority built from
per-mechanic modules, which is the pattern this substrate exists to replace,
not extend. Its `mechanical-network.ts` (generalized coordinates, cable
length as a function of DOFs, force via virtual work) is a sound primitive in
the abstract, but it is wired to that parallel state tree and its own
mechanism modules, not to `bodies.ts`; adopting it here would mean running
two physics authorities side by side. Left as a noted idea, not pulled in.
`Grok`'s relevant diff is UX polish on `player.ts` (jump buffering, auto
sprint, camera lean from acceleration) — no debris, no well crossing, nothing
that overlaps this pass's work.

## Not verified here

- Frame rate on Fold 6-class hardware, or any device.
- APK install and WebView behaviour on a physical device.
- Fold/unfold ergonomics in hand.
- Rendered image quality on a real GPU. The headless runs use SwiftShader.
