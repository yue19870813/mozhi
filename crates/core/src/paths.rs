//! Logical paths always use `/`; native paths never cross the IPC/Git/ZIP boundary.
use crate::{Error, Result};
use std::{
    fs::Metadata,
    path::{Component, Path},
};

pub fn logical(path: &Path) -> Result<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(part) = component else {
            return Err(Error::InvalidPath);
        };
        let part = part.to_str().ok_or(Error::InvalidPath)?;
        if part.contains('\\') {
            return Err(Error::InvalidPath);
        }
        parts.push(part);
    }
    if parts.is_empty() {
        return Err(Error::InvalidPath);
    }
    Ok(parts.join("/"))
}

pub fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Reject all reparse points, including junctions and cloud placeholders.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub fn reserved_name(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_uppercase();
    ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        })
}
