fn main() {
    if std::env::var("TARGET").as_deref() == Ok("x86_64-apple-darwin") {
        // Intel releases bundle the source-built runtime beside the executable.
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
    tauri_build::build()
}
