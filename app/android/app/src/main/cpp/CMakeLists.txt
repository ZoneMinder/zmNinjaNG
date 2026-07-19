cmake_minimum_required(VERSION 3.22.1)
project(zmninja_mnn)

set(MNN_BUILD_LLM ON CACHE BOOL "" FORCE)
set(MNN_LLM_BUILD_DEMO OFF CACHE BOOL "" FORCE)
set(MNN_SEP_BUILD ON CACHE BOOL "" FORCE)
set(MNN_BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(MNN_LOW_MEMORY ON CACHE BOOL "" FORCE)
set(MNN_CPU_WEIGHT_DEQUANT_GEMM ON CACHE BOOL "" FORCE)
set(MNN_SUPPORT_TRANSFORMER_FUSE ON CACHE BOOL "" FORCE)
set(MNN_ARM82 ON CACHE BOOL "" FORCE)
# Vulkan for GPU inference. MNN added LLM support to the Vulkan backend in
# 3.5.0 (with CoopMat matrix acceleration; this submodule is 3.6.0 and carries
# those kernels), so the "CPU/Metal/OpenCL only" line in docs/transformers/
# llm.md describes the llm_bench tool's flag, not the runtime.
#
# Preferred over OpenCL because OpenCL segfaulted building the model on a Pixel
# 8 (its attention kernel does not compile on Mali), and because it needs a
# vendor library reachable only through a manifest declaration. Vulkan is
# public NDK and present on every modern Android device. A device where it
# still crashes falls back to CPU permanently, see native_mnn_jni.cpp.
# No GPU backend on Android. Both were built and measured on a Pixel 8 and both
# lost: OpenCL segfaulted building the model (its attention kernel does not
# compile on Mali) and Vulkan doubled memory into heavy swapping while running
# slower than the CPU. Upstream reports OpenCL LLM decode at 2.5 tok/s against a
# documented 11 on Adreno hardware too (MNN issue #3371), so this is not one
# device being unlucky. Shipping them cost 2.2MB (OpenCL) of APK for a path that
# is unusable, so they are compiled out entirely rather than left switchable.
# iOS keeps Metal, which is different hardware and does work.
set(MNN_OPENCL OFF CACHE BOOL "" FORCE)
set(MNN_VULKAN OFF CACHE BOOL "" FORCE)
# ~25 host test executables, none packaged into the APK; skipping them cuts
# build time.
set(MNN_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLM_SUPPORT_HTTP_RESOURCE OFF CACHE BOOL "" FORCE)

add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/../../../../../native/MNN ${CMAKE_BINARY_DIR}/mnn)
add_library(zmninja_mnn SHARED native_mnn_jni.cpp)
target_include_directories(zmninja_mnn PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/../../../../../native
  ${CMAKE_CURRENT_LIST_DIR}/../../../../../native/MNN/include
  ${CMAKE_CURRENT_LIST_DIR}/../../../../../native/MNN/transformers/llm/engine/include)
target_compile_features(zmninja_mnn PRIVATE cxx_std_17)
target_link_options(zmninja_mnn PRIVATE "-Wl,-z,max-page-size=16384")
target_link_libraries(zmninja_mnn PRIVATE MNN llm android log)
