use percent_encoding::percent_decode_str;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub raw: String,
    pub start: usize,
    pub end: usize,
    pub wiki: bool,
    #[serde(default)]
    pub image: bool,
    pub target: Option<String>,
    pub resolution: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedNote {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub tags: Vec<String>,
    pub references: Vec<Reference>,
    pub issues: Vec<String>,
}
pub(crate) fn frontmatter(body: &str) -> (usize, Option<&str>) {
    let Some(rest) = body
        .strip_prefix("---\r\n")
        .or_else(|| body.strip_prefix("---\n"))
    else {
        return (0, None);
    };
    let start = body.len() - rest.len();
    let mut position = start;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return (position + line.len(), Some(&body[start..position]));
        }
        position += line.len();
    }
    (0, None)
}
pub fn parse(path: &str, body: &str) -> ParsedNote {
    let (offset, yaml) = frontmatter(body);
    let mut note = ParsedNote {
        path: path.into(),
        id: None,
        title: path
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .trim_end_matches(".md")
            .into(),
        tags: vec![],
        references: vec![],
        issues: vec![],
    };
    if let Some(yaml) = yaml {
        match serde_yaml::from_str::<serde_yaml::Value>(yaml) {
            Ok(value) => {
                note.id = value.get("id").and_then(|v| v.as_str()).map(str::to_owned);
                if let Some(tags) = value.get("tags") {
                    if let Some(tags) = tags.as_sequence() {
                        note.tags = tags
                            .iter()
                            .filter_map(|v| v.as_str())
                            .map(str::to_owned)
                            .collect();
                    } else {
                        note.issues.push("tags 必须是数组".into());
                    }
                }
            }
            Err(_) => note.issues.push("front matter YAML 无法解析".into()),
        }
    }
    note.tags.sort();
    note.tags.dedup();
    let mut excluded = vec![];
    let mut heading = false;
    let mut title = String::new();
    for (event, range) in
        Parser::new_ext(&body[offset..], Options::all() & !Options::ENABLE_WIKILINKS)
            .into_offset_iter()
    {
        let range = range.start + offset..range.end + offset;
        match event {
            Event::Start(Tag::Heading {
                level: pulldown_cmark::HeadingLevel::H1,
                ..
            }) if title.is_empty() => heading = true,
            Event::End(TagEnd::Heading(_)) => heading = false,
            Event::Text(text) if heading => title.push_str(&text),
            Event::Code(text) if heading => {
                title.push_str(&text);
                excluded.push(range);
            }
            Event::Start(Tag::CodeBlock(_)) => excluded.push(range),
            Event::Code(_) | Event::Html(_) | Event::InlineHtml(_) => excluded.push(range),
            Event::Start(Tag::Image { dest_url, .. }) => {
                excluded.push(range.clone());
                let raw = dest_url.to_string();
                if is_local(&raw) {
                    note.references.push(Reference {
                        raw,
                        start: range.start,
                        end: range.end,
                        wiki: false,
                        image: true,
                        target: None,
                        resolution: "attachment".into(),
                    });
                }
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                excluded.push(range.clone());
                let raw = dest_url.to_string();
                if is_local(&raw)
                    && raw
                        .split('#')
                        .next()
                        .unwrap_or("")
                        .to_lowercase()
                        .ends_with(".md")
                {
                    // Store full source ranges; rename can rewrite the complete link without regex.
                    note.references.push(Reference {
                        raw,
                        start: range.start,
                        end: range.end,
                        wiki: false,
                        image: false,
                        target: None,
                        resolution: "missing".into(),
                    });
                }
            }
            _ => {}
        }
    }
    if !title.is_empty() {
        note.title = title;
    }
    let mut cursor = offset;
    while let Some(relative) = body[cursor..].find("[[") {
        let start = cursor + relative;
        cursor = start + 2;
        if body[..start]
            .chars()
            .rev()
            .take_while(|c| *c == '\\')
            .count()
            % 2
            == 1
        {
            continue;
        }
        if excluded.iter().any(|r| r.start <= start && start < r.end) {
            continue;
        }
        let Some(end) = body[cursor..].find("]]").map(|i| cursor + i + 2) else {
            break;
        };
        if body[cursor..end - 2].contains('\n') {
            continue;
        }
        let raw = body[cursor..end - 2]
            .split('|')
            .next()
            .unwrap_or("")
            .trim()
            .to_owned();
        if !raw.is_empty() && is_local(&raw) {
            note.references.push(Reference {
                raw,
                start,
                end,
                wiki: true,
                image: false,
                target: None,
                resolution: "missing".into(),
            });
        }
        cursor = end;
    }
    note.references.sort_by_key(|r| r.start);
    note
}
pub fn is_local(raw: &str) -> bool {
    !raw.starts_with('/') && !raw.contains(':') && !raw.contains('\\')
}
fn normalize(base: &str, raw: &str) -> Option<String> {
    let decoded = percent_decode_str(raw.split('#').next()?)
        .decode_utf8()
        .ok()?;
    if !is_local(&decoded) {
        return None;
    }
    let mut parts: Vec<&str> = base.split('/').filter(|p| !p.is_empty()).collect();
    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            x => parts.push(x),
        }
    }
    Some(parts.join("/"))
}
pub fn resolve(notes: &mut [ParsedNote]) {
    let paths: BTreeSet<String> = notes.iter().map(|n| n.path.clone()).collect();
    let mut ids: BTreeMap<String, usize> = BTreeMap::new();
    for n in notes.iter() {
        if let Some(id) = &n.id {
            *ids.entry(id.clone()).or_default() += 1;
        }
    }
    for note in notes {
        if note.id.as_ref().is_some_and(|id| ids[id] > 1) {
            note.issues
                .push("重复 ID：请修复元数据，当前按路径区分笔记".into());
        }
        let parent = note.path.rsplit_once('/').map_or("", |(p, _)| p);
        for reference in &mut note.references {
            if reference.image {
                reference.target = normalize(parent, &reference.raw);
                continue;
            }

            let raw = reference.raw.split('#').next().unwrap_or("");
            let raw = if reference.wiki && !raw.to_lowercase().ends_with(".md") {
                format!("{raw}.md")
            } else {
                raw.to_owned()
            };
            let mut candidates = vec![];
            if !reference.wiki {
                if let Some(p) = normalize(parent, &raw).filter(|p| paths.contains(p)) {
                    candidates.push(p);
                }
            } else if raw.contains('/') {
                if let Some(p) = normalize("", &raw).filter(|p| paths.contains(p)) {
                    candidates.push(p);
                }
            } else {
                if let Some(p) = normalize(parent, &raw).filter(|p| paths.contains(p)) {
                    candidates.push(p);
                }
                if candidates.is_empty() {
                    candidates.extend(
                        paths
                            .iter()
                            .filter(|p| p.rsplit('/').next() == Some(raw.as_str()))
                            .cloned(),
                    );
                }
            }
            reference.target = if candidates.len() == 1 {
                Some(candidates[0].clone())
            } else {
                None
            };
            reference.resolution = match candidates.len() {
                0 => "missing",
                1 => "resolved",
                _ => "ambiguous",
            }
            .into();
        }
    }
}
pub fn relative_path(source: &str, target: &str) -> String {
    let source: Vec<_> = source.split('/').collect();
    let source = &source[..source.len().saturating_sub(1)];
    let target: Vec<_> = target.split('/').collect();
    let shared = source
        .iter()
        .zip(&target)
        .take_while(|(a, b)| a == b)
        .count();
    let mut parts = vec![".."; source.len() - shared];
    parts.extend_from_slice(&target[shared..]);
    parts.join("/")
}
pub fn rewrite(body: &str, note: &ParsedNote, moves: &BTreeMap<String, String>) -> String {
    let source = moves.get(&note.path).unwrap_or(&note.path);
    let mut result = body.to_owned();
    for reference in note.references.iter().rev() {
        let Some(target) = reference.target.as_ref() else {
            continue;
        };
        let destination = moves.get(target).unwrap_or(target);
        if destination == target && source == &note.path {
            continue;
        }
        let anchor = reference
            .raw
            .split_once('#')
            .map(|(_, a)| format!("#{a}"))
            .unwrap_or_default();
        let original = &body[reference.start..reference.end];
        let replacement = if reference.wiki {
            let alias = original
                .strip_prefix("[[")
                .and_then(|s| s.strip_suffix("]]"))
                .and_then(|s| s.split_once('|'))
                .map(|(_, a)| format!("|{a}"))
                .unwrap_or_default();
            format!("[[{}{anchor}{alias}]]", destination.trim_end_matches(".md"))
        } else {
            let destination = relative_path(source, destination)
                .replace('%', "%25")
                .replace(' ', "%20")
                .replace('(', "%28")
                .replace(')', "%29");
            let rewritten_target = format!("{destination}{anchor}");
            if let Some(boundary) = original.rfind("](") {
                let after = boundary + 2;
                if let Some(relative) = original[after..].find(&reference.raw) {
                    let mut replacement = original.to_owned();
                    let begin = after + relative;
                    replacement
                        .replace_range(begin..begin + reference.raw.len(), &rewritten_target);
                    replacement
                } else {
                    original.to_owned()
                }
            } else {
                // A reference-style link is converted to an inline link; its shared definition is untouched.
                let label = original
                    .trim_start_matches('!')
                    .strip_prefix('[')
                    .and_then(|s| s.find(']').map(|i| &s[..i]))
                    .unwrap_or("笔记");
                format!(
                    "{}[{label}]({rewritten_target})",
                    if reference.image { "!" } else { "" }
                )
            }
        };
        result.replace_range(reference.start..reference.end, &replacement);
    }
    result
}
