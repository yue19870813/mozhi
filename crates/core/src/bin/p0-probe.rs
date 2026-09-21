use mozhi_core::{git_probe, search};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let count: usize = args
        .get(1)
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(10_000);
    if !(1..=10_000).contains(&count) {
        return Err("样本数量须为 1–10000".into());
    }
    let report = serde_json::json!({
        "schemaVersion": 1,
        "os": std::env::consts::OS, "arch": std::env::consts::ARCH,
        "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
        "search": search::benchmark(count)?, "git": git_probe::run()?,
        "limitations": ["热查询 25 次；查询最多返回 100 条；一字/二字使用补充索引，非冷启动测试", "Git 为本地 bare 仓库测试，HTTPS 真连接待验收", "中文输入与图谱需系统 WebView / 真机验证"]
    });
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
