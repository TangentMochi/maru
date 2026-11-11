use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

const REQUESTS_FILE: &str = "requests.json";
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
struct HttpRequest {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    status_text: String,
    body: String,
}

/// The HTTP session that 開始, 中断 and 終了 control: whether requests carry the cookies
/// earlier responses set. A session's cookies live in its own client and go when it is dropped.
enum Session {
    Off,
    Active(reqwest::Client),
    /// The cookies wait untouched while requests go out without them.
    Paused(reqwest::Client),
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum SessionStatus {
    Off,
    Active,
    Paused,
}

struct Http {
    /// Sends requests outside a session; keeps no cookies.
    plain: reqwest::Client,
    session: Mutex<Session>,
}

fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().timeout(TIMEOUT)
}

impl Http {
    fn new() -> Result<Self, String> {
        let plain = client_builder().build().map_err(|e| e.to_string())?;
        Ok(Self { plain, session: Mutex::new(Session::Off) })
    }

    fn status(&self) -> SessionStatus {
        match *self.session.lock().unwrap() {
            Session::Off => SessionStatus::Off,
            Session::Active(_) => SessionStatus::Active,
            Session::Paused(_) => SessionStatus::Paused,
        }
    }

    /// Starts a session with no cookies, or resumes a paused one with the cookies it had.
    fn start(&self) -> Result<SessionStatus, String> {
        let mut session = self.session.lock().unwrap();
        *session = match std::mem::replace(&mut *session, Session::Off) {
            Session::Off => {
                Session::Active(client_builder().cookie_store(true).build().map_err(|e| e.to_string())?)
            }
            Session::Active(client) | Session::Paused(client) => Session::Active(client),
        };
        Ok(SessionStatus::Active)
    }

    fn pause(&self) -> SessionStatus {
        let mut session = self.session.lock().unwrap();
        *session = match std::mem::replace(&mut *session, Session::Off) {
            Session::Active(client) => Session::Paused(client),
            other => other,
        };
        drop(session);
        self.status()
    }

    fn end(&self) -> SessionStatus {
        *self.session.lock().unwrap() = Session::Off;
        SessionStatus::Off
    }

    /// The client the next request goes through.
    fn client(&self) -> reqwest::Client {
        match &*self.session.lock().unwrap() {
            Session::Active(client) => client.clone(),
            Session::Off | Session::Paused(_) => self.plain.clone(),
        }
    }
}

/// Cancel handles for requests that are waiting on a response, keyed by the id the frontend chose.
#[derive(Default)]
struct InFlight(Mutex<HashMap<String, oneshot::Sender<()>>>);

fn data_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

fn read_json(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map(Some).map_err(|e| e.to_string())
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    // Write beside the target and rename, so a crash mid-write never leaves a truncated file.
    let staging = path.with_extension("json.tmp");
    fs::write(&staging, text).map_err(|e| e.to_string())?;
    fs::rename(&staging, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_requests(app: AppHandle) -> Result<Option<Value>, String> {
    read_json(&data_path(&app, REQUESTS_FILE)?)
}

#[tauri::command]
fn save_requests(app: AppHandle, requests: Value) -> Result<(), String> {
    write_json(&data_path(&app, REQUESTS_FILE)?, &requests)
}

#[tauri::command]
fn session_status(http: State<'_, Http>) -> SessionStatus {
    http.status()
}

#[tauri::command]
fn start_session(http: State<'_, Http>) -> Result<SessionStatus, String> {
    http.start()
}

#[tauri::command]
fn pause_session(http: State<'_, Http>) -> SessionStatus {
    http.pause()
}

#[tauri::command]
fn end_session(http: State<'_, Http>) -> SessionStatus {
    http.end()
}

async fn perform(client: &reqwest::Client, request: HttpRequest) -> Result<HttpResponse, String> {
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| format!("メソッドが正しくありません: {}", request.method))?;
    let mut builder = client.request(method, &request.url);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let response = builder.send().await.map_err(describe_error)?;
    let status = response.status();
    let body = response.text().await.map_err(describe_error)?;
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or_default().to_string(),
        body,
    })
}

fn describe_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "応答がありません（時間切れ）".to_string()
    } else if error.is_connect() {
        "宛先に接続できません".to_string()
    } else {
        error.to_string()
    }
}

#[tauri::command]
async fn send_request(
    id: String,
    request: HttpRequest,
    http: State<'_, Http>,
    in_flight: State<'_, InFlight>,
) -> Result<HttpResponse, String> {
    let (cancel, cancelled) = oneshot::channel();
    in_flight.0.lock().unwrap().insert(id.clone(), cancel);
    let client = http.client();
    let result = tokio::select! {
        result = perform(&client, request) => result,
        _ = cancelled => Err("中止しました".to_string()),
    };
    in_flight.0.lock().unwrap().remove(&id);
    result
}

#[tauri::command]
fn cancel_request(id: String, in_flight: State<'_, InFlight>) {
    if let Some(cancel) = in_flight.0.lock().unwrap().remove(&id) {
        let _ = cancel.send(());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Http::new().expect("error while building the HTTP client"))
        .manage(InFlight::default())
        .invoke_handler(tauri::generate_handler![
            load_requests,
            save_requests,
            session_status,
            start_session,
            pause_session,
            end_session,
            send_request,
            cancel_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Answers one connection with `status` and hands back the raw request it received.
    fn serve_once(status: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/tickets?date=today", listener.local_addr().unwrap());
        let received = std::thread::spawn(move || answer(&listener, status, ""));
        (url, received)
    }

    fn answer(listener: &TcpListener, status: &str, headers: &str) -> String {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).unwrap();
        let reply = format!("HTTP/1.1 {status}\r\n{headers}Content-Length: 2\r\nConnection: close\r\n\r\n{{}}");
        stream.write_all(reply.as_bytes()).unwrap();
        String::from_utf8_lossy(&buffer[..read]).to_string()
    }

    /// A server that sets the cookie `sid=<n>` on its nth response.
    struct CookieServer {
        url: String,
        requests: std::sync::mpsc::Receiver<String>,
    }

    impl CookieServer {
        fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/", listener.local_addr().unwrap());
            let (sender, requests) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                for n in 1.. {
                    let request = answer(&listener, "200 OK", &format!("Set-Cookie: sid={n}\r\n"));
                    if sender.send(request).is_err() {
                        break;
                    }
                }
            });
            Self { url, requests }
        }

        /// Sends one request the way `send_request` would and returns the cookie it carried.
        async fn cookie_sent(&self, http: &Http) -> Option<String> {
            let request = HttpRequest {
                method: "GET".to_string(),
                url: self.url.clone(),
                headers: HashMap::new(),
                body: None,
            };
            perform(&http.client(), request).await.unwrap();
            let received = self.requests.recv().unwrap();
            received.lines().find_map(|line| line.strip_prefix("cookie: ").map(str::to_string))
        }
    }

    #[tokio::test]
    async fn requests_outside_a_session_carry_no_cookies() {
        let server = CookieServer::start();
        let http = Http::new().unwrap();

        assert_eq!(http.status(), SessionStatus::Off);
        assert_eq!(server.cookie_sent(&http).await, None);
        assert_eq!(server.cookie_sent(&http).await, None);
    }

    #[tokio::test]
    async fn a_session_sends_back_the_cookies_it_received() {
        let server = CookieServer::start();
        let http = Http::new().unwrap();

        assert_eq!(http.start(), Ok(SessionStatus::Active));
        assert_eq!(server.cookie_sent(&http).await, None);
        assert_eq!(server.cookie_sent(&http).await.as_deref(), Some("sid=1"));
        assert_eq!(server.cookie_sent(&http).await.as_deref(), Some("sid=2"));
    }

    #[tokio::test]
    async fn a_paused_session_neither_sends_nor_learns_cookies_until_resumed() {
        let server = CookieServer::start();
        let http = Http::new().unwrap();
        http.start().unwrap();
        server.cookie_sent(&http).await;

        assert_eq!(http.pause(), SessionStatus::Paused);
        assert_eq!(server.cookie_sent(&http).await, None);

        assert_eq!(http.start(), Ok(SessionStatus::Active));
        assert_eq!(server.cookie_sent(&http).await.as_deref(), Some("sid=1"));
    }

    #[tokio::test]
    async fn ending_a_session_forgets_its_cookies() {
        let server = CookieServer::start();
        let http = Http::new().unwrap();
        http.start().unwrap();
        server.cookie_sent(&http).await;

        assert_eq!(http.end(), SessionStatus::Off);
        assert_eq!(server.cookie_sent(&http).await, None);

        http.start().unwrap();
        assert_eq!(server.cookie_sent(&http).await, None);
    }

    #[test]
    fn pausing_or_ending_without_a_session_changes_nothing() {
        let http = Http::new().unwrap();
        assert_eq!(http.pause(), SessionStatus::Off);
        assert_eq!(http.end(), SessionStatus::Off);
    }

    fn post(url: String) -> HttpRequest {
        HttpRequest {
            method: "POST".to_string(),
            url,
            headers: HashMap::from([("X-Token".to_string(), "abc".to_string())]),
            body: Some(r#"{"adult":1}"#.to_string()),
        }
    }

    #[tokio::test]
    async fn sends_method_headers_and_body_and_returns_the_status() {
        let (url, received) = serve_once("400 Bad Request");
        let response = perform(&reqwest::Client::new(), post(url)).await.unwrap();

        assert_eq!(response.status, 400);
        assert_eq!(response.status_text, "Bad Request");
        assert_eq!(response.body, "{}");

        let received = received.join().unwrap().to_lowercase();
        assert!(received.starts_with("post /tickets?date=today "), "{received}");
        assert!(received.contains("x-token: abc"), "{received}");
        assert!(received.ends_with(r#"{"adult":1}"#), "{received}");
    }

    #[tokio::test]
    async fn unreachable_host_is_reported_in_words() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let result = perform(&reqwest::Client::new(), post(format!("http://127.0.0.1:{port}/"))).await;
        assert_eq!(result.err().as_deref(), Some("宛先に接続できません"));
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("maru-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn missing_file_reads_as_none() {
        let path = scratch_dir("missing").join(REQUESTS_FILE);
        assert_eq!(read_json(&path), Ok(None));
    }

    #[test]
    fn saved_requests_read_back_unchanged() {
        let dir = scratch_dir("roundtrip");
        let path = dir.join("nested").join(REQUESTS_FILE);
        let requests = json!([{ "id": "1", "name": "入場券", "method": "POST", "fields": [] }]);

        write_json(&path, &requests).unwrap();
        assert_eq!(read_json(&path), Ok(Some(requests)));

        let replacement = json!([]);
        write_json(&path, &replacement).unwrap();
        assert_eq!(read_json(&path), Ok(Some(replacement)));

        fs::remove_dir_all(dir).unwrap();
    }
}
