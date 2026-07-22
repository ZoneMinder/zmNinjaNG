// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LlamaKit",
    platforms: [.iOS(.v16)],
    products: [.library(name: "LlamaKit", targets: ["LlamaKit"])],
    targets: [
        .binaryTarget(
            name: "llama",
            url: "https://github.com/ggml-org/llama.cpp/releases/download/b10087/llama-b10087-xcframework.zip",
            checksum: "ea28e09d542f025686aec47df1b3312c2510f7ed884c476743ab76c31c924005"),
        .target(name: "LlamaKit", dependencies: ["llama"], path: "Sources/LlamaKitTarget"),
    ]
)
