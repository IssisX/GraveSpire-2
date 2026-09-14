#!/usr/bin/env python

env = SConscript("godot-cpp/SConstruct")
env.Append(CPPPATH=["native/include", "native/godot"])
env.Append(CXXFLAGS=["-std=c++20"])
sources = [
    "native/src/simulation.cpp",
    "native/godot/simulation_bridge.cpp",
    "native/godot/register_types.cpp",
]
suffix = env["suffix"]
library = env.SharedLibrary(
    "game/bin/libgravespire" + suffix + env["SHLIBSUFFIX"],
    source=sources,
)
Default(library)
