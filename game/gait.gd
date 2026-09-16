extends RefCounted
class_name Gait

# Presentation-only camera embodiment. Never writes player world pose.

var phase := 0.0
var time := 0.0
var vert := 0.0
var lat := 0.0
var roll := 0.0
var yaw := 0.0
var pitch := 0.0
var land := 0.0
var breath := 0.0
var trauma := 0.0
var prev_phase := 0.0
var foot := false


func impulse(amount: float) -> void:
	trauma = minf(1.0, trauma + amount)


func step(dt: float, sample: Dictionary) -> void:
	time += dt
	foot = false
	var grounded: bool = sample.get("grounded", true)
	var speed: float = sample.get("speed", 0.0)
	var crouch: bool = sample.get("crouch", false)
	var sprint: bool = sample.get("sprint", false)
	var fwd: float = sample.get("forward_accel", 0.0)
	var yaw_rate: float = sample.get("yaw_rate", 0.0)
	var landed: float = sample.get("landed", 0.0)

	var stride := 2.45 if sprint else (1.28 if crouch else 1.72)
	prev_phase = phase
	if grounded and speed > 0.32:
		phase += (speed / stride) * TAU * dt
		if phase > TAU:
			phase -= TAU
	else:
		phase = lerpf(phase, 0.0, 1.0 - exp(-4.2 * dt))

	var crossed := (prev_phase < PI and phase >= PI) or (prev_phase > phase and phase < 0.4)
	if grounded and speed > 0.7 and crossed:
		foot = true

	var speed_k := minf(1.0, speed / (4.4 if sprint else 2.4))
	var amp := 0.008 if crouch else (0.022 if sprint else 0.016)
	var want_v := (-cos(phase * 2.0) * amp * speed_k) if grounded else 0.0
	var want_l := (sin(phase) * amp * 0.55 * speed_k) if grounded else 0.0
	var want_roll := (-sin(phase) * 0.012 * speed_k) if grounded else 0.0
	var want_yaw := -yaw_rate * 0.07
	var want_pitch := -clampf(fwd, -3.2, 3.2) * 0.012

	if landed > 0.0:
		land = maxf(land, landed)
		trauma = minf(1.0, trauma + landed * 0.35)

	vert = lerpf(vert, want_v, 1.0 - exp(-14.0 * dt)) - land * 0.05
	lat = lerpf(lat, want_l, 1.0 - exp(-12.0 * dt))
	roll = lerpf(roll, want_roll + yaw_rate * 0.04, 1.0 - exp(-10.0 * dt))
	yaw = lerpf(yaw, want_yaw, 1.0 - exp(-8.0 * dt))
	pitch = lerpf(pitch, want_pitch, 1.0 - exp(-9.0 * dt))
	land = lerpf(land, 0.0, 1.0 - exp(-6.5 * dt))

	var idle := 1.0 if (grounded and speed < 0.28) else 0.0
	var want_breath := sin(time * 1.25) * 0.0038 * idle
	breath = lerpf(breath, want_breath, 1.0 - exp(-3.4 * dt))
	trauma = maxf(0.0, trauma - dt * 1.8)


func offset() -> Dictionary:
	var shake := trauma * trauma
	var t := time * 29.0
	return {
		"x": lat + sin(t * 1.13) * 0.012 * shake,
		"y": vert + breath + cos(t * 1.31) * 0.01 * shake,
		"z": 0.0,
		"roll": roll + sin(t * 0.9) * 0.008 * shake,
		"yaw": yaw,
		"pitch": pitch,
	}
