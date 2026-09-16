# GRAVESPIRE

GRAVESPIRE is a Godot 4.7 industrial immersive simulation targeting
Android. The player changes what a persistent megastructure can physically
do by operating, loading, bracing, rerouting, and breaking coupled machinery
and structure.

`docs/GRAVESPIRE-GDD.md` is the binding design authority. Source, tests,
automation, and builds in this repository are the implementation authority.

## Authority

```
player input → typed command → C++ authoritative simulation → snapshot → Godot presentation
```

Portable C++ owns consequential coupled state (freight carrier, transfer
frame, isolation gate). Godot owns embodiment, world presentation, input,
interaction, and Fold-first controls. Godot Jolt owns player/world/salvage
contact. There is no TypeScript/Three.js simulation on this path.

The `Grok` branch's `web/` + Android WebView APK is a demoted prototype.
It is not the game.

## Current executable slice

First-person Freight Spine Bay 07:

- inhabit the bay, well, recv deck and east gallery;
- Fold-first move / look / contextual Action;
- walk, sprint, crouch, jump, step-over, mantle, ladder, moving-carrier ride;
- operate Carrier 07-A only from the pulpit pendant;
- vent / open the isolation gate from its local panel;
- jack / brace the transfer frame from its local station;
- a pressurized gate cannot be shoved open — venting unloads it, jack/brace
  clears the neck, and the east gallery becomes a physical route;
- recv lamps follow the carrier envelope, not a HUD flag;
- crib/crate salvage are Jolt rigid bodies.

This is not a claim of GDD §16 completeness, co-rotational beams, or
finished industrial parkour.

## Build native reference tests

```sh
make test
```

## Build the Godot extension

```sh
git submodule update --init --recursive
python -m pip install scons
scons api_version=4.7 platform=linux target=template_debug
```

Open `game/project.godot` with Godot 4.7.2.

Android arm64:

```sh
scons api_version=4.7 platform=android target=template_debug arch=arm64
```

GitHub Actions workflow `godot-android.yml` exports
`GRAVESPIRE-android-debug.apk` from `game/project.godot` and the GDExtension
artifact. A WebView APK is not an acceptable proof of this slice.
