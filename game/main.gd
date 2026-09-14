extends Node3D

var simulation: SimulationBridge
var carrier := MeshInstance3D.new()
var frame_beam := MeshInstance3D.new()
var gate := MeshInstance3D.new()
var cable := MeshInstance3D.new()
var status := Label.new()
var camera := Camera3D.new()

const ACTIONS := [
	["LIFT", "carrier_raise", true],
	["LOWER", "carrier_lower", true],
	["TRAVERSE ◀", "carrier_left", true],
	["TRAVERSE ▶", "carrier_right", true],
	["BRAKE", "carrier_brake", false],
	["JACK FRAME", "frame_jack", true],
	["BRACE", "frame_brace", false],
	["CUT BRACE", "frame_cut_brace", false],
	["VENT GATE", "gate_vent", true],
	["OPEN GATE", "gate_open", true],
	["CLOSE GATE", "gate_close", true],
	["WEDGE", "gate_wedge", false],
]

func _ready() -> void:
	simulation = SimulationBridge.new()
	add_child(simulation)
	_build_world()
	_build_controls()

func _box(size: Vector3, color: Color) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = 0.72
	material.roughness = 0.43
	mesh.material = material
	node.mesh = mesh
	add_child(node)
	return node

func _build_world() -> void:
	var world := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("#05090c")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#6c8291")
	environment.ambient_light_energy = 0.55
	world.environment = environment
	add_child(world)

	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-58.0, -34.0, 0.0)
	light.light_color = Color("#ffd9ad")
	light.light_energy = 2.2
	light.shadow_enabled = true
	add_child(light)

	frame_beam = _box(Vector3(13.0, 0.65, 0.85), Color("#48545a"))
	frame_beam.position = Vector3(0.0, 4.8, 0.0)
	carrier = _box(Vector3(4.2, 1.0, 3.0), Color("#b66a24"))
	cable = _box(Vector3(0.09, 4.0, 0.09), Color("#b9c1c4"))
	gate = _box(Vector3(0.65, 5.2, 4.2), Color("#33434c"))
	gate.position = Vector3(5.0, 1.8, -1.0)

	for x in [-6.0, 6.0]:
		var column := _box(Vector3(0.85, 8.0, 0.85), Color("#283138"))
		column.position = Vector3(x, 0.7, 0.0)

	var floor_node := _box(Vector3(18.0, 0.4, 12.0), Color("#1d252a"))
	floor_node.position = Vector3(0.0, -3.15, 0.0)

	camera.position = Vector3(14.5, 8.6, 17.5)
	camera.look_at_from_position(camera.position, Vector3(0.0, 1.5, 0.0))
	add_child(camera)

func _build_controls() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := MarginContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("margin_left", 28)
	root.add_theme_constant_override("margin_top", 24)
	root.add_theme_constant_override("margin_right", 28)
	root.add_theme_constant_override("margin_bottom", 24)
	layer.add_child(root)
	var layout := VBoxContainer.new()
	root.add_child(layout)

	var title := Label.new()
	title.text = "GRAVESPIRE  /  BAY 07 COUPLING CELL"
	title.add_theme_font_size_override("font_size", 28)
	layout.add_child(title)
	status.add_theme_font_size_override("font_size", 18)
	layout.add_child(status)
	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	layout.add_child(spacer)
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	layout.add_child(grid)

	for definition in ACTIONS:
		var button := Button.new()
		button.text = definition[0]
		button.custom_minimum_size = Vector2(0.0, 74.0)
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.add_theme_font_size_override("font_size", 17)
		if definition[2]:
			button.button_down.connect(
				func(): simulation.set_action(definition[1], true))
			button.button_up.connect(
				func(): simulation.set_action(definition[1], false))
		else:
			button.pressed.connect(func():
				simulation.set_action(definition[1], true)
				simulation.set_action(definition[1], false))
		grid.add_child(button)

func _process(_delta: float) -> void:
	if simulation == null:
		return
	var state: Dictionary = simulation.snapshot()
	var deflection: float = state.frame_deflection_m
	var twist: float = state.frame_twist_rad
	frame_beam.position.y = 4.8 - deflection * 7.0
	frame_beam.rotation.z = twist * 3.0
	carrier.position = Vector3(
		state.carrier_lateral_m,
		state.carrier_height_m - 2.0 - deflection * 7.0,
		0.0)
	var cable_length: float = max(0.2, 4.8 - carrier.position.y)
	cable.scale.y = cable_length / 4.0
	cable.position = Vector3(
		carrier.position.x,
		carrier.position.y + cable_length * 0.5 + 0.5,
		0.0)
	gate.rotation.z = -state.gate_angle_rad
	gate.rotation.x = state.gate_misalignment_m * 2.4
	status.text = (
		"LOAD %5.0f kN   FRAME %+6.1f mm / %+5.2f°   " +
		"SET %+5.1f mm   DAMAGE %3.0f%%\n" +
		"GATE %5.0f kPa   MISALIGN %+5.1f mm   TICK %d") % [
		state.cable_tension_n / 1000.0,
		state.frame_deflection_m * 1000.0,
		rad_to_deg(state.frame_twist_rad),
		state.frame_plastic_set_m * 1000.0,
		state.frame_damage * 100.0,
		state.gate_pressure_pa / 1000.0,
		state.gate_misalignment_m * 1000.0,
		state.authority_tick,
	]

