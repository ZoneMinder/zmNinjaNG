#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface NativeMnnBridge : NSObject
/** Loads the model if it is not already loaded, returning the backend actually
 *  in use ("metal"/"cpu"). Split out of `chat` so the app can tell the user why
 *  the first turn is slow: loading a 2B model takes seconds, and folded into
 *  `chat` it was indistinguishable from generation. */
+ (nullable NSString *)loadAtConfigPath:(NSString *)configPath error:(NSError **)error;

/** `messages` is an ordered array of `{"role": ..., "content": ...}` turns,
 *  handed to MNN's ChatMessages overload so the model's own chat template
 *  applies real role markers (see NativeMnnBridge.mm). Returns
 *  `{"content": ..., "promptTokens": ..., "completionTokens": ...}`; the token
 *  counts are MNN's own, so the app measures real context usage. */
+ (nullable NSDictionary *)chatAtConfigPath:(NSString *)configPath messages:(NSArray<NSDictionary<NSString *, NSString *> *> *)messages maxTokens:(NSInteger)maxTokens error:(NSError **)error;
+ (void)unload;
@end

NS_ASSUME_NONNULL_END
