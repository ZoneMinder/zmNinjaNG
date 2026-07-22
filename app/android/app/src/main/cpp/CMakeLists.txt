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
FetchContent_MakeAvailable(llama_cpp)

add_library(nativellm SHARED llama_jni.cpp)
# Linking `llama` propagates its public include dir (llama.h).
target_link_libraries(nativellm llama android log)

# ponytail: baseline armv8-a CPU only. Add -DGGML_CPU_KLEIDIAI=ON / dotprod+i8mm variants
# if inference throughput on-device is too slow.
