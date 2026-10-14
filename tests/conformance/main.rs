//! Runs forge's conformance suite, `conformance/`, against the TypeScript
//! generator. The design is `conformance/README.md`.
//!
//! The test generates an SDK from `conformance/openapi.json` with the
//! `forge` command, starts an HTTP server and the conformance client in
//! `conformance/ts`, and runs every case of `conformance/cases` at once.
//! A filter runs the cases whose `file/name` contains it:
//!
//! ```text
//! cargo test --test conformance -- 'errors/a declared error'
//! ```

mod case;
mod client;
mod diff;
mod server;
mod value;

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::process::{Command, ExitCode};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use case::{Case, Outcome};
use client::{Client, Passthrough, Process};
use diff::diff;
use server::Server;
use value::{Kind, Value, indent};

/// How long a client has to report the result of a case.
const CASE_TIMEOUT: Duration = Duration::from_secs(30);

fn main() -> ExitCode {
    // `cargo test FILTER` passes the filter to every test, and flags such
    // as `--nocapture` that this test has no use for.
    let filter = std::env::args().skip(1).find(|a| !a.starts_with('-'));
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let suite = root.join("conformance");
    match run(&suite, filter.as_deref()) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(err) => {
            eprintln!("conformance: {err}");
            ExitCode::FAILURE
        }
    }
}

/// Runs the cases that match `filter`, and returns whether they passed.
fn run(suite: &Path, filter: Option<&str>) -> Result<bool, String> {
    let cases = case::load(suite)?;
    check_api(suite, &cases)?;
    let client = suite.join("ts");
    let expected = expected_failures(&client.join("expected-failures.yaml"), &cases)?;
    let cases: Vec<Arc<Case>> = cases
        .into_iter()
        .filter(|c| filter.is_none_or(|f| c.path().contains(f)))
        .map(Arc::new)
        .collect();
    if cases.is_empty() {
        println!("conformance: no case matches {filter:?}");
        return Ok(true);
    }

    // The pass-through client checks the cases and the runner first, so a
    // broken case is not taken for a broken generator.
    let server = Server::start().map_err(|e| format!("start the server: {e}"))?;
    let passthrough = Passthrough(server.addr());
    let (results, stray) = check_all(&server, &passthrough, &cases, Vec::new);
    let broken: Vec<_> = cases
        .iter()
        .zip(&results)
        .filter_map(|(c, r)| Some((c, r.as_ref().err()?)))
        .collect();
    if !broken.is_empty() || !stray.is_empty() {
        for (c, err) in broken {
            println!("FAIL     {} (pass-through client)\n{}", c.path(), indent(err, "    "));
        }
        for s in &stray {
            println!("FAIL     {}", indent(s, "    ").trim_start());
        }
        println!("\nthe pass-through client fails, so the runner or the cases are wrong");
        return Ok(false);
    }

    let sdk = client.join("sdk");
    if sdk.exists() {
        fs::remove_dir_all(&sdk).map_err(|e| format!("{}: {e}", sdk.display()))?;
    }
    let generated = Command::new(env!("CARGO_BIN_EXE_forge"))
        .arg(suite.join("openapi.json"))
        .args(["--target", "ts", "--out"])
        .arg(&sdk)
        .output()
        .map_err(|e| format!("run forge: {e}"))?;
    if !generated.status.success() {
        return Err(format!(
            "forge failed to generate the SDK:\n{}",
            String::from_utf8_lossy(&generated.stderr)
        ));
    }
    let server = Server::start().map_err(|e| format!("start the server: {e}"))?;
    let mut node = Command::new(std::env::var_os("NODE").unwrap_or_else(|| "node".into()));
    node.current_dir(&client).args([
        "--harmony-temporal",
        "--disable-warning=ExperimentalWarning",
        "--import",
        "./src/register.ts",
        "./src/client.ts",
    ]);
    let process = Process::start(node)?;
    let (results, stray) = check_all(&server, &process, &cases, || process.close(Duration::from_secs(10)));

    let (mut passed, mut failed, mut known) = (0, 0, 0);
    for (c, result) in cases.iter().zip(&results) {
        match (result, expected.iter().find(|(name, _)| *name == c.name)) {
            (Ok(()), None) => {
                passed += 1;
                println!("ok       {}", c.path());
            }
            (Err(err), None) => {
                failed += 1;
                println!("FAIL     {}\n{}", c.path(), indent(err, "    "));
            }
            (Err(_), Some((_, reason))) => {
                known += 1;
                println!("expected {}: {reason}", c.path());
            }
            (Ok(()), Some(_)) => {
                failed += 1;
                println!(
                    "FAIL     {}\n    passes, so take it out of {}",
                    c.path(),
                    Path::new("conformance/ts/expected-failures.yaml").display()
                );
            }
        }
    }
    for s in &stray {
        println!("FAIL     {}", indent(s, "    ").trim_start());
    }
    println!("\n{passed} passed, {known} failed as expected, {failed} failed");
    Ok(failed == 0 && stray.is_empty())
}

/// Runs every case at once with `client`, then calls `close`, which stops
/// the client and returns how it failed. It returns how each case failed,
/// and the problems that belong to no case.
fn check_all(
    server: &Server,
    client: &dyn Client,
    cases: &[Arc<Case>],
    close: impl FnOnce() -> Vec<String>,
) -> (Vec<Result<(), String>>, Vec<String>) {
    let results: Vec<Result<(), String>> = thread::scope(|s| {
        let runs: Vec<_> = cases.iter().map(|c| s.spawn(|| check(server, client, c))).collect();
        runs.into_iter().map(|run| run.join().unwrap()).collect()
    });
    // Once the client has stopped, no request can arrive late.
    let mut stray = close();
    stray.extend(server.take_strays());
    let results = cases
        .iter()
        .zip(results)
        .map(|(c, result)| match (result, server.take_late(c)) {
            (result, late) if late.is_empty() => result,
            (Ok(()), late) => Err(format!("{}:\n{}", c.place(), indent(&late.join("\n"), "  "))),
            (Err(err), late) => Err(format!("{err}\n{}", indent(&late.join("\n"), "  "))),
        })
        .collect();
    (results, stray)
}

/// Runs one case and returns how it failed.
fn check(server: &Server, client: &dyn Client, c: &Arc<Case>) -> Result<(), String> {
    let state = server.start_case(Arc::clone(c));
    let out = client.call(c, &server.base_url(c), CASE_TIMEOUT);
    // A request from now on is late, and check_all adds it to the case.
    server.done(c);
    let mut problems = state.take_problems();
    match out {
        Err(err) => problems.push(err),
        Ok(out) => {
            problems.extend(state.missing());
            if let Some(d) = compare(&c.result, out) {
                problems.push(format!("result: (-want +got)\n{}", indent(&d, "  ")));
            }
        }
    }
    if problems.is_empty() {
        return Ok(());
    }
    Err(format!("{}:\n{}", c.place(), indent(&problems.join("\n"), "  ")))
}

/// Returns a diff of the result a case wants and the one a client reported,
/// or `None` when they match. Of an error, only the members the case lists
/// are compared.
fn compare(want: &Outcome, got: Outcome) -> Option<String> {
    let object = |o: &Outcome| {
        let mut members = Vec::new();
        if let Some(r) = &o.response {
            members.push(("response".to_owned(), r.clone()));
        }
        if let Some(e) = &o.error {
            members.push(("error".to_owned(), e.clone()));
        }
        Value::Object(members)
    };
    let mut got = got;
    if let (Some(Value::Object(listed)), Some(Value::Object(members))) = (&want.error, &got.error) {
        let kept = members
            .iter()
            .filter(|(k, _)| listed.iter().any(|(l, _)| l == k))
            .cloned()
            .collect();
        got.error = Some(Value::Object(kept));
    }
    let (w, g) = (object(want).canonical(), object(&got).canonical());
    (w != g).then(|| diff(&w, &g))
}

/// Checks that every case calls a method of the suite API, that its
/// requests go to that method's operation, and that every method has a
/// case. Groups and methods are named the way the generated SDK names them,
/// in camelCase.
fn check_api(suite: &Path, cases: &[Case]) -> Result<(), String> {
    let text = fs::read_to_string(suite.join("openapi.json")).map_err(|e| format!("openapi.json: {e}"))?;
    let doc: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("openapi.json: {e}"))?;
    let camel = |s: &str| forge::Name::new(s).camel();
    // (group, method) -> (HTTP method, path template)
    let mut methods = Vec::new();
    for (path, item) in doc["paths"].as_object().into_iter().flatten() {
        for (verb, op) in item.as_object().into_iter().flatten() {
            let Some(name) = op.get("x-fern-sdk-method-name").and_then(|n| n.as_str()) else {
                continue;
            };
            let group: Vec<String> = match op.get("x-fern-sdk-group-name") {
                Some(serde_json::Value::String(s)) => s.split('.').map(camel).collect(),
                Some(serde_json::Value::Array(names)) => names.iter().filter_map(|n| n.as_str()).map(camel).collect(),
                _ => Vec::new(),
            };
            methods.push(((group.join("."), camel(name)), (verb.to_uppercase(), path.clone())));
        }
    }
    let mut errs = Vec::new();
    let mut called = BTreeSet::new();
    for c in cases {
        let key = (c.call.group.clone(), c.call.method.clone());
        let Some((_, (verb, template))) = methods.iter().find(|(k, _)| *k == key) else {
            errs.push(format!(
                "{}: {:?} calls {}, which the suite API does not have",
                c.place(),
                c.name,
                show(&key)
            ));
            continue;
        };
        called.insert(key.clone());
        for (i, ex) in c.exchanges.iter().enumerate() {
            if ex.expect.method != *verb || !matches_template(template, &ex.expect.path) {
                errs.push(format!(
                    "{}: {:?}: exchange {} expects {} {}, but {} is {verb} {template}",
                    c.place(),
                    c.name,
                    i + 1,
                    ex.expect.method,
                    ex.expect.path,
                    show(&key)
                ));
            }
        }
    }
    for (key, _) in &methods {
        if !called.contains(key) {
            errs.push(format!("no case calls {}", show(key)));
        }
    }
    if errs.is_empty() {
        Ok(())
    } else {
        Err(format!("the cases do not match the suite API:\n{}", errs.join("\n")))
    }
}

fn show((group, method): &(String, String)) -> String {
    if group.is_empty() {
        format!("client.{method}")
    } else {
        format!("client.{group}.{method}")
    }
}

/// Reports whether an escaped path fits a path template such as
/// `/orgs/{org_id}/projects`, where a parameter stands for one segment.
fn matches_template(template: &str, path: &str) -> bool {
    let (t, p): (Vec<_>, Vec<_>) = (template.split('/').collect(), path.split('/').collect());
    t.len() == p.len()
        && t.iter()
            .zip(&p)
            .all(|(t, p)| t == p || (t.starts_with('{') && t.ends_with('}') && !p.is_empty()))
}

/// Reads the cases a client is known to fail, a mapping from each case's
/// name to why it fails. Naming a case the suite does not have is an error,
/// so the list cannot outlive its cases.
fn expected_failures(path: &Path, cases: &[Case]) -> Result<Vec<(String, String)>, String> {
    let shown = path.file_name().unwrap().to_string_lossy();
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("{shown}: {err}")),
    };
    let node = value::parse(&text).map_err(|e| format!("{shown}: {e}"))?;
    if node.is_null() {
        return Ok(Vec::new());
    }
    let Kind::Map(entries) = &node.kind else {
        return Err(format!("{shown}: expected a mapping from case names to reasons"));
    };
    let mut out = Vec::new();
    for (key, value) in entries {
        let (Some(name), Some(reason)) = (key.scalar(), value.scalar()) else {
            return Err(format!("{shown}:{}: expected a case name and a reason", key.line));
        };
        if !cases.iter().any(|c| c.name == name) {
            return Err(format!("{shown}:{}: there is no case {name:?}", key.line));
        }
        out.push((name.to_owned(), reason.to_owned()));
    }
    Ok(out)
}
