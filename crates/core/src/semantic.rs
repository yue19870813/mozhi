//! Rebuildable, vault-private semantic index. No model or network dependency.
use crate::{ai, vault::Note, Error, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

pub const MODEL_ID: &str = "minilm-multilingual-q8-v1-2c4055b";
pub const DIM: usize = 384;
#[derive(Clone, Debug)]
pub struct Chunk {
    pub start: usize,
    pub end: usize,
    pub text: String,
}
#[derive(Clone)]
pub struct Hit {
    pub path: String,
    pub hash: String,
    pub chunk: Chunk,
    pub score: f32,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub notes: usize,
    pub chunks: usize,
}

/// Character boundaries preserve every body character, with paragraph-aware splits and overlap.
pub fn chunks(content: &str) -> Vec<Chunk> {
    let (_, body) = ai::split_body(content);
    let chars: Vec<char> = body.chars().collect();
    let mut out = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + 240).min(chars.len());
        if end < chars.len() {
            if let Some(i) = (start + 120..end).rev().find(|&i| chars[i] == '\n') {
                end = i + 1;
            }
        }
        let text: String = chars[start..end].iter().collect();
        if !text.trim().is_empty() {
            out.push(Chunk { start, end, text });
        }
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(24).max(start + 1);
    }
    out
}
/// Reject stale or tampered cached text before it can become a model reference.
pub fn matches(note: &Note, hit: &Hit) -> bool {
    if note.path != hit.path || note.content_hash != hit.hash || hit.chunk.start >= hit.chunk.end {
        return false;
    }
    let (_, body) = ai::split_body(&note.content);
    if hit.chunk.end > body.chars().count() {
        return false;
    }
    body.chars()
        .skip(hit.chunk.start)
        .take(hit.chunk.end - hit.chunk.start)
        .eq(hit.chunk.text.chars())
}
pub struct Index(Connection);
impl Index {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS semantic_meta(model TEXT NOT NULL); CREATE TABLE IF NOT EXISTS semantic_notes(path TEXT PRIMARY KEY, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS semantic_chunks(path TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, text TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY(path,start));")?;
        let model: Option<String> = db
            .query_row("SELECT model FROM semantic_meta LIMIT 1", [], |r| r.get(0))
            .ok();
        if model.as_deref() != Some(MODEL_ID) {
            db.execute_batch("BEGIN;DELETE FROM semantic_chunks;DELETE FROM semantic_notes;DELETE FROM semantic_meta;COMMIT;")?;
            db.execute("INSERT INTO semantic_meta VALUES(?)", [MODEL_ID])?;
        }
        Ok(Self(db))
    }
    pub fn hashes(&self) -> Result<HashMap<String, String>> {
        Ok(self
            .0
            .prepare("SELECT path,hash FROM semantic_notes")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?)
    }
    pub fn stats(&self) -> Result<Stats> {
        Ok(Stats {
            notes: self
                .0
                .query_row("SELECT count(*) FROM semantic_notes", [], |r| r.get(0))?,
            chunks: self
                .0
                .query_row("SELECT count(*) FROM semantic_chunks", [], |r| r.get(0))?,
        })
    }
    pub fn clear(&self) -> Result<()> {
        self.0.execute_batch(
            "BEGIN;DELETE FROM semantic_chunks;DELETE FROM semantic_notes;COMMIT;",
        )?;
        Ok(())
    }
    pub fn prune(&mut self, paths: &HashSet<String>) -> Result<()> {
        let hashes = self.hashes()?;
        let tx = self.0.transaction()?;
        for path in hashes.keys().filter(|p| !paths.contains(*p)) {
            tx.execute("DELETE FROM semantic_chunks WHERE path=?", [path])?;
            tx.execute("DELETE FROM semantic_notes WHERE path=?", [path])?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn replace(&mut self, note: &Note, chunks: &[Chunk], vectors: &[Vec<f32>]) -> Result<()> {
        if chunks.len() != vectors.len()
            || vectors
                .iter()
                .any(|v| v.len() != DIM || v.iter().any(|x| !x.is_finite()))
        {
            return Err(Error::Probe("向量数据无效".into()));
        }
        let tx = self.0.transaction()?;
        tx.execute("DELETE FROM semantic_chunks WHERE path=?", [&note.path])?;
        for (c, v) in chunks.iter().zip(vectors) {
            let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
            tx.execute(
                "INSERT INTO semantic_chunks VALUES(?,?,?,?,?)",
                params![note.path, c.start, c.end, c.text, bytes],
            )?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO semantic_notes VALUES(?,?)",
            params![note.path, note.content_hash],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn search(&self, query: &[f32], limit: usize) -> Result<Vec<Hit>> {
        if query.len() != DIM || query.iter().any(|x| !x.is_finite()) {
            return Err(Error::Probe("向量数据无效".into()));
        }
        let qnorm = query.iter().map(|x| x * x).sum::<f32>().sqrt();
        if qnorm <= 0.0 {
            return Ok(vec![]);
        }
        let mut stmt=self.0.prepare("SELECT c.path,n.hash,c.start,c.end,c.text,c.vector FROM semantic_chunks c JOIN semantic_notes n ON c.path=n.path")?;
        let mut rows = stmt.query([])?;
        let mut hits = Vec::new();
        while let Some(r) = rows.next()? {
            let bytes: Vec<u8> = r.get(5)?;
            if bytes.len() != DIM * 4 {
                continue;
            }
            let v: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect();
            let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            if norm <= 0.0 {
                continue;
            }
            let score = query.iter().zip(v).map(|(a, b)| a * b).sum::<f32>() / (qnorm * norm);
            if !score.is_finite() {
                continue;
            }
            hits.push(Hit {
                path: r.get(0)?,
                hash: r.get(1)?,
                chunk: Chunk {
                    start: r.get(2)?,
                    end: r.get(3)?,
                    text: r.get(4)?,
                },
                score,
            });
            hits.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.path.cmp(&b.path)));
            hits.truncate(limit);
        }
        Ok(hits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn body_chunks_cover_unicode_and_exclude_metadata() {
        let body = format!("# 标题\n\n{}", "中文🙂abc\n".repeat(120));
        let result = chunks(&format!("---\nid: secret\n---\n{body}"));
        let chars: Vec<char> = body.chars().collect();
        let mut covered = HashSet::new();
        for c in result {
            assert_eq!(c.text, chars[c.start..c.end].iter().collect::<String>());
            covered.extend(c.start..c.end);
            assert!(!c.text.contains("secret"));
        }
        assert_eq!(covered.len(), chars.len());
    }
    #[test]
    fn cached_sources_reject_changed_notes_wrong_paths_and_tampered_ranges() {
        let note = Note {
            path: "a.md".into(),
            content: "---\nid: secret\n---\n中文正文".into(),
            content_hash: "hash".into(),
        };
        let mut hit = Hit {
            path: note.path.clone(),
            hash: note.content_hash.clone(),
            chunk: Chunk {
                start: 0,
                end: 4,
                text: "中文正文".into(),
            },
            score: 1.0,
        };
        assert!(matches(&note, &hit));
        hit.hash = "old".into();
        assert!(!matches(&note, &hit));
        hit.hash = "hash".into();
        hit.chunk.text = "伪造正文".into();
        assert!(!matches(&note, &hit));
        hit.chunk.text = "中文正文".into();
        hit.chunk.end = 100;
        assert!(!matches(&note, &hit));
        hit.chunk.end = 4;
        hit.path = "other.md".into();
        assert!(!matches(&note, &hit));
    }
    #[test]
    fn index_is_atomic_incremental_and_removes_deleted_notes() {
        let tmp = tempfile::tempdir().unwrap();
        let mut index = Index::open(&tmp.path().join("vectors.db")).unwrap();
        let note = Note {
            path: "a.md".into(),
            content: "测试".into(),
            content_hash: "hash".into(),
        };
        let parts = chunks(&note.content);
        let mut v = vec![0.0; DIM];
        v[0] = 1.0;
        index.replace(&note, &parts, &[v.clone()]).unwrap();
        assert_eq!(index.search(&v, 10).unwrap()[0].chunk.text, "测试");
        assert!(index
            .replace(&note, &parts, &[vec![f32::NAN; DIM]])
            .is_err());
        assert_eq!(index.stats().unwrap().chunks, 1);
        index.prune(&HashSet::new()).unwrap();
        assert_eq!(index.stats().unwrap().notes, 0);
    }
}
