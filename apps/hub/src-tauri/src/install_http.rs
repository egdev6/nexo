//! HTTPS adapter for the bounded installer download orchestrator.
//!
//! Redirects are never followed here: the orchestrator validates each `Location` before the
//! next request. Automatic decompression is disabled even if another dependency enables it.
use crate::install_download::{
    Body, CONNECT_TIMEOUT, DOWNLOAD_TIMEOUT, Network, NetworkError, Response, ResponseKind,
};

#[derive(Debug)]
pub struct HttpTransport {
    client: reqwest::Client,
}

impl HttpTransport {
    pub fn new() -> Result<Self, reqwest::Error> {
        // reqwest's rustls-no-provider backend requires an installed provider. Respect one
        // already configured by the host; concurrent initializations are safe.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(DOWNLOAD_TIMEOUT)
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .build()?;
        Ok(Self { client })
    }
}

pub struct HttpBody(reqwest::Response);

impl Body for HttpBody {
    async fn next(&mut self) -> Result<Option<Vec<u8>>, NetworkError> {
        self.0
            .chunk()
            .await
            .map(|chunk| chunk.map(|bytes| bytes.to_vec()))
            .map_err(|_| NetworkError)
    }
}

impl Network for HttpTransport {
    type Body = HttpBody;

    async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| NetworkError)?;
        let effective_url = response.url().as_str().to_owned();
        let status = response.status();
        let kind = if status.is_redirection() {
            match response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
            {
                Some(location) => ResponseKind::Redirect(location.to_owned()),
                None => ResponseKind::Failed,
            }
        } else if status == reqwest::StatusCode::OK {
            ResponseKind::Ok {
                length: response.content_length(),
                body: HttpBody(response),
            }
        } else {
            ResponseKind::Failed
        };
        Ok(Response {
            effective_url,
            kind,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_disables_automatic_redirects_and_has_a_download_deadline() {
        let transport = HttpTransport::new().unwrap();
        let debug = format!("{transport:?}");
        assert!(debug.contains("Policy(None)"), "{debug}");
        assert!(debug.contains("900s"), "{debug}");
    }

    #[tokio::test]
    async fn refuses_plain_http_without_making_a_request() {
        let transport = HttpTransport::new().unwrap();
        assert!(
            transport
                .get("http://github.com/egdev6/app/releases/download/v1/setup.exe")
                .await
                .is_err()
        );
    }
}
