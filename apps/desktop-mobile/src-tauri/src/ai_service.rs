//! Shared native model transport; no desktop events or UI state.
use crate::{failure, ApiError, ApiResult};
fn model_error(code: &'static str, message: &str) -> ApiError {
    ApiError {
        code,
        message: message.into(),
    }
}
use futures_util::StreamExt;
use mozhi_core::ai::{self, Config};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::watch;
pub(crate) async fn completion(
    config: &Config,
    key: &str,
    messages: Vec<Value>,
    cancelled: watch::Receiver<bool>,
    emit: impl FnMut(&str),
) -> ApiResult<String> {
    completion_with_timeout(
        config,
        key,
        messages,
        cancelled,
        emit,
        Duration::from_secs(120),
    )
    .await
}
pub(crate) async fn completion_with_timeout(
    config: &Config,
    key: &str,
    messages: Vec<Value>,
    mut cancelled: watch::Receiver<bool>,
    mut emit: impl FnMut(&str),
    timeout: Duration,
) -> ApiResult<String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()
        .map_err(|_| failure("无法初始化模型连接"))?;
    let mut request = client
        .post(config.validate()?.as_str())
        .json(&json!({"model":config.model,"messages":messages,"stream":true}));
    if !key.is_empty() {
        request = request.bearer_auth(key);
    }
    let work = async {
        let response = request.send().await.map_err(|e| {
            if e.is_timeout() {
                model_error("TIMEOUT", "模型请求超时，请手动重试")
            } else {
                model_error("NETWORK_FAILED", "模型连接失败，请检查地址与网络")
            }
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(model_error(
                match status.as_u16() {
                    401 | 403 => "MODEL_CREDENTIALS",
                    429 => "RATE_LIMITED",
                    300..=399 => "MODEL_CONFIG",
                    _ => "MODEL_ERROR",
                },
                match status.as_u16() {
                    401 | 403 => "模型认证失败，请检查 API Key 与权限",
                    429 => "模型服务限流，请稍后手动重试",
                    300..=399 => "模型地址返回重定向，请配置最终服务地址",
                    _ => "模型服务返回错误",
                },
            ));
        }
        let mut stream = response.bytes_stream();
        let mut parser = ai::SseParser::default();
        let mut result = String::new();
        let mut received = 0;
        let mut finished = false;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| {
                if e.is_timeout() {
                    model_error("TIMEOUT", "模型请求超时，请手动重试")
                } else {
                    failure("模型响应中断")
                }
            })?;
            received += chunk.len();
            if received > 2 * 1024 * 1024 {
                return Err(failure("模型响应超过大小限制"));
            }
            for data in parser.feed(&chunk)? {
                if data == "[DONE]" {
                    if result.is_empty() {
                        return Err(failure("模型返回空内容"));
                    }
                    return Ok(result);
                }
                let value: Value =
                    serde_json::from_str(&data).map_err(|_| failure("模型流式响应格式无效"))?;
                if value.get("error").is_some() {
                    return Err(failure("模型服务返回错误"));
                }
                if value
                    .pointer("/choices/0/finish_reason")
                    .and_then(Value::as_str)
                    .is_some_and(|reason| reason != "stop")
                {
                    return Err(failure("模型响应未完成，请手动重试"));
                }
                if value
                    .pointer("/choices/0/finish_reason")
                    .is_some_and(|reason| reason == "stop")
                {
                    finished = true;
                }
                if let Some(text) = value
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                {
                    result.push_str(text);
                    if result.len() > 1024 * 1024 {
                        return Err(failure("生成内容超过大小限制"));
                    }
                    emit(text);
                }
            }
        }
        if result.is_empty() {
            Err(failure("模型未返回兼容的流式内容"))
        } else if finished {
            Ok(result)
        } else {
            Err(failure("模型响应未完成，请手动重试"))
        }
    };
    tokio::select! {
        _=cancelled.changed()=>Err(failure("已停止生成")),
        _=tokio::time::sleep(timeout)=>Err(model_error("TIMEOUT","模型请求超时，请手动重试")),
        result=work=>result,
    }
}
