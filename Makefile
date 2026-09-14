CXX ?= g++
CXXFLAGS := -std=c++20 -O2 -Wall -Wextra -Wpedantic -Werror
INCLUDES := -Inative/include
TEST_BIN := build/simulation_tests

.PHONY: test clean

test: $(TEST_BIN)
	./$(TEST_BIN)

$(TEST_BIN): native/src/simulation.cpp native/tests/simulation_tests.cpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) $(INCLUDES) $^ -o $@

clean:
	rm -f $(TEST_BIN)

