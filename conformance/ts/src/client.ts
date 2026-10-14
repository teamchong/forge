// The TypeScript conformance client. tests/conformance loads the cases of
// conformance/cases, serves the responses they expect, and writes one case
// per line to this client's standard input. The client makes each case's
// call with the SDK that forge generated into ../sdk and writes its result
// as a line to standard output. The protocol is in conformance/README.md.

import { createInterface } from 'node:readline';

import { ApiError, createClient } from '../sdk/index.js';
import { tag, untag } from './values.js';

/**
 * A case, as the runner sends it. exchanges and result are left out: a
 * client that calls an SDK does not read them.
 */
interface Case {
  id: string;
  name: string;
  baseUrl: string;
  token: string;
  client: Fields;
  call: {
    group: string;
    method: string;
    request: Fields;
    options: Fields;
    iterate: boolean;
  };
}

type Fields = { [key: string]: unknown };

/**
 * The kind of an error: the three the suite names, and "unexpected" for an
 * error that is none of them, which fails whatever case it is reported for.
 */
type Kind = 'api' | 'client' | 'network' | 'unexpected';

type Result =
  | { id: string; response: unknown }
  | {
      id: string;
      error: { kind: Kind; status?: number; message: string; details?: unknown };
    };

/**
 * An error that fetch threw: the request was sent, or tried, and got no
 * response.
 */
class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'NetworkError';
  }
}

/**
 * Returns the headers of the client or call options of a case, an object of
 * strings, as the SDK takes them.
 */
function headers(value: unknown): Headers | undefined {
  if (value === undefined) {
    return undefined;
  }
  const out = new Headers();
  for (const [key, item] of Object.entries(value as Fields)) {
    out.append(key, String(item));
  }
  return out;
}

/**
 * Returns the query of the client or call options of a case, an object of
 * strings or arrays of strings, in the order the case writes it.
 */
function query(value: unknown): URLSearchParams | undefined {
  if (value === undefined) {
    return undefined;
  }
  const out = new URLSearchParams();
  for (const [key, item] of Object.entries(value as Fields)) {
    for (const each of Array.isArray(item) ? item : [item]) {
      out.append(key, String(each));
    }
  }
  return out;
}

/**
 * Returns options with its headers and query converted, and every other
 * member untagged.
 */
function options(value: Fields): Fields {
  const out: Fields = {};
  for (const [key, item] of Object.entries(value)) {
    switch (key) {
      case 'headers':
        out[key] = headers(item);
        break;
      case 'query':
        out[key] = query(item);
        break;
      default:
        out[key] = untag(item);
    }
  }
  return out;
}

/**
 * Returns the method of a case: call.method on the client at call.group, a
 * dotted path that is empty for the root.
 */
function method(root: unknown, c: Case): (request: unknown, opts: unknown) => unknown {
  let target = root as Fields;
  let path = 'client';
  for (const name of c.call.group === '' ? [] : c.call.group.split('.')) {
    path += `.${name}`;
    const next = target[name];
    if ((typeof next !== 'object' && typeof next !== 'function') || next === null) {
      throw new ConformanceError(`${path} is not a group`);
    }
    target = next as Fields;
  }
  path += `.${c.call.method}`;
  const fn = target[c.call.method];
  if (typeof fn !== 'function') {
    throw new ConformanceError(`${path} is not a method`);
  }
  return (request, opts) => fn.call(target, request, opts);
}

/**
 * An error in the case or the client rather than the SDK.
 */
class ConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConformanceError';
  }
}

/** Below the runner's 30 second case timeout. */
const FETCH_TIMEOUT_MS = 20_000;

async function run(c: Case): Promise<Result> {
  // Whether the SDK called fetch, which tells a TypeError thrown before a
  // request from one thrown after it.
  let sent = false;
  const fetcher: typeof fetch = async (input, init) => {
    sent = true;
    try {
      // Gives up before the runner's case timeout, so a hung request is
      // reported as a network error rather than a missing result.
      const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return await fetch(input, { ...init, signal });
    } catch (error) {
      throw new NetworkError(error);
    }
  };
  try {
    const client = createClient({
      ...options(c.client),
      token: c.token,
      baseUrl: c.baseUrl,
      fetch: fetcher,
    });
    const call = method(client, c);
    const request = untag(c.call.request);
    const opts = options(c.call.options);
    if (c.call.iterate) {
      const items: unknown[] = [];
      const pages = call(request, opts);
      if (typeof pages !== 'object' || pages === null || !(Symbol.asyncIterator in pages)) {
        // A method that sent a request anyway must not reject later with
        // nothing to catch it, which would end the client and every case.
        void Promise.resolve(pages).catch(() => {});
        const name = ['client', c.call.group, c.call.method].filter((part) => part !== '').join('.');
        throw new ConformanceError(`${name} does not return an async iterable`);
      }
      for await (const item of pages as AsyncIterable<unknown>) {
        items.push(item);
      }
      return { id: c.id, response: tag(items) };
    }
    return { id: c.id, response: tag(await call(request, opts)) };
  } catch (error) {
    return { id: c.id, error: classify(error, sent) };
  }
}

function classify(error: unknown, sent: boolean): Extract<Result, { error: unknown }>['error'] {
  if (error instanceof ApiError) {
    return {
      kind: 'api',
      status: error.status,
      message: error.message,
      details: tag(error.details),
    };
  }
  if (error instanceof NetworkError) {
    return { kind: 'network', message: error.message };
  }
  if (error instanceof TypeError && !sent) {
    return { kind: 'client', message: error.message };
  }
  // Anything else is a bug in the SDK or this client. It is reported so the
  // case fails with it, and its stack is written to standard error.
  console.error(error);
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { kind: 'unexpected', message };
}

function write(result: Result): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

// Cases run concurrently, and each result is written when it is ready. The
// client exits when its standard input closes and every case has finished.
const running = new Set<Promise<void>>();
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (line.trim() === '') {
    continue;
  }
  let c: Case;
  try {
    c = JSON.parse(line) as Case;
  } catch (error) {
    console.error(`the runner wrote a line that is not JSON: ${line}`, error);
    process.exitCode = 1;
    continue;
  }
  const done: Promise<void> = run(c).then(write, (error: unknown) => {
    write({ id: c.id, error: { kind: 'unexpected', message: String(error) } });
  });
  running.add(done);
  void done.finally(() => running.delete(done));
}
await Promise.all(running);
