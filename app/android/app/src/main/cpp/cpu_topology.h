// CPU topology for llama.cpp thread sizing (refs #270).
//
// Split out of llama_jni.cpp so the heuristic can be exercised without the
// engine: cpu_topology_test.cpp is a standalone assert-based check, see its
// header for the one-line build command.
#pragma once

#include <algorithm>
#include <cstdio>
#include <thread>
#include <vector>

namespace zmninja {

// Cores whose cpufreq ceiling is within 75% of the fastest core's: the big and
// mid clusters, excluding the efficiency cores. Returns 0 when cpufreq is
// unreadable (SELinux, an unusual kernel), which is the caller's cue to fall
// back to a count-only guess.
//
// 75% is the gap every current big.LITTLE arm64 layout leaves between its
// slowest performance core and its fastest efficiency core:
//   Tensor G5  (Pixel 10): 2x2.25 + 5x3.05 + 1x3.78 GHz -> cut at 2.84 -> 6
//   Tensor G3  (Pixel 8):  4x1.70 + 4x2.37 + 1x2.91 GHz -> cut at 2.19 -> 5
//   SD 8 Gen 2:            3x2.02 + 4x2.80 + 1x3.19 GHz -> cut at 2.39 -> 5
//   SD 855:                4x1.78 + 3x2.42 + 1x2.84 GHz -> cut at 2.13 -> 4
// Cores are scanned individually rather than by cluster because the sysfs
// cluster grouping (policyN) is not uniform across vendors, while
// cpuinfo_max_freq is.
// The cut itself, over already-read frequencies. Split from the sysfs scan so
// the layouts above are checkable without the device that has them.
inline int fast_core_count_from(const std::vector<long> &freqs) {
    if (freqs.empty()) return 0;
    const long top = *std::max_element(freqs.begin(), freqs.end());
    return (int) std::count_if(freqs.begin(), freqs.end(), [top](long f) { return f * 4 >= top * 3; });
}

inline int fast_core_count() {
    std::vector<long> freqs;
    // Sparse and offline cores just miss the open; keep scanning rather than
    // stopping at the first gap.
    for (int cpu = 0; cpu < 64; cpu++) {
        char path[128];
        snprintf(path, sizeof(path), "/sys/devices/system/cpu/cpu%d/cpufreq/cpuinfo_max_freq", cpu);
        FILE *f = fopen(path, "r");
        if (!f) continue;
        long khz = 0;
        if (fscanf(f, "%ld", &khz) == 1 && khz > 0) freqs.push_back(khz);
        fclose(f);
    }
    return fast_core_count_from(freqs);
}

// Threads for llama_decode: the performance cores, clamped to [4, 6].
//
// The little cluster straggles on prefill and drags the whole batch, so it is
// excluded rather than used. Measured with llama-bench (Qwen3-4B Q4_K_M, fa=1)
// on Pixel 10 / Tensor G5, pp512 t/s by thread count:
//   4: 19.90   5: 22.18   6: 26.22   7: 25.85   8: 24.60
// 6 is this device's performance-core count and its peak; 7 and 8 regress as
// soon as a little core joins. Pixel 8 / Tensor G3 peaked the same way at its
// own count of 5 (16.19 t/s, regressing to 15.78 at 7). Decode is flat across
// every thread count (6.2-6.7 t/s on Pixel 10) because it is bandwidth-bound,
// so this tunes prefill only.
//
// The clamp keeps an unusual topology sane: a phone reporting 8 performance
// cores has never beaten 6 in a bench, and a failed cpufreq read falls back to
// the count-only guess this heuristic replaced.
inline int inference_thread_count() {
    int fast = fast_core_count();
    if (fast <= 0) fast = (int) std::thread::hardware_concurrency() - 4;
    return std::max(4, std::min(6, fast));
}

} // namespace zmninja
