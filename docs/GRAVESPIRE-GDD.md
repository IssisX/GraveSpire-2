GRAVESPIRE

Game Design Document — Godot 4.7 edition

Design status: This document specifies the intended game. It does not claim that its custom simulation, performance targets, or Godot integration have been implemented or verified.

Source authority: IssisX/GraveSpire-2. This repository is the sole authority for project source, configuration, tests, automation, builds, and implementation history. GRAVESPIRE targets Godot 4.7.x; CI pins an exact maintenance release while project compatibility remains on the Godot 4.7 line.


---

1. The game

GRAVESPIRE is a single-player, first-person industrial immersive simulation inside a persistent, 1.6-kilometer megastructure. The player is a reclamation specialist navigating an inhabited machine whose transport, power, processing equipment, and supporting structure have become dangerously interdependent.

The objective is not to demolish everything. It is to gain access, recover valuable systems, protect or exploit inhabitants, and ultimately determine which parts of the megastructure remain operational.

The defining experience is learning to change what the building can physically do.

A walkway is simultaneously a route, a loaded structure, a mounting surface, and potentially a brace. A freight carrier is transportation, suspended mass, stored gravitational energy, and an improvised counterweight. A severed service line is not merely visual damage: it can strand machinery, isolate a district, or eliminate a hazard.

The player progresses from operating equipment to rearranging the dependencies that make equipment useful.

The emotional progression

Initially, the spire is intimidating: enormous loads, obscure noises, inaccessible platforms, machinery whose operation is only partly understood. Familiarity turns that intimidation into anticipation. The player begins recognizing what is carrying weight, what is holding something back, and which dependency can be changed.

Mastery should feel like this:

> “That crane cannot lift the gate. But it can unload the hinge bearing, which lets the jack rotate the gate, which gives me somewhere to anchor the freight cable.”



The game rewards mechanical understanding without requiring the player to solve equations.

What it is not

It is not a conventional shooter with destructible scenery, a sequence of predetermined engineering puzzles, or a simulation dashboard with a character attached. It is not an unrestricted engineering package, either: the world supplies coherent industrial components with understandable operating envelopes.

Sophistication belongs in the consequences, not in the number of buttons.


---

2. Player embodiment and control

The player is physically present, vulnerable to falls, crushing, heat, and moving equipment. They are capable of climbing and industrial work, but cannot drag multi-tonne objects by hand or overpower a loaded mechanism.

First-person presentation provides accurate targeting and preserves the scale of machinery. A contextual inspection camera may show attachment geometry or machine clearance, but does not grant remote interaction.

Movement

The movement vocabulary is walk, sprint, crouch, jump, mantle, climb, and tether-assisted movement.

Movement must respect changing supports:

Standing on a moving platform inherits its contact-point velocity.

Jumping from rotating equipment preserves the relevant departure velocity.

A loaded climbing anchor transfers force into its supporting structure.

A platform can remain physically crossable after an NPC judges it unsafe.

Losing support produces a fall or a reachable recovery action, not an invisible replacement floor.


The character controller may use gameplay assistance for stepping and mantling. Those assists cannot create support, cancel a meaningful fall, or pull the player through solid geometry.

Fold-first controls

Landscape play is the primary layout. The unfolded display receives expanded inspection information; the outer display retains the same capabilities with less simultaneous information.

The control model uses left-thumb movement, right-thumb view, a primary action, and a contextual secondary action. Holding the interaction control opens a compact tool/action selector. No essential action requires three simultaneous touches.

Rigging is a deliberate sequence: select the first attachment, inspect the reachable second attachment, preview the connection, then commit. The preview shows physical incompatibilities—reach, clearance, attachment type—not a guaranteed prediction of success.

Machine controls use understandable physical commands: raise/lower, extend/retract, open/close, drive/brake. Touch assistance smooths the requested control input; it does not bypass acceleration, traction, torque, or load limits.


---

3. The core loop

Observe → interpret → prepare → intervene → exploit → live with the result.

Observation identifies routes, active loads, damaged connections, machine state, and occupants. Preparation includes isolating power, adding a brace, positioning a carrier, anchoring a line, or moving people away. Intervention changes an actual physical or operational condition.

The reward is often a new capability rather than an item: a functioning lift, a stable shortcut, an accessible maintenance route, a controllable machine, or a district that can support further work.

Every meaningful intervention changes the next decision. Cutting a route open may also remove the machinery needed to move recovered cargo through it.

The competing values

Three pressures prevent “destroy everything” from becoming the dominant strategy:

Access: Can the player reach and move through the world?

Operational value: Which machinery, services, and recoverable components remain useful?

Human consequence: Who can still move, work, escape, or receive essential supplies?

These pressures are not collapsed into one universal score. A successful extraction can leave an operational disaster. Preserving a district can cost valuable equipment. The campaign acknowledges those differences.


---

4. The persistent world

The spire is one connected industrial place, divided into districts for navigation, streaming, and production—not separate challenge arenas that reset.

Its principal district types are:

District	Physical character	Strategic importance

Freight Spine	Suspended carriers, transfer gantries, counterweights, vertical routes	Moves people, tools, and recovered equipment
Load-Transfer Galleries	Trusses, braces, transfer floors, expansion connections	Carries loads between districts
Process Works	Hot equipment, pressure vessels, service manifolds, heavy gates	Produces useful output and persistent hazards
Service and Habitation Bands	Distribution boards, workshops, occupied circulation routes	Supplies, recovery, inhabitants, alternate access
Upper Transfer Works	Long spans, exposed machinery, stressed infrastructure junctions	Concentrates the consequences of earlier decisions


Freight Spine Bay 07 is the opening location of the finished game. It teaches operation, inspection, unloading, and rerouting through ordinary objectives. It is not a disposable demonstration environment.

World construction rules

Every major district requires multiple meaningful connections to the rest of the spire: transport, structural support, power, services, or occupied routes. These connections must matter during play.

The entire visible megastructure is not a uniformly detailed deformable solid. Structural resolution follows gameplay significance. Primary load paths and district interfaces remain represented globally; local structures receive more detail where bending, contact, damage, or player intervention requires it.

A district outside the camera does not cease carrying weight.

Fixed foundations and non-interactive boundaries are explicit world properties. An ordinary-looking support must not secretly become indestructible merely because a mission depends on it.


---

5. The three principal physical systems

These are substantial things the player manipulates. Motors, breakers, valves, and heat models deepen them; those supporting mechanisms are not substitutes for major gameplay systems.

5.1 Freight and lifting assemblies

Suspended carriers, traveling gantries, winches, counterweights, and docking structures form a connected material-handling system.

The player can lift, lower, traverse, redistribute cargo, rerig supported attachment points, brake, release, and brace. Outcomes depend on mass distribution, rope geometry, available drive torque, braking capacity, attachment strength, and the structure carrying the machinery.

An offset load twists its carrier and changes support reactions. A stalled drive draws current. A descending load can back-drive the mechanism. A brake can hold after power loss if its design is mechanically fail-safe; another mechanism may coast. These are component properties, not a universal “power off means drop” rule.

Freight assemblies can become bridges, moving cover, temporary supports, or controlled sources of impact.

5.2 Load-bearing architecture

Walkways, long-span galleries, transfer frames, braces, and suspended decks are manipulable structural assemblies.

The player can unload, brace, jack, pull, cut, disconnect, climb, and deliberately redistribute forces. A damaged structure can remain useful without becoming pristine again.

The important distinction is between damage and loss of function. A bent member may still carry load. A visually intact connection may have slipped enough to jam a machine. A cracked walkway may remain traversable by the player but unsuitable for a loaded carrier.

Progressive failure must reveal alternative load paths. Removing one support does not necessarily cause collapse; it may transfer demand into neighboring members until a different connection yields.

5.3 Process and isolation assemblies

Large isolation gates, pressurized vessels, duct manifolds, and their supporting frames create the third family of manipulable machinery.

The player can isolate, vent, reroute, drain, jack, wedge, brace, and breach. Pressure and thermal state affect the force required to operate equipment. Distorted supports can misalign seals, jam gates, or tear attached lines.

A gate under pressure is not a door with a larger interaction timer. A drained vessel changes structural loading. A ruptured line changes network behavior and creates a physically bounded discharge.

Fluid and gas simulation serves those consequences. The game does not require a full three-dimensional fluid solver everywhere to represent pressure, inventory, leakage, or thrust.

Cross-system requirement

Each principal system must support both constructive and destructive use. A capability that only creates a one-time explosion or collapse is insufficient.

Broken material remains mechanically useful when its size and state permit it. A fallen beam can obstruct a gate, support a ramp, or increase the load on another deck.


---

6. Tools, resources, and progression

The player begins with inspection, basic isolation, and limited rigging capability. Progression expands the space of possible interventions rather than granting arbitrary percentage bonuses.

Tool families

Inspection equipment reveals electrical state, temperature, alignment, load estimates, and accessible connection details. Measurements have limited coverage and confidence. The interface must distinguish a measured quantity from a structural prediction.

Rigging equipment includes rated lines, slings, shackles, clamps, and portable winches. Attachment geometry matters. A clamp suitable for a flange is not automatically suitable for a smooth vessel wall.

Support equipment includes jacks, props, spreaders, wedges, and replacement connectors. Installation creates actual constraints, preload, and load paths.

Cutting and disassembly equipment removes material or connections through work performed over time. It does not apply abstract structural damage points. Cutting a loaded member changes its remaining section and can alter behavior before separation.

Isolation and service equipment provides access to distribution boards, mechanical overrides, valves, and local controls.

Progression principles

Better equipment changes reach, capacity, precision, access, portability, or information quality. Player knowledge remains valuable across the campaign.

Repair does not erase history. A patch creates new mechanical properties. Replacing a connector restores that connector; it does not straighten a plastically bent frame. Straightening requires work and may leave reduced reliability.

There is no generic crafting economy built from interchangeable scrap. Useful salvage has identifiable functions: a compatible drive, intact brake, rated connector, serviceable cable, or usable structural section.


---

7. The structural mathematics

7.1 Required representation

The structural model is a three-dimensional nonlinear frame-and-surface system with adaptive reduction.

For frame members, the baseline is a co-rotational beam formulation with:

Three translational and three rotational degrees of freedom per node.

Axial response, bending about both principal axes, shear, and torsion.

Section orientation, eccentric attachments, and connection offsets.

Geometric stiffness and large-displacement effects.

Persistent material and connection history.


Co-rotation separates large rigid rotation from local deformation; it is not itself a complete material law or a guarantee of nonlinear robustness. Three-dimensional co-rotational structural formulations are established methods. OpenSees formulation reference

A beam is mathematically represented along its length, but operates in a three-dimensional world and carries three-dimensional forces and moments. That is not a two-dimensional game or a planar truss approximation.

Timoshenko-type shear flexibility is required where member proportions make shear deformation significant. Slender-member limits must recover appropriate beam behavior without locking.

7.2 Governing state

At the mechanical level:

\[
M(q)\ddot q+h(q,\dot q)+f_{\mathrm{int}}(q,z,T)
=
f_{\mathrm{ext}}+J(q)^\mathsf{T}\lambda
\]

Here, \(q\) contains generalized positions and orientations; \(z\) contains irreversible material and connection state; \(T\) is thermal state; and \(\lambda\) represents constraint/contact forces. Impulse-based contact updates use the corresponding momentum equation, not forces with impulse units accidentally substituted.

The solver must retain the state needed to distinguish:

A structure that has never been loaded.

One currently bent elastically.

One unloaded after yielding.

One partially fractured.

One repaired or braced in its deformed configuration.


A single “structural health” value cannot represent those differences.

7.3 Plasticity and history

Beam sections use a constitutive model capable of coupled axial and bending response. Fiber-section integration is an appropriate baseline for distributing longitudinal yielding across a cross-section; shear and torsional behavior require explicit additional treatment.

Persistent state includes plastic strain or equivalent plastic section variables, hardening history, damage, and accumulated dissipated work.

The following behaviors are mandatory:

Permanent set: Unloading does not erase plastic deformation.

Load-path dependence: Applying, removing, and reversing loads can produce different responses.

Temperature dependence: Heating changes material behavior rather than merely accelerating a damage timer.

Connection hysteresis: Slipped or yielded connections do not behave like untouched connections after unloading.

Cyclic degradation is included where repeated machine operation creates meaningful gameplay. Full lifetime fatigue prediction for every bolt is outside the design.

7.4 Buckling and failure

Global member and assembly buckling must emerge from geometry, stiffness, loading, and realistic imperfections. A force threshold alone cannot create credible buckling behavior.

The model distinguishes:

Elastic instability.

Plastic hinging and redistribution.

Connection slip or separation.

Tensile rupture.

Shear failure.

Local section deterioration where supported by the chosen representation.


Ordinary beam elements do not automatically reproduce thin-wall local buckling, cross-section crushing, or arbitrary tearing of sheet metal. Those phenomena require calibrated section laws or localized shell models.

The game must not advertise those capabilities on objects whose representation cannot express them.

Damage evolution is regularized by a physical length or fracture-energy treatment so subdividing a member does not arbitrarily change its toughness. Breaking a connection changes topology; it is not merely permission to play a fracture animation.

7.5 Decks, plates, and attachment surfaces

Walkable decks need more than beams underneath an unrelated flat collision mesh. Load distribution and deformed walking surfaces must come from a compatible plate, shell, or calibrated structural-panel representation.

Detailed shell behavior is reserved for surfaces whose bending, tearing, or local collapse changes play. Minor cladding can use simpler breakable panels, but its reduced fidelity must not leak into primary structural behavior.

7.6 Reduced-order simulation

Undamaged or mildly disturbed regions may use component-mode reduction. Boundary degrees of freedom remain available so adjacent structures exchange forces and motion. Craig–Bampton-style component reduction provides an established basis for this approach. NASA component-flexibility reference

The reduction is valid only within an identified operating envelope. Significant damage, new contact, changed supports, or large local deformation can invalidate it.

When that happens, the system must enrich or replace the reduced representation while preserving configuration, momentum, internal state, and accounted energy. Continuing to use an intact precomputed stiffness matrix after a major load-path failure is prohibited.

Reduction removes computational redundancy, not consequences.


---

8. Machines, cables, electricity, and heat

Cables and rigging

Cables are tension-only elements. A slack cable does not push.

Their state includes unstretched length, extension, tension, attachment geometry, and relevant damage. Winch payout changes available length; it does not directly teleport the load.

A straight analytical span is valid only where sag, distributed mass, and intermediate contact are negligible. Longer spans use an appropriate sagging-cable representation. Player-adjacent wrapping, snagging, or whipping requires promotion to a contact-capable segmented model.

Promotion must preserve mass, length, tension state, and momentum. It cannot introduce a second invisible cable that also carries the load.

A sling contacting an edge must resolve that contact or reject the configuration. Visually passing through a beam while transmitting force around it is unacceptable.

Electromechanical response

A representative motor model is:

\[
L\dot i=V-R(T)i-k_e\omega,
\qquad
\tau_m=k_t i
\]

The actual drive assembly adds transmission ratio, inertia, losses, control limits, and its electrical supply model. These equations describe an appropriate motor abstraction, not every motor topology.

The consequences are important: acceleration changes current demand; stalled machinery can overheat; lowering a load can return mechanical power to the drive. Regenerated power must go to a receptive supply, storage, or a dissipative braking path—not disappear while the system claims energy consistency.

Controllers have saturation and anti-windup. A command to maintain position is not an infinite-force constraint.

Brakes and mechanical limits

Brakes have distinct holding and slipping regimes, torque capacity, wear where relevant, and thermal behavior. Frictional work heats the brake. Rated overload, power-loss behavior, and manual release are properties of the specific mechanism.

Backlash, end stops, clutch slip, and bearing misalignment are represented where they change player decisions.

Electrical infrastructure

Electrical distribution is a network of conductors, sources, protection devices, and loads with finite capacity.

Network equations enforce current balance and appropriate component voltage-current relationships. Disconnected islands are handled explicitly; the solver must not hide a singular circuit behind arbitrary numerical leakage.

Breakers use a defined protection characteristic with thermal memory where appropriate. A brief startup surge and sustained overload need not produce the same outcome.

Broken or displaced structure can sever conductors. Wet or damaged equipment can create modeled faults. Electrical state changes lighting, machinery, access, and hazards through real consumers.

Thermal behavior

Thermal state is spatially resolved enough to distinguish local heating and meaningful temperature gradients:

\[
C_i(T)\dot T_i=
\sum_j G_{ij}(T_j-T_i)
+P_i-Q_{\mathrm{conv},i}-Q_{\mathrm{rad},i}
\]

Temperatures use kelvin internally. Sources include electrical losses, braking, process equipment, and player tools.

Structural response includes thermal expansion as well as temperature-dependent stiffness and strength. Uneven heating can bend a member; restrained expansion can create force before strength loss dominates. Temperature-dependent structural-steel behavior should be calibrated against suitable published material data, not one invented universal curve. NIST constitutive-data publication

Cooling does not undo plasticity or fracture. Where the material model includes irreversible thermal degradation, that history also persists.

Pressure and process networks

Vessels conserve inventory and energy within their declared fluid model. Lines and valves govern flow through pressure difference and resistance; gas storage includes compressibility where required.

Pressure acting on a gate generates force through area and orientation. Discharge can generate reaction force, heat transfer, and hazards.

Fluid hammer, detailed turbulence, and arbitrary multiphase flow are not universal promises. A machine whose intended behavior requires one of those phenomena needs a specific supporting model before that behavior becomes part of the game.


---

9. Contact, coupling, and numerical robustness

This is the most consequential technical boundary.

Godot’s documented Jolt integration reports estimated contact impulses that are not generally accurate for bodies involved in multiple simultaneous contacts. Those values cannot be treated as exact structural reaction measurements. Godot’s contact-impulse limitation

Ownership

The C++ simulation owns load-bearing structures, critical machinery, rigging, and mechanically consequential contact. Critical contacts must resolve against the effective inertia and compliance of the participating rigid and deformable bodies.

A collision backend may provide geometric contact information. The coupled mechanical solution determines the authoritative reaction.

Built-in Jolt can own noncritical rigid-body motion and secondary debris. An object that can become a brace, counterweight, damaging projectile, or mission obstruction is mechanically critical and must enter the authoritative coupling path before that interaction occurs.

The same collision cannot be resolved once by Jolt and again by the structural solver.

Contact requirements

Normal contact is unilateral: surfaces resist penetration but do not attract each other. Friction obeys an explicit stick/slip model. Fast, consequential bodies require continuous collision handling or a defensible time-of-impact treatment.

Contact loads enter structures at their actual locations, with corresponding moments. A load applied to one edge of a platform cannot be smeared evenly across all supports for convenience.

The model must distinguish structural failure from separation of an ordinary contact. A beam resting on a wall is not welded to it.

Time integration

The 30 Hz authority tick is retained for command ordering and committed world state. It is not a claim that stiff mechanics can be accurately integrated in one 33.3 ms step.

A 120 Hz mechanical schedule is the initial design baseline, with bounded refinement for difficult events. The final substep requirements depend on convergence and device measurements.

Nonlinear implicit integration with controlled high-frequency dissipation is the baseline for structural dynamics. Generalized-alpha is a candidate method; its linear stability properties do not establish unconditional robustness for arbitrary nonlinear contact and fracture. OpenSees numerical-method cautions

Within a substep, tightly coupled electrical, machine, structural, and contact variables must be solved or iterated consistently. An ordered event bus distributes committed consequences; it is not a replacement for the coupled equations.

Failure handling

The numerical implementation must distinguish physical instability from solver failure.

A failed nonlinear iteration does not mean “collapse the object.” The system retries through a bounded, deterministic refinement policy. An unrecoverable solve retains the last valid state and produces an explicit diagnostic; it must not silently commit NaNs, teleportation, or arbitrary force clamping.

All participating quantities have defined units, frames, ownership, and update timing. Critical state uses double precision internally; conversion to engine coordinates occurs at controlled boundaries.


---

10. Fracture aftermath and conservation

When connectivity changes, disconnected components inherit their mass, geometry, motion, and material history.

Rigid conversion preserves total linear and angular momentum to the stated numerical tolerance. Elastic energy is not automatically converted into a theatrical outward burst. Any released energy must be partitioned between continued motion, fracture, plastic dissipation, heat, and modeled loss.

A detached assembly can remain deformable if later bending matters. Otherwise, a rigid approximation retains its deformed shape and meaningful mass properties.

Persistence of useful debris

Debris is classified by consequence:

Mechanically consequential debris remains authoritative while supporting, obstructing, loading, or threatening something.

Settled inactive debris may use a sleeping or aggregated representation that preserves relevant occupied volume, mass, and support relations.

Purely visual fragments can be pooled and removed. They may not carry meaningful load or block a route.

A player must never return to find that a strategically placed wreckage brace vanished because a particle lifetime expired.


---

11. Traversal, inhabitants, and opposition

Traversal truth

Traversal is a dedicated graph derived from actual geometry and structural state. Connections describe walking, climbing, jumping, tethering, or riding machinery.

An edge carries conditions such as clearance, slope, relative velocity, support continuity, hazard exposure, and load suitability. Structural changes invalidate affected connections before AI commits to using them.

Navigation meshes can help with local movement on stable surfaces. They do not own the truth of whether a moving, damaged, or disconnected route exists.

Player and NPC judgments differ without requiring separate worlds. The player can attempt an unsafe crossing. An NPC may reject it because of a conservative risk model.

Any displayed “safe load” is an estimate under stated assumptions, not a magical globally exact answer.

Inhabitants

NPCs have destinations, jobs, equipment access, relationships, and limited knowledge. They do not orbit the player by default.

Their goals include keeping routes open, maintaining services, protecting equipment, moving cargo, rescuing someone, or preventing unauthorized intervention.

They perceive motion, sound, visible damage, instruments, and reports. A person who cannot see a remote breaker does not instantly know its state unless an information path exists.

Physical behavior

NPCs wait for docking, withdraw from failing supports, seek alternatives, operate available controls, and become stranded when access genuinely disappears.

Rescue involves changing physical access or moving the person with supported equipment. A scripted rescue flag cannot replace the problem.

Opposition uses the same world: isolating a supply, moving a carrier, securing a gate, or defending a control station. Enemies do not receive infinite torque, free power, or inaccessible traversal merely to maintain difficulty.

Combat is secondary. It creates immediate pressure and positional choices, but defeating an opponent does not repair the machine or restore the route they were controlling.


---

12. Missions and campaign structure

Missions specify outcomes and constraints, not one mandatory sequence of interactions.

Typical outcomes include restoring freight access, recovering an intact component, evacuating occupants, isolating a hazardous process, or preventing failure from spreading into an occupied district.

Success predicates refer to world state:

The required destination is actually reachable.

Cargo physically arrives.

The recovered component retains required functionality.

A service remains available to specified consumers.

A structure carries the required load without violating the mission’s conditions.


Example: recover a freight drive

A valuable drive is mounted on a distorted transfer assembly. Occupants need the adjacent route, and removing the drive’s supply also disables equipment elsewhere.

The player might:

Restore enough alignment to operate the carrier normally.

Unload and brace the assembly, then remove the drive mechanically.

Reroute power and use another machine as temporary handling equipment.

Accept damage to part of the freight route and recover the drive through a lower gallery.


The game recognizes consequences, not a hidden preferred solution.

Campaign progression

The campaign develops through three shifts in responsibility:

Local competence: Learn equipment, recover access, establish a usable workshop and return routes.

District interdependence: Interventions affect inhabited areas and competing users of shared services.

System-scale choice: Preserve, isolate, repurpose, or abandon major parts of the spire based on the world the player has created.

The conclusion evaluates persistent operational and human outcomes. It does not restore the building for a final cutscene.

Avoiding softlocks

Recoverability is designed into route and tool availability, not imposed through invisible indestructibility. Multiple industrial access paths, manual overrides, recoverable equipment, and explicit abandonment options prevent a single broken mechanism from silently ending the campaign.

A catastrophic player decision may make a particular objective impossible. The game must acknowledge that and change the objective state. It must not conceal impossibility behind an active quest marker.


---

13. Information, graphics, and sound

Reading the world

The world provides physical evidence before asking for technical interpretation: carrier lean, cable sag, slipping connections, distorted door gaps, changing motor pitch, moving dust, failing lights, and deformed walking surfaces.

Not every failure has a long warning. Brittle failures can be abrupt. Fairness comes from inspectable conditions and consistent rules, not a mandatory countdown.

Inspection overlays expose actual measurements and estimates with units and provenance. A damage tint is optional information, not the sole way to understand the environment.

Visual direction

Industrial realism comes from scale, material response, machinery articulation, credible construction, and coherent lighting—not layers of bloom and fog.

The material library uses consistent physical scale, surface families, trim sheets, and packed texture channels. Damage presentation follows authoritative state: exposed fracture surfaces, changed geometry, displacement, temperature, and contamination where modeled.

Deformed geometry needs compatible normals and collision. A shader-bent beam over an undeformed collider is not acceptable for a load-bearing object.

Godot’s Mobile renderer is the Android baseline. Its documented feature set excludes several desktop techniques, including SDFGI, screen-space reflections, and volumetric fog; the visual design cannot depend on them. Godot renderer comparison

Stable architectural regions can use baked lighting where a reproducible baking path exists. Changeable areas require lighting that does not leave permanent shadows of demolished structures. A GPU-dependent content process cannot be assumed available merely because APK compilation works in CI.

Sound

Sound communicates mechanical state: motor load, brake slip, contact events, structural vibration, and pressure release.

High-frequency resonance can be synthesized from reduced vibration information without running the structural solver at audio rate. Acoustic presentation reads physical state; it does not apply additional physical energy to the simulation.

Music supports isolation and escalation, but machinery remains legible. Excessive camera shake, motion blur, and constant warning noise cannot compensate for weak feedback.


---

14. Saving, determinism, and world continuity

A save captures the authoritative world at a consistent committed boundary.

It includes structural configuration and velocity, plastic and damage state, broken connectivity, connection slip, cable payout, machine state, thermal and electrical history, pressure/inventory state, consequential debris, NPC state, mission predicates, simulation time, and random-stream state.

Saving only residual capacity is forbidden. Reconstructing a damaged frame from its original geometry destroys the state that makes the game persistent.

Resume behavior

Loading a save during deformation resumes the stored motion and internal state. It does not settle everything, recreate an intact structural basis, or reset a slipping brake.

Derived traversal and rendering data are rebuilt from restored authority and versioned content. Solver caches may be rebuilt, but doing so must not change material history.

Save writes are transactional and versioned. Android backgrounding pauses simulation; reopening the app does not integrate hours of uncontrolled elapsed wall time.

Death loads an explicit save state. Any rewind resets all coupled systems to that state, not just player position.

Determinism boundary

Commands, authoritative event ordering, state transitions, and seeded variation are reproducible within the supported numerical contract.

Bit-identical cross-device debris motion is not promised. Small numerical differences near an unstable bifurcation may alter fine fracture details. They must not produce arbitrary changes in unrelated mission logic or duplicate events.

Visual settings cannot alter structural strength, failure laws, or the availability of player actions.


---

15. Godot architecture and mobile feasibility

The game consists of one portable C++ simulation core, a Godot integration layer, and presentation/content systems.

C++ owns authoritative simulation, world-condition evaluation, and persistence state. GDScript can request actions and present results. It cannot independently decide that a structure broke, a machine moved successfully, or a route became valid.

Godot nodes are views and interaction surfaces, not one node per numerical degree of freedom. The simulation uses compact indexed storage with stable identifiers and bounded hot-path allocation.

Whole-spire scaling

The world uses three computational levels:

Global: Structural interfaces, network connectivity, district conditions, and consequential long-range changes.

Active: Detailed mechanics, local contact, traversal, and occupants around current activity.

Dormant: Persisted history and valid reduced state for inactive regions.

Activation depends on causal relevance, not camera distance alone. A remotely heated support or a load transfer can wake a region before the player reaches it.

A district boundary may not be replaced with an infinitely rigid support merely because the adjacent district is unloaded.

Performance contract

The existing project’s 45 FPS sustained active-bay target on Fold 6-class hardware remains the target, not a verified result. Sixty FPS is desirable but does not control architecture.

The 45 FPS target corresponds to approximately 22.2 ms per rendered frame. Simulation, rendering, streaming, and platform work must fit their overlapping CPU/GPU budgets under sustained thermal conditions—not just during a short cold-device run.

No honest GDD can derive a supported count of nonlinear members, contacts, or NPCs without implementation measurements.

When over budget, reduce visual cost, redundant simulation detail, or simultaneous active extent before removing meaningful physical behavior. A structural-quality slider that secretly weakens or strengthens the world is prohibited.

Phone-only production

GitHub remains source authority and remote build automation produces installable APKs. No required production step may depend on Cory owning a desktop.

Procedural assembly tools and text-authored scene data support remote content work. The Android editor is optional assistance, not a mandatory manual step for every build.

Remote compilation, rendered evidence, and Fold execution are separate capabilities. Successful compilation does not imply access to a GPU renderer or an Android test device.


---

16. Non-negotiable acceptance criteria

These are requirements of the finished systems, not a prototype roadmap.

Capability	What must be demonstrably true

Three-dimensional structure	Off-axis loading produces appropriate bending, torsion, and unequal reactions
Objectivity	Rigid translation or rotation alone does not create strain or damage
Elastic response	Supported benchmark cases converge toward analytical or independently computed solutions
Plasticity	Unloading preserves permanent set; reloading uses the altered internal state
Buckling	Geometry, restraint, imperfections, and load direction affect instability
Load redistribution	Losing a member changes forces in surviving paths before consequences are committed
Thermal coupling	Free expansion and restrained expansion produce different responses
Contact	Critical loads and moments enter at actual contact locations without double application
Fracture	Separation changes connectivity and respects accounted mass, momentum, and energy
Resolution	Refinement does not arbitrarily change material strength or fracture energy
Machinery	Torque, power, braking, and thermal limits constrain motion
Traversal	Deformation and topology changes alter actual available routes
NPC behavior	Decisions use reachable routes and perceived information
Persistence	Mid-motion save/load restores deformation, history, motion, and dependencies
Mobile operation	Sustained device measurements meet the chosen performance contract
Presentation	Visible deformation and mechanically relevant collision remain consistent


Each numerical capability requires versioned reference cases, stated units, and explicit tolerances. “Looks plausible” is not sufficient evidence of structural correctness. Conversely, a perfect solver does not excuse unreadable controls or tedious missions.


---

17. Binding exclusions and future implementation rules

The following substitutions would change GRAVESPIRE into a weaker game and are not permitted without an explicit design revision:

Structural health bars replacing mechanical state.

Planar trusses standing in for all three-dimensional structural behavior.

Scripted collapse sequences presented as emergent failure.

Unlimited-force motors, grabs, brakes, or character actions.

Cosmetic deformation over unchanged load-bearing collision.

Unloaded districts losing physical consequences.

Deletion of useful debris to conceal performance problems.

Arbitrary full-volume fracture claims backed only by predefined panels.

Global stiffness reduction used as a substitute for missing local deformation.

Solver nonconvergence interpreted as physical failure.

A second authoritative simulation hidden in presentation scripts.

Repeated engine changes in place of addressing a demonstrated limitation.


The game does not promise engineering-certified accuracy, arbitrary destruction of every rendered surface, or simultaneous full-resolution simulation of the entire spire. Those are different projects with different computational requirements.

It does promise that its important physical objects behave consistently within explicitly supported models, remember what happened to them, and remain available for further interaction.

GRAVESPIRE’s quality comes from a world whose history changes its possibilities. The player does not merely break the building. They learn how to make the damaged building work differently.
