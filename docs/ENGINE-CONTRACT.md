# Engine contract

## Pinned baseline

- Godot Engine: `4.7.2-stable`
- Godot C++ bindings: tag `10.0.0-rc2`, commit
  `5ed72a0dc2517a8082598a950895c6b24e8aa282`
- Renderer: Mobile
- Player/world contact: Godot Jolt Physics 3D
- Initial target: Android arm64, Fold 6-class hardware

Godot 4.7.2 is the current stable maintenance release as of the repository's
initialization. The project declares 4.7 compatibility and CI/build automation
must pin exact tool artifacts rather than floating `latest`.

## Authority

The portable C++ simulation owns mechanically consequential state, command
commit order, world-condition evaluation, and save-state schema. The Godot
layer owns input, presentation, audio, content assembly, and noncritical debris.

The integration is one-way at the presentation boundary:

```text
input -> typed command -> C++ authority -> committed snapshot -> Godot view
```

Godot scripts cannot independently declare fracture, successful motion,
traversal validity, or mission completion. Derived predicates such as
`gallery_passable`, `neck_walk_clear`, and `carrier_at_recv` are computed
from committed physical state inside C++.

Player locomotion and salvage rigid-body contact use Godot Jolt. That is
not a second gameplay simulation of the coupling cell.

## Current fidelity boundary

Bay 07 is an inhabited first-person location around one lumped
three-body coupling cell. Off-axis loading, persistent plastic set, monotone
damage, finite pressure inventory, and gate misalignment remain authoritative.

The hoist is no longer a kinematic cheat. Unstretched cable length is state.
Winch payout changes length; it does not teleport the load. Tension is
`max(0, k·extension + c·rate)` — a slack cable does not push the frame.
The hoist brake has a rated holding capacity with thermal derate; overload
slips, pays out, and heats. Act I local competence is derived from
`gallery_passable`, `neck_walk_clear`, and `carrier_at_recv`.

The lumped cell does not yet satisfy the finished GDD's co-rotational beam,
shell, contact, fracture-energy, or adaptive reduction acceptance criteria.

Those claims remain unavailable until their versioned reference cases pass.

The `web/` Three.js client and its WebView APK are not an implementation of
this contract.

## Official sources

- Godot 4.7 documentation:
  https://docs.godotengine.org/en/4.7/
- GDExtension C++ example:
  https://docs.godotengine.org/en/4.7/tutorials/scripting/gdextension/gdextension_cpp_example.html
- Renderer feature comparison:
  https://docs.godotengine.org/en/4.7/tutorials/rendering/renderers.html
- Android export:
  https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_android.html
- Godot 4.7.2 release:
  https://godotengine.org/article/maintenance-release-godot-4-7-2/
