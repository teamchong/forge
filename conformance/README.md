# Conformance suite

Every SDK generator in forge has to turn the same API description into a
client that sends the same requests and gives callers the same results. The
conformance suite checks that for any generator, in any language: a runner
drives the generated client one call at a time and checks both ends of every
call.

```sh
cargo test --test conformance                              # every case
cargo test --test conformance -- 'errors/a declared error' # cases whose file/name contains it
```

It needs Node.js 24 or later on the `PATH`, or in `NODE`.

## Layout

| Path                       | Holds                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| `conformance/openapi.json` | the suite API                                                        |
| `conformance/cases/*.yaml` | the cases, one file per pattern                                      |
| `conformance/ts/`          | the TypeScript conformance client, and the cases it is known to fail |
| `tests/conformance/`       | the runner                                                           |

## A suite API covers every pattern

`openapi.json` is an API description written for the suite. It is small, and
every pattern an SDK has to handle appears in it at least once:

| Pattern       | The suite has                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| Groups        | a root method, nested groups, and a method and a subgroup with the same name                                     |
| Names         | kebab, snake and camel names, acronyms, and names with other characters                                          |
| Schemas       | every primitive, enums, arrays, maps, `nullable`, `allOf`, `oneOf`, `anyOf`, and models that refer to each other |
| Formats       | `date-time`, `date`, `byte`, `int64`                                                                             |
| Requests      | path and query parameters, an object body, an array body, and a body property with the name of a parameter       |
| Responses     | a response with no body, and two status codes with different bodies                                              |
| SDK variables | a path parameter with `x-fern-sdk-variable`                                                                      |
| Pagination    | a cursor, page numbers with a total, and offsets                                                                 |
| Errors        | a declared error for one status, one for a range such as `4XX`, an undeclared status, and no response            |

The runner checks that every method of the suite API has a case, and that
every case calls a method the API has, at its path.

## The runner owns the cases and the server

The runner is the `conformance` test of the crate. It generates an SDK from
the suite API with the `forge` command, then starts an HTTP server and the
conformance client. For each case, it sends the client a call to make and a
base URL on its server. The client makes the call with the generated SDK and
reports what it got back.

The runner is both ends of every call. As the server, it sees the requests
the SDK sends and chooses the responses. As the one who asked for the call,
it sees the result the SDK gave the caller. It checks both against the case.

The SDK is generated on every run into `conformance/ts/sdk/`, which git
ignores, so the suite always tests the generator as it is.

## A case is a call, its exchanges and its result

```yaml
- name: an object body is sent in wire names
  client: { orgId: o1 }
  call:
    group: projects
    method: create
    request: { displayName: Demo }
  exchanges:
    - expect:
        method: POST
        path: /orgs/o1/projects
        headers: { content-type: application/json }
        body: { display_name: Demo }
      respond:
        status: 201
        body: { id: p1, display_name: Demo, created_at: '2024-03-01T10:00:00Z' }
  result:
    response: { id: p1, displayName: Demo, createdAt: { $datetime: '2024-03-01T10:00:00Z' } }

- name: a declared error is decoded
  call:
    group: projects
    method: get
    request: { orgId: o1, projectId: missing }
  exchanges:
    - expect: { method: GET, path: /orgs/o1/projects/missing }
      respond:
        status: 404
        body: { error_code: not_found, message: No such project }
  result:
    error:
      kind: api
      status: 404
      message: No such project
      details: { errorCode: not_found, message: No such project }
```

| Key                   | Holds                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `name`                | what the case checks, unique in the suite                                                                                        |
| `client`              | the client options, besides the token and the base URL                                                                           |
| `call.group`          | the group's property path, such as `projects.members`; empty for the root                                                        |
| `call.method`         | the method's property name                                                                                                       |
| `call.request`        | the request, in field names                                                                                                      |
| `call.options`        | the request options: `headers`, an object of strings, and `query`, an object of strings or lists of strings                      |
| `call.iterate`        | iterate over every item instead of reading one response                                                                          |
| `exchanges[].expect`  | a request the server must receive: `method`, `path`, `query`, `headers` and `body`                                               |
| `exchanges[].respond` | its response: `status`, `headers`, and a JSON `body` or a `text` body; or `disconnect: true` to close the connection without one |
| `result`              | the `response` the caller must get, `null` for none, or the `error` it must see                                                  |

The server side of a case, `expect` and `respond`, is written in wire names.
The client side, `client`, `call` and `result`, is written in the field names
forge's naming rules give, in camelCase. A client for a language with other
conventions, such as snake_case, converts them the same way its generator
does.

An error has a `kind`: `api` for an error response, with its `status`,
`message` and `details`; `client` for a call the SDK refuses before sending a
request, such as one with a missing SDK variable, which has no exchanges; and
`network` for a request that got no response.

The runner rejects a case with an unknown key, a duplicate name, or a result
that could never pass, such as a `client` error with exchanges. It reports
every invalid case at once, but stops at the first error in a file it cannot
parse, such as one with an unknown key.

## The client makes the call and reports the result

The runner writes one case per line to the client's standard input:

```json
{
  "id": "an-object-body-is-sent-in-wire-names",
  "name": "an object body is sent in wire names",
  "baseUrl": "http://127.0.0.1:52100/an-object-body-is-sent-in-wire-names/",
  "token": "conformance-token",
  "client": { "orgId": "o1" },
  "call": {
    "group": "projects",
    "method": "create",
    "request": { "displayName": "Demo" },
    "options": {},
    "iterate": false
  },
  "exchanges": [{ "method": "POST", "path": "/orgs/o1/projects", "body": { "display_name": "Demo" } }],
  "result": { "response": { "id": "p1", "displayName": "Demo" } }
}
```

The client creates a client from `token`, `baseUrl` and the members of
`client`, finds the method by walking `group` and `method` from the root
client, and calls it with `request` and `options`. Objects keep the order the
case writes their keys in. It writes one result per line to its standard
output, with the id of the case:

```json
{ "id": "…", "response": { "id": "p1", "displayName": "Demo" } }
{ "id": "…", "response": [{ "id": "p1" }, { "id": "p2" }] }
{ "id": "…", "error": { "kind": "api", "status": 404, "message": "…", "details": {} } }
{ "id": "…", "error": { "kind": "client", "message": "…" } }
{ "id": "…", "error": { "kind": "network", "message": "…" } }
{ "id": "…", "error": { "kind": "unexpected", "message": "…" } }
```

The list is every item, when the case sets `iterate`. `unexpected` is for an
error that is none of the other kinds, a bug in the SDK or the client, and
always fails the case. Results may come in any order, so a client can run
cases at the same time; a case that fails in any way must not stop the
others. The client exits when its standard input closes.

The client knows nothing about the cases. Every case, however it is made,
goes through the same few lines of code. `exchanges` and `result` are there
for a client without an SDK, which the next section uses; a client that
calls an SDK ignores them.

## Values JSON cannot hold are tagged

Requests and results contain values that JSON has no type for. Both sides
write them as a one-key object, and each client maps them to its language's
types:

| Value           | Written as                                |
| --------------- | ----------------------------------------- |
| a `date-time`   | `{ "$datetime": "2024-03-01T10:00:00Z" }` |
| a `date`        | `{ "$date": "2024-03-01" }`               |
| an `int64`      | `{ "$int64": "9007199254740993" }`        |
| a `byte` string | `{ "$bytes": "aGVsbG8=" }`                |

## The runner checks both ends

The server gives each case its own base URL, `<server>/<id>/`, where the id
is the case's name in kebab case, so it knows which case every request
belongs to and every case runs at the same time. A request matches the next
exchange when:

- the method and the escaped path are equal;
- the query has the same keys and values in the same order;
- every header the case lists has the listed value, and others are not
  checked;
- the body is the same JSON value, or both have none.

The server answers with the exchange's response even when the request does
not match, so a case reports what went wrong on the wire and not the errors
that follow from it.

A result matches when it is the same JSON value as the case's result, with
numbers compared by value and tagged values by what they hold, so
`"2024-03-01T12:00:00+02:00"` and `"2024-03-01T10:00:00Z"` are the same
`$datetime`. Of an error, only the members the case lists are compared.

A case fails when a request does not match the next exchange, when a request
arrives after the last one or after the case finished, when an exchange never
arrives, when the client reports no result within 30 seconds, or when the
result differs from `result`. The failure shows the case's file, line and
name, and a diff of what was expected and what happened. A request for no
case, or a result for no waiting case, fails the run.

Before the generated client, the runner runs every case with a pass-through
client, which sends each case's `exchanges` as they are written and reports
its `result`. It passes when the runner and the cases agree, so a broken case
or runner fails the run there, before it can be taken for a broken generator.

## Known failures are listed with a reason

A generator that does not handle a pattern yet lists the cases it fails in
its client's `expected-failures.yaml`, each with why:

```yaml
a cursor is followed until it is null: the generator does not paginate
```

A listed case that fails is reported with its reason and does not fail the
run. A listed case that passes fails it, and so does a name that is no case,
so the list only shrinks as the generator catches up, and a renamed case
cannot hide behind it.

## Why a conformance suite?

A case is data, so a new behaviour is tested by adding a few lines of YAML,
in no particular language. Each case passes or fails on its own and says
which pattern broke. Because the runner is both the server and the caller,
one case checks the request the SDK sends and the value it returns, on the
success path and the error path alike.

## Why JSON lines over standard input and output?

Any language can read and write them, and the client needs no server or port
of its own. A new generator, such as a WebAssembly plugin, reuses the suite
API, the cases and the runner, and only writes its own client.
