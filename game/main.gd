extends Node3D

## First-person Bay 07. C++ SimulationBridge owns coupled freight/frame/gate
## state. This script issues typed commands and presents committed snapshots.

var simulation: Node
var player: SpirePlayer
var hud: SpireHud
var carrier: AnimatableBody3D
var payload: MeshInstance3D
var cable: MeshInstance3D
var cable_segs: Array[MeshInstance3D] = []
var frame_beam: AnimatableBody3D
var gate: AnimatableBody3D
var brace_mesh: MeshInstance3D
var neck_plate: AnimatableBody3D
var neck_blocker: AnimatableBody3D
var sheave: MeshInstance3D
var recv_lamps: Array[OmniLight3D] = []
var steam: MeshInstance3D
var pendant: Area3D
var gate_panel: Area3D
var jack_station: Area3D
var ladder_area: Area3D
var operate_kind := ""
var look_id := ""
var last_actions: Dictionary = {}
var npcs: Array[Dictionary] = []
var bark := ""
var bark_t := 0.0
var missing_authority := false

const WELL_Z := 0.0


func _ready() -> void:
	if ClassDB.class_exists("SimulationBridge"):
		simulation = ClassDB.instantiate("SimulationBridge")
		simulation.name = "Simulation"
		add_child(simulation)
		simulation.process_physics_priority = -20
		simulation.set_physics_process(true)
	else:
		missing_authority = true
	_world()
	_player()
	_hud()
	if missing_authority:
		hud.set_state("C++ AUTHORITY MISSING", "Build the GDExtension before play.", "", false, false)


func _player() -> void:
	player = SpirePlayer.new()
	player.name = "Player"
	player.position = Vector3(-5.45, 0.02, 0.55)
	player.yaw = -1.15
	player.process_physics_priority = 10
	add_child(player)


func _hud() -> void:
	hud = SpireHud.new()
	add_child(hud)
	hud.look_delta.connect(func(dx, dy): player.apply_look(dx, dy))
	hud.move_axis.connect(func(v): player.move_axis = v)
	hud.jump_on.connect(func(on): player.jump_held = on)
	hud.crouch_on.connect(func(on): player.crouch_held = on)
	hud.sprint_on.connect(func(on): player.sprint_held = on)
	hud.action_on.connect(func(on):
		player.action_held = on
		if on:
			_try_action()
	)
	hud.operate.connect(_on_operate)
	if not DisplayServer.is_touchscreen_available():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var mm := event as InputEventMouseMotion
		player.apply_look(mm.relative.x, mm.relative.y)
	if event is InputEventKey:
		var k := event as InputEventKey
		var on := k.pressed and not k.echo
		match k.physical_keycode:
			KEY_E:
				if on:
					_try_action()
			KEY_R:
				_hold_if("carrier", "carrier_raise", k.pressed)
				_hold_if("frame", "frame_jack", k.pressed)
			KEY_F:
				_hold_if("carrier", "carrier_lower", k.pressed)
			KEY_Q:
				_hold_if("carrier", "carrier_left", k.pressed)
			KEY_X:
				_hold_if("carrier", "carrier_right", k.pressed)
			KEY_B:
				if on:
					_pulse("carrier_brake")
			KEY_V:
				_hold_if("gate", "gate_vent", k.pressed)
			KEY_G:
				_hold_if("gate", "gate_open", k.pressed)
			KEY_T:
				_hold_if("gate", "gate_close", k.pressed)
			KEY_J:
				if on:
					_pulse("frame_brace")


func _hold_if(kind: String, action: String, on: bool) -> void:
	if operate_kind == kind:
		_on_operate(StringName(action), on)


func _pulse(action: String) -> void:
	_on_operate(StringName(action), true)
	_on_operate(StringName(action), false)


func _on_operate(action: StringName, on: bool) -> void:
	if simulation == null:
		return
	last_actions[String(action)] = on
	simulation.call("set_action", action, on)


func _try_action() -> void:
	if look_id == "rami" or look_id == "ilea" or look_id == "chen":
		bark_t = 6.0
		return
	if look_id == "pendant":
		operate_kind = "" if operate_kind == "carrier" else "carrier"
	elif look_id == "gate_panel":
		operate_kind = "" if operate_kind == "gate" else "gate"
	elif look_id == "jack":
		operate_kind = "" if operate_kind == "frame" else "frame"
	elif look_id == "ledge":
		player.request_jump()


func _physics_process(dt: float) -> void:
	if missing_authority or simulation == null or player == null:
		return
	var state: Dictionary = simulation.call("snapshot")
	_sync_machines(state)
	_context(state)
	_npcs(dt, state)
	bark_t = maxf(0.0, bark_t - dt)
	var hint := _hint_for(look_id)
	if bark_t > 0.0:
		hint = bark
	var inspect := _inspect(state)
	hud.set_state(hint, inspect, operate_kind, player.hurt, player.dead, _objective(state))


func _sync_machines(state: Dictionary) -> void:
	var lat: float = state["carrier_lateral_m"]
	var h: float = state["carrier_height_m"]
	var defl: float = state["frame_deflection_m"]
	var twist: float = state["frame_twist_rad"]
	var ang: float = state["gate_angle_rad"]
	var mis: float = state["gate_misalignment_m"]
	var tension: float = state["cable_tension_n"]
	carrier.position = Vector3(lat, h, WELL_Z)
	carrier.rotation.z = twist * 0.15
	payload.position = Vector3(lat, h - 0.72, WELL_Z)
	var top := 6.15 - defl
	_sync_cable(Vector3(lat, top, WELL_Z), Vector3(lat, h + 0.42, WELL_Z), tension)
	if sheave != null:
		sheave.position = Vector3(lat, top + 0.22, WELL_Z)
	frame_beam.position = Vector3(0.0, top, 0.0)
	frame_beam.rotation.z = twist
	gate.position = Vector3(7.15, 2.15 + defl * 0.4, 0.0)
	gate.rotation = Vector3(mis * 0.6, -ang, 0.0)
	brace_mesh.visible = bool(state["brace_connected"])
	# Racked neck is a raised collision lip, not a dropped cosmetic plate.
	var neck_clear: bool = bool(state["neck_walk_clear"])
	neck_plate.position = Vector3(6.55, 0.02 if neck_clear else 0.12, 0.0)
	neck_plate.rotation.z = 0.0 if neck_clear else clampf(mis * 8.0, -0.28, 0.28)
	if neck_blocker != null:
		neck_blocker.position = Vector3(6.62, -0.85 if neck_clear else 0.78, 0.0)
	var dock: bool = state["carrier_at_recv"]
	for lamp in recv_lamps:
		lamp.light_color = Color(0.45, 0.95, 0.55) if dock else Color(0.85, 0.28, 0.16)
		lamp.light_energy = 2.4 if dock else 0.9
	var p: float = state["gate_pressure_pa"]
	steam.visible = p > 40000.0 or absf(mis) > 0.02
	steam.scale = Vector3.ONE * clampf((p / 420000.0) + absf(mis) * 8.0, 0.2, 1.6)
	steam.position = Vector3(7.0 + mis * 2.0, 1.4, 1.6)


func _sync_cable(a: Vector3, b: Vector3, tension: float) -> void:
	if cable_segs.is_empty():
		return
	var span := maxf(0.25, a.distance_to(b))
	var sag := 0.02
	if tension < 80.0:
		sag = minf(span * 0.45, 1.85)
	else:
		sag = clampf(22.0 * span * span / tension, 0.016, span * 0.42)
	var nseg := cable_segs.size()
	for i in nseg:
		var t0 := float(i) / float(nseg)
		var t1 := float(i + 1) / float(nseg)
		var p0 := a.lerp(b, t0)
		var p1 := a.lerp(b, t1)
		p0.y -= 4.0 * sag * t0 * (1.0 - t0)
		p1.y -= 4.0 * sag * t1 * (1.0 - t1)
		var mid := (p0 + p1) * 0.5
		var delta := p1 - p0
		var seglen := maxf(0.05, delta.length())
		var seg: MeshInstance3D = cable_segs[i]
		var y := delta / seglen
		var x := y.cross(Vector3(0.0, 0.0, 1.0))
		if x.length() < 0.2:
			x = y.cross(Vector3(1.0, 0.0, 0.0))
		x = x.normalized()
		var z := x.cross(y).normalized()
		var b := Basis(x, y, z).scaled(Vector3(1.0, seglen, 1.0))
		seg.transform = Transform3D(b, mid)
	if cable != null:
		cable.visible = false


func _context(state: Dictionary) -> void:
	look_id = ""
	var origin := player.look_origin()
	var dir := player.look_dir()
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(origin, origin + dir * 3.2)
	q.collide_with_areas = true
	q.collide_with_bodies = true
	q.exclude = [player.get_rid()]
	var hit := space.intersect_ray(q)
	if not hit.is_empty():
		var n := hit.collider as Node
		if n != null:
			look_id = str(n.get_meta("station", ""))
			if look_id == "" and hit.position.y - player.global_position.y > 0.5:
				look_id = "ledge"
	if player.get_slide_collision_count() > 0:
		pass
	# Distance gate: looking is not operating.
	if look_id in ["pendant", "gate_panel", "jack"]:
		var station: Node3D = pendant if look_id == "pendant" else (gate_panel if look_id == "gate_panel" else jack_station)
		if player.global_position.distance_to(station.global_position) > 1.85:
			look_id = "look_" + look_id
	if ladder_area.get_overlapping_bodies().has(player):
		player.on_ladder = true
	if operate_kind != "" and look_id.begins_with("look_"):
		# Still in operate until they leave the station far enough.
		var home: Node3D = pendant if operate_kind == "carrier" else (gate_panel if operate_kind == "gate" else jack_station)
		if player.global_position.distance_to(home.global_position) > 2.4:
			operate_kind = ""
	# Drop operate commands when leaving a station so motors don't run away.
	if operate_kind == "":
		for a in ["carrier_raise", "carrier_lower", "carrier_left", "carrier_right", "gate_vent", "gate_open", "gate_close", "frame_jack"]:
			if last_actions.get(a, false):
				_on_operate(StringName(a), false)
				last_actions[a] = false
	var _unused := state


func _hint_for(id: String) -> String:
	match id:
		"pendant":
			return "OPERATE PENDANT" if operate_kind != "carrier" else "RELEASE PENDANT"
		"gate_panel":
			return "GATE PANEL" if operate_kind != "gate" else "LEAVE PANEL"
		"jack":
			return "FRAME JACK" if operate_kind != "frame" else "LEAVE JACK"
		"look_pendant":
			return "Walk to the pendant to operate"
		"look_gate_panel":
			return "Walk to the panel to vent / open"
		"look_jack":
			return "Walk to the jack to take load"
		"rami":
			return "TALK  RAMI"
		"ilea":
			return "TALK  ILEA"
		"chen":
			return "TALK  CHEN"
		"ledge":
			return "MANTLE"
		_:
			return ""


func _inspect(state: Dictionary) -> String:
	if look_id in ["pendant", "look_pendant", "carrier"]:
		var brake := "FREE"
		if bool(state["brake_slipping"]):
			brake = "SLIP"
		elif bool(state["brake_engaged"]):
			brake = "HOLD"
		return "CARRIER 07-A   %0.0f kN  %s  L0 %0.2f m  h %0.2f  x %+0.2f  %0.0f °C" % [
			state["cable_tension_n"] / 1000.0,
			brake,
			state["cable_unstretched_m"],
			state["carrier_height_m"],
			state["carrier_lateral_m"],
			state["brake_temperature_k"] - 273.15,
		]
	if look_id in ["gate_panel", "look_gate_panel"]:
		return "ISOLATION GATE   %0.0f kPa   jam ×%0.1f   leaf %0.0f°   gap %+0.0f mm" % [
			state["gate_pressure_pa"] / 1000.0,
			state["gate_jam"],
			rad_to_deg(state["gate_angle_rad"]),
			state["gate_misalignment_m"] * 1000.0,
		]
	if look_id in ["jack", "look_jack"]:
		return "TRANSFER FRAME   defl %+0.0f mm   set %+0.0f mm   %s" % [
			state["frame_deflection_m"] * 1000.0,
			state["frame_plastic_set_m"] * 1000.0,
			"BRACED" if state["brace_connected"] else "UNBRACED",
		]
	return "BAY 07   gallery %s   neck %s   07-A %s" % [
		"OPEN" if state["gallery_passable"] else "BLOCKED",
		"CLEAR" if state["neck_walk_clear"] else "RACKED",
		"DOCKED" if state["carrier_at_recv"] else "OFF-RECV",
	]


func _objective(state: Dictionary) -> String:
	if not bool(state.get("finite", true)):
		return "BAY 07  unbounded — not a solvable state"
	var shop := "OPEN" if bool(state["act1_shop_open"]) else "BLOCKED"
	var recv := "DOCKED" if bool(state["carrier_at_recv"]) else "AWAY"
	if bool(state["act1_local_competence"]):
		return "BAY 07  shop OPEN  recv DOCKED"
	if bool(state["brake_engaged"]) and operate_kind == "carrier":
		return "BAY 07  shop %s  recv %s   hoist HOLDING" % [shop, recv]
	return "BAY 07  shop %s  recv %s" % [shop, recv]


func _npcs(dt: float, state: Dictionary) -> void:
	var _dt := dt
	for npc in npcs:
		var body: Node3D = npc["body"]
		var id: String = npc["id"]
		if id == "ilea":
			var target_x := 5.6 if bool(state["gallery_passable"]) and bool(state["neck_walk_clear"]) else 9.6
			body.position.x = lerpf(body.position.x, target_x, minf(1.0, 0.6 * dt))
		if player.global_position.distance_to(body.global_position) < 2.2 and look_id == id:
			bark = npc["line"]
			if bool(state["act1_local_competence"]) and id == "chen":
				bark = "Recv lamps are green and the shop route is a hole. I'm taking the crate through."
			elif bool(state["gallery_passable"]) and id == "ilea":
				bark = "East neck's walking. I'm taking the shop route."
			elif bool(state["carrier_at_recv"]) and id == "chen":
				bark = "Recv lamps are green. Don't celebrate until the leaf is honest."
			elif bool(state["brake_slipping"]) and id == "rami":
				bark = "That brake is slipping. Rated hold is gone. Watch the cable."


func _mat(color: Color, metal := 0.72, rough := 0.42) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.metallic = metal
	m.roughness = rough
	return m


func _mesh_box(size: Vector3, color: Color, metal := 0.7, rough := 0.45) -> MeshInstance3D:
	var n := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	b.material = _mat(color, metal, rough)
	n.mesh = b
	return n


func _static_box(size: Vector3, pos: Vector3, color: Color, parent: Node = null) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = pos
	body.collision_layer = 1
	body.collision_mask = 0
	var mesh := _mesh_box(size, color)
	body.add_child(mesh)
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	col.shape = sh
	body.add_child(col)
	(parent if parent != null else self).add_child(body)
	return body


func _anim_box(size: Vector3, pos: Vector3, color: Color) -> AnimatableBody3D:
	var body := AnimatableBody3D.new()
	body.position = pos
	body.sync_to_physics = true
	body.collision_layer = 1
	body.collision_mask = 0
	var mesh := _mesh_box(size, color)
	body.add_child(mesh)
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	col.shape = sh
	body.add_child(col)
	add_child(body)
	return body


func _station(name: String, pos: Vector3, size: Vector3, color: Color) -> Area3D:
	var a := Area3D.new()
	a.name = name
	a.position = pos
	a.collision_layer = 4
	a.collision_mask = 2
	a.monitoring = true
	a.set_meta("station", name)
	var mesh := _mesh_box(size, color, 0.2, 0.55)
	a.add_child(mesh)
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	col.shape = sh
	a.add_child(col)
	add_child(a)
	return a


func _npc(id: String, pos: Vector3, color: Color, line: String) -> void:
	var body := StaticBody3D.new()
	body.position = pos
	body.set_meta("station", id)
	body.collision_layer = 1
	var mesh := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.28
	cap.height = 1.7
	cap.material = _mat(color, 0.15, 0.7)
	mesh.mesh = cap
	mesh.position.y = 0.85
	body.add_child(mesh)
	var col := CollisionShape3D.new()
	var sh := CapsuleShape3D.new()
	sh.radius = 0.28
	sh.height = 1.7
	col.shape = sh
	col.position.y = 0.85
	body.add_child(col)
	add_child(body)
	npcs.append({"id": id, "body": body, "line": line})


func _world() -> void:
	var world := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.035, 0.045, 0.055)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.45, 0.52, 0.58)
	env.ambient_light_energy = 0.42
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.glow_enabled = true
	env.glow_intensity = 0.25
	env.fog_enabled = true
	env.fog_density = 0.008
	env.fog_light_color = Color(0.12, 0.16, 0.18)
	env.volumetric_fog_enabled = false
	world.environment = env
	add_child(world)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48.0, 28.0, 0.0)
	sun.light_color = Color(1.0, 0.86, 0.68)
	sun.light_energy = 1.55
	sun.shadow_enabled = true
	add_child(sun)

	# Bay floor with a north well cut: three slabs.
	_static_box(Vector3(16.4, 0.38, 7.4), Vector3(0.0, -0.19, -0.9), Color(0.14, 0.17, 0.19))
	_static_box(Vector3(5.6, 0.38, 6.4), Vector3(-5.4, -0.19, 4.6), Color(0.14, 0.17, 0.19))
	_static_box(Vector3(5.2, 0.38, 6.4), Vector3(5.6, -0.19, 4.6), Color(0.14, 0.17, 0.19))
	# Well lip grating
	_static_box(Vector3(11.2, 0.08, 0.55), Vector3(0.2, 0.04, 3.55), Color(0.42, 0.38, 0.28), null)
	# South apron
	_static_box(Vector3(10.0, 0.38, 3.6), Vector3(0.0, -0.19, -6.8), Color(0.16, 0.18, 0.16))
	# West pulpit
	_static_box(Vector3(2.8, 0.42, 5.4), Vector3(-7.2, 0.22, 0.4), Color(0.18, 0.2, 0.22))
	_static_box(Vector3(0.28, 1.15, 5.4), Vector3(-8.5, 0.9, 0.4), Color(0.22, 0.25, 0.27))
	# East gallery beyond the gate
	_static_box(Vector3(7.2, 0.38, 4.4), Vector3(11.0, -0.19, 0.0), Color(0.15, 0.17, 0.2))
	# Recv deck
	_static_box(Vector3(4.6, 0.32, 5.2), Vector3(6.4, 2.22, 0.0), Color(0.2, 0.22, 0.18))
	# Recv stairs from south apron (diamond steps)
	for i in 8:
		var t := float(i)
		_static_box(
			Vector3(1.15, 0.18, 1.15),
			Vector3(4.35 + t * 0.28, 0.12 + t * 0.26, -3.7 + t * 0.22),
			Color(0.28, 0.26, 0.2)
		)
	# Columns / architecture
	for x in [-7.6, 7.4]:
		for z in [-5.4, 3.2]:
			_static_box(Vector3(0.85, 12.5, 0.85), Vector3(x, 5.9, z), Color(0.17, 0.2, 0.22))
	# North well walls and pit
	_static_box(Vector3(0.4, 11.0, 8.2), Vector3(-2.5, -4.8, 7.4), Color(0.12, 0.14, 0.16))
	_static_box(Vector3(0.4, 11.0, 8.2), Vector3(4.0, -4.8, 7.4), Color(0.12, 0.14, 0.16))
	_static_box(Vector3(7.0, 11.0, 0.4), Vector3(0.75, -4.8, 11.4), Color(0.12, 0.14, 0.16))
	_static_box(Vector3(6.6, 0.4, 7.6), Vector3(0.75, -9.8, 7.6), Color(0.1, 0.11, 0.12))
	# Catwalk and machine deck inside the well
	_static_box(Vector3(5.8, 0.16, 1.35), Vector3(0.7, -2.15, 9.35), Color(0.32, 0.3, 0.24))
	_static_box(Vector3(4.8, 0.18, 2.4), Vector3(0.7, -4.54, 8.6), Color(0.24, 0.22, 0.18))
	# Machine guts (presentation of the well as machinery, not a second sim)
	_static_box(Vector3(1.6, 1.1, 1.6), Vector3(-0.4, -3.7, 8.4), Color(0.45, 0.28, 0.12))
	_static_box(Vector3(1.4, 1.4, 1.4), Vector3(1.8, -3.55, 8.9), Color(0.3, 0.32, 0.34))
	# Ladder: stacked treads + climb volume
	for i in 9:
		_static_box(Vector3(0.55, 0.06, 0.18), Vector3(-1.55, -0.05 - float(i) * 0.24, 3.72), Color(0.55, 0.48, 0.22))
	ladder_area = Area3D.new()
	ladder_area.position = Vector3(-1.55, -1.1, 3.72)
	ladder_area.collision_layer = 4
	ladder_area.collision_mask = 2
	ladder_area.monitoring = true
	var lcol := CollisionShape3D.new()
	var lbox := BoxShape3D.new()
	lbox.size = Vector3(0.9, 2.5, 0.7)
	lcol.shape = lbox
	ladder_area.add_child(lcol)
	add_child(ladder_area)

	# Spire rising: stacked districts so the bay is one floor of a 1.6 km machine
	for band in 14:
		var y := 14.0 + float(band) * 11.5
		var shade := 0.1 + float(band % 3) * 0.03
		_static_box(Vector3(22.0, 0.6, 18.0), Vector3(0.0, y, 1.0), Color(shade, shade + 0.02, shade + 0.03))
		_static_box(Vector3(1.1, 10.6, 1.1), Vector3(-9.5, y + 5.2, -7.0), Color(0.14, 0.16, 0.18))
		_static_box(Vector3(1.1, 10.6, 1.1), Vector3(9.5, y + 5.2, 8.0), Color(0.14, 0.16, 0.18))
		if band % 2 == 0:
			_static_box(Vector3(8.0, 0.25, 1.0), Vector3(0.0, y + 3.4, -8.6), Color(0.35, 0.22, 0.1))
	# Deep well continuing below
	for band in 6:
		var y := -12.0 - float(band) * 9.0
		_static_box(Vector3(8.0, 0.4, 8.0), Vector3(0.7, y, 7.6), Color(0.08, 0.09, 0.1))

	# Overhead transfer frame (authoritative pose)
	frame_beam = _anim_box(Vector3(14.5, 0.7, 0.95), Vector3(0.0, 6.15, 0.0), Color(0.3, 0.34, 0.36))
	carrier = _anim_box(Vector3(4.3, 0.85, 3.1), Vector3(-1.8, 2.2, 0.0), Color(0.72, 0.42, 0.14))
	payload = _mesh_box(Vector3(2.4, 1.35, 1.9), Color(0.55, 0.38, 0.16), 0.35, 0.6)
	add_child(payload)
	cable = _mesh_box(Vector3(0.09, 4.0, 0.09), Color(0.75, 0.78, 0.8), 0.9, 0.28)
	cable.visible = false
	add_child(cable)
	for _i in 10:
		var seg := _mesh_box(Vector3(0.07, 1.0, 0.07), Color(0.76, 0.78, 0.8), 0.92, 0.28)
		add_child(seg)
		cable_segs.append(seg)
	sheave = MeshInstance3D.new()
	var sheave_mesh := CylinderMesh.new()
	sheave_mesh.top_radius = 0.22
	sheave_mesh.bottom_radius = 0.22
	sheave_mesh.height = 0.18
	sheave_mesh.material = _mat(Color(0.55, 0.58, 0.6), 0.85, 0.3)
	sheave.mesh = sheave_mesh
	sheave.rotation_degrees.z = 90.0
	add_child(sheave)
	_static_box(Vector3(14.8, 0.22, 0.38), Vector3(0.0, 6.55, 0.0), Color(0.28, 0.3, 0.32))
	gate = _anim_box(Vector3(0.55, 4.6, 4.3), Vector3(7.15, 2.15, 0.0), Color(0.22, 0.28, 0.32))
	# Jambs/lintel so the leaf is the only hole. Walking around is not a secret route.
	_static_box(Vector3(1.1, 4.8, 0.7), Vector3(7.15, 2.2, 2.55), Color(0.18, 0.2, 0.22))
	_static_box(Vector3(1.1, 4.8, 0.7), Vector3(7.15, 2.2, -2.55), Color(0.18, 0.2, 0.22))
	_static_box(Vector3(1.2, 0.55, 5.6), Vector3(7.15, 4.55, 0.0), Color(0.2, 0.22, 0.24))
	# Pressure manifold to the vent panel — presentation of inventory, not a second fluid sim.
	_static_box(Vector3(0.16, 0.16, 2.2), Vector3(6.85, 2.6, -1.2), Color(0.45, 0.22, 0.14), null)
	_static_box(Vector3(0.18, 1.1, 0.18), Vector3(6.55, 1.9, -2.35), Color(0.45, 0.22, 0.14), null)
	neck_plate = _anim_box(Vector3(1.6, 0.22, 3.6), Vector3(6.55, 0.0, 0.0), Color(0.4, 0.36, 0.28))
	neck_blocker = _anim_box(Vector3(0.7, 1.55, 3.4), Vector3(6.62, -0.85, 0.0), Color(0.42, 0.32, 0.22))
	brace_mesh = _mesh_box(Vector3(0.22, 3.4, 0.22), Color(0.82, 0.55, 0.18), 0.8, 0.3)
	brace_mesh.position = Vector3(5.4, 1.7, -2.6)
	brace_mesh.rotation_degrees.z = 18.0
	brace_mesh.visible = false
	add_child(brace_mesh)

	pendant = _station("pendant", Vector3(-6.7, 1.18, 0.85), Vector3(0.42, 0.7, 0.34), Color(0.18, 0.55, 0.4))
	gate_panel = _station("gate_panel", Vector3(6.55, 1.25, -2.35), Vector3(0.28, 0.7, 0.42), Color(0.55, 0.25, 0.16))
	jack_station = _station("jack", Vector3(4.15, 0.85, -3.35), Vector3(0.7, 1.1, 0.7), Color(0.55, 0.48, 0.2))

	steam = _mesh_box(Vector3(0.8, 1.6, 0.8), Color(0.7, 0.78, 0.8, 0.25), 0.0, 1.0)
	var sm := steam.mesh as BoxMesh
	(sm.material as StandardMaterial3D).transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	steam.position = Vector3(7.0, 1.4, 1.6)
	add_child(steam)

	for z in [-1.6, 1.6]:
		var lamp := OmniLight3D.new()
		lamp.position = Vector3(6.5, 3.1, z)
		lamp.omni_range = 6.5
		lamp.light_color = Color(0.85, 0.28, 0.16)
		lamp.light_energy = 0.9
		add_child(lamp)
		recv_lamps.append(lamp)

	# Sodium bay lights
	for p in [Vector3(-4, 5.4, -3), Vector3(3.2, 5.4, 2.4), Vector3(-2, 4.8, -6)]:
		var n := OmniLight3D.new()
		n.position = p
		n.omni_range = 9.0
		n.light_color = Color(1.0, 0.72, 0.38)
		n.light_energy = 1.3
		add_child(n)

	_npc("rami", Vector3(-6.15, 0.42, 2.15), Color(0.72, 0.55, 0.38), "Brake's holding the drum. Release it before you hoist. That leaf will not take a shove — vent, then jack the rack.")
	_npc("chen", Vector3(1.4, 0.0, -5.4), Color(0.38, 0.52, 0.62), "Crib and crate on the south apron. I am not hauling 200 kilos by hand while that gate's still a wall.")
	_npc("ilea", Vector3(9.6, 0.0, 0.35), Color(0.62, 0.42, 0.48), "Shop side. I can see you. I cannot reach you until that pressure comes off the hinge.")
	_rigid(Vector3(0.55, 0.55, 0.55), Vector3(-1.1, 0.32, -5.6), 240.0, Color(0.45, 0.32, 0.16))
	_rigid(Vector3(0.9, 0.7, 0.7), Vector3(0.4, 0.4, -5.9), 165.0, Color(0.38, 0.28, 0.18))


func _rigid(size: Vector3, pos: Vector3, mass: float, color: Color) -> void:
	var body := RigidBody3D.new()
	body.mass = mass
	body.position = pos
	body.collision_layer = 1
	body.collision_mask = 1
	body.linear_damp = 0.8
	body.angular_damp = 1.4
	body.continuous_cd = true
	var mesh := _mesh_box(size, color, 0.2, 0.7)
	body.add_child(mesh)
	var col := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	col.shape = sh
	body.add_child(col)
	add_child(body)
