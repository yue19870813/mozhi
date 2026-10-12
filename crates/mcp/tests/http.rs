use mozhi_mcp::{Backend, ToolError, ToolFuture};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio_util::sync::CancellationToken;
struct Synthetic {
    started: AtomicBool,
    cancelled: AtomicBool,
}
impl Backend for Synthetic {
    fn call(&self, name: String, args: Value, cancel: CancellationToken) -> ToolFuture<'_> {
        Box::pin(async move {
            if name == "ask_notes" {
                self.started.store(true, Ordering::SeqCst);
                cancel.cancelled().await;
                self.cancelled.store(true, Ordering::SeqCst);
                return Err(ToolError::new("CANCELLED", "Cancelled"));
            }
            if name == "read_note" {
                return Ok(
                    json!({"path":args["path"],"markdown":"# Synthetic","body":"# Synthetic","frontMatter":"","metadata":{},"contentHash":"synthetic-hash"}),
                );
            }
            Ok(json!({"name":name,"arguments":args}))
        })
    }
}
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap()
}
fn post(
    client: &reqwest::Client,
    url: &str,
    session: Option<&str>,
    value: Value,
) -> reqwest::RequestBuilder {
    let mut request = client
        .post(url)
        .bearer_auth("synthetic-token")
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", "2025-03-26")
        .json(&value);
    if let Some(session) = session {
        request = request.header("Mcp-Session-Id", session);
    }
    request
}
async fn setup() -> (
    mozhi_mcp::Running,
    reqwest::Client,
    String,
    String,
    Arc<Synthetic>,
) {
    let backend = Arc::new(Synthetic {
        started: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
    });
    let server = mozhi_mcp::start(0, "synthetic-token".into(), backend.clone())
        .await
        .unwrap();
    let url = format!("http://127.0.0.1:{}/mcp", server.port);
    let c = client();
    let init=post(&c,&url,None,json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"synthetic-test","version":"1"}}})).send().await.unwrap();
    assert!(init.status().is_success());
    let session = init.headers()["Mcp-Session-Id"]
        .to_str()
        .unwrap()
        .to_owned();
    let body = decode(init).await;
    assert!(body["result"]["capabilities"]["tools"].is_object());
    let response = post(
        &c,
        &url,
        Some(&session),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .send()
    .await
    .unwrap();
    assert!(response.status().is_success());
    (server, c, url, session, backend)
}
#[tokio::test]
async fn initializes_discovers_and_calls_tools_over_real_http() {
    let (server, c, url, session, _) = setup().await;
    let response = decode(
        post(
            &c,
            &url,
            Some(&session),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .send()
        .await
        .unwrap(),
    )
    .await;
    assert_eq!(response["result"]["tools"].as_array().unwrap().len(), 6);
    let response=decode(post(&c,&url,Some(&session),json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_note","arguments":{"vaultId":"synthetic","path":"test.md"}}})).send().await.unwrap()).await;
    assert!(response["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("test.md"));
    server.stop();
}
#[tokio::test]
async fn authenticates_existing_sessions_and_rejects_browser_origins_and_foreign_hosts() {
    let (server, c, url, session, _) = setup().await;
    for (header, value, status) in [
        ("Authorization", "Bearer wrong", 401),
        ("Origin", "http://localhost", 403),
        ("Host", "evil.test", 403),
    ] {
        let r = post(
            &c,
            &url,
            Some(&session),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .header(header, value)
        .send()
        .await
        .unwrap();
        assert_eq!(r.status().as_u16(), status);
    }
    assert_eq!(c.get(&url).send().await.unwrap().status().as_u16(), 401);
    server.stop();
}
#[tokio::test]
async fn refuses_occupied_port_and_oversized_requests() {
    let (server, c, url, _, backend) = setup().await;
    assert!(mozhi_mcp::start(server.port, "other".into(), backend)
        .await
        .is_err());
    let r = c
        .post(url)
        .bearer_auth("synthetic-token")
        .body("x".repeat(3 * 1024 * 1024 + 1))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 413);
    server.stop();
}
#[tokio::test]
async fn rejects_missing_vault_and_out_of_range_pagination() {
    let (server, c, url, session, _) = setup().await;
    for args in [
        json!({}),
        json!({"vaultId":"synthetic","limit":201}),
        json!({"vaultId":"synthetic","offset":-1}),
        json!({"vaultId":"synthetic","extra":true}),
    ] {
        let r=decode(post(&c,&url,Some(&session),json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_notes","arguments":args}})).send().await.unwrap()).await;
        assert!(
            r["result"]["isError"] == true || r.get("error").is_some(),
            "{r}"
        );
    }
    server.stop();
}
#[tokio::test]
async fn cancellation_notification_reaches_backend() {
    let (server, c, url, session, backend) = setup().await;
    let request = post(
        &c,
        &url,
        Some(&session),
        json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"ask_notes","arguments":{"vaultId":"synthetic","question":"test"}}}),
    );
    let task = tokio::spawn(async move { request.send().await });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while !backend.started.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let r=post(&c,&url,Some(&session),json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7,"reason":"test"}})).send().await.unwrap();
    assert!(r.status().is_success());
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while !backend.cancelled.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    task.abort();
    server.stop();
}

async fn decode(response: reqwest::Response) -> Value {
    let text = response.text().await.unwrap();
    if let Ok(value) = serde_json::from_str(&text) {
        return value;
    }
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(value) = serde_json::from_str(data) {
                return value;
            }
        }
    }
    panic!("No JSON response: {text}");
}

#[tokio::test]
async fn shutdown_and_token_rotation_invalidate_previous_connections() {
    let (server, c, url, session, backend) = setup().await;
    let port = server.port;
    server.shutdown().await;
    let restarted = mozhi_mcp::start(port, "rotated-token".into(), backend)
        .await
        .unwrap();
    let stale = post(
        &c,
        &url,
        Some(&session),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    )
    .send()
    .await;
    assert!(stale.is_err() || !stale.as_ref().unwrap().status().is_success());
    let current = c
        .post(&url)
        .bearer_auth("rotated-token")
        .header("Accept", "application/json, text/event-stream")
        .header("Mcp-Session-Id", session)
        .header("MCP-Protocol-Version", "2025-03-26")
        .json(&json!({"jsonrpc":"2.0","id":3,"method":"tools/list"}))
        .send()
        .await
        .unwrap();
    assert!(!current.status().is_success());
    restarted.shutdown().await;
    let offline = c.get(url).send().await;
    assert!(offline.is_err() || !offline.unwrap().status().is_success());
}
