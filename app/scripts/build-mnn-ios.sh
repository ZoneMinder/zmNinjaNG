#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
MNN="$ROOT/app/native/MNN"
OUT="$ROOT/app/ios/App/MNN.framework"

cd "$MNN"
sh package_scripts/ios/buildiOS.sh "-DMNN_BUILD_LLM=ON -DMNN_LLM_BUILD_DEMO=OFF -DLLM_SUPPORT_HTTP_RESOURCE=OFF -DMNN_LOW_MEMORY=ON -DMNN_CPU_WEIGHT_DEQUANT_GEMM=ON -DMNN_SUPPORT_TRANSFORMER_FUSE=ON -DMNN_ARM82=ON"
rm -rf "$OUT"
cp -R "MNN-iOS-CPU-GPU/Static/MNN.framework" "$OUT"
