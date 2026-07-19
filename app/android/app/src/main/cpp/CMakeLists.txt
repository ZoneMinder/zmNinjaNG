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
