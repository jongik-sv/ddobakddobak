fn main() {
  #[cfg(target_os = "macos")]
  {
    // screencapturekit crate needs Swift Concurrency runtime
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
  }
  tauri_build::build()
}
