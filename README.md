# GRAVESPIRE

GRAVESPIRE is a Godot 4.7-targeted first-person industrial immersive simulation for Android. The player changes what one persistent megastructure can physically do by operating, loading, bracing, rerouting, breaking, riding, and repurposing coupled machinery and structure.

`docs/GRAVESPIRE-GDD.md` is the binding design authority. Live source, tests, automation, builds, and runtime evidence are implementation truth.

## Current consolidation state

`ChatGPT` is the active consolidation branch. It retains two deliberately distinct execution substrates:

- `web/` + `android/`: the current MC-01→MC-12 vertical machine-skyscraper prototype, including the shared generalized-coordinate mechanical network, athletic traversal, high-altitude fall/recovery loop, atmospheric depth, and Android WebView APK path.
- `game/` + `native/`: the Godot 4.7.2 + portable C++ Bay 07 acceptance slice, retained as the path toward the GDD's final authority architecture rather than treated as a replacement for the taller prototype.

The branch salvage record is in `docs/BRANCH-SALVAGE-MAP.md`.

## Native Bay 07 authority

Portable C++ owns consequential Bay 07 freight/frame/gate state. Godot issues typed commands and renders committed snapshots.

Current native slice includes:

- Fold-first move/look/contextual Action;
- athletic first-person locomotion and moving-support inheritance;
- Carrier 07-A operated locally from its pendant;
- tension-only hoist cable with authoritative unstretched length;
- raise/lower changes winch payout instead of teleporting the carrier;
- finite holding brake with temperature-dependent derate and overload slip;
- pressure isolation gate, frame jack/brace, route predicates, and persistent plastic set;
- Act I local competence derived from a physically open shop route plus carrier receiving-envelope state;
- Android arm64 Godot export automation.

This is not a claim of final GDD co-rotational structure, arbitrary 6-DOF consequential contact, fracture-energy, or adaptive-reduction completeness.

## Web machine-skyscraper prototype

The current web/Android prototype grows Bay 07 into a continuous stacked sequence of giant mechanisms through MC-12. It is the gameplay proving ground for large-scale causal chains, parkour, moving machinery, wind exposure, long falls, parachute recovery, loose consequential ingredients, and physical handoffs between mechanisms.

Its reduced generalized-coordinate mechanics are useful implementation evidence, but they do not supersede the GDD requirement that final critical simulation authority live in portable C++.

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

## Android builds

- WebView skyscraper workflow: `.github/workflows/chatgpt-apk.yml`
- Native Godot Bay 07 workflow: `.github/workflows/godot-android.yml`

The two APKs are intentionally labelled separately so build/runtime claims do not get conflated.
