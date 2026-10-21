//! Outbound HTTPS (ADR-001 §3.8). Phase 1: fixed Open-Meteo endpoints only.
//! Phase 3 (OutboundHttp) extends `Endpoint` and adds a DNS resolver refusing private addresses.
//! reqwest is built without compression features: no Accept-Encoding is sent (bodies are small),
//! so the size limit applies to the bytes actually received.

use std::time::Duration;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub const TOTAL_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_CONCURRENT_REQUESTS: usize = 4;
pub const USER_AGENT: &str = concat!("Homebase/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endpoint {
    OpenMeteoForecast,
    OpenMeteoGeocoding,
}

impl Endpoint {
    pub const fn base_url(self) -> &'static str {
        match self {
            Endpoint::OpenMeteoForecast => "https://api.open-meteo.com/v1/forecast",
            Endpoint::OpenMeteoGeocoding => "https://geocoding-api.open-meteo.com/v1/search",
        }
    }

    pub const fn host(self) -> &'static str {
        match self {
            Endpoint::OpenMeteoForecast => "api.open-meteo.com",
            Endpoint::OpenMeteoGeocoding => "geocoding-api.open-meteo.com",
        }
    }

    pub const fn max_body_bytes(self) -> usize {
        match self {
            Endpoint::OpenMeteoForecast => 64 * 1024,
            Endpoint::OpenMeteoGeocoding => 256 * 1024,
        }
    }

    /// Constant base plus already validated pairs (`append_pair`, form encoding).
    pub fn url(self, query: &[(&str, String)]) -> reqwest::Url {
        let mut url = reqwest::Url::parse(self.base_url()).expect("constant base URL is valid");
        {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in query {
                pairs.append_pair(key, value);
            }
        }
        url
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError {
    Unavailable,
    Forbidden,
    Timeout,
    Network,
    Status(u16),
    TooLarge,
    UnexpectedContentType,
}

/// Pure: https scheme, host == endpoint host, no credentials, no explicit port, base path.
pub fn check_url(endpoint: Endpoint, url: &reqwest::Url) -> Result<(), NetError> {
    let base = reqwest::Url::parse(endpoint.base_url()).map_err(|_| NetError::Forbidden)?;
    let ok = url.scheme() == "https"
        && url.host_str() == Some(endpoint.host())
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.path() == base.path();
    if ok {
        Ok(())
    } else {
        Err(NetError::Forbidden)
    }
}

/// Pure, in this order: status, content type, announced length.
pub fn check_response(
    status: u16,
    content_type: Option<&str>,
    content_length: Option<u64>,
    max: usize,
) -> Result<(), NetError> {
    if !(200..=299).contains(&status) {
        return Err(NetError::Status(status));
    }
    let is_json = content_type.is_some_and(|value| {
        value
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .eq_ignore_ascii_case("application/json")
    });
    if !is_json {
        return Err(NetError::UnexpectedContentType);
    }
    if content_length.is_some_and(|n| n > max as u64) {
        return Err(NetError::TooLarge);
    }
    Ok(())
}

/// Source of body chunks (a `Response` in production, a queue in tests).
pub(crate) trait ChunkSource {
    fn next_chunk(
        &mut self,
    ) -> impl std::future::Future<Output = Result<Option<Vec<u8>>, NetError>> + Send;
}

/// Reads at most `max` bytes. No pre-allocation from Content-Length; the size is checked
/// before extending.
pub(crate) async fn read_limited<S: ChunkSource>(
    source: &mut S,
    max: usize,
) -> Result<Vec<u8>, NetError> {
    let mut body = Vec::new();
    while let Some(chunk) = source.next_chunk().await? {
        if body.len().saturating_add(chunk.len()) > max {
            return Err(NetError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn classify(error: &reqwest::Error) -> NetError {
    // Diagnostic only: the kind, never the URL, the query or the body.
    let (net_error, kind) = if error.is_timeout() {
        (NetError::Timeout, "timeout")
    } else {
        (NetError::Network, "network")
    };
    eprintln!("homebase: weather request failed: {kind}");
    net_error
}

struct ResponseSource(reqwest::Response);

impl ChunkSource for ResponseSource {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, NetError> {
        self.0
            .chunk()
            .await
            .map(|chunk| chunk.map(|bytes| bytes.to_vec()))
            .map_err(|error| classify(&error))
    }
}

pub struct NetClient {
    client: Option<reqwest::Client>,
    permits: tokio::sync::Semaphore,
}

impl NetClient {
    /// Builds the single client; on failure logs without any URL and keeps `None`.
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TOTAL_TIMEOUT)
            .user_agent(USER_AGENT)
            .no_proxy()
            .referer(false)
            .tls_version_min(reqwest::tls::Version::TLS_1_2)
            .tls_backend_native()
            .build();
        let client = match client {
            Ok(client) => Some(client),
            Err(_) => {
                eprintln!("homebase: failed to build the outbound HTTP client");
                None
            }
        };
        Self {
            client,
            permits: tokio::sync::Semaphore::new(MAX_CONCURRENT_REQUESTS),
        }
    }

    #[cfg(test)]
    pub fn is_available(&self) -> bool {
        self.client.is_some()
    }

    pub async fn get_json(
        &self,
        endpoint: Endpoint,
        url: reqwest::Url,
    ) -> Result<Vec<u8>, NetError> {
        let client = self.client.as_ref().ok_or(NetError::Unavailable)?;
        check_url(endpoint, &url)?;
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| NetError::Unavailable)?;
        let response = client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| classify(&error))?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        check_response(
            response.status().as_u16(),
            content_type.as_deref(),
            response.content_length(),
            endpoint.max_body_bytes(),
        )?;
        read_limited(&mut ResponseSource(response), endpoint.max_body_bytes()).await
    }
}

impl Default for NetClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    const JSON: Option<&str> = Some("application/json");

    type Chunks = Vec<Result<Vec<u8>, NetError>>;

    struct Queue(VecDeque<Result<Vec<u8>, NetError>>);

    impl ChunkSource for Queue {
        fn next_chunk(
            &mut self,
        ) -> impl std::future::Future<Output = Result<Option<Vec<u8>>, NetError>> + Send {
            std::future::ready(self.0.pop_front().transpose())
        }
    }

    fn read(chunks: Chunks, max: usize) -> Result<Vec<u8>, NetError> {
        let mut source = Queue(chunks.into());
        tauri::async_runtime::block_on(read_limited(&mut source, max))
    }

    const ENDPOINTS: [Endpoint; 2] = [Endpoint::OpenMeteoForecast, Endpoint::OpenMeteoGeocoding];

    #[test]
    fn base_urls_are_https_on_the_declared_host() {
        for endpoint in ENDPOINTS {
            let url = reqwest::Url::parse(endpoint.base_url()).unwrap();
            assert_eq!(url.scheme(), "https");
            assert_eq!(url.host_str(), Some(endpoint.host()));
            assert_eq!(url.port(), None);
        }
    }

    #[test]
    fn url_encodes_pairs_and_passes_check_url() {
        let url =
            Endpoint::OpenMeteoGeocoding.url(&[("name", "Saint-Étienne, France".to_string())]);
        assert_eq!(check_url(Endpoint::OpenMeteoGeocoding, &url), Ok(()));
        let pairs: Vec<_> = url.query_pairs().collect();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].1, "Saint-Étienne, France");
    }

    #[test]
    fn url_keeps_special_characters_in_a_single_pair() {
        let value = "a&count=1000#x=y";
        let url = Endpoint::OpenMeteoGeocoding.url(&[("name", value.to_string())]);
        assert_eq!(check_url(Endpoint::OpenMeteoGeocoding, &url), Ok(()));
        let pairs: Vec<_> = url.query_pairs().collect();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "name");
        assert_eq!(pairs[0].1, value);
        assert_eq!(url.fragment(), None);
    }

    #[test]
    fn check_url_refuses_foreign_urls() {
        let forecast = Endpoint::OpenMeteoForecast;
        for raw in [
            "http://api.open-meteo.com/v1/forecast",
            "https://evil.example/v1/forecast",
            "https://user@api.open-meteo.com/v1/forecast",
            "https://api.open-meteo.com:8443/v1/forecast",
            "https://api.open-meteo.com/v1/other",
        ] {
            let url = reqwest::Url::parse(raw).unwrap();
            assert_eq!(check_url(forecast, &url), Err(NetError::Forbidden), "{raw}");
        }
        let geocoding = Endpoint::OpenMeteoGeocoding.url(&[]);
        assert_eq!(check_url(forecast, &geocoding), Err(NetError::Forbidden));
    }

    #[test]
    fn check_response_rules() {
        let max = 100;
        assert_eq!(check_response(200, JSON, None, max), Ok(()));
        assert_eq!(
            check_response(200, Some("Application/JSON; charset=utf-8"), None, max),
            Ok(())
        );
        for content_type in [Some("application/jsonx"), Some("text/html"), None] {
            assert_eq!(
                check_response(200, content_type, None, max),
                Err(NetError::UnexpectedContentType)
            );
        }
        assert_eq!(
            check_response(302, JSON, None, max),
            Err(NetError::Status(302))
        );
        assert_eq!(
            check_response(429, JSON, None, max),
            Err(NetError::Status(429))
        );
        assert_eq!(check_response(200, JSON, Some(100), max), Ok(()));
        assert_eq!(
            check_response(200, JSON, Some(101), max),
            Err(NetError::TooLarge)
        );
    }

    #[test]
    fn read_limited_accepts_exactly_max_bytes() {
        let body = read(vec![Ok(vec![1; 40]), Ok(vec![2; 60])], 100).unwrap();
        assert_eq!(body.len(), 100);
    }

    #[test]
    fn read_limited_refuses_one_byte_over() {
        assert_eq!(
            read(vec![Ok(vec![1; 40]), Ok(vec![2; 40]), Ok(vec![3; 21])], 100),
            Err(NetError::TooLarge)
        );
    }

    #[test]
    fn read_limited_refuses_a_single_oversized_chunk() {
        assert_eq!(read(vec![Ok(vec![1; 101])], 100), Err(NetError::TooLarge));
    }

    #[test]
    fn read_limited_propagates_errors_and_handles_empty() {
        assert_eq!(
            read(vec![Ok(vec![1; 5]), Err(NetError::Network)], 100),
            Err(NetError::Network)
        );
        assert_eq!(read(vec![], 100), Ok(Vec::new()));
    }

    fn pipeline(announced: Option<u64>, chunks: Chunks, max: usize) -> Result<Vec<u8>, NetError> {
        check_response(200, JSON, announced, max)?;
        read(chunks, max)
    }

    #[test]
    fn lying_content_length_is_handled() {
        let max = 2000;
        // Announces 10, sends max + 1.
        assert_eq!(
            pipeline(Some(10), vec![Ok(vec![0; max + 1])], max),
            Err(NetError::TooLarge)
        );
        // Announces max + 1: refused before any read (the queue alone would succeed).
        assert_eq!(
            pipeline(Some(max as u64 + 1), vec![Ok(vec![0; 10])], max),
            Err(NetError::TooLarge)
        );
        // Announces 1000, sends 10.
        assert_eq!(
            pipeline(Some(1000), vec![Ok(vec![0; 10])], max).map(|body| body.len()),
            Ok(10)
        );
    }

    #[test]
    fn client_builds_without_network() {
        assert!(NetClient::new().is_available());
    }
}
