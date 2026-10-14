//! The JSON values the suite writes, how YAML turns into them, and the
//! canonical form the runner compares them in.

use std::collections::HashMap;
use std::fmt::Write as _;

use yaml_rust2::parser::{Event, MarkedEventReceiver, Parser};
use yaml_rust2::scanner::{Marker, TScalarStyle};

/// A JSON value. Numbers keep their digits, so an int64 is not rounded, and
/// objects keep their keys in the order they are written, so a query in the
/// call options reaches the client in the case's order.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    /// Returns the member `key` of an object.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn is_object(&self) -> bool {
        matches!(self, Value::Object(_))
    }

    /// Returns the value as compact JSON.
    pub fn json(&self) -> String {
        let mut out = String::new();
        self.write(&mut out, None, 0);
        out
    }

    /// Returns the value as indented JSON in a canonical form, so that two
    /// values are the same exactly when their canonical forms are equal:
    /// keys are sorted, numbers are compared by value, and tagged values by
    /// what they hold, so `"2024-03-01T12:00:00+02:00"` and
    /// `"2024-03-01T10:00:00Z"` are the same `$datetime`.
    pub fn canonical(&self) -> String {
        let mut out = String::new();
        self.normalize().write(&mut out, Some("  "), 0);
        out.push('\n');
        out
    }

    fn normalize(&self) -> Value {
        match self {
            Value::Number(n) => Value::Number(canonical_number(n)),
            Value::Array(items) => Value::Array(items.iter().map(Value::normalize).collect()),
            Value::Object(members) => {
                if let [(tag, Value::String(s))] = members.as_slice()
                    && let Some(held) = canonical_tag(tag, s)
                {
                    return Value::Object(vec![(tag.clone(), Value::String(held))]);
                }
                let mut out: Vec<_> = members.iter().map(|(k, v)| (k.clone(), v.normalize())).collect();
                out.sort_by(|a, b| a.0.cmp(&b.0));
                Value::Object(out)
            }
            v => v.clone(),
        }
    }

    fn write(&self, out: &mut String, indent: Option<&str>, depth: usize) {
        let newline = |out: &mut String, depth: usize| {
            if let Some(indent) = indent {
                out.push('\n');
                out.push_str(&indent.repeat(depth));
            }
        };
        match self {
            Value::Null => out.push_str("null"),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Number(n) => out.push_str(n),
            Value::String(s) => out.push_str(&quote(s)),
            Value::Array(items) if items.is_empty() => out.push_str("[]"),
            Value::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    newline(out, depth + 1);
                    item.write(out, indent, depth + 1);
                }
                newline(out, depth);
                out.push(']');
            }
            Value::Object(members) if members.is_empty() => out.push_str("{}"),
            Value::Object(members) => {
                out.push('{');
                for (i, (key, value)) in members.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    newline(out, depth + 1);
                    out.push_str(&quote(key));
                    out.push_str(if indent.is_some() { ": " } else { ":" });
                    value.write(out, indent, depth + 1);
                }
                newline(out, depth);
                out.push('}');
            }
        }
    }
}

impl From<serde_json::Value> for Value {
    fn from(v: serde_json::Value) -> Value {
        match v {
            serde_json::Value::Null => Value::Null,
            serde_json::Value::Bool(b) => Value::Bool(b),
            serde_json::Value::Number(n) => Value::Number(n.to_string()),
            serde_json::Value::String(s) => Value::String(s),
            serde_json::Value::Array(items) => Value::Array(items.into_iter().map(Value::from).collect()),
            serde_json::Value::Object(members) => {
                Value::Object(members.into_iter().map(|(k, v)| (k, Value::from(v))).collect())
            }
        }
    }
}

fn quote(s: &str) -> String {
    serde_json::to_string(s).expect("a string is always JSON")
}

/// Returns a number in a canonical form: integers in full, and other
/// numbers as the nearest `f64`.
fn canonical_number(n: &str) -> String {
    if let Some(i) = canonical_integer(n) {
        return i;
    }
    match n.parse::<f64>() {
        Ok(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", f as i64),
        Ok(f) => format!("{f}"),
        Err(_) => n.to_owned(),
    }
}

/// Returns the digits of a decimal integer without leading zeros, or `None`
/// when `n` is not one.
fn canonical_integer(n: &str) -> Option<String> {
    let (sign, digits) = match n.strip_prefix('-') {
        Some(digits) => ("-", digits),
        None => ("", n.strip_prefix('+').unwrap_or(n)),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    match digits.trim_start_matches('0') {
        "" => Some("0".to_owned()),
        digits => Some(format!("{sign}{digits}")),
    }
}

/// Returns the canonical form of what a tagged value holds, or `None` when
/// `tag` is not a tag or `s` is not a valid value for it.
fn canonical_tag(tag: &str, s: &str) -> Option<String> {
    match tag {
        "$datetime" => s.parse::<jiff::Timestamp>().ok().map(|t| t.to_string()),
        "$date" => s.parse::<jiff::civil::Date>().ok().map(|d| d.to_string()),
        "$int64" => canonical_integer(s),
        "$bytes" => base64_decode(s).map(|b| base64_encode(&b)),
        _ => None,
    }
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encodes `b` in standard, padded base64.
fn base64_encode(b: &[u8]) -> String {
    let mut out = String::new();
    for chunk in b.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(BASE64[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Decodes standard or URL-safe base64, with or without padding.
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.trim_end_matches('=');
    if s.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::new();
    let (mut n, mut bits) = (0u32, 0);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        };
        n = n << 6 | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((n >> bits) as u8);
        }
    }
    Some(out)
}

/// A YAML node and the line it starts on.
#[derive(Clone, Debug)]
pub struct Node {
    pub line: usize,
    pub kind: Kind,
}

#[derive(Clone, Debug)]
pub enum Kind {
    /// A scalar: its text, and whether it is a string whatever the text,
    /// because it is quoted, a block, or tagged `!!str`.
    Scalar(String, bool),
    Seq(Vec<Node>),
    Map(Vec<(Node, Node)>),
}

impl Node {
    /// Returns the text of a scalar.
    pub fn scalar(&self) -> Option<&str> {
        match &self.kind {
            Kind::Scalar(text, _) => Some(text),
            _ => None,
        }
    }

    /// Returns whether the node is a plain `null`, or empty.
    pub fn is_null(&self) -> bool {
        matches!(&self.kind, Kind::Scalar(text, false) if matches!(text.as_str(), "" | "~" | "null" | "Null" | "NULL"))
    }

    /// Converts the node to JSON by the YAML 1.2 core schema. Keys must be
    /// scalars and appear once; `.inf` and `.nan` have no JSON form.
    pub fn value(&self) -> Result<Value, String> {
        match &self.kind {
            Kind::Scalar(text, true) => Ok(Value::String(text.clone())),
            Kind::Scalar(_, false) if self.is_null() => Ok(Value::Null),
            Kind::Scalar(text, false) => {
                plain(text).ok_or_else(|| format!("line {}: {text:?} is not a JSON value", self.line))
            }
            Kind::Seq(items) => items
                .iter()
                .map(Node::value)
                .collect::<Result<_, _>>()
                .map(Value::Array),
            Kind::Map(entries) => {
                let mut members: Vec<(String, Value)> = Vec::new();
                for (key, value) in entries {
                    let Some(name) = key.scalar() else {
                        return Err(format!("line {}: a key must be a scalar", key.line));
                    };
                    if members.iter().any(|(k, _)| k == name) {
                        return Err(format!("line {}: duplicate key {name:?}", key.line));
                    }
                    members.push((name.to_owned(), value.value()?));
                }
                Ok(Value::Object(members))
            }
        }
    }
}

/// Resolves a plain scalar that is not null: a bool, a number, or a string.
fn plain(text: &str) -> Option<Value> {
    match text {
        "true" | "True" | "TRUE" => return Some(Value::Bool(true)),
        "false" | "False" | "FALSE" => return Some(Value::Bool(false)),
        _ => {}
    }
    if let Some(i) = canonical_integer(text) {
        return Some(Value::Number(i));
    }
    for (prefix, radix) in [("0x", 16), ("0o", 8)] {
        if let Some(digits) = text.strip_prefix(prefix) {
            return u128::from_str_radix(digits, radix)
                .ok()
                .map(|n| Value::Number(n.to_string()));
        }
    }
    if matches!(
        text.to_ascii_lowercase().trim_start_matches(['-', '+']),
        ".inf" | ".nan"
    ) {
        return None;
    }
    let json = text.strip_prefix('+').unwrap_or(text);
    if serde_json::from_str::<serde_json::Number>(json).is_ok() {
        return Some(Value::Number(json.to_owned()));
    }
    // YAML floats that JSON has no syntax for, such as `.5` and `1.`.
    let number = json.trim_start_matches('-');
    if number.starts_with(|c: char| c.is_ascii_digit() || c == '.')
        && number
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'-' | b'+'))
        && let Ok(f) = json.parse::<f64>()
    {
        return Some(Value::Number(format!("{f}")));
    }
    Some(Value::String(text.to_owned()))
}

/// Parses a YAML document.
pub fn parse(text: &str) -> Result<Node, String> {
    let mut builder = Builder::default();
    Parser::new_from_str(text)
        .load(&mut builder, false)
        .map_err(|e| e.to_string())?;
    if let Some(err) = builder.error {
        return Err(err);
    }
    builder.root.ok_or_else(|| "the file is empty".to_owned())
}

#[derive(Default)]
struct Builder {
    frames: Vec<Frame>,
    anchors: HashMap<usize, Node>,
    root: Option<Node>,
    error: Option<String>,
}

struct Frame {
    line: usize,
    anchor: usize,
    map: bool,
    items: Vec<Node>,
}

impl Builder {
    fn finish(&mut self, node: Node, anchor: usize) {
        if anchor != 0 {
            self.anchors.insert(anchor, node.clone());
        }
        match self.frames.last_mut() {
            Some(frame) => frame.items.push(node),
            None if self.root.is_none() => self.root = Some(node),
            None => {}
        }
    }
}

impl MarkedEventReceiver for Builder {
    fn on_event(&mut self, ev: Event, mark: Marker) {
        let line = mark.line();
        match ev {
            Event::Scalar(text, style, anchor, tag) => {
                let string = style != TScalarStyle::Plain
                    || tag.is_some_and(|t| t.handle == "tag:yaml.org,2002:" && t.suffix == "str");
                self.finish(
                    Node {
                        line,
                        kind: Kind::Scalar(text, string),
                    },
                    anchor,
                );
            }
            Event::SequenceStart(anchor, _) => self.frames.push(Frame {
                line,
                anchor,
                map: false,
                items: Vec::new(),
            }),
            Event::MappingStart(anchor, _) => self.frames.push(Frame {
                line,
                anchor,
                map: true,
                items: Vec::new(),
            }),
            Event::SequenceEnd | Event::MappingEnd => {
                let frame = self.frames.pop().expect("the parser balances its events");
                let kind = if frame.map {
                    let mut items = frame.items.into_iter();
                    let mut entries = Vec::new();
                    while let (Some(k), Some(v)) = (items.next(), items.next()) {
                        entries.push((k, v));
                    }
                    Kind::Map(entries)
                } else {
                    Kind::Seq(frame.items)
                };
                self.finish(Node { line: frame.line, kind }, frame.anchor);
            }
            Event::Alias(id) => match self.anchors.get(&id).cloned() {
                Some(node) => self.finish(node, 0),
                None => self.error = Some(format!("line {line}: unknown alias")),
            },
            _ => {}
        }
    }
}

/// Shows `s` with `prefix` before every line, for failure messages.
pub fn indent(s: &str, prefix: &str) -> String {
    let mut out = String::new();
    for (i, line) in s.trim_end_matches('\n').split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let _ = write!(out, "{prefix}{line}");
    }
    out
}
