// Standalone check for cpu_topology.h (refs #270). Not part of the CMake build:
// the heuristic is pure arithmetic over frequencies, so it needs no NDK, no
// device and no llama.cpp. Build and run it on the host:
//
//   c++ -std=c++17 cpu_topology_test.cpp -o /tmp/cpu_topology_test && /tmp/cpu_topology_test
//
// The layouts below are the ones cpu_topology.h documents; if the 75% cut is
// ever retuned, these are the numbers that have to keep holding.
#include <cassert>
#include <cstdio>

#include "cpu_topology.h"

using zmninja::fast_core_count_from;

int main() {
    // kHz, exactly as cpuinfo_max_freq reports them.

    // Tensor G5 (Pixel 10): 2 little + 5 mid + 1 big. The regression this fixes:
    // hw-4 gave 4 here, costing 32% of prefill.
    assert(fast_core_count_from({2246000, 2246000, 3052000, 3052000, 3052000, 3052000, 3052000, 3782000}) == 6);

    // Tensor G3 (Pixel 8): 4 little + 4 mid + 1 big. 5 is where its own bench peaked.
    assert(fast_core_count_from({1700000, 1700000, 1700000, 1700000, 2368000, 2368000, 2368000, 2368000, 2914000}) == 5);

    // Snapdragon 8 Gen 2: 3 little + 4 mid + 1 big.
    assert(fast_core_count_from({2020000, 2020000, 2020000, 2803000, 2803000, 2803000, 2803000, 3187000}) == 5);

    // Snapdragon 855: 4 little + 3 mid + 1 big.
    assert(fast_core_count_from({1785000, 1785000, 1785000, 1785000, 2419000, 2419000, 2419000, 2841000}) == 4);

    // Uniform cores (no big.LITTLE): every core is a performance core.
    assert(fast_core_count_from({2400000, 2400000, 2400000, 2400000}) == 4);

    // Unreadable cpufreq: 0, so inference_thread_count falls back to the count-only guess.
    assert(fast_core_count_from({}) == 0);

    // The cut is a ratio, not a fixed gap: a core exactly at 75% of the top stays in,
    // one just below drops out.
    assert(fast_core_count_from({3000000, 4000000}) == 2);
    assert(fast_core_count_from({2999999, 4000000}) == 1);

    printf("cpu_topology: all checks passed\n");
    return 0;
}
