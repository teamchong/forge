//! The cases of the suite, as `conformance/cases/*.yaml` writes them.

use std::fs;
use std::path::Path;

use crate::value::{self, Kind, Node, Value};

/// One call of the suite: the call a client makes, the requests the server
/// must receive and their responses, and the result the caller must get.
#[derive(Debug)]
pub struct Case {
    /// Says what the case checks. It is unique in the suite.
    pub name: String,
    /// The client options besides the token and the base URL, in field
    /// names.
    pub client: Option<Value>,
    pub call: Call,
    /// The requests the server must receive, in order, and its responses,
    /// in wire names.
    pub exchanges: Vec<Exchange>,
    pub result: Outcome,
    /// The name of the case's file without its extension, such as
    /// `errors`, which names the pattern it checks.
    pub file: String,
    pub line: usize,
}

/// The method a case calls and what it passes, in field names.
#[derive(Debug, Default)]
pub struct Call {
    /// The group's property path, such as `projects.members`; empty for the
    /// root.
    pub group: String,
    pub method: String,
    pub request: Option<Value>,
    /// The request options, such as `headers` and `query`.
    pub options: Option<Value>,
    /// Asks for every item of every page instead of one response.
    pub iterate: bool,
}

#[derive(Debug)]
pub struct Exchange {
    pub expect: Expect,
    pub respond: Respond,
}

/// A request the server must receive, in wire form.
#[derive(Debug, Default)]
pub struct Expect {
    pub method: String,
    /// The escaped path below the base URL, such as `/orgs/o1/projects/a%20b`.
    pub path: String,
    /// The query, whose keys and values must come in this order. A case
    /// writes it as a mapping from each key to a value or a list of values;
    /// a list repeats the key.
    pub query: Vec<(String, String)>,
    /// Headers that must have these values; others are not checked.
    pub headers: Vec<(String, String)>,
    /// The JSON body, or `None` when the request must have none.
    pub body: Option<Value>,
}

/// The response the server sends to a request.
#[derive(Debug, Default)]
pub struct Respond {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    /// A JSON body, sent as `application/json` unless `headers` sets a
    /// content type.
    pub body: Option<Value>,
    /// A body sent as it is, as `text/plain` unless `headers` sets a content
    /// type.
    pub text: Option<String>,
    /// Closes the connection without a response.
    pub disconnect: bool,
}

/// What the caller must get, or what a client reported: a response, which
/// is JSON `null` for one with no body, or an error.
#[derive(Debug, Default)]
pub struct Outcome {
    pub response: Option<Value>,
    pub error: Option<Value>,
}

impl Case {
    /// Returns the case's name as a URL path segment, which the runner uses
    /// as the case's id and in its base URL.
    pub fn id(&self) -> String {
        let mut out = String::new();
        let mut gap = false;
        for c in self.name.to_lowercase().chars() {
            if c.is_ascii_lowercase() || c.is_ascii_digit() {
                if gap && !out.is_empty() {
                    out.push('-');
                }
                gap = false;
                out.push(c);
            } else {
                gap = true;
            }
        }
        out
    }

    /// The case's file and name, as `cargo test` filters them.
    pub fn path(&self) -> String {
        format!("{}/{}", self.file, self.name)
    }

    /// Where the case is written, for errors.
    pub fn place(&self) -> String {
        format!("{}.yaml:{}", self.file, self.line)
    }
}

/// Reads every case in `dir/cases/*.yaml`, file by file in name order, and
/// each file's cases in order. It reports every invalid case together.
pub fn load(dir: &Path) -> Result<Vec<Case>, String> {
    let mut files: Vec<_> = fs::read_dir(dir.join("cases"))
        .map_err(|e| format!("{}: {e}", dir.join("cases").display()))?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "yaml"))
        .collect();
    files.sort();
    if files.is_empty() {
        return Err("there are no cases/*.yaml files".to_owned());
    }
    let mut cases = Vec::new();
    let mut errs = Vec::new();
    for path in files {
        let file = path.file_stem().unwrap().to_string_lossy().into_owned();
        let parsed = fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|text| value::parse(&text))
            .and_then(|node| parse_cases(&file, &node));
        match parsed {
            Ok(parsed) => cases.extend(parsed),
            Err(err) => errs.push(format!("cases/{file}.yaml: {err}")),
        }
    }
    for (i, c) in cases.iter().enumerate() {
        if let Err(err) = c.validate() {
            errs.push(format!("{}: {:?}: {err}", c.place(), c.name));
        }
        if let Some(other) = cases[..i].iter().find(|o| o.id() == c.id())
            && !c.name.is_empty()
        {
            errs.push(format!(
                "{}: {:?} has the same id as {:?} at {}",
                c.place(),
                c.name,
                other.name,
                other.place()
            ));
        }
    }
    if errs.is_empty() {
        Ok(cases)
    } else {
        Err(errs.join("\n"))
    }
}

/// Reads a file of cases, a YAML list, rejecting unknown keys.
fn parse_cases(file: &str, node: &Node) -> Result<Vec<Case>, String> {
    let Kind::Seq(items) = &node.kind else {
        return Err(format!("line {}: the cases must be a list", node.line));
    };
    items.iter().map(|item| parse_case(file, item)).collect()
}

fn parse_case(file: &str, node: &Node) -> Result<Case, String> {
    let mut c = Case {
        name: String::new(),
        client: None,
        call: Call::default(),
        exchanges: Vec::new(),
        result: Outcome::default(),
        file: file.to_owned(),
        line: node.line,
    };
    for (key, value) in entries(node, &["name", "client", "call", "exchanges", "result"])? {
        match key {
            "name" => c.name = string(value)?,
            "client" => c.client = json(value)?,
            "call" => c.call = parse_call(value)?,
            "exchanges" => c.exchanges = parse_exchanges(value)?,
            _ => {
                // A response of null is kept as JSON null, unlike the other
                // values, where null leaves the key out.
                for (key, value) in entries(value, &["response", "error"])? {
                    let v = Some(value.value()?);
                    if key == "response" {
                        c.result.response = v;
                    } else {
                        c.result.error = v;
                    }
                }
            }
        }
    }
    Ok(c)
}

fn parse_call(node: &Node) -> Result<Call, String> {
    let mut call = Call::default();
    for (key, value) in entries(node, &["group", "method", "request", "options", "iterate"])? {
        match key {
            "group" => call.group = string(value)?,
            "method" => call.method = string(value)?,
            "request" => call.request = json(value)?,
            "options" => call.options = json(value)?,
            _ => {
                call.iterate = match value.value()? {
                    Value::Bool(b) => b,
                    _ => return Err(format!("line {}: iterate must be true or false", value.line)),
                }
            }
        }
    }
    Ok(call)
}

fn parse_exchanges(node: &Node) -> Result<Vec<Exchange>, String> {
    let Kind::Seq(items) = &node.kind else {
        return Err(format!("line {}: exchanges must be a list", node.line));
    };
    let mut out = Vec::new();
    for item in items {
        let mut expect = Expect::default();
        let mut respond = Respond::default();
        for (key, value) in entries(item, &["expect", "respond"])? {
            if key == "expect" {
                for (key, value) in entries(value, &["method", "path", "query", "headers", "body"])? {
                    match key {
                        "method" => expect.method = string(value)?,
                        "path" => expect.path = string(value)?,
                        "query" => expect.query = query(value)?,
                        "headers" => expect.headers = strings(value)?,
                        _ => expect.body = json(value)?,
                    }
                }
            } else {
                for (key, value) in entries(value, &["status", "headers", "body", "text", "disconnect"])? {
                    match key {
                        "status" => {
                            respond.status = string(value)?
                                .parse()
                                .map_err(|_| format!("line {}: status must be a number", value.line))?
                        }
                        "headers" => respond.headers = strings(value)?,
                        "body" => respond.body = json(value)?,
                        "text" => respond.text = Some(string(value)?),
                        _ => respond.disconnect = value.value()? == Value::Bool(true),
                    }
                }
            }
        }
        out.push(Exchange { expect, respond });
    }
    Ok(out)
}

/// Returns the entries of a mapping, rejecting keys not in `known` and keys
/// that appear twice.
fn entries<'n>(node: &'n Node, known: &[&'static str]) -> Result<Vec<(&'static str, &'n Node)>, String> {
    let Kind::Map(entries) = &node.kind else {
        return Err(format!("line {}: expected a mapping", node.line));
    };
    let mut out: Vec<(&'static str, &Node)> = Vec::new();
    for (key, value) in entries {
        let name = key.scalar().unwrap_or_default();
        let Some(&known) = known.iter().find(|&&k| k == name) else {
            return Err(format!(
                "line {}: unknown key {name:?}; the keys are {}",
                key.line,
                known.join(", ")
            ));
        };
        if out.iter().any(|(k, _)| *k == known) {
            return Err(format!("line {}: duplicate key {name:?}", key.line));
        }
        out.push((known, value));
    }
    Ok(out)
}

fn string(node: &Node) -> Result<String, String> {
    node.scalar()
        .map(str::to_owned)
        .ok_or_else(|| format!("line {}: expected a scalar", node.line))
}

/// Returns a JSON value, or `None` for null.
fn json(node: &Node) -> Result<Option<Value>, String> {
    if node.is_null() {
        Ok(None)
    } else {
        node.value().map(Some)
    }
}

/// Returns a mapping of strings, such as headers.
fn strings(node: &Node) -> Result<Vec<(String, String)>, String> {
    entries_any(node)?
        .into_iter()
        .map(|(k, v)| Ok((k, string(v)?)))
        .collect()
}

/// Returns a query: a mapping from each key to a scalar or a list of them.
fn query(node: &Node) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for (key, value) in entries_any(node)? {
        let values = match &value.kind {
            Kind::Seq(items) => items.iter().collect(),
            _ => vec![value],
        };
        for v in values {
            if v.scalar().is_none() || v.is_null() {
                return Err(format!("line {}: query value of {key:?} must be a scalar", v.line));
            }
            out.push((key.clone(), string(v)?));
        }
    }
    Ok(out)
}

fn entries_any(node: &Node) -> Result<Vec<(String, &Node)>, String> {
    let Kind::Map(entries) = &node.kind else {
        return Err(format!("line {}: expected a mapping", node.line));
    };
    entries.iter().map(|(k, v)| Ok((string(k)?, v))).collect()
}

impl Case {
    /// Reports the first problem with a case that the runner cannot run or
    /// that could never pass.
    fn validate(&self) -> Result<(), String> {
        if self.id().is_empty() {
            return Err("a case needs a name with a letter or a digit".to_owned());
        }
        if self.call.method.is_empty() {
            return Err("call.method is missing".to_owned());
        }
        for (key, v) in [
            ("client", &self.client),
            ("call.request", &self.call.request),
            ("call.options", &self.call.options),
        ] {
            if v.as_ref().is_some_and(|v| !v.is_object()) {
                return Err(format!("{key} must be an object"));
            }
        }
        for (i, ex) in self.exchanges.iter().enumerate() {
            ex.validate().map_err(|e| format!("exchange {}: {e}", i + 1))?;
        }
        let error = match (&self.result.response, &self.result.error) {
            (None, None) => return Err("result needs a response or an error".to_owned()),
            (Some(_), Some(_)) => return Err("result has both a response and an error".to_owned()),
            (Some(_), None) => return Ok(()),
            (None, Some(error)) => error,
        };
        if !error.is_object() {
            return Err("result.error must be an object".to_owned());
        }
        match error.get("kind") {
            Some(Value::String(k)) if k == "api" => {
                if !matches!(error.get("status"), Some(Value::Number(_))) {
                    return Err("an api error needs a status".to_owned());
                }
            }
            Some(Value::String(k)) if k == "client" => {
                if !self.exchanges.is_empty() {
                    return Err("a client error is refused before a request, so it has no exchanges".to_owned());
                }
            }
            Some(Value::String(k)) if k == "network" => {}
            kind => {
                return Err(format!(
                    "result.error.kind is {}, not api, client or network",
                    kind.map_or("missing".to_owned(), Value::json)
                ));
            }
        }
        Ok(())
    }
}

impl Exchange {
    fn validate(&self) -> Result<(), String> {
        if self.expect.method.is_empty() {
            return Err("expect.method is missing".to_owned());
        }
        if !self.expect.path.starts_with('/') {
            return Err(format!("expect.path {:?} must start with /", self.expect.path));
        }
        let r = &self.respond;
        if r.disconnect {
            if r.status != 0 || !r.headers.is_empty() || r.body.is_some() || r.text.is_some() {
                return Err("respond.disconnect sends no response, so it takes nothing else".to_owned());
            }
        } else if !(100..=999).contains(&r.status) {
            return Err(format!("respond.status {} is not a status code", r.status));
        } else if r.body.is_some() && r.text.is_some() {
            return Err("respond has both a body and a text".to_owned());
        }
        Ok(())
    }
}

/// Encodes a query in order, without the leading `?`.
pub fn encode_query(query: &[(String, String)]) -> String {
    let escape = |s: &str| {
        let mut out = String::new();
        for b in s.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
                b' ' => out.push('+'),
                _ => out.push_str(&format!("%{b:02X}")),
            }
        }
        out
    };
    query
        .iter()
        .map(|(k, v)| format!("{}={}", escape(k), escape(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Decodes a raw query, keeping the order of its keys. A part that is not
/// valid is kept as it is.
pub fn parse_query(raw: &str) -> Vec<(String, String)> {
    let unescape = |s: &str| -> String {
        let bytes = s.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'+' => out.push(b' '),
                b'%' => match s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 2;
                    }
                    None => return s.to_owned(),
                },
                b => out.push(b),
            }
            i += 1;
        }
        String::from_utf8(out).unwrap_or_else(|_| s.to_owned())
    };
    raw.split('&')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (k, v) = part.split_once('=').unwrap_or((part, ""));
            (unescape(k), unescape(v))
        })
        .collect()
}

/// Shows a query decoded, for failure messages.
pub fn show_query(query: &[(String, String)]) -> String {
    if query.is_empty() {
        return "(none)".to_owned();
    }
    query
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}
