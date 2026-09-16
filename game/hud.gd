extends CanvasLayer
class_name SpireHud

signal look_delta(dx: float, dy: float)
signal move_axis(v: Vector2)
signal jump_on(pressed: bool)
signal crouch_on(pressed: bool)
signal sprint_on(pressed: bool)
signal action_on(pressed: bool)
signal operate(action: StringName, pressed: bool)

var hint := ""
var inspect_line := ""
var operate_kind := ""
var hurt := false
var dead := false
var touch := false

var _move := Vector2.ZERO
var _look_pid := -1
var _look_prev := Vector2.ZERO
var _move_pid := -1
var _move_origin := Vector2.ZERO

var _hint: Label
var _inspect: Label
var _action: Button
var _jump: Button
var _crouch: Button
var _ops: HBoxContainer
var _nub: ColorRect
var _stick_base: ColorRect
var _dead: Label
var _built_kind := ""


func _ready() -> void:
	layer = 20
	touch = DisplayServer.is_touchscreen_available()
	_build()


func _build() -> void:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	_hint = Label.new()
	_hint.position = Vector2(28, 24)
	_hint.add_theme_font_size_override("font_size", 18)
	_hint.add_theme_color_override("font_color", Color(0.86, 0.9, 0.92))
	root.add_child(_hint)

	_inspect = Label.new()
	_inspect.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_inspect.position = Vector2(28, -96)
	_inspect.add_theme_font_size_override("font_size", 15)
	_inspect.add_theme_color_override("font_color", Color(0.72, 0.78, 0.74, 0.92))
	root.add_child(_inspect)

	_dead = Label.new()
	_dead.set_anchors_preset(Control.PRESET_CENTER)
	_dead.offset_left = -220
	_dead.offset_top = -20
	_dead.add_theme_font_size_override("font_size", 28)
	_dead.add_theme_color_override("font_color", Color(0.86, 0.22, 0.18))
	_dead.visible = false
	root.add_child(_dead)

	_action = _fab("ACTION", Vector2(-148, -148))
	_action.pressed.connect(func(): pass)
	_action.button_down.connect(func(): action_on.emit(true))
	_action.button_up.connect(func(): action_on.emit(false))
	root.add_child(_action)

	_jump = _fab("JUMP", Vector2(-148, -248))
	_jump.add_theme_font_size_override("font_size", 16)
	_jump.custom_minimum_size = Vector2(92, 72)
	_jump.button_down.connect(func(): jump_on.emit(true))
	_jump.button_up.connect(func(): jump_on.emit(false))
	root.add_child(_jump)

	_crouch = _fab("CROUCH", Vector2(-258, -148))
	_crouch.toggle_mode = true
	_crouch.custom_minimum_size = Vector2(92, 72)
	_crouch.toggled.connect(func(on: bool): crouch_on.emit(on))
	root.add_child(_crouch)

	_ops = HBoxContainer.new()
	_ops.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_ops.offset_left = -280
	_ops.offset_top = -118
	_ops.offset_right = 280
	_ops.offset_bottom = -44
	_ops.add_theme_constant_override("separation", 8)
	_ops.visible = false
	root.add_child(_ops)

	_stick_base = ColorRect.new()
	_stick_base.color = Color(0.08, 0.1, 0.12, 0.35)
	_stick_base.size = Vector2(148, 148)
	_stick_base.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_stick_base.position = Vector2(36, -196)
	_stick_base.mouse_filter = Control.MOUSE_FILTER_STOP
	_stick_base.gui_input.connect(_on_stick)
	root.add_child(_stick_base)
	_nub = ColorRect.new()
	_nub.color = Color(0.82, 0.86, 0.84, 0.55)
	_nub.size = Vector2(46, 46)
	_nub.position = Vector2(51, 51)
	_nub.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_stick_base.add_child(_nub)

	var look_pad := Control.new()
	look_pad.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	look_pad.mouse_filter = Control.MOUSE_FILTER_STOP
	look_pad.gui_input.connect(_on_look)
	root.add_child(look_pad)
	root.move_child(look_pad, 0)

	if not touch:
		_stick_base.visible = false
		_jump.visible = false
		_crouch.visible = false
		_action.visible = true


func _fab(text: String, corner: Vector2) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(112, 88)
	b.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	b.position = corner
	b.add_theme_font_size_override("font_size", 18)
	return b


func set_state(p_hint: String, p_inspect: String, kind: String, p_hurt: bool, p_dead: bool) -> void:
	hint = p_hint
	inspect_line = p_inspect
	operate_kind = kind
	hurt = p_hurt
	dead = p_dead
	_hint.text = hint
	_inspect.text = inspect_line
	_action.text = hint if hint != "" else "ACTION"
	_action.modulate = Color(1, 1, 1, 1) if hint != "" else Color(1, 1, 1, 0.35)
	_dead.visible = dead
	_dead.text = "FALLEN  —  reload the bay"
	if kind != _built_kind:
		_rebuild_ops(kind)
	_ops.visible = kind != ""


func _rebuild_ops(kind: String) -> void:
	_built_kind = kind
	for c in _ops.get_children():
		c.queue_free()
	var defs: Array = []
	if kind == "carrier":
		defs = [["RAISE", "carrier_raise"], ["LOWER", "carrier_lower"], ["◀", "carrier_left"], ["▶", "carrier_right"], ["BRAKE", "carrier_brake"]]
	elif kind == "gate":
		defs = [["VENT", "gate_vent"], ["OPEN", "gate_open"], ["CLOSE", "gate_close"], ["WEDGE", "gate_wedge"]]
	elif kind == "frame":
		defs = [["JACK", "frame_jack"], ["BRACE", "frame_brace"], ["CUT", "frame_cut_brace"]]
	for d in defs:
		var b := Button.new()
		b.text = d[0]
		b.custom_minimum_size = Vector2(88, 64)
		var action: StringName = StringName(d[1])
		var pulse := d[1] in ["carrier_brake", "frame_brace", "frame_cut_brace", "gate_wedge"]
		if pulse:
			b.pressed.connect(func():
				operate.emit(action, true)
				operate.emit(action, false)
			)
		else:
			b.button_down.connect(func(): operate.emit(action, true))
			b.button_up.connect(func(): operate.emit(action, false))
		_ops.add_child(b)


func _on_stick(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			_move_pid = st.index
			_move_origin = st.position
		elif st.index == _move_pid:
			_move_pid = -1
			_move = Vector2.ZERO
			_nub.position = Vector2(51, 51)
			move_axis.emit(_move)
	elif event is InputEventScreenDrag:
		var dg := event as InputEventScreenDrag
		if dg.index != _move_pid:
			return
		var delta: Vector2 = dg.position - _move_origin
		if delta.length() > 64.0:
			delta = delta.normalized() * 64.0
		_nub.position = Vector2(51, 51) + delta * 0.7
		_move = Vector2(delta.x / 64.0, -delta.y / 64.0)
		move_axis.emit(_move)
		sprint_on.emit(_move.length() > 0.86)


func _on_look(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed and st.position.x > get_viewport().get_visible_rect().size.x * 0.42:
			_look_pid = st.index
			_look_prev = st.position
		elif st.index == _look_pid:
			_look_pid = -1
	elif event is InputEventScreenDrag:
		var dg := event as InputEventScreenDrag
		if dg.index != _look_pid:
			return
		var d: Vector2 = dg.position - _look_prev
		_look_prev = dg.position
		look_delta.emit(d.x, d.y)
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var mm := event as InputEventMouseMotion
		look_delta.emit(mm.relative.x, mm.relative.y)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
