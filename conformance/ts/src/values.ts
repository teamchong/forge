// The suite writes values that JSON cannot hold as tagged objects, such as
// {"$datetime": "2024-03-01T10:00:00Z"}. These functions convert them to
// and from the TypeScript types the SDK uses.

type Tagged = { [key: string]: unknown };

function isPlainObject(value: unknown): value is Tagged {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const tags: { readonly [tag: string]: (text: string) => unknown } = {
  $datetime: (text) => Temporal.Instant.from(text),
  $date: (text) => Temporal.PlainDate.from(text),
  $int64: (text) => BigInt(text),
  $bytes: (text) => new Uint8Array(Buffer.from(text, 'base64')),
};

/**
 * Returns value with every tagged value replaced by its TypeScript value.
 * Keys keep their order.
 */
export function untag(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(untag);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const keys = Object.keys(value);
  const [key] = keys;
  if (keys.length === 1 && key !== undefined && Object.hasOwn(tags, key)) {
    const decode = tags[key];
    const text = value[key];
    if (decode !== undefined && typeof text === 'string') {
      return decode(text);
    }
  }
  const out: Tagged = {};
  for (const key of keys) {
    Object.defineProperty(out, key, {
      value: untag(value[key]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * Returns value as JSON can hold it, with each value of a type JSON lacks
 * written as a tagged value. undefined is null, as the suite writes a
 * missing response.
 */
export function tag(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'bigint') {
    return { $int64: value.toString() };
  }
  if (value instanceof Temporal.Instant) {
    return { $datetime: value.toString() };
  }
  if (value instanceof Temporal.PlainDate) {
    return { $date: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return {
      $bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    };
  }
  if (Array.isArray(value)) {
    return value.map(tag);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Tagged = {};
  for (const key of Object.keys(value)) {
    // A missing member is left out rather than written as null.
    if (value[key] !== undefined) {
      Object.defineProperty(out, key, {
        value: tag(value[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return out;
}
