#import "NativeMnnBridge.h"
#include <mutex>
#include <sstream>
#include <string>
#include <MNN/llm/llm.hpp>
#include "../../../native/mnn-runtime-config.h"

namespace {
std::mutex m;
MNN::Transformer::Llm *model = nullptr;
std::string path;
/** Backend the loaded model actually resolved to, reported to the UI. */
std::string loadedBackend = "cpu";
/** True when the GPU crashed a previous launch and CPU was forced. */
bool gpuCrashedBefore = false;

/** iOS builds MNN with -DMNN_METAL=ON (package_scripts/ios/buildiOS.sh), so
 *  Metal is compiled in on every device; there is no OpenCL here. MNN degrades
 *  to CPU by itself if the Metal runtime cannot be created. */
constexpr MNNForwardType kPreferredBackend = MNN_FORWARD_METAL;

/** Loads `wanted` unless it is already loaded. Caller holds `m`. */
bool ensureLoaded(const std::string &wanted, bool useGpu) {
  if (model && path == wanted) return true;
  if (model) MNN::Transformer::Llm::destroy(model);
  model = MNN::Transformer::Llm::createLLM(wanted);
  if (!model) return false;
  const std::string directory = zmninjaMnnModelDirectory(wanted);
  // Skip the GPU entirely if a previous attempt never came back: a backend that
  // takes the process down cannot be caught, only remembered.
  gpuCrashedBefore = zmninjaMnnGpuCrashedBefore(directory);
  const MNNForwardType backend = (useGpu && !gpuCrashedBefore) ? zmninjaMnnResolveBackend(kPreferredBackend) : MNN_FORWARD_CPU;
  if (backend != MNN_FORWARD_CPU) zmninjaMnnMarkGpuAttempt(directory);
  loadedBackend = zmninjaMnnBackendName(backend);
  model->set_config(zmninjaMnnConfig(loadedBackend.c_str(), directory));
  const bool ok = model->load();
  zmninjaMnnClearGpuAttempt(directory);
  if (!ok) { model = nullptr; return false; }
  path = wanted;
  return true;
}

/** A generation cut off mid-token can leave a truncated multi-byte sequence at
 *  the tail, which makes +stringWithUTF8String: return nil and lose the whole
 *  reply. Drop the incomplete sequence instead. */
void dropTruncatedUtf8Tail(std::string &text) {
  size_t i = text.size();
  while (i > 0 && (static_cast<unsigned char>(text[i - 1]) & 0xC0) == 0x80) i--;
  if (i == 0) return;
  const unsigned char lead = static_cast<unsigned char>(text[i - 1]);
  size_t expected = 1;
  if ((lead & 0xE0) == 0xC0) expected = 2;
  else if ((lead & 0xF0) == 0xE0) expected = 3;
  else if ((lead & 0xF8) == 0xF0) expected = 4;
  if (expected > 1 && text.size() - (i - 1) < expected) text.resize(i - 1);
}

NSError *loadError(void) {
  return [NSError errorWithDomain:@"NativeMnn" code:1 userInfo:@{NSLocalizedDescriptionKey: @"MNN model could not load."}];
}
}

@implementation NativeMnnBridge

+ (void)unload {
  std::lock_guard<std::mutex> lock(m);
  if (model) MNN::Transformer::Llm::destroy(model);
  model = nullptr;
  path.clear();
  loadedBackend = "cpu";
}

+ (NSString *)loadAtConfigPath:(NSString *)configPath useGpu:(BOOL)useGpu error:(NSError **)error {
  std::lock_guard<std::mutex> lock(m);
  if (!ensureLoaded(std::string(configPath.UTF8String), useGpu)) { if (error) *error = loadError(); return nil; }
  // "cpu!" marks a forced fall back after a GPU crash, so the app can say so.
  return [NSString stringWithUTF8String:(loadedBackend + (gpuCrashedBefore ? "!" : "")).c_str()];
}

+ (NSDictionary *)chatAtConfigPath:(NSString *)configPath messages:(NSArray<NSDictionary<NSString *, NSString *> *> *)messages maxTokens:(NSInteger)maxTokens useGpu:(BOOL)useGpu error:(NSError **)error {
  std::lock_guard<std::mutex> lock(m);
  if (!ensureLoaded(std::string(configPath.UTF8String), useGpu)) { if (error) *error = loadError(); return nil; }

  // ChatMessages, not a flattened string: the string overload wraps the whole
  // blob as ONE user turn (losing every role marker) and appends to the prior
  // call's KV cache even though the caller re-sends the full conversation.
  MNN::Transformer::ChatMessages chat;
  chat.reserve(messages.count);
  for (NSDictionary<NSString *, NSString *> *message in messages) {
    NSString *role = message[@"role"] ?: @"user", *content = message[@"content"] ?: @"";
    chat.emplace_back(std::string(role.UTF8String), std::string(content.UTF8String));
  }
  if (chat.empty()) {
    if (error) *error = [NSError errorWithDomain:@"NativeMnn" code:2 userInfo:@{NSLocalizedDescriptionKey: @"MNN chat requires at least one message."}];
    return nil;
  }

  std::ostringstream out;
  model->response(chat, &out, nullptr, (int)maxTokens);
  std::string text = out.str();
  dropTruncatedUtf8Tail(text);

  const auto *context = model->getContext();
  return @{
    @"content": [NSString stringWithUTF8String:text.c_str()] ?: @"",
    @"promptTokens": @(context->prompt_len),
    @"completionTokens": @(context->gen_seq_len),
  };
}

@end
