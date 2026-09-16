extends CharacterBody3D
class_name SpirePlayer

const WALK := 2.55
const SPRINT := 4.85
const CROUCH_SPEED := 1.15
const GRAVITY := 9.80665
const JUMP_V := 3.55
const COYOTE := 0.14
const EYE := 1.62
const EYE_CROUCH := 0.96
const CAP_H := 1.72
const CAP_H_CROUCH := 1.05
const LOOK_SENS := 0.0024

var yaw := -1.15
var pitch := 0.08
var crouch := false
var eye := EYE
var coyote := 0.0
var jump_buf := 0.0
var air_time := 0.0
var fall_from := 0.0
var landed := 0.0
var sprinting := false
var forward_accel := 0.0
var yaw_rate := 0.0
var speed := 0.0
var on_ladder := false
var mantle_t := 0.0
var mantle_to := Vector3.ZERO
var hurt := false
var dead := false

var move_axis := Vector2.ZERO
var look_axis := Vector2.ZERO
var jump_held := false
var crouch_held := false
var sprint_held := false
var action_held := false

var gait := Gait.new()
var hull: CollisionShape3D
var cam: Camera3D
var cam_boom: Node3D


func _ready() -> void:
	floor_stop_on_slope = true
	floor_max_angle = deg_to_rad(52.0)
	floor_snap_length = 0.22
	safe_margin = 0.07
	platform_on_leave = CharacterBody3D.PLATFORM_ON_LEAVE_ADD_VELOCITY
	up_direction = Vector3.UP
	collision_layer = 2
	collision_mask = 1
	motion_mode = CharacterBody3D.MOTION_MODE_GROUNDED

	hull = CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.32
	cap.height = CAP_H
	hull.shape = cap
	hull.position.y = CAP_H * 0.5
	add_child(hull)

	cam_boom = Node3D.new()
	cam_boom.position.y = EYE
	add_child(cam_boom)
	cam = Camera3D.new()
	cam.fov = 72.0
	cam.near = 0.08
	cam.far = 420.0
	cam_boom.add_child(cam)
	cam.current = true


func apply_look(dx: float, dy: float) -> void:
	var prev := yaw
	yaw -= dx * LOOK_SENS
	pitch = clampf(pitch - dy * LOOK_SENS, -1.52, 1.52)
	yaw_rate = yaw - prev


func request_jump() -> void:
	jump_buf = 0.14


func _physics_process(dt: float) -> void:
	if dead:
		velocity = Vector3.ZERO
		return

	_poll_desktop()
	landed = 0.0
	if mantle_t > 0.0:
		_step_mantle(dt)
		return

	var want_h := CAP_H_CROUCH if crouch_held else CAP_H
	crouch = crouch_held
	var target_eye := EYE_CROUCH if crouch else EYE
	eye = lerpf(eye, target_eye, minf(1.0, dt * 10.0))
	var cap := hull.shape as CapsuleShape3D
	cap.height = want_h
	hull.position.y = want_h * 0.5

	apply_look(look_axis.x, look_axis.y)

	var basis_yaw := Basis(Vector3.UP, yaw)
	var forward := -basis_yaw.z
	var right := basis_yaw.x
	var mag := move_axis.length()
	sprinting = (not crouch) and is_on_floor() and (sprint_held or mag > 0.86)
	var max_sp := CROUCH_SPEED if crouch else (SPRINT if sprinting else WALK)
	var wish := (forward * move_axis.y + right * move_axis.x)
	if wish.length() > 1.0:
		wish = wish.normalized()
	var accel := 18.0 if is_on_floor() else 4.5
	var target := wish * max_sp
	var prev_h := Vector3(velocity.x, 0.0, velocity.z)
	velocity.x = lerpf(velocity.x, target.x, minf(1.0, accel * dt))
	velocity.z = lerpf(velocity.z, target.z, minf(1.0, accel * dt))
	var new_h := Vector3(velocity.x, 0.0, velocity.z)
	var acc := (new_h - prev_h) / maxf(dt, 1e-4)
	forward_accel = acc.dot(forward)

	var was_ground := is_on_floor()
	if was_ground:
		coyote = COYOTE
		air_time = 0.0
		fall_from = global_position.y
	else:
		coyote -= dt
		air_time += dt

	if on_ladder:
		velocity.y = move_axis.y * 2.45
		velocity.x = lerpf(velocity.x, wish.x * 0.7, minf(1.0, 12.0 * dt))
		velocity.z = lerpf(velocity.z, wish.z * 0.7, minf(1.0, 12.0 * dt))
	else:
		velocity.y -= GRAVITY * dt

	if jump_buf > 0.0:
		jump_buf -= dt
	if jump_held:
		request_jump()
	var want_jump := jump_buf > 0.0
	if want_jump and coyote > 0.0 and not on_ladder:
		velocity.y = JUMP_V
		coyote = 0.0
		jump_buf = 0.0
		floor_snap_length = 0.0
	elif want_jump and not is_on_floor():
		if _try_mantle():
			jump_buf = 0.0
			return

	if not on_ladder:
		floor_snap_length = 0.22 if (is_on_floor() or coyote > 0.0) else 0.0

	move_and_slide()
	_step_over()

	if not was_ground and is_on_floor():
		var drop := fall_from - global_position.y
		landed = clampf((drop - 0.35) / 4.2, 0.0, 1.0)
		_apply_fall(drop)

	if global_position.y < -10.6:
		dead = true

	speed = Vector3(velocity.x, 0.0, velocity.z).length()
	gait.step(dt, {
		"speed": speed,
		"grounded": is_on_floor() or on_ladder,
		"crouch": crouch,
		"sprint": sprinting,
		"forward_accel": forward_accel,
		"yaw_rate": yaw_rate,
		"landed": landed,
	})
	_apply_camera()
	yaw_rate = 0.0
	on_ladder = false


func _apply_camera() -> void:
	var g := gait.offset()
	cam_boom.position = Vector3(g["x"], eye + g["y"], g["z"])
	cam_boom.rotation = Vector3(pitch + g["pitch"], yaw + g["yaw"], g["roll"])


func _step_mantle(dt: float) -> void:
	mantle_t -= dt
	var t := 1.0 - clampf(mantle_t / 0.32, 0.0, 1.0)
	global_position = global_position.lerp(mantle_to, minf(1.0, t * 3.0))
	velocity = Vector3.ZERO
	if mantle_t <= 0.0:
		global_position = mantle_to
		mantle_t = 0.0
	_apply_camera()


func _try_mantle() -> bool:
	var space := get_world_3d().direct_space_state
	var origin := global_position + Vector3(0.0, 0.95, 0.0)
	var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
	var q := PhysicsRayQueryParameters3D.create(origin, origin + fwd * 0.9)
	q.exclude = [get_rid()]
	q.collision_mask = 1
	var hit := space.intersect_ray(q)
	if hit.is_empty():
		return false
	var probe: Vector3 = hit.position + fwd * 0.18 + Vector3(0.0, 1.38, 0.0)
	var down := PhysicsRayQueryParameters3D.create(probe, probe + Vector3(0.0, -1.2, 0.0))
	down.exclude = [get_rid()]
	down.collision_mask = 1
	var ledge := space.intersect_ray(down)
	if ledge.is_empty():
		return false
	var dy: float = ledge.position.y - global_position.y
	if dy < 0.5 or dy > 1.35:
		return false
	# Destination must actually exist; do not invent support.
	mantle_to = Vector3(ledge.position.x, ledge.position.y + 0.03, ledge.position.z)
	mantle_t = 0.32
	return true


func _step_over() -> void:
	if not is_on_wall() or not is_on_floor():
		return
	var n := get_wall_normal()
	if absf(n.y) > 0.35:
		return
	var space := get_world_3d().direct_space_state
	var toe := global_position + Vector3(0.0, 0.38, 0.0) - n * 0.42
	var down := PhysicsRayQueryParameters3D.create(toe + Vector3(0.0, 0.15, 0.0), toe + Vector3(0.0, -0.2, 0.0))
	down.exclude = [get_rid()]
	down.collision_mask = 1
	var hit := space.intersect_ray(down)
	if hit.is_empty():
		return
	var rise: float = hit.position.y - global_position.y
	if rise > 0.04 and rise <= 0.4:
		global_position.y = hit.position.y + 0.01


func _apply_fall(drop: float) -> void:
	if drop > 8.5:
		dead = true
		gait.impulse(1.0)
	elif drop > 4.8:
		hurt = true
		gait.impulse(0.55)
	elif drop > 0.8:
		gait.impulse(drop * 0.08)


func look_origin() -> Vector3:
	return cam.global_position


func look_dir() -> Vector3:
	return -cam.global_transform.basis.z


func _poll_desktop() -> void:
	if DisplayServer.is_touchscreen_available() and move_axis.length() > 0.05:
		return
	var x := (1.0 if Input.is_physical_key_pressed(KEY_D) else 0.0) - (1.0 if Input.is_physical_key_pressed(KEY_A) else 0.0)
	var y := (1.0 if Input.is_physical_key_pressed(KEY_W) else 0.0) - (1.0 if Input.is_physical_key_pressed(KEY_S) else 0.0)
	var k := Vector2(x, y)
	if k.length() > 1.0:
		k = k.normalized()
	if k != Vector2.ZERO or not DisplayServer.is_touchscreen_available():
		move_axis = k
	sprint_held = sprint_held or Input.is_physical_key_pressed(KEY_SHIFT)
	crouch_held = crouch_held or Input.is_physical_key_pressed(KEY_C)
	if Input.is_physical_key_pressed(KEY_SPACE):
		if not jump_held:
			request_jump()
		jump_held = true
	elif not DisplayServer.is_touchscreen_available():
		jump_held = false
