# GRAVESPIRE

GRAVESPIRE is a Godot 4.7 industrial immersive simulation targeting
Android. The player changes what a persistent megastructure can physically
do by operating, loading, bracing, rerouting, and breaking coupled machinery
and structure.

`docs/GRAVESPIRE-GDD.md` is the binding design authority. Source, tests,
automation, and builds in this repository are the implementation authority.

## Current executable slice

The opening engineering cell couples three player-manipulable macro systems
through one portable C++ authority:

- suspended freight carrier;
- load-transfer frame;
- pressure isolation gate.

The slice proves the ownership and coupling path. It is not a claim that the
finished nonlinear frame, contact, fracture, or mobile performance contracts
already exist.

## Build native reference tests

```sh
make test
```

## Build the Godot extension

Clone the pinned `godot-cpp` submodule, install SCons, then run:

```sh
git submodule update --init --recursive
python -m pip install scons
scons api_version=4.7 platform=linux target=template_debug
```

Open `game/project.godot` with Godot 4.7.2.

## Authority boundary

The C++ core owns consequential simulation state and committed outcomes.
Godot scripts issue commands and render snapshots. Presentation cannot decide
that a structure broke, a machine succeeded, or a route became valid.

## Act I Android APK — the playable branch

`main` stays the Godot 4.7 + C++ coupling cell. The Act I branches keep that
tree and add a playable Act I debug APK:

- `web/` — TypeScript authority + Three.js first-person bay (touch-first)
- `android/` — WebView wrapper (WebViewAssetLoader, fold/unfold safe)
- `.github/workflows/android-apk.yml` — builds the APK and publishes a
  branch-specific prerelease (`grok-act1-apk`, `claude-act1-apk`)

`docs/ACT-I-WEB-CLIENT.md` is the ownership map and the declared mechanical
reduction for that client. Read it before changing the simulation or the
interaction layer.

This APK is **not** GDD §7/§16 co-rotational completeness, and it is **not**
the Godot mobile export.

### Player-experience pass

The Act I client is built around one control model rather than a tool rail:

- left thumb moves on a dynamic stick, right side looks by direct drag;
- one Action control performs the best thing the world offers where you stand,
  and a hold opens a compact selector only when more than one action is
  genuinely eligible;
- machine verbs — hoist, traverse, brake, release, open, close, vent, wedge,
  jack, brace — appear only while you are operating that machine, and leave
  when you do;
- dense engineering readings live in inspection and in machine panels, not in
  permanent HUD chrome.

Camera embodiment is a procedural gait driven by real movement state. Those
offsets are presentation only: interaction targeting, collision, support and
authoritative player position never see them.
