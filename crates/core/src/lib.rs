pub mod git_probe;
pub mod search;
pub mod vault;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("路径不在已授权笔记库范围内，或包含符号链接")]
    InvalidPath,
    #[error("文件已被外部修改；草稿已保留，请重新打开后协调版本")]
    Conflict,
    #[error("笔记超过 2 MiB 编辑上限")]
    TooLarge,
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Sql(#[from] rusqlite::Error),
    #[error("{0}")]
    Git(#[from] git2::Error),
    #[error("{0}")]
    Probe(String),
}
pub type Result<T> = std::result::Result<T, Error>;
pub mod knowledge;
pub mod markdown;
pub mod operations;
pub mod sync;

pub mod paths;
