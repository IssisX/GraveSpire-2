#include "simulation_bridge.hpp"

#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

namespace gravespire {

void initialize_module(godot::ModuleInitializationLevel level) {
  if (level != godot::MODULE_INITIALIZATION_LEVEL_SCENE) {
    return;
  }
  godot::ClassDB::register_class<SimulationBridge>();
}

void uninitialize_module(godot::ModuleInitializationLevel level) {
  if (level != godot::MODULE_INITIALIZATION_LEVEL_SCENE) {
    return;
  }
}

}  // namespace gravespire

extern "C" {

GDExtensionBool GDE_EXPORT gravespire_library_init(
    GDExtensionInterfaceGetProcAddress get_proc_address,
    GDExtensionClassLibraryPtr library,
    GDExtensionInitialization* initialization) {
  godot::GDExtensionBinding::InitObject init(
      get_proc_address, library, initialization);
  init.register_initializer(gravespire::initialize_module);
  init.register_terminator(gravespire::uninitialize_module);
  init.set_minimum_library_initialization_level(
      godot::MODULE_INITIALIZATION_LEVEL_SCENE);
  return init.init();
}

}

