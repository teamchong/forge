//! The HTTP server of a run. It gives each case its own base URL,
//! `<server>/<id>/`, checks every request against the case's next exchange
//! and answers with that exchange's response.
//!
//! It speaks just enough HTTP/1.1 for the clients: one request per
//! connection, answered with `Connection: close`, so no client retries a
//! request on a connection the server closed, and every request is sent
//! once.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::Arc;

use parking_lot::Mutex;
use std::thread;
use std::time::Duration;

use crate::case::{self, Case, Expect, Respond};
use crate::diff::diff;
use crate::value::{Value, indent};

pub struct Server {
    addr: SocketAddr,
    shared: Arc<Shared>,
}

#[derive(Default)]
struct Shared {
    cases: Mutex<HashMap<String, Arc<CaseState>>>,
    /// The ids of the cases that have finished.
    finished: Mutex<HashSet<String>>,
    /// The requests that arrived after their case finished, by case id.
    late: Mutex<HashMap<String, Vec<String>>>,
    /// Requests that belonged to no case.
    strays: Mutex<Vec<String>>,
}

/// What the server knows of a running case.
pub struct CaseState {
    case: Arc<Case>,
    progress: Mutex<Progress>,
}

#[derive(Default)]
struct Progress {
    /// The index of the next exchange.
    next: usize,
    /// The requests that did not match, in the order they came.
    problems: Vec<String>,
}

/// A request as it arrived.
struct Request {
    method: String,
    /// The escaped path, with the case's id.
    path: String,
    raw_query: String,
    /// Header names in lower case, in the order they came.
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Server {
    pub fn start() -> std::io::Result<Server> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let addr = listener.local_addr()?;
        let shared = Arc::new(Shared::default());
        let accept = Arc::clone(&shared);
        // The thread lives as long as the run; the process ends after it.
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let shared = Arc::clone(&accept);
                thread::spawn(move || shared.serve(stream));
            }
        });
        Ok(Server { addr, shared })
    }

    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn base_url(&self, c: &Case) -> String {
        format!("http://{}/{}/", self.addr, c.id())
    }

    /// Makes the server accept the requests of `c` until [`Server::done`].
    pub fn start_case(&self, c: Arc<Case>) -> Arc<CaseState> {
        let state = Arc::new(CaseState {
            case: Arc::clone(&c),
            progress: Mutex::default(),
        });
        self.shared.cases.lock().insert(c.id(), Arc::clone(&state));
        state
    }

    pub fn done(&self, c: &Case) {
        self.shared.finished.lock().insert(c.id());
        self.shared.cases.lock().remove(&c.id());
    }

    /// Returns the requests of `c` that arrived after it finished.
    pub fn take_late(&self, c: &Case) -> Vec<String> {
        self.shared.late.lock().remove(&c.id()).unwrap_or_default()
    }

    pub fn take_strays(&self) -> Vec<String> {
        std::mem::take(&mut self.shared.strays.lock())
    }
}

impl Shared {
    fn serve(&self, stream: TcpStream) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
        let mut reader = BufReader::new(&stream);
        let request = match read_request(&mut reader) {
            Ok(Some(request)) => request,
            Ok(None) => return,
            Err(err) => {
                self.strays.lock().push(format!("reading a request: {err}"));
                return;
            }
        };
        let mut out = &stream;
        let trimmed = request.path.strip_prefix('/').unwrap_or(&request.path);
        let (id, rest) = trimmed.split_once('/').unwrap_or((trimmed, ""));
        let path = format!("/{rest}");
        // The request is checked while `cases` is locked, so once `done` has
        // removed a case, no request can still be recording into it.
        let cases = self.cases.lock();
        let Some(state) = cases.get(id).cloned() else {
            drop(cases);
            let request = describe(&request.method, &path, &request.raw_query);
            if self.finished.lock().contains(id) {
                self.late
                    .lock()
                    .entry(id.to_owned())
                    .or_default()
                    .push(format!("{request} arrived after the case finished"));
            } else {
                self.strays.lock().push(format!(
                    "{request} belongs to no case, as its first segment is not a case's id"
                ));
            }
            fail(&mut out, 404, &format!("no running case has the id {id}"));
            return;
        };
        let respond = state.take(&request, &path);
        drop(cases);
        match respond {
            Some(respond) => write_response(&mut out, respond),
            None => fail(&mut out, 500, "conformance: the case expects no more requests"),
        }
    }
}

impl CaseState {
    /// Checks a request against the next exchange and returns its response,
    /// or `None` when every exchange has arrived. The response is sent even
    /// when the request does not match, so a case reports what went wrong on
    /// the wire and not the errors that follow from it.
    fn take(&self, r: &Request, path: &str) -> Option<&Respond> {
        let mut progress = self.progress.lock();
        let n = self.case.exchanges.len();
        let request = describe(&r.method, path, &r.raw_query);
        progress.next += 1;
        let Some(ex) = self.case.exchanges.get(progress.next - 1) else {
            let next = progress.next;
            progress
                .problems
                .push(format!("request {next} arrived after the last exchange: {request}"));
            return None;
        };
        let mismatches = ex.expect.mismatches(r, path);
        if !mismatches.is_empty() {
            let next = progress.next;
            progress.problems.push(format!(
                "request {next} of {n} does not match: {request}\n{}",
                indent(&mismatches.join("\n"), "    ")
            ));
        }
        Some(&ex.respond)
    }

    /// Returns the requests that did not match so far.
    pub fn take_problems(&self) -> Vec<String> {
        std::mem::take(&mut self.progress.lock().problems)
    }

    /// Returns the exchanges that never arrived.
    pub fn missing(&self) -> Vec<String> {
        let progress = self.progress.lock();
        let n = self.case.exchanges.len();
        (progress.next..n)
            .map(|i| {
                let e = &self.case.exchanges[i].expect;
                format!(
                    "request {} of {n} never arrived: {}",
                    i + 1,
                    describe(&e.method, &e.path, &case::encode_query(&e.query))
                )
            })
            .collect()
    }
}

fn describe(method: &str, path: &str, raw_query: &str) -> String {
    let method = if method.is_empty() {
        String::new()
    } else {
        format!("{method} ")
    };
    if raw_query.is_empty() {
        format!("{method}{path}")
    } else {
        format!("{method}{path}?{raw_query}")
    }
}

impl Expect {
    /// Returns how a request differs from the expected one.
    fn mismatches(&self, r: &Request, path: &str) -> Vec<String> {
        let mut out = Vec::new();
        if r.method != self.method {
            out.push(format!("method: got {}, want {}", r.method, self.method));
        }
        if path != self.path {
            out.push(format!("path: got {path}, want {}", self.path));
        }
        let query = case::parse_query(&r.raw_query);
        if query != self.query {
            out.push(format!(
                "query: got {}, want {}",
                case::show_query(&query),
                case::show_query(&self.query)
            ));
        }
        let mut headers: Vec<_> = self.headers.iter().collect();
        headers.sort();
        for (name, want) in headers {
            let values: Vec<&str> = r
                .headers
                .iter()
                .filter(|(n, _)| n.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.as_str())
                .collect();
            let got = values.join(", ");
            if values.is_empty() {
                out.push(format!("header {name}: missing, want {want:?}"));
            } else if got != *want {
                out.push(format!("header {name}: got {got:?}, want {want:?}"));
            }
        }
        match &self.body {
            None if !r.body.is_empty() => {
                out.push(format!("body: got {}, want none", String::from_utf8_lossy(&r.body)));
            }
            None => {}
            Some(want) if r.body.is_empty() => {
                out.push(format!("body: got none, want {}", want.canonical().trim_end()));
            }
            Some(want) => match serde_json::from_slice::<serde_json::Value>(&r.body) {
                Err(err) => out.push(format!(
                    "body: got {:?}, which is not JSON: {err}",
                    String::from_utf8_lossy(&r.body)
                )),
                Ok(got) => {
                    let (w, g) = (want.canonical(), Value::from(got).canonical());
                    if w != g {
                        out.push(format!("body: (-want +got)\n{}", indent(&diff(&w, &g), "  ")));
                    }
                }
            },
        }
        out
    }
}

/// Reads one request, or `None` when the connection closes before one.
fn read_request(reader: &mut BufReader<&TcpStream>) -> std::io::Result<Option<Request>> {
    let invalid = |msg: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, msg.to_owned());
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else {
        return Err(invalid(&format!("bad request line {line:?}")));
    };
    let (path, raw_query) = target.split_once('?').unwrap_or((target, ""));
    let mut request = Request {
        method: method.to_owned(),
        path: path.to_owned(),
        raw_query: raw_query.to_owned(),
        headers: Vec::new(),
        body: Vec::new(),
    };
    loop {
        line.clear();
        reader.read_line(&mut line)?;
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            break;
        }
        let (name, value) = header
            .split_once(':')
            .ok_or_else(|| invalid(&format!("bad header {header:?}")))?;
        request
            .headers
            .push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
    }
    let header = |name: &str| request.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone());
    if header("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked")) {
        loop {
            line.clear();
            reader.read_line(&mut line)?;
            let size = line.trim().split(';').next().unwrap_or_default();
            let size = usize::from_str_radix(size, 16).map_err(|_| invalid(&format!("bad chunk size {line:?}")))?;
            if size == 0 {
                // The trailers, then the empty line that ends them.
                loop {
                    line.clear();
                    if reader.read_line(&mut line)? == 0 || line.trim().is_empty() {
                        break;
                    }
                }
                break;
            }
            let start = request.body.len();
            request.body.resize(start + size, 0);
            reader.read_exact(&mut request.body[start..])?;
            line.clear();
            reader.read_line(&mut line)?;
        }
    } else if let Some(length) = header("content-length") {
        let length: usize = length
            .parse()
            .map_err(|_| invalid(&format!("bad content-length {length:?}")))?;
        request.body.resize(length, 0);
        reader.read_exact(&mut request.body)?;
    }
    Ok(Some(request))
}

fn write_response(out: &mut &TcpStream, r: &Respond) {
    if r.disconnect {
        let _ = out.shutdown(std::net::Shutdown::Both);
        return;
    }
    let mut headers = r.headers.clone();
    let has = |headers: &[(String, String)], name: &str| headers.iter().any(|(n, _)| n.eq_ignore_ascii_case(name));
    let body = match (&r.body, &r.text) {
        (Some(body), _) => {
            if !has(&headers, "content-type") {
                headers.push(("Content-Type".to_owned(), "application/json".to_owned()));
            }
            body.json().into_bytes()
        }
        (None, Some(text)) => {
            if !has(&headers, "content-type") {
                headers.push(("Content-Type".to_owned(), "text/plain; charset=utf-8".to_owned()));
            }
            text.clone().into_bytes()
        }
        (None, None) => Vec::new(),
    };
    send(out, r.status, &headers, &body);
}

/// Answers a request that no exchange answers.
fn fail(out: &mut &TcpStream, status: u16, message: &str) {
    let body = Value::Object(vec![("message".to_owned(), Value::String(message.to_owned()))]).json();
    send(
        out,
        status,
        &[("Content-Type".to_owned(), "application/json".to_owned())],
        body.as_bytes(),
    );
}

fn send(out: &mut &TcpStream, status: u16, headers: &[(String, String)], body: &[u8]) {
    let mut head = format!("HTTP/1.1 {status} {}\r\nConnection: close\r\n", reason(status));
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    // A 1xx, 204 or 304 response has no body, and so no length.
    if !(status < 200 || status == 204 || status == 304) {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    let _ = out.write_all(head.as_bytes());
    let _ = out.write_all(body);
    let _ = out.flush();
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "",
    }
}
