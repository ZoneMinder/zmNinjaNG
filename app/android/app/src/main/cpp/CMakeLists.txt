# NativeLlm JNI engine. Fetches llama.cpp pinned to the same tag as iOS (b10087)
# and builds a CPU-only arm64 backend. No Metal/Vulkan/OpenCL (out of scope, iOS uses Metal).
cmake_minimum_required(VERSION 3.22.1)
project(nativellm CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(
    llama_cpp
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG b10087
    GIT_SHALLOW TRUE
)

# Library-only, CPU-only. These match the C API LlamaEngine.swift uses; nothing
# in llama_jni.cpp needs common/tools/curl/openssl.
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP      OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON   OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL           OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL        OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE          OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE       OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP          OFF CACHE BOOL "" FORCE)  # ggml uses its own pthread pool; avoids NDK libomp linkage
set(BUILD_SHARED_LIBS    ON  CACHE BOOL "" FORCE)  # llama/ggml as shared libs; AGP packages them all

# Runtime CPU-feature dispatch. GGML_CPU_ALL_VARIANTS builds one ggml-cpu .so per arm64
# ISA tier (armv8.0 baseline .. armv8.2+dotprod .. armv8.6+i8mm+sve .. armv9.2); GGML_BACKEND_DL
# makes them dlopen-loadable and the ggml loader picks the highest tier the running CPU
# actually supports. This is SIGILL-SAFE on every device: a Snapdragon 855/865-era 6-12GB
# phone (no i8mm) loads the dotprod variant, an ancient chip loads armv8.0, and a Pixel 8
# (Tensor G3) loads armv9.0 with dotprod+i8mm+sve. On-device llama-bench (Qwen3-4B Q4_K_M,
# 5 threads): baseline armv8-a pp512 8.4 t/s -> dispatched variant 16.2 t/s (~1.9x prefill),
# tg 5.6 -> 7.0 t/s (~1.25x). See task-12 report for the full table.
set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL       ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(llama_cpp)

add_library(nativellm SHARED llama_jni.cpp)
# Linking `llama` propagates its public include dir (llama.h); ggml headers (ggml-backend.h,
# for the load-all-from-path call) come transitively through llama -> ggml.
target_link_libraries(nativellm llama android log)
