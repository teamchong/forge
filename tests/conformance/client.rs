//! A conformance client running as a child process, which reads cases from
//! its standard input and writes results to its standard output.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::case::{Case, Outcome, encode_query};
use crate::value::{Value, indent};

/// The token the runner gives every client.
pub const TOKEN: &str = "conformance-token";

/// Makes the call of a case and reports its outcome.
pub trait Client: Sync {
    fn call(&self, c: &Case, base_url: &str, timeout: Duration) -> Result<Outcome, String>;
}

pub struct Process {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    shared: Arc<Shared>,
}

#[derive(Default)]
struct Shared {
    /// The cases waiting for a result, by id. It is `None` once the client's
    /// standard output has ended.
    pending: Mutex<Option<HashMap<String, Sender<Outcome>>>>,
    /// Output lines that belonged to no case.
    strays: Mutex<Vec<String>>,
    stderr: Mutex<String>,
}

impl Process {
    /// Starts `cmd`, setting its standard input, output and error.
    pub fn start(mut cmd: Command) -> Result<Process, String> {
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("start the conformance client {cmd:?}: {e}"))?;
        let shared = Arc::new(Shared {
            pending: Mutex::new(Some(HashMap::new())),
            ..Shared::default()
        });
        let stdout = child.stdout.take().unwrap();
        let reader = Arc::clone(&shared);
        thread::spawn(move || reader.read(stdout));
        let mut stderr = child.stderr.take().unwrap();
        let errors = Arc::clone(&shared);
        thread::spawn(move || {
            let mut buf = [0; 4096];
            while let Ok(n @ 1..) = stderr.read(&mut buf) {
                errors.stderr.lock().push_str(&String::from_utf8_lossy(&buf[..n]));
            }
        });
        let stdin = child.stdin.take();
        Ok(Process {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            shared,
        })
    }

    /// Sends a case to the client and waits up to `timeout` for its result.
    fn send(&self, c: &Case, base_url: &str, timeout: Duration) -> Result<Outcome, String> {
        let (tx, rx) = mpsc::channel();
        let id = c.id();
        match self.shared.pending.lock().as_mut() {
            Some(pending) => pending.insert(id.clone(), tx),
            None => return Err(self.exited("the client closed its output before it reported a result")),
        };
        let line = message(c, base_url).json() + "\n";
        let sent = match self.stdin.lock().as_mut() {
            Some(stdin) => stdin.write_all(line.as_bytes()).and_then(|()| stdin.flush()),
            None => Err(std::io::ErrorKind::BrokenPipe.into()),
        };
        if let Err(err) = sent {
            self.forget(&id);
            return Err(self.exited(&format!("sending the case to the client: {err}")));
        }
        match rx.recv_timeout(timeout) {
            Ok(outcome) => Ok(outcome),
            Err(RecvTimeoutError::Disconnected) => {
                Err(self.exited("the client closed its output before it reported a result"))
            }
            Err(RecvTimeoutError::Timeout) => {
                self.forget(&id);
                Err(format!("the client reported no result within {timeout:?}"))
            }
        }
    }

    fn forget(&self, id: &str) {
        if let Some(pending) = self.shared.pending.lock().as_mut() {
            pending.remove(id);
        }
    }

    /// Adds what the client wrote to its standard error to `err`.
    fn exited(&self, err: &str) -> String {
        let stderr = self.shared.stderr.lock();
        if stderr.is_empty() {
            err.to_owned()
        } else {
            format!("{err}; its standard error:\n{}", indent(&stderr, "    "))
        }
    }

    /// Closes the client's standard input and waits for it to exit, killing
    /// it after `grace`. It returns how the client failed, and the output
    /// lines that belonged to no case.
    pub fn close(&self, grace: Duration) -> Vec<String> {
        self.stdin.lock().take();
        let mut errs = Vec::new();
        let deadline = Instant::now() + grace;
        let mut child = self.child.lock();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
                Ok(None) => {
                    let _ = child.kill();
                    errs.push(self.exited(&format!(
                        "the client did not exit within {grace:?} of its input closing"
                    )));
                    break child.wait().ok();
                }
                Err(err) => {
                    errs.push(format!("waiting for the client: {err}"));
                    break None;
                }
            }
        };
        if let Some(status) = status
            && !status.success()
            && errs.is_empty()
        {
            errs.push(self.exited(&format!("the conformance client failed: {status}")));
        }
        errs.extend(std::mem::take(&mut *self.shared.strays.lock()));
        errs
    }
}

impl Client for Process {
    fn call(&self, c: &Case, base_url: &str, timeout: Duration) -> Result<Outcome, String> {
        self.send(c, base_url, timeout)
    }
}

/// A client without an SDK. For each case, it sends the requests the server
/// expects exactly as the case writes them, and reports the result the case
/// expects, unless a request gets no response, which it reports as a
/// network error. It passes the whole suite when the runner and the cases
/// agree, so it tests them apart from any generator.
pub struct Passthrough(pub SocketAddr);

impl Client for Passthrough {
    fn call(&self, c: &Case, _: &str, timeout: Duration) -> Result<Outcome, String> {
        for ex in &c.exchanges {
            let e = &ex.expect;
            let mut target = format!("/{}{}", c.id(), e.path);
            if !e.query.is_empty() {
                target = format!("{target}?{}", encode_query(&e.query));
            }
            let mut head = format!("{} {target} HTTP/1.1\r\nHost: {}\r\n", e.method, self.0);
            for (name, value) in &e.headers {
                head.push_str(&format!("{name}: {value}\r\n"));
            }
            let body = e.body.as_ref().map(Value::json).unwrap_or_default();
            if e.body.is_some() {
                if !e.headers.iter().any(|(n, _)| n.eq_ignore_ascii_case("content-type")) {
                    head.push_str("Content-Type: application/json\r\n");
                }
                head.push_str(&format!("Content-Length: {}\r\n", body.len()));
            }
            head.push_str("\r\n");
            let exchange = || -> std::io::Result<Vec<u8>> {
                let mut stream = TcpStream::connect(self.0)?;
                stream.set_read_timeout(Some(timeout))?;
                stream.write_all(head.as_bytes())?;
                stream.write_all(body.as_bytes())?;
                // The server closes every connection after its response.
                let mut response = Vec::new();
                stream.read_to_end(&mut response)?;
                Ok(response)
            };
            match exchange() {
                Ok(response) if !response.is_empty() => {}
                Ok(_) => {
                    let message = "the server closed the connection without a response".to_owned();
                    let error = Value::Object(vec![
                        ("kind".to_owned(), Value::String("network".to_owned())),
                        ("message".to_owned(), Value::String(message)),
                    ]);
                    return Ok(Outcome {
                        response: None,
                        error: Some(error),
                    });
                }
                Err(err) => return Err(format!("sending {} {target}: {err}", e.method)),
            }
        }
        Ok(Outcome {
            response: c.result.response.clone(),
            error: c.result.error.clone(),
        })
    }
}

impl Shared {
    /// Hands each result line to the case waiting for it.
    fn read(&self, stdout: impl Read) {
        for line in BufReader::new(stdout).lines() {
            let line = match line {
                Ok(line) => line,
                Err(err) => {
                    self.strays.lock().push(format!("reading the client's output: {err}"));
                    break;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(serde_json::Value::Object(mut members)) = serde_json::from_str(&line) else {
                self.strays
                    .lock()
                    .push(format!("the client wrote a line that is not a JSON object: {line}"));
                continue;
            };
            let Some(serde_json::Value::String(id)) = members.remove("id") else {
                self.strays
                    .lock()
                    .push(format!("the client wrote a result without a string id: {line}"));
                continue;
            };
            let waiting = self.pending.lock().as_mut().and_then(|p| p.remove(&id));
            let Some(tx) = waiting else {
                self.strays
                    .lock()
                    .push(format!("the client wrote a result for no waiting case: {line}"));
                continue;
            };
            let mut outcome = Outcome::default();
            for (key, value) in members {
                match key.as_str() {
                    "response" => outcome.response = Some(value.into()),
                    "error" => outcome.error = Some(value.into()),
                    _ => {}
                }
            }
            let _ = tx.send(outcome);
        }
        // Dropping the senders wakes every case still waiting.
        self.pending.lock().take();
    }
}

/// Returns the line the runner sends a client for a case. `exchanges` and
/// `result` let a client without an SDK check the runner itself; a client
/// that calls an SDK ignores them.
fn message(c: &Case, base_url: &str) -> Value {
    let s = |s: &str| Value::String(s.to_owned());
    let or_empty = |v: &Option<Value>| v.clone().unwrap_or(Value::Object(Vec::new()));
    let exchanges = c
        .exchanges
        .iter()
        .map(|ex| {
            let e = &ex.expect;
            let mut wire = vec![("method".to_owned(), s(&e.method)), ("path".to_owned(), s(&e.path))];
            if !e.query.is_empty() {
                wire.push(("query".to_owned(), s(&encode_query(&e.query))));
            }
            if !e.headers.is_empty() {
                let headers = e.headers.iter().map(|(k, v)| (k.clone(), s(v))).collect();
                wire.push(("headers".to_owned(), Value::Object(headers)));
            }
            if let Some(body) = &e.body {
                wire.push(("body".to_owned(), body.clone()));
            }
            Value::Object(wire)
        })
        .collect();
    let mut result = Vec::new();
    if let Some(response) = &c.result.response {
        result.push(("response".to_owned(), response.clone()));
    }
    if let Some(error) = &c.result.error {
        result.push(("error".to_owned(), error.clone()));
    }
    Value::Object(vec![
        ("id".to_owned(), s(&c.id())),
        ("name".to_owned(), s(&c.name)),
        ("baseUrl".to_owned(), s(base_url)),
        ("token".to_owned(), s(TOKEN)),
        ("client".to_owned(), or_empty(&c.client)),
        (
            "call".to_owned(),
            Value::Object(vec![
                ("group".to_owned(), s(&c.call.group)),
                ("method".to_owned(), s(&c.call.method)),
                ("request".to_owned(), or_empty(&c.call.request)),
                ("options".to_owned(), or_empty(&c.call.options)),
                ("iterate".to_owned(), Value::Bool(c.call.iterate)),
            ]),
        ),
        ("exchanges".to_owned(), Value::Array(exchanges)),
        ("result".to_owned(), Value::Object(result)),
    ])
}
