use mozhi_core::{
    knowledge::{self, GraphQuery},
    markdown::{self, ParsedNote},
};

fn notes(entries: &[(&str, &str)]) -> Vec<ParsedNote> {
    let mut notes: Vec<_> = entries
        .iter()
        .map(|(path, content)| markdown::parse(path, content))
        .collect();
    markdown::resolve(&mut notes);
    notes
}

#[test]
fn counts_distinct_sources_excluding_self_images_and_missing_targets() {
    let mut notes = notes(&[
        ("工作/目标.md", "# 目标\n[[工作/目标]]"),
        ("甲.md", "[[工作/目标]] [[工作/目标]] [[不存在]]"),
        ("乙.md", "[目标](工作/目标.md)"),
        ("图片.md", "![目标](工作/目标.md)"),
        ("孤立.md", "# 孤立"),
    ]);
    // Even a stale resolved reference must not produce a nonexistent count.
    notes[1].references[2].target = Some("不存在.md".into());
    let graph = knowledge::graph(
        &notes,
        &GraphQuery {
            include_isolated: true,
            ..Default::default()
        },
    );
    assert_eq!(graph.incoming_counts["工作/目标.md"], 2);
    assert_eq!(graph.incoming_counts["孤立.md"], 0);
    assert!(!graph.incoming_counts.contains_key("不存在.md"));
    let json = serde_json::to_value(graph).unwrap();
    assert_eq!(json["incomingCounts"]["工作/目标.md"], 2);
}

#[test]
fn global_counts_are_stable_under_filters_and_local_depth() {
    let notes = notes(&[
        ("工作/目标.md", "---\ntags: [重要]\n---\n# 目标"),
        ("甲.md", "[[工作/目标]]"),
        ("乙.md", "[[工作/目标]]"),
    ]);
    for query in [
        GraphQuery {
            directory: Some("工作".into()),
            ..Default::default()
        },
        GraphQuery {
            keyword: Some("目标".into()),
            ..Default::default()
        },
        GraphQuery {
            tag: Some("重要".into()),
            ..Default::default()
        },
        GraphQuery {
            center: Some("甲.md".into()),
            depth: Some(1),
            ..Default::default()
        },
    ] {
        let graph = knowledge::graph(
            &notes,
            &GraphQuery {
                include_isolated: true,
                ..query
            },
        );
        assert_eq!(graph.incoming_counts["工作/目标.md"], 2);
        assert_eq!(graph.incoming_counts.len(), graph.nodes.len());
    }
}

#[test]
fn counts_include_sources_outside_node_and_edge_budgets() {
    let mut notes = vec![markdown::parse("000目标.md", "# 目标")];
    for i in 0..3010 {
        notes.push(markdown::parse(&format!("源{i:04}.md"), "[[000目标]]"));
    }
    markdown::resolve(&mut notes);
    let global = knowledge::graph(
        &notes,
        &GraphQuery {
            include_isolated: true,
            ..Default::default()
        },
    );
    assert!(global.truncated);
    assert_eq!(global.nodes.len(), 1000);
    assert_eq!(global.incoming_counts["000目标.md"], 3010);
    let local = knowledge::graph(
        &notes,
        &GraphQuery {
            center: Some("000目标.md".into()),
            depth: Some(1),
            include_isolated: true,
            ..Default::default()
        },
    );
    assert!(local.truncated);
    assert_eq!(local.nodes.len(), 200);
    assert_eq!(local.incoming_counts["000目标.md"], 3010);
}
