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

## Grok branch — Act I Android APK

`main` stays the Godot 4.7 + C++ coupling cell. This **Grok** branch keeps that
tree and adds a playable Act I debug APK:

- `web/` — TypeScript authority + Three.js first-person bay (touch-first)
- `android/` — WebView wrapper (WebViewAssetLoader, fold/unfold safe)
- `.github/workflows/android-apk.yml` — builds the APK and publishes
  the `grok-act1-apk` prerelease

Install: open https://github.com/IssisX/GraveSpire-2/releases/tag/grok-act1-apk
and tap `gravespire-act1-debug.apk`. Allow unknown sources if Android asks.

This APK is **not** GDD §7/§16 co-rotational completeness, and it is **not**
the Godot mobile export.
