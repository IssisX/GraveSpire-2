extends Node
class_name SpireExterior

# Native Godot exterior megastructure. Presentation reads the C++ authority;
# all consequential machine coordinates come from SimulationBridge snapshots.

var root: Node3D
var simulation: Node
var player: CharacterBody3D
var built := false

var lift_car: AnimatableBody3D
var lift_counter: AnimatableBody3D
var bridge: AnimatableBody3D
var sky_car: AnimatableBody3D
var sky_counter: AnimatableBody3D
var ballast_trolley: AnimatableBody3D
var wind_car: AnimatableBody3D
var wind_counter: AnimatableBody3D
var wind_sail: Node3D

var stations: Dictionary = {}
var birds: Array[Node3D] = []
var action_prev := false
var ballast_target := 0
var time_s := 0.0

var bark_layer: CanvasLayer
var bark_label: Label
var wind_audio: AudioStreamPlayer
var wind_stream: AudioStreamGenerator
var wind_playback: AudioStreamGeneratorPlayback
var wind_phase := 0.0
var wind_noise := 0.0

const TOWER_X := 54.0
const TOWER_Z := 0.0
const TOWER_TOP := 540.0
const LIFT_BASE_Y := 3.0
const LIFT_X := 42.0
const LIFT_Z := -10.0
const BRIDGE_PIVOT := Vector3(46.0, 64.0, -10.0)
const BRIDGE_LEN := 20.0
const SKY_BASE_Y := 68.0
const SKY_X := 66.0
const SKY_Z := 10.0
const WIND_BASE_Y := 143.0
const WIND_X := 50.0
const WIND_Z := 10.0


func _ready() -> void:
	process_physics_priority = 30
	set_physics_process(true)
	set_process(true)
	call_deferred("_attach")


func _attach() -> void:
	var scene := get_tree().current_scene
	if scene == null:
		call_deferred("_attach")
		return
	root = scene as Node3D
	if root == null:
		call_deferred("_attach")
		return
	simulation = root.get_node_or_null("Simulation")
	player = root.get_node_or_null("Player") as CharacterBody3D
	if simulation == null or player == null:
		call_deferred("_attach")
		return
	_build_world()
	_configure_environment()
	_build_overlay_and_audio()
	built = true


func _physics_process(_dt: float) -> void:
	if not built or simulation == null or player == null:
		return
	var state: Dictionary = simulation.call("snapshot")
	_sync_machines(state)
	_interact(state)
	_update_bark(state)


func _process(dt: float) -> void:
	if not built or player == null:
		return
	time_s += dt
	_update_birds()
	_fill_wind_audio()


func _mat(color: Color, metal := 0.72, rough := 0.42, alpha := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(color.r, color.g, color.b, alpha)
	m.metallic = metal
	m.roughness = rough
	if alpha < 0.999:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.no_depth_test = false
	return m


func _box_mesh(size: Vector3, color: Color, metal := 0.72, rough := 0.42) -> MeshInstance3D:
	var n := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = _mat(color, metal, rough)
	n.mesh = mesh
	return n


func _static_box(size: Vector3, pos: Vector3, color: Color, rot := Vector3.ZERO, collide := true) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = pos
	body.rotation = rot
	body.collision_layer = 1
	body.collision_mask = 0
	body.add_child(_box_mesh(size, color))
	if collide:
		var col := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		col.shape = sh
		body.add_child(col)
	root.add_child(body)
	return body


func _visual_box(size: Vector3, pos: Vector3, color: Color, rot := Vector3.ZERO) -> MeshInstance3D:
	var mesh := _box_mesh(size, color)
	mesh.position = pos
	mesh.rotation = rot
	root.add_child(mesh)
	return mesh


func _anim_box(size: Vector3, pos: Vector3, color: Color) -> AnimatableBody3D:
	var body := AnimatableBody3D.new()
	body.position = pos
	body.sync_to_physics = true
	body.collision_layer = 1
	body.collision_mask = 0
	body.add_child(_box_mesh(size, color))
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	col.shape = sh
	body.add_child(col)
	root.add_child(body)
	return body


func _cylinder(radius: float, height: float, pos: Vector3, color: Color, rot := Vector3.ZERO) -> MeshInstance3D:
	var n := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 16
	mesh.material = _mat(color, 0.82, 0.32)
	n.mesh = mesh
	n.position = pos
	n.rotation = rot
	root.add_child(n)
	return n


func _label(text: String, pos: Vector3, size := 0.45) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.position = pos
	l.font_size = 42
	l.pixel_size = 0.008 * size / 0.45
	l.modulate = Color(0.95, 0.82, 0.42)
	l.outline_size = 8
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	root.add_child(l)
	return l


func _station(id: String, parent: Node3D, local_pos: Vector3, text: String) -> Area3D:
	var a := Area3D.new()
	a.position = local_pos
	a.collision_layer = 4
	a.collision_mask = 2
	a.monitoring = true
	a.set_meta("spire_station", id)
	var mesh := _box_mesh(Vector3(0.55, 0.95, 0.45), Color(0.82, 0.48, 0.12), 0.35, 0.52)
	a.add_child(mesh)
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = Vector3(0.65, 1.05, 0.55)
	col.shape = sh
	a.add_child(col)
	parent.add_child(a)
	stations[id] = a
	var l := Label3D.new()
	l.text = text
	l.position = local_pos + Vector3(0.0, 1.35, 0.0)
	l.font_size = 34
	l.pixel_size = 0.008
	l.modulate = Color(1.0, 0.82, 0.38)
	l.outline_size = 7
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	parent.add_child(l)
	return a


func _build_world() -> void:
	# Exit Bay 07 through the existing east route into a real exterior apron.
	_static_box(Vector3(30.0, 0.45, 22.0), Vector3(25.0, -0.22, 0.0), Color(0.19, 0.2, 0.19))
	_static_box(Vector3(58.0, 0.55, 72.0), Vector3(57.0, -0.28, 0.0), Color(0.13, 0.145, 0.15))
	_static_box(Vector3(16.0, 0.35, 8.0), Vector3(18.0, 0.17, 0.0), Color(0.29, 0.27, 0.21))
	_label("GRAVESPIRE  /  EXTERIOR FREIGHT RISE", Vector3(31.0, 4.0, -12.0), 0.62)

	# 540 m open industrial megaframe. The structure is intentionally sparse:
	# mechanisms, void and wind are the building, not rooms stacked in a box.
	var steel := Color(0.15, 0.18, 0.2)
	var dark := Color(0.085, 0.105, 0.12)
	var rust := Color(0.42, 0.24, 0.11)
	var legs := [Vector2(40.0, -18.0), Vector2(68.0, -18.0), Vector2(40.0, 18.0), Vector2(68.0, 18.0)]
	for seg in 14:
		var cy := 20.0 + float(seg) * 40.0
		for p in legs:
			_static_box(Vector3(1.55, 40.0, 1.55), Vector3(p.x, cy, p.y), steel)
	for band in 18:
		var y := 18.0 + float(band) * 30.0
		for z in [-18.0, 18.0]:
			_static_box(Vector3(29.5, 0.75, 0.8), Vector3(TOWER_X, y, z), dark)
		for x in [40.0, 68.0]:
			_static_box(Vector3(0.8, 0.75, 36.0), Vector3(x, y, 0.0), dark)
		# Readable X-bracing without turning every diagonal into collision clutter.
		var angle := atan2(30.0, 28.0)
		_visual_box(Vector3(41.0, 0.42, 0.42), Vector3(TOWER_X, y + 15.0, -18.25), rust, Vector3(0.0, 0.0, angle))
		_visual_box(Vector3(41.0, 0.42, 0.42), Vector3(TOWER_X, y + 15.0, 18.25), rust, Vector3(0.0, 0.0, -angle))

	# Large future-machine silhouettes keep the upper spire industrial and legible.
	for spec in [
		[320.0, 8.5, -12.0], [366.0, 11.0, 12.0], [418.0, 9.0, -10.0], [474.0, 13.0, 8.0]
	]:
		var y: float = spec[0]
		var r: float = spec[1]
		var z: float = spec[2]
		_cylinder(r, 4.0, Vector3(TOWER_X, y, z), Color(0.24, 0.27, 0.29), Vector3(PI * 0.5, 0.0, 0.0))
		_visual_box(Vector3(24.0, 1.2, 1.2), Vector3(TOWER_X, y, z), rust)
		_static_box(Vector3(20.0, 0.45, 6.0), Vector3(TOWER_X, y - 6.0, z), Color(0.18, 0.19, 0.18))

	# Mechanism A — 22 t player-carrying traction lift / 18 t counterweight.
	lift_car = _anim_box(Vector3(8.0, 0.65, 7.0), Vector3(LIFT_X, LIFT_BASE_Y, LIFT_Z), Color(0.62, 0.34, 0.1))
	lift_counter = _anim_box(Vector3(5.0, 6.0, 5.0), Vector3(LIFT_X, LIFT_BASE_Y + 60.0, 10.0), Color(0.27, 0.29, 0.31))
	_static_box(Vector3(8.8, 0.45, 8.0), Vector3(LIFT_X, 2.35, LIFT_Z), Color(0.23, 0.24, 0.2))
	for i in 8:
		_static_box(Vector3(1.0, 0.18, 2.4), Vector3(35.6 + float(i) * 0.75, 0.12 + float(i) * 0.34, LIFT_Z), Color(0.34, 0.31, 0.22))
	_station("lift", lift_car, Vector3(-2.7, 0.85, 2.4), "HOLD ACTION: UP\nCROUCH + ACTION: DOWN")
	_label("22 t TRACTION CAR  /  18 t COUNTERWEIGHT", Vector3(42.0, 9.0, -15.0), 0.52)
	_cylinder(2.4, 4.0, Vector3(42.0, 67.0, 0.0), Color(0.27, 0.3, 0.32), Vector3(PI * 0.5, 0.0, 0.0))

	# Mechanism B — 48 t bascule. Lift arrival retracts its physical latch.
	bridge = AnimatableBody3D.new()
	bridge.position = BRIDGE_PIVOT
	bridge.sync_to_physics = true
	bridge.collision_layer = 1
	bridge.collision_mask = 0
	var bridge_mesh := _box_mesh(Vector3(BRIDGE_LEN, 0.75, 5.2), Color(0.34, 0.25, 0.13))
	bridge_mesh.position.x = BRIDGE_LEN * 0.5
	bridge.add_child(bridge_mesh)
	var bridge_col := CollisionShape3D.new()
	var bridge_shape := BoxShape3D.new()
	bridge_shape.size = Vector3(BRIDGE_LEN, 0.75, 5.2)
	bridge_col.shape = bridge_shape
	bridge_col.position.x = BRIDGE_LEN * 0.5
	bridge.add_child(bridge_col)
	root.add_child(bridge)
	_static_box(Vector3(8.0, 0.5, 8.0), Vector3(42.0, 63.6, -10.0), Color(0.2, 0.22, 0.21))
	_static_box(Vector3(8.0, 0.5, 8.0), Vector3(67.0, 63.6, -10.0), Color(0.2, 0.22, 0.21))
	_label("48 t BASCULE  —  LIFT CONTACT RELEASE", Vector3(55.0, 69.0, -14.0), 0.54)

	# Catwalk into mechanism C.
	_static_box(Vector3(5.0, 0.4, 22.0), Vector3(66.0, 64.0, 0.0), Color(0.24, 0.23, 0.19))
	for i in 8:
		_static_box(Vector3(2.4, 0.18, 1.0), Vector3(66.0, 64.15 + float(i) * 0.48, 8.2 + float(i) * 0.24), Color(0.34, 0.31, 0.22))

	# Mechanism C — ballast-controlled sky car.
	sky_car = _anim_box(Vector3(8.0, 0.65, 7.0), Vector3(SKY_X, SKY_BASE_Y, SKY_Z), Color(0.3, 0.48, 0.55))
	sky_counter = _anim_box(Vector3(5.5, 7.0, 5.5), Vector3(SKY_X, SKY_BASE_Y + 70.0, -10.0), Color(0.25, 0.27, 0.28))
	ballast_trolley = _anim_box(Vector3(3.0, 2.5, 3.0), Vector3(58.0, 67.2, 15.0), Color(0.72, 0.42, 0.12))
	_static_box(Vector3(12.0, 0.5, 2.2), Vector3(62.0, 66.0, 15.0), Color(0.2, 0.23, 0.24))
	var ballast_station := Node3D.new()
	ballast_station.position = Vector3(58.0, 66.0, 12.6)
	root.add_child(ballast_station)
	_station("ballast", ballast_station, Vector3.ZERO, "ACTION: SHIFT 10 t BALLAST")
	_station("sky_brake", sky_car, Vector3(-2.8, 0.85, 2.4), "ACTION: SKY-CAR BRAKE")
	_label("COUNTERWEIGHT SKY-CAR  /  MOVE MASS, THEN RELEASE", Vector3(66.0, 77.0, 15.0), 0.54)

	# Upper landing and approach to the wind machine.
	_static_box(Vector3(12.0, 0.5, 9.0), Vector3(65.0, 138.0, 10.0), Color(0.19, 0.21, 0.21))
	_static_box(Vector3(18.0, 0.45, 5.0), Vector3(57.0, 141.0, 10.0), Color(0.24, 0.23, 0.19), Vector3(0.0, 0.0, deg_to_rad(-8.0)))

	# Mechanism D — wind-work ascender. Sky-car arrival clears the wind latch.
	wind_car = _anim_box(Vector3(8.0, 0.65, 7.0), Vector3(WIND_X, WIND_BASE_Y, WIND_Z), Color(0.54, 0.46, 0.18))
	wind_counter = _anim_box(Vector3(5.0, 7.0, 5.0), Vector3(WIND_X, WIND_BASE_Y + 100.0, -10.0), Color(0.24, 0.26, 0.27))
	_station("wind_brake", wind_car, Vector3(-2.7, 0.85, 2.4), "ACTION: WIND-HOIST BRAKE")
	wind_sail = Node3D.new()
	wind_sail.position = Vector3(40.0, 168.0, -20.0)
	var sail_mast := _visual_box(Vector3(1.1, 30.0, 1.1), wind_sail.position, Color(0.2, 0.23, 0.25))
	var sail_panel := _visual_box(Vector3(1.0, 25.0, 34.0), wind_sail.position + Vector3(8.0, 0.0, 0.0), Color(0.46, 0.29, 0.12))
	wind_sail.set_meta("mast", sail_mast)
	wind_sail.set_meta("panel", sail_panel)
	root.add_child(wind_sail)
	_label("WINDWARD ASCENDER  /  520 m² SAIL", Vector3(48.0, 154.0, -19.0), 0.56)

	# Wind-car top exits into athletic service steel and the first cloud deck.
	_static_box(Vector3(12.0, 0.5, 9.0), Vector3(50.0, 243.0, 10.0), Color(0.18, 0.2, 0.2))
	_build_cloud_approach()
	_build_clouds()
	_build_birds()


func _static_ramp(a: Vector3, b: Vector3, width: float) -> void:
	var d := b - a
	var len := Vector2(d.x, d.y).length()
	var mid := (a + b) * 0.5
	var angle := atan2(d.y, d.x)
	_static_box(Vector3(len, 0.34, width), mid, Color(0.27, 0.26, 0.21), Vector3(0.0, 0.0, angle))


func _build_cloud_approach() -> void:
	var y := 246.0
	var x := 48.0
	for i in 12:
		var nx := 60.0 if i % 2 == 0 else 46.0
		var ny := y + 4.8
		_static_ramp(Vector3(x, y, 10.0), Vector3(nx, ny, 10.0), 3.0)
		_static_box(Vector3(5.0, 0.35, 4.0), Vector3(nx, ny, 10.0), Color(0.2, 0.22, 0.21))
		x = nx
		y = ny
	_static_box(Vector3(18.0, 0.5, 10.0), Vector3(54.0, 306.0, 10.0), Color(0.18, 0.2, 0.21))
	_label("CLOUD MAINTENANCE DECK  +306 m", Vector3(54.0, 309.5, 14.0), 0.58)


func _build_clouds() -> void:
	var cloud_mat := _mat(Color(0.66, 0.72, 0.76), 0.0, 1.0, 0.12)
	for i in 14:
		var n := MeshInstance3D.new()
		var sphere := SphereMesh.new()
		sphere.radius = 34.0 + float(i % 4) * 7.0
		sphere.height = sphere.radius * 1.25
		sphere.radial_segments = 12
		sphere.rings = 6
		sphere.material = cloud_mat
		n.mesh = sphere
		var a := float(i) * 2.399
		var r := 20.0 + float((i * 17) % 35)
		n.position = Vector3(TOWER_X + cos(a) * r, 282.0 + float(i % 5) * 11.0, TOWER_Z + sin(a) * r)
		root.add_child(n)


func _build_birds() -> void:
	for i in 4:
		var g := Node3D.new()
		for side in [-1.0, 1.0]:
			var wing := _box_mesh(Vector3(2.4, 0.07, 0.42), Color(0.035, 0.04, 0.045), 0.0, 0.9)
			wing.position.x = side * 1.05
			wing.rotation.z = side * 0.12
			g.add_child(wing)
		var body := _box_mesh(Vector3(0.35, 0.22, 1.1), Color(0.025, 0.03, 0.032), 0.0, 0.95)
		g.add_child(body)
		root.add_child(g)
		birds.append(g)


func _configure_environment() -> void:
	var worlds := root.find_children("*", "WorldEnvironment", true, false)
	if not worlds.is_empty():
		var we := worlds[0] as WorldEnvironment
		if we != null and we.environment != null:
			var env := we.environment
			var sky := Sky.new()
			var sm := ProceduralSkyMaterial.new()
			sm.sky_top_color = Color(0.16, 0.28, 0.4)
			sm.sky_horizon_color = Color(0.62, 0.68, 0.72)
			sm.ground_bottom_color = Color(0.035, 0.045, 0.05)
			sm.ground_horizon_color = Color(0.34, 0.38, 0.4)
			sm.sun_angle_max = 12.0
			sky.sky_material = sm
			env.background_mode = Environment.BG_SKY
			env.sky = sky
			env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
			env.ambient_light_energy = 0.72
			env.fog_enabled = true
			env.fog_density = 0.00125
			env.fog_light_color = Color(0.47, 0.55, 0.62)
			env.fog_sky_affect = 0.65
	var cameras := root.find_children("*", "Camera3D", true, false)
	for c in cameras:
		(c as Camera3D).far = 950.0


func _build_overlay_and_audio() -> void:
	bark_layer = CanvasLayer.new()
	bark_layer.layer = 24
	add_child(bark_layer)
	bark_label = Label.new()
	bark_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	bark_label.position = Vector2(-360, 86)
	bark_label.custom_minimum_size = Vector2(720, 52)
	bark_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	bark_label.add_theme_font_size_override("font_size", 20)
	bark_label.add_theme_color_override("font_color", Color(0.96, 0.9, 0.75))
	bark_layer.add_child(bark_label)

	wind_audio = AudioStreamPlayer.new()
	wind_stream = AudioStreamGenerator.new()
	wind_stream.mix_rate = 22050.0
	wind_stream.buffer_length = 0.18
	wind_audio.stream = wind_stream
	wind_audio.volume_db = -8.0
	add_child(wind_audio)
	wind_audio.play()
	wind_playback = wind_audio.get_stream_playback() as AudioStreamGeneratorPlayback


func _sync_machines(state: Dictionary) -> void:
	var lq: float = state["spire_lift_q_m"]
	lift_car.position = Vector3(LIFT_X, LIFT_BASE_Y + lq, LIFT_Z)
	lift_counter.position = Vector3(LIFT_X, LIFT_BASE_Y + 60.0 - lq, 10.0)
	bridge.rotation.z = -float(state["spire_bridge_angle_rad"])

	var bx: float = state["spire_sky_ballast_x_m"]
	ballast_trolley.position = Vector3(58.0 + bx, 67.2, 15.0)
	var sq: float = state["spire_sky_car_q_m"]
	sky_car.position = Vector3(SKY_X, SKY_BASE_Y + sq, SKY_Z)
	sky_counter.position = Vector3(SKY_X, SKY_BASE_Y + 70.0 - sq, -10.0)

	var wq: float = state["spire_wind_car_q_m"]
	wind_car.position = Vector3(WIND_X, WIND_BASE_Y + wq, WIND_Z)
	wind_counter.position = Vector3(WIND_X, WIND_BASE_Y + 100.0 - wq, -10.0)
	var sail_angle := wq / 2.2
	var mast := wind_sail.get_meta("mast") as MeshInstance3D
	var panel := wind_sail.get_meta("panel") as MeshInstance3D
	if mast != null:
		mast.rotation.y = sail_angle
	if panel != null:
		var rel := panel.position - wind_sail.position
		var rot := Basis(Vector3.UP, sail_angle)
		panel.position = wind_sail.position + rot * Vector3(8.0, 0.0, 0.0)
		panel.rotation.y = sail_angle


func _focused_station() -> String:
	var best := ""
	var best_d := 999.0
	var look: Vector3 = player.call("look_dir")
	for id in stations.keys():
		var node := stations[id] as Node3D
		if node == null:
			continue
		var delta := node.global_position - player.global_position
		var d := delta.length()
		if d > 2.7 or d >= best_d:
			continue
		if look.dot(delta.normalized()) < 0.18:
			continue
		best = String(id)
		best_d = d
	return best


func _pulse(action: StringName) -> void:
	simulation.call("set_action", action, true)
	simulation.call("set_action", action, false)


func _set_hold(action: StringName, enabled: bool) -> void:
	simulation.call("set_action", action, enabled)


func _interact(state: Dictionary) -> void:
	var focus := _focused_station()
	var action: bool = bool(player.get("action_held"))
	var crouch: bool = bool(player.get("crouch_held"))
	var rising := action and not action_prev

	_set_hold(&"spire_lift_up", focus == "lift" and action and not crouch)
	_set_hold(&"spire_lift_down", focus == "lift" and action and crouch)

	if focus == "ballast" and rising:
		ballast_target = -1 if float(state["spire_sky_ballast_x_m"]) > 4.0 else 1
	if ballast_target > 0:
		var done_right := float(state["spire_sky_ballast_x_m"]) > 7.85
		_set_hold(&"sky_ballast_right", not done_right)
		_set_hold(&"sky_ballast_left", false)
		if done_right:
			ballast_target = 0
	elif ballast_target < 0:
		var done_left := float(state["spire_sky_ballast_x_m"]) < 0.15
		_set_hold(&"sky_ballast_left", not done_left)
		_set_hold(&"sky_ballast_right", false)
		if done_left:
			ballast_target = 0
	else:
		_set_hold(&"sky_ballast_left", false)
		_set_hold(&"sky_ballast_right", false)

	if focus == "sky_brake" and rising:
		_pulse(&"sky_car_brake")
	if focus == "wind_brake" and rising:
		_pulse(&"wind_car_brake")
	action_prev = action


func _update_bark(state: Dictionary) -> void:
	if bark_label == null:
		return
	var text := String(player.get("fall_bark"))
	if text != "":
		bark_label.text = text
		return
	var focus := _focused_station()
	match focus:
		"lift":
			bark_label.text = "TRACTION LIFT  %0.1f m  —  hold ACTION to climb" % float(state["spire_lift_q_m"])
		"ballast":
			bark_label.text = "10 t BALLAST  %s" % ("ON COUNTERWEIGHT" if bool(state["spire_sky_ballast_loaded"]) else "TRANSFER REQUIRED")
		"sky_brake":
			bark_label.text = "SKY-CAR BRAKE  %s" % ("HOLDING" if bool(state["spire_sky_car_brake_engaged"]) else "RELEASED")
		"wind_brake":
			bark_label.text = "WIND ASCENDER  %s  /  latch %s" % ["HOLDING" if bool(state["spire_wind_car_brake_engaged"]) else "RELEASED", "CLEAR" if bool(state["spire_wind_unlocked"]) else "CAPTURED"]
		_:
			bark_label.text = ""


func _update_birds() -> void:
	for i in birds.size():
		var bird := birds[i]
		var period := 43.0 + float(i) * 17.0
		var phase := fmod(time_s + float(i) * 13.0, period)
		bird.visible = phase < 9.0 + float(i % 2) * 4.0
		if not bird.visible:
			continue
		var a := time_s * (0.11 + float(i) * 0.013) + float(i) * 1.9
		var radius := 32.0 + float(i) * 9.0
		var altitude := 170.0 + float(i) * 38.0
		bird.position = Vector3(TOWER_X + cos(a) * radius, altitude + sin(a * 1.7) * 4.0, TOWER_Z + sin(a) * radius)
		bird.rotation.y = -a + PI * 0.5
		bird.rotation.z = sin(a * 2.3) * 0.16


func _fill_wind_audio() -> void:
	if wind_playback == null or player == null:
		return
	var altitude := maxf(0.0, player.global_position.y)
	var exposure := clampf((altitude - 72.0) / 240.0, 0.0, 1.0)
	var falling := clampf((-player.velocity.y - 7.0) / 28.0, 0.0, 1.0)
	var intensity := clampf(exposure * 0.72 + falling * 0.72, 0.0, 1.0)
	var frames := mini(wind_playback.get_frames_available(), 384)
	for _i in frames:
		wind_phase += TAU * 73.0 / 22050.0
		wind_noise = lerpf(wind_noise, randf_range(-1.0, 1.0), 0.085)
		var sample := (wind_noise * 0.13 + sin(wind_phase) * 0.018) * intensity
		wind_playback.push_frame(Vector2(sample, sample))
