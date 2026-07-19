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
# GPU inference where the device supports it. MNN loads libOpenCL.so at runtime
# and falls back to CPU on its own when the driver is missing or unusable, which
# is common across Android GPUs, so this is an attempt rather than a guarantee.
# There is no Metal here (iOS only) and Vulkan is not enabled: MNN only selects
# it through MNN_FORWARD_AUTO, which would also outrank OpenCL, and it costs
# binary size for a path we have not measured.
set(MNN_OPENCL ON CACHE BOOL "" FORCE)
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
