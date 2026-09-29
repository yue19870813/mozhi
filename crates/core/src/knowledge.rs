use crate::{
    markdown::{self, ParsedNote},
    vault::Vault,
    Result,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQuery {
    pub center: Option<String>,
    pub depth: Option<usize>,
    pub tag: Option<String>,
    pub directory: Option<String>,
    pub keyword: Option<String>,
    pub include_isolated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<ParsedNote>,
    pub edges: Vec<Edge>,
    pub truncated: bool,
    pub incoming_counts: BTreeMap<String, usize>,
}
#[derive(Serialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
    pub count: usize,
}
pub fn scan(vault: &Vault) -> Result<Vec<ParsedNote>> {
    let mut notes = Vec::new();
    for entry in vault.list()? {
        if let Ok(note) = vault.read(&entry.path) {
            notes.push(markdown::parse(&note.path, &note.content));
        }
    }
    markdown::resolve(&mut notes);
    Ok(notes)
}
pub fn graph(notes: &[ParsedNote], query: &GraphQuery) -> Graph {
    // Count distinct referring notes across the whole vault before filtering or
    // truncating the visible graph. Repeated links do not inflate node sizes.
    let existing: BTreeSet<_> = notes.iter().map(|note| note.path.as_str()).collect();
    let mut incoming: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for note in notes {
        for reference in &note.references {
            if reference.image {
                continue;
            }
            if let Some(target) = reference.target.as_deref() {
                if target != note.path && existing.contains(target) {
                    incoming.entry(target).or_default().insert(&note.path);
                }
            }
        }
    }
    let allowed: BTreeSet<_> = notes
        .iter()
        .filter(|n| {
            query
                .tag
                .as_ref()
                .is_none_or(|s| s.is_empty() || n.tags.contains(s))
                && query.directory.as_ref().is_none_or(|s| {
                    s.is_empty() || n.path.starts_with(&format!("{}/", s.trim_end_matches('/')))
                })
                && query.keyword.as_ref().is_none_or(|s| {
                    s.is_empty()
                        || n.title.to_lowercase().contains(&s.to_lowercase())
                        || n.path.contains(s)
                })
        })
        .map(|n| n.path.clone())
        .collect();
    let mut pairs = std::collections::BTreeMap::new();
    for n in notes {
        for r in &n.references {
            if r.image {
                continue;
            }
            if let Some(target) = &r.target {
                if allowed.contains(&n.path) && allowed.contains(target) {
                    *pairs
                        .entry((n.path.clone(), target.clone()))
                        .or_insert(0usize) += 1;
                }
            }
        }
    }
    let mut visible = allowed.clone();
    if let Some(center) = &query.center {
        visible.clear();
        let mut queue = VecDeque::from([(center.clone(), 0)]);
        while let Some((path, depth)) = queue.pop_front() {
            if !allowed.contains(&path) || !visible.insert(path.clone()) {
                continue;
            }
            if visible.len() >= 200 {
                break;
            }
            if depth < query.depth.unwrap_or(1).clamp(1, 2) {
                for (a, b) in pairs.keys() {
                    if a == &path {
                        queue.push_back((b.clone(), depth + 1));
                    }
                    if b == &path {
                        queue.push_back((a.clone(), depth + 1));
                    }
                }
            }
        }
    }
    if !query.include_isolated {
        visible.retain(|p| pairs.keys().any(|(a, b)| a == p || b == p));
    }
    let truncated = visible.len() > 1000
        || (query.center.is_some() && visible.len() >= 200)
        || pairs.len() > 3000;
    visible = visible.into_iter().take(1000).collect();
    let incoming_counts = visible
        .iter()
        .map(|path| {
            (
                path.clone(),
                incoming.get(path.as_str()).map_or(0, BTreeSet::len),
            )
        })
        .collect();
    let nodes = notes
        .iter()
        .filter(|n| visible.contains(&n.path))
        .cloned()
        .collect();
    let edges = pairs
        .into_iter()
        .filter(|((a, b), _)| visible.contains(a) && visible.contains(b))
        .take(3000)
        .map(|((source, target), count)| Edge {
            source,
            target,
            count,
        })
        .collect();
    Graph {
        nodes,
        edges,
        truncated,
        incoming_counts,
    }
}
