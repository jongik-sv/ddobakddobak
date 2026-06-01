fn main() {
    tauri_build::build();

    // Build scripts run on the HOST, so gate on CARGO_CFG_TARGET_OS (the *target*
    // OS) — not `#[cfg(target_os=...)]` which reflects the host. Cross-compiling
    // for Android from a macOS host would otherwise wrongly take the macOS branch.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "android" {
        android_sherpa_bindgen();
    } else if target_os == "macos" {
        // screencapturekit crate needs the Swift Concurrency runtime at load time.
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}

/// Android cross-compile branch: generate sherpa-onnx C-API bindings + link the
/// two prebuilt `.so` (vendored in T0).
///
/// 1. bindgen parses the C-API header with HOST libclang. The header is
///    target-independent (only needs `<stdint.h>`), so we do NOT point at the
///    NDK sysroot.
/// 2. Emit per-ABI link directives for the prebuilt `.so` so the Android cdylib
///    links against `libsherpa-onnx-c-api` (+ `libonnxruntime`).
fn android_sherpa_bindgen() {
    // Host libclang for bindgen. Set only if unset so a caller-provided
    // LIBCLANG_PATH (e.g. a Homebrew llvm) still wins.
    if std::env::var_os("LIBCLANG_PATH").is_none() {
        std::env::set_var("LIBCLANG_PATH", "/Library/Developer/CommandLineTools/usr/lib");
    }

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    // Vendored header (T0): src-tauri/inc/sherpa-onnx/c-api/c-api.h.
    let header = format!("{manifest_dir}/inc/sherpa-onnx/c-api/c-api.h");

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");
    let out_path = std::path::Path::new(&out_dir).join("sherpa_bindings.rs");

    // Broad allowlist: the entire public surface is `SherpaOnnx*`-prefixed and
    // cohesive C. Hand-listing risks dropping the nested Cohere config /
    // transitive structs, so allowlist the whole prefix for fn/type/var.
    let bindings = bindgen::Builder::default()
        .header(&header)
        .allowlist_function("SherpaOnnx.*")
        .allowlist_type("SherpaOnnx.*")
        .allowlist_var("SherpaOnnx.*")
        .generate()
        .expect("failed to generate sherpa-onnx bindings");
    bindings
        .write_to_file(&out_path)
        .expect("failed to write sherpa_bindings.rs");
    println!("cargo:rerun-if-changed={header}");

    // Map the target arch to the on-disk ABI dir under the Android Gradle
    // project. The link-time search dir and the runtime APK packaging are two
    // independent mechanisms that MUST stay in sync per ABI.
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH");
    let abi = match arch.as_str() {
        "aarch64" => "arm64-v8a",
        "x86_64" => "x86_64",
        other => panic!("unsupported android target arch: {other}"),
    };
    let abi_dir =
        format!("{manifest_dir}/gen/android/app/src/main/jniLibs/{abi}");

    // SONAME note: neither prebuilt `.so` has a DT_SONAME (confirmed via
    // llvm-readelf), so lld records DT_NEEDED == the on-disk filename
    // (`libsherpa-onnx-c-api.so`, `libonnxruntime.so`). The APK MUST package
    // those exact filenames — DT_NEEDED == filename is load-bearing.
    // onnxruntime is pulled in via libsherpa-onnx-c-api.so's DT_NEEDED, but we
    // name it explicitly too so a direct `cargo build --target` link gate also
    // resolves it.
    println!("cargo:rustc-link-search=native={abi_dir}");
    println!("cargo:rustc-link-lib=dylib=sherpa-onnx-c-api");
    println!("cargo:rustc-link-lib=dylib=onnxruntime");
}
