use crate::{markdown, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{path::Path, time::Instant};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub excerpt: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub elapsed_ms: f64,
    pub strategy: String,
}
pub struct SearchIndex {
    db: Connection,
}
impl SearchIndex {
    pub fn open(path: &Path) -> Result<Self> {
        match Self::open_inner(path) {
            Err(crate::Error::Sql(rusqlite::Error::SqliteFailure(code, _)))
                if matches!(
                    code.code,
                    rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase
                ) =>
            {
                let backup = path.with_extension(format!("corrupt-{}", uuid::Uuid::new_v4()));
                std::fs::rename(path, &backup)?;
                for suffix in ["-wal", "-shm"] {
                    let side = std::path::PathBuf::from(format!("{}{suffix}", path.display()));
                    if side.exists() {
                        std::fs::rename(
                            side,
                            std::path::PathBuf::from(format!("{}{suffix}", backup.display())),
                        )?;
                    }
                }
                Self::open_inner(path)
            }
            result => result,
        }
    }
    fn open_inner(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch("PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS index_meta (schema_version INTEGER NOT NULL);
            INSERT INTO index_meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM index_meta);
            CREATE TABLE IF NOT EXISTS note_hashes(path TEXT PRIMARY KEY,hash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS note_tags(path TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(path,tag));
            CREATE INDEX IF NOT EXISTS tag_lookup ON note_tags(tag,path);
            CREATE TABLE IF NOT EXISTS short_terms(term TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(term,path));
            CREATE INDEX IF NOT EXISTS short_terms_path ON short_terms(path);
            CREATE TABLE IF NOT EXISTS notes_meta(path TEXT PRIMARY KEY,parsed TEXT NOT NULL);
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path UNINDEXED, title, body, filename, tokenize='trigram');")?;
        db.execute("UPDATE index_meta SET schema_version=2", [])?;
        Ok(Self { db })
    }
    pub fn replace_all(&mut self, notes: &[(String, String)]) -> Result<()> {
        let tx = self.db.transaction()?;
        tx.execute_batch("DELETE FROM notes_fts; DELETE FROM note_tags; DELETE FROM short_terms; DELETE FROM notes_meta; DELETE FROM note_hashes;")?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO notes_fts(path, title, body, filename) VALUES (?1, ?2, ?3, ?1)",
            )?;
            for (path, body) in notes {
                stmt.execute(params![path, title(path, body), body])?;
                metadata(&tx, path, body)?;
            }
        }
        tx.commit()?;
        Ok(())
    }
    pub fn upsert(&mut self, path: &str, body: &str) -> Result<()> {
        let tx = self.db.transaction()?;
        tx.execute("DELETE FROM notes_fts WHERE path=?1", [path])?;
        tx.execute(
            "INSERT INTO notes_fts(path,title,body,filename) VALUES (?1,?2,?3,?1)",
            params![path, title(path, body), body],
        )?;
        metadata(&tx, path, body)?;
        tx.commit()?;
        Ok(())
    }
    pub fn reconcile(&mut self, notes: &[(String, String)]) -> Result<()> {
        let hashes: std::collections::BTreeMap<String, String> = {
            let mut stmt = self.db.prepare("SELECT path,hash FROM note_hashes")?;
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<std::result::Result<_, _>>()?;
            rows
        };
        let paths: std::collections::BTreeSet<_> = notes.iter().map(|(p, _)| p.as_str()).collect();
        for (path, body) in notes {
            if hashes.get(path) != Some(&crate::vault::hash(body.as_bytes())) {
                self.upsert(path, body)?;
            }
        }
        let tx = self.db.transaction()?;
        for path in hashes.keys().filter(|p| !paths.contains(p.as_str())) {
            for table in [
                "notes_fts",
                "note_tags",
                "short_terms",
                "notes_meta",
                "note_hashes",
            ] {
                tx.execute(&format!("DELETE FROM {table} WHERE path=?1"), [path])?;
            }
        }
        tx.commit()?;
        Ok(())
    }
    pub fn knowledge(&self) -> Result<Vec<markdown::ParsedNote>> {
        let mut stmt = self
            .db
            .prepare("SELECT parsed FROM notes_meta ORDER BY path")?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut notes = rows
            .into_iter()
            .map(|s| serde_json::from_str(&s).map_err(|e| crate::Error::Probe(e.to_string())))
            .collect::<Result<Vec<_>>>()?;
        markdown::resolve(&mut notes);
        Ok(notes)
    }
    pub fn query(&self, query: &str, directory: &str) -> Result<SearchResults> {
        self.query_filtered(query, directory, "", false)
    }
    pub fn query_filtered(
        &self,
        query: &str,
        directory: &str,
        tag: &str,
        filename_only: bool,
    ) -> Result<SearchResults> {
        let started = Instant::now();
        let mut words = vec![];
        let mut tags = vec![];
        let mut directories = vec![];
        if !directory.is_empty() {
            directories.push(directory.to_owned());
        }
        if !tag.is_empty() {
            tags.push(tag.to_owned());
        }
        for word in query.split_whitespace() {
            if let Some(value) = word.strip_prefix("tag:") {
                if !value.is_empty() {
                    tags.push(value.to_owned());
                }
            } else if let Some(value) = word.strip_prefix("path:") {
                if !value.is_empty() {
                    directories.push(value.to_owned());
                }
            } else {
                words.push(word.to_owned());
            }
        }
        if words.is_empty() && tags.is_empty() && directories.is_empty() {
            return Ok(SearchResults {
                hits: vec![],
                elapsed_ms: 0.,
                strategy: "empty".into(),
            });
        }
        let mut conditions = vec![];
        let mut values: Vec<rusqlite::types::Value> = vec![];
        let mut bind = |value: String| {
            values.push(value.into());
            format!("?{}", values.len())
        };
        for directory in directories {
            let p = bind(format!("{}/", directory.trim_matches('/')));
            conditions.push(format!("substr(f.path,1,length({p}))={p}"));
        }
        for tag in tags {
            let p = bind(tag);
            conditions.push(format!(
                "EXISTS (SELECT 1 FROM note_tags t WHERE t.path=f.path AND t.tag={p})"
            ));
        }
        let mut short = false;
        for word in &words {
            if !filename_only && word.chars().count() >= 3 {
                let p = bind(format!("\"{}\"", word.replace('"', "\"\"")));
                conditions.push(format!(
                    "f.rowid IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH {p})"
                ));
            } else {
                let p = bind(word.to_lowercase());
                if filename_only {
                    conditions.push(format!("instr(lower(f.path),{p})>0"));
                } else {
                    short = true;
                    conditions.push(format!(
                        "EXISTS (SELECT 1 FROM short_terms s WHERE s.path=f.path AND s.term={p})"
                    ));
                }
            }
        }
        let ranking = if let Some(word) = words.first() {
            let p = bind(word.to_lowercase());
            format!("(instr(lower(f.title),{p})>0) DESC,(instr(lower(f.path),{p})>0) DESC,")
        } else {
            String::new()
        };
        let sql=format!("SELECT f.path,f.title,substr(f.body,1,240) FROM notes_fts f WHERE {} ORDER BY {ranking} f.path LIMIT 100",conditions.join(" AND "));
        let mut stmt = self.db.prepare(&sql)?;
        let hits = stmt
            .query_map(rusqlite::params_from_iter(values), |row| {
                Ok(SearchHit {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    excerpt: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(SearchResults {
            hits,
            elapsed_ms: started.elapsed().as_secs_f64() * 1000.,
            strategy: if filename_only {
                "filename"
            } else if short {
                "short-term-index"
            } else {
                "fts5-trigram"
            }
            .into(),
        })
    }
}
fn metadata(tx: &rusqlite::Transaction<'_>, path: &str, body: &str) -> Result<()> {
    let parsed = markdown::parse(path, body);
    tx.execute(
        "INSERT OR REPLACE INTO note_hashes(path,hash) VALUES (?1,?2)",
        params![path, crate::vault::hash(body.as_bytes())],
    )?;
    tx.execute("DELETE FROM note_tags WHERE path=?1", [path])?;
    tx.execute("DELETE FROM short_terms WHERE path=?1", [path])?;
    tx.execute(
        "INSERT OR REPLACE INTO notes_meta(path,parsed) VALUES (?1,?2)",
        params![path, serde_json::to_string(&parsed).unwrap()],
    )?;
    for tag in parsed.tags {
        tx.execute(
            "INSERT OR IGNORE INTO note_tags VALUES (?1,?2)",
            params![path, tag],
        )?;
    }
    let chars: Vec<_> = format!("{path}\n{}\n{body}", parsed.title)
        .to_lowercase()
        .chars()
        .collect();
    let mut terms = std::collections::BTreeSet::new();
    for (i, c) in chars.iter().enumerate() {
        terms.insert(c.to_string());
        if let Some(next) = chars.get(i + 1) {
            terms.insert(format!("{c}{next}"));
        }
    }
    let mut stmt = tx.prepare("INSERT OR IGNORE INTO short_terms VALUES (?1,?2)")?;
    for term in terms {
        stmt.execute(params![term, path])?;
    }
    Ok(())
}

fn title(path: &str, body: &str) -> String {
    body.lines()
        .find_map(|line| line.strip_prefix("# "))
        .unwrap_or(path.trim_end_matches(".md"))
        .to_owned()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryMeasurement {
    pub query: String,
    pub hits: usize,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub strategy: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProbe {
    pub notes: usize,
    pub bytes_per_note: usize,
    pub index_ms: f64,
    pub database_bytes: u64,
    pub measurements: Vec<QueryMeasurement>,
}
pub fn benchmark(count: usize) -> Result<SearchProbe> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("index.sqlite");
    let mut index = SearchIndex::open(&path)?;
    let notes: Vec<_> = (0..count)
        .map(|i| {
            let mut body = format!(
                "# 项目笔记 {i}\n\n这是中文技术验证。Rust 与 Markdown 混排，标点：预算、计划。\n"
            );
            if i % 100 == 0 {
                body.push_str("唯一标记：知识图谱检索 alpha-beta 稀有词。\n");
            }
            while body.len() < 5120 {
                body.push_str("本地优先，离线编辑；笔记关系与跨设备同步。\n");
            }
            (format!("项目/笔记-{i:05}.md"), body)
        })
        .collect();
    let bytes_per_note = notes.first().map_or(0, |n| n.1.len());
    let started = Instant::now();
    index.replace_all(&notes)?;
    let index_ms = started.elapsed().as_secs_f64() * 1000.;
    let mut measurements = Vec::new();
    for query in [
        "知",
        "图谱",
        "知识图谱",
        "Markdown",
        "alpha-beta",
        "预算、计划",
        "不存在",
        "%",
        "\" OR *",
    ] {
        let mut times = Vec::new();
        let mut last = index.query(query, "")?; // warmup
        for _ in 0..25 {
            last = index.query(query, "")?;
            times.push(last.elapsed_ms);
        }
        times.sort_by(f64::total_cmp);
        measurements.push(QueryMeasurement {
            query: query.into(),
            hits: last.hits.len(),
            p50_ms: times[12],
            p95_ms: times[23],
            strategy: last.strategy,
        });
    }
    index.db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    Ok(SearchProbe {
        notes: count,
        bytes_per_note,
        index_ms,
        database_bytes: std::fs::metadata(path)?.len(),
        measurements,
    })
}
