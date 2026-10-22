// Progressive Type-Feedback MCP runtime for Forge-generated TypeScript SDKs.

export type ScalarKind =
  | 'unknown'
  | 'null'
  | 'boolean'
  | 'string'
  | 'number'
  | 'bigint'
  | 'Temporal.Instant'
  | 'Temporal.PlainDate'
  | 'Uint8Array';

export type TypeSchema =
  | { readonly kind: 'scalar'; readonly scalar: ScalarKind }
  | { readonly kind: 'enum'; readonly values: readonly (string | number | boolean)[] }
  | {
      readonly kind: 'array';
      readonly elem: TypeSchema;
      readonly minItems?: number | undefined;
      readonly maxItems?: number | undefined;
    }
  | {
      readonly kind: 'object';
      readonly fields: readonly FieldSchema[];
      readonly extra?: TypeSchema | undefined;
    }
  | {
      readonly kind: 'union';
      readonly members: readonly TypeSchema[];
      readonly discriminator?: string | undefined;
    }
  | { readonly kind: 'intersection'; readonly members: readonly TypeSchema[] }
  | { readonly kind: 'model'; readonly model: string };

export interface FieldSchema {
  readonly name: string;
  readonly wireName: string;
  readonly required: boolean;
  readonly readonly?: boolean | undefined;
  readonly deprecated?: boolean | undefined;
  readonly location?: 'path' | 'query' | undefined;
  readonly description?: string | undefined;
  readonly type: TypeSchema;
}

export interface RequestBodySchema {
  readonly required: boolean;
  readonly description?: string | undefined;
  readonly type: TypeSchema;
}

export interface MethodSchema {
  readonly name: string;
  readonly path: string;
  readonly httpMethod: string;
  readonly route: string;
  readonly summary?: string | undefined;
  readonly description?: string | undefined;
  readonly deprecated?: boolean | undefined;
  readonly requestTypeName?: string | undefined;
  readonly requestOptional?: boolean | undefined;
  readonly requestFlat?: boolean | undefined;
  readonly requestParams: readonly FieldSchema[];
  readonly requestBody?: RequestBodySchema | undefined;
  readonly responseTypeName: string;
  readonly responseType?: TypeSchema | undefined;
  readonly responseOptional?: boolean | undefined;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}

export interface GroupSchema {
  readonly name: string;
  readonly path: string;
  readonly description?: string | undefined;
  readonly children: readonly string[];
  readonly methods: readonly MethodSchema[];
  readonly models: readonly string[];
}

export interface ModelSchema {
  readonly name: string;
  readonly path: string;
  readonly schemaName: string;
  readonly description?: string | undefined;
  readonly deprecated?: boolean | undefined;
  readonly type: TypeSchema;
}

export interface ApiSchema {
  readonly version: string;
  readonly description?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly rootChildren: readonly string[];
  readonly rootModels: readonly string[];
  readonly groups: Readonly<Record<string, GroupSchema>>;
  readonly models: Readonly<Record<string, ModelSchema>>;
}

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly symbol?: string | undefined;
}

/**
 * Thrown when agent code accesses a non-existent SDK symbol or passes arguments
 * that violate the OpenAPI/TypeScript types. Includes compiler-style diagnostics
 * and progressive 1-level `.d.ts` type definitions for immediate self-correction.
 */
export class TypeFeedbackError extends Error {
  readonly issues: readonly ValidationIssue[];
  readonly typeDefinition: string;

  constructor(issues: readonly ValidationIssue[], typeDefinition: string) {
    const summary = issues.map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`).join('\n');
    super(`${summary}\n\n--- TypeScript Definition (.d.ts) ---\n${typeDefinition}`);
    this.name = 'TypeFeedbackError';
    this.issues = issues;
    this.typeDefinition = typeDefinition;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (
    ArrayBuffer.isView(value) ||
    value instanceof Date ||
    ('epochNanoseconds' in value && typeof value.epochNanoseconds === 'bigint') ||
    ('year' in value &&
      typeof value.year === 'number' &&
      'month' in value &&
      typeof value.month === 'number' &&
      'day' in value &&
      typeof value.day === 'number')
  ) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return (
    proto === Object.prototype ||
    proto === null ||
    (typeof proto === 'object' && Object.getPrototypeOf(proto) === null)
  );
}

function firstSummaryLine(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const first = text.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (first === '') {
    return undefined;
  }
  return first.length > 120 ? `${first.slice(0, 117)}...` : first;
}

function formatJsDoc(description: string | undefined, deprecated: boolean | undefined, indent: string): string {
  const text = description?.trim() ?? '';
  if (text === '' && !deprecated) {
    return '';
  }
  const lines: string[] = [];
  if (text !== '') {
    for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
      lines.push(rawLine.trimEnd());
    }
  }
  if (deprecated) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`${'@'}deprecated`);
  }
  if (lines.length === 1 && !lines[0]!.includes('*/')) {
    return `${indent}/** ${lines[0]} */\n`;
  }
  const body = lines
    .map((line) => {
      const escaped = line.replace(/\*\//g, '*\\/');
      return escaped === '' ? `${indent} *` : `${indent} * ${escaped}`;
    })
    .join('\n');
  return `${indent}/**\n${body}\n${indent} */\n`;
}

function formatLiteral(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
  }
  return String(value);
}

function formatPropertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : formatLiteral(name);
}

function isLeafType(schema: ApiSchema | undefined, type: TypeSchema, seen = new Set<string>()): boolean {
  switch (type.kind) {
    case 'scalar':
    case 'enum':
      return true;
    case 'array':
      return isLeafType(schema, type.elem, seen);
    case 'model': {
      if (!schema || seen.has(type.model)) {
        return false;
      }
      const model = schema.models[type.model];
      if (!model) {
        return false;
      }
      seen.add(type.model);
      return isLeafType(schema, model.type, seen);
    }
    case 'union':
      return (
        type.members.length > 0 &&
        type.members.length <= 6 &&
        type.members.every((m) => isLeafType(schema, m, new Set(seen)))
      );
    case 'object':
    case 'intersection':
      return false;
  }
}

function collectReferencedModels(schema: ApiSchema, type: TypeSchema | undefined, out: Set<string>): void {
  if (!type) {
    return;
  }
  switch (type.kind) {
    case 'model':
      if (!isLeafType(schema, type)) {
        out.add(type.model);
      }
      break;
    case 'array':
      collectReferencedModels(schema, type.elem, out);
      break;
    case 'object':
      for (const field of type.fields) {
        collectReferencedModels(schema, field.type, out);
      }
      collectReferencedModels(schema, type.extra, out);
      break;
    case 'union':
    case 'intersection':
      for (const member of type.members) {
        collectReferencedModels(schema, member, out);
      }
      break;
    case 'scalar':
    case 'enum':
      break;
  }
}

function formatTypeExpr(
  type: TypeSchema,
  prec: 'top' | 'union' | 'intersection' | 'postfix' = 'top',
  schema?: ApiSchema,
  seen = new Set<string>(),
): string {
  switch (type.kind) {
    case 'scalar':
      return type.scalar;
    case 'model': {
      if (schema && !seen.has(type.model)) {
        const model = schema.models[type.model];
        if (model && isLeafType(schema, model.type)) {
          const nextSeen = new Set(seen);
          nextSeen.add(type.model);
          return formatTypeExpr(model.type, prec, schema, nextSeen);
        }
      }
      return type.model;
    }
    case 'enum': {
      if (type.values.length === 0) {
        return 'never';
      }
      const joined = type.values.map(formatLiteral).join(' | ');
      return type.values.length > 1 && (prec === 'intersection' || prec === 'postfix') ? `(${joined})` : joined;
    }
    case 'array':
      return `${formatTypeExpr(type.elem, 'postfix', schema, seen)}[]`;
    case 'object': {
      const parts: string[] = [];
      for (const field of type.fields) {
        if (field.readonly) {
          continue;
        }
        const opt = field.required ? '' : '?';
        parts.push(`${formatPropertyKey(field.name)}${opt}: ${formatTypeExpr(field.type, 'top', schema, seen)}`);
      }
      if (type.extra) {
        parts.push(
          `[key: string]: ${formatTypeExpr(type.extra, 'top', schema, seen) === 'unknown' ? 'unknown' : 'unknown'}`,
        );
      }
      if (parts.length === 0) {
        return 'Record<string, never>';
      }
      return `{ ${parts.join('; ')} }`;
    }
    case 'union': {
      if (type.members.length === 0) {
        return 'never';
      }
      const joined = type.members.map((m) => formatTypeExpr(m, 'union', schema, seen)).join(' | ');
      return type.members.length > 1 && (prec === 'intersection' || prec === 'postfix') ? `(${joined})` : joined;
    }
    case 'intersection': {
      if (type.members.length === 0) {
        return 'unknown';
      }
      const joined = type.members.map((m) => formatTypeExpr(m, 'intersection', schema, seen)).join(' & ');
      return type.members.length > 1 && prec === 'postfix' ? `(${joined})` : joined;
    }
  }
}

function renderFieldsBlock(
  schema: ApiSchema,
  fields: readonly FieldSchema[],
  extra: TypeSchema | undefined,
  indent: string,
  includeReadonly: boolean,
): string {
  const lines: string[] = [];
  let hasKeptField = false;
  for (const field of fields) {
    if (!includeReadonly && field.readonly) {
      continue;
    }
    hasKeptField = true;
    const desc = fields.length > 8 ? firstSummaryLine(field.description) : field.description;
    const doc = formatJsDoc(desc, field.deprecated, indent);
    const ro = field.readonly ? 'readonly ' : '';
    const opt = field.required ? '' : '?';
    const locComment = field.location ? ` // ${field.location} param` : '';
    lines.push(
      `${doc}${indent}${ro}${formatPropertyKey(field.name)}${opt}: ${formatTypeExpr(field.type, 'top', schema)};${locComment}`,
    );
  }
  if (extra) {
    const keyType = hasKeptField ? 'unknown' : formatTypeExpr(extra, 'top', schema);
    lines.push(`${indent}[key: string]: ${keyType};`);
  }
  return lines.join('\n');
}

function renderMethodSignature(method: MethodSchema, indent = '  ', brief = false): string {
  const parts = [method.summary, method.description]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .filter((s, idx, arr) => idx === 0 || s !== arr[0]);
  const docText = brief ? firstSummaryLine(method.summary ?? method.description) : parts.join('\n\n');
  const doc = formatJsDoc(docText, method.deprecated, indent);
  const reqParam = method.requestTypeName
    ? `request${method.requestOptional ? '?' : ''}: ${method.requestTypeName}, options?: RequestOptions`
    : 'options?: RequestOptions';
  return `${doc}${indent}${formatPropertyKey(method.name)}(${reqParam}): Promise<${method.responseTypeName}>; // ${method.httpMethod} ${method.route}`;
}

function renderRequestDeclaration(schema: ApiSchema, method: MethodSchema): string | undefined {
  const name = method.requestTypeName;
  if (!name) {
    return undefined;
  }
  const params = method.requestParams;
  const body = method.requestBody;
  if (!body) {
    const block = renderFieldsBlock(schema, params, undefined, '  ', false);
    return block === '' ? `export type ${name} = Record<string, never>;` : `export interface ${name} {\n${block}\n}`;
  }
  if (method.requestFlat) {
    const flatObj = resolveFlatObjectType(schema, body.type, new Set(), true);
    if (flatObj) {
      const byName = new Map<string, FieldSchema>();
      for (const p of params) {
        byName.set(p.name, p);
      }
      for (const f of flatObj.fields) {
        if (!f.readonly && f.required && !byName.has(f.name)) {
          byName.set(f.name, f);
        }
      }
      for (const f of flatObj.fields) {
        if (!f.readonly && !f.required && !byName.has(f.name)) {
          byName.set(f.name, f);
        }
      }
      const block = renderFieldsBlock(schema, Array.from(byName.values()), flatObj.extra, '  ', false);
      return block === '' ? `export type ${name} = Record<string, never>;` : `export interface ${name} {\n${block}\n}`;
    }
    if (params.length === 0) {
      return `export type ${name} = ${formatTypeExpr(body.type, 'top', schema)};`;
    }
    const paramsBlock = renderFieldsBlock(schema, params, undefined, '  ', false);
    return `export type ${name} = {\n${paramsBlock}\n} & ${formatTypeExpr(body.type, 'intersection', schema)};`;
  }
  const bodyField: FieldSchema = {
    name: 'body',
    wireName: 'body',
    required: body.required,
    description: body.description,
    type: body.type,
  };
  const block = renderFieldsBlock(schema, [...params, bodyField], undefined, '  ', false);
  return `export interface ${name} {\n${block}\n}`;
}

function renderResponseDeclaration(schema: ApiSchema, method: MethodSchema): string {
  const name = method.responseTypeName;
  if (!method.responseType) {
    return `export type ${name} = void;`;
  }
  if (method.responseType.kind === 'object' && !method.responseOptional && method.responseType.fields.length > 0) {
    const block = renderFieldsBlock(schema, method.responseType.fields, method.responseType.extra, '  ', true);
    return `export interface ${name} {\n${block}\n}`;
  }
  const expr = formatTypeExpr(method.responseType, 'top', schema);
  return method.responseOptional ? `export type ${name} = (${expr}) | undefined;` : `export type ${name} = ${expr};`;
}

function renderModelDeclaration(schema: ApiSchema, model: ModelSchema): string {
  const doc = formatJsDoc(model.description, model.deprecated, '');
  const flatObj = resolveFlatObjectType(schema, model.type, new Set(), true);
  if (flatObj && flatObj.fields.length > 0) {
    const block = renderFieldsBlock(schema, flatObj.fields, flatObj.extra, '  ', true);
    return `${doc}export interface ${model.name} {\n${block}\n}`;
  }
  return `${doc}export type ${model.name} = ${formatTypeExpr(model.type, 'top', schema)};`;
}

function countGroupMethods(schema: ApiSchema, groupPath: string): number {
  const group = schema.groups[groupPath];
  if (!group) {
    return 0;
  }
  let total = group.methods.length;
  for (const child of group.children) {
    total += countGroupMethods(schema, `${groupPath}.${child}`);
  }
  return total;
}

function editDistance(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) {
    return 0;
  }
  const prev = Array.from({ length: bl.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: bl.length + 1 }, () => 0);
  for (let i = 1; i <= al.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl.length; j++) {
      const cost = al[i - 1] === bl[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= bl.length; j++) {
      prev[j] = curr[j]!;
    }
  }
  return prev[bl.length]!;
}

function findSuggestions(schema: ApiSchema, query: string, limit = 5): string[] {
  const lastDot = query.lastIndexOf('.');
  const parentPath = lastDot !== -1 ? query.slice(0, lastDot) : '';
  const parentGroup = parentPath ? schema.groups[parentPath] : undefined;

  const candidates: string[] = [];
  if (parentGroup) {
    for (const child of parentGroup.children) {
      candidates.push(`${parentGroup.path}.${child}`);
    }
    for (const method of parentGroup.methods) {
      candidates.push(method.path);
      if (method.requestTypeName) {
        candidates.push(`${parentGroup.path}.${method.requestTypeName}`);
      }
      candidates.push(`${parentGroup.path}.${method.responseTypeName}`);
    }
    for (const modelName of parentGroup.models) {
      candidates.push(`${parentGroup.path}.${modelName}`);
    }
  } else {
    for (const group of Object.values(schema.groups)) {
      candidates.push(group.path);
      for (const method of group.methods) {
        candidates.push(method.path);
        if (method.requestTypeName) {
          candidates.push(`${group.path}.${method.requestTypeName}`);
        }
        candidates.push(`${group.path}.${method.responseTypeName}`);
      }
    }
    for (const model of Object.values(schema.models)) {
      candidates.push(model.path);
    }
  }

  const ql = query.toLowerCase();
  const hasDot = query.includes('.');
  return candidates
    .map((candidate) => {
      const cl = candidate.toLowerCase();
      if (cl.endsWith(`.${ql}`)) {
        return { candidate, score: 0.1 };
      }
      const short = candidate.split('.').pop() ?? candidate;
      const queryShort = query.split('.').pop() ?? query;
      const fullDist = editDistance(query, candidate);
      const score =
        !hasDot || parentGroup !== undefined ? Math.min(fullDist, editDistance(queryShort, short) + 0.5) : fullDist;
      return { candidate, score };
    })
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((item) => item.candidate);
}

function normalizeRoutePattern(route: string): string {
  return route
    .trim()
    .replace(/\{[^}]+\}/g, '{}')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function matchByHttpRoute(schema: ApiSchema, rawQuery: string): string | undefined {
  const routeMatch = rawQuery
    .trim()
    .match(/^(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/[A-Za-z0-9._~:/?#[\]@!$&'*+,;=%{}-]+)$/i);
  if (!routeMatch?.[2]) {
    return undefined;
  }
  const queryHttpVerb = routeMatch[1]?.toUpperCase();
  const queryNormRoute = normalizeRoutePattern(routeMatch[2]);
  const exactMatches: MethodSchema[] = [];
  for (const group of Object.values(schema.groups)) {
    for (const method of group.methods) {
      if (normalizeRoutePattern(method.route) !== queryNormRoute) {
        continue;
      }
      if (queryHttpVerb && method.httpMethod.toUpperCase() !== queryHttpVerb) {
        continue;
      }
      exactMatches.push(method);
    }
  }
  if (exactMatches.length === 0) {
    return undefined;
  }
  if (exactMatches.length === 1 && exactMatches[0]) {
    return resolveSymbolDts(schema, exactMatches[0].path);
  }
  return renderMethodListDts(exactMatches, `Route '${rawQuery.trim()}'`);
}

function renderMethodListDts(methods: readonly MethodSchema[], label: string): string {
  const lines: string[] = [
    `// ${label} (${methods.length} matching methods - call dts("<methodPath>") for full request/response .d.ts):`,
  ];
  const byGroup = new Map<string, MethodSchema[]>();
  for (const method of methods.slice(0, 25)) {
    const dot = method.path.lastIndexOf('.');
    const gPath = dot !== -1 ? method.path.slice(0, dot) : '';
    const list = byGroup.get(gPath) ?? [];
    list.push(method);
    byGroup.set(gPath, list);
  }
  for (const [gPath, groupMethods] of byGroup.entries()) {
    lines.push(`\n// Group: client.${gPath}`);
    lines.push(`export namespace ${gPath} {`);
    lines.push('  export interface Client {');
    for (const method of groupMethods) {
      lines.push(renderMethodSignature(method, '    ', true));
    }
    lines.push('  }');
    lines.push('}');
  }
  if (methods.length > 25) {
    lines.push(`\n// ... +${methods.length - 25} more matching methods`);
  }
  return lines.join('\n');
}

export interface SearchMethodEntry {
  readonly path: string;
  readonly group: string;
  readonly name: string;
  readonly httpMethod: string;
  readonly route: string;
  readonly summary?: string | undefined;
  readonly description?: string | undefined;
}

const METHODS_CACHE = new WeakMap<ApiSchema, readonly SearchMethodEntry[]>();

function getAllMethods(schema: ApiSchema): readonly SearchMethodEntry[] {
  let cached = METHODS_CACHE.get(schema);
  if (cached) {
    return cached;
  }
  const all: SearchMethodEntry[] = [];
  for (const group of Object.values(schema.groups)) {
    for (const method of group.methods) {
      all.push({
        path: method.path,
        group: group.path,
        name: method.name,
        httpMethod: method.httpMethod,
        route: method.route,
        ...(method.summary !== undefined ? { summary: method.summary } : {}),
        ...(method.description !== undefined ? { description: method.description } : {}),
      });
    }
  }
  cached = Object.freeze(all);
  METHODS_CACHE.set(schema, cached);
  return cached;
}

function extractSymbolFromItem(schema: ApiSchema, item: unknown): string | undefined {
  if (typeof item === 'string') {
    return resolveSymbolDts(schema, item) !== undefined ? item : undefined;
  }
  const symPath = getSymbolPath(item);
  if (symPath !== undefined) {
    return symPath;
  }
  if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string') {
    if (resolveSymbolDts(schema, item[0]) !== undefined) {
      return item[0];
    }
    return extractSymbolFromItem(schema, item[1]);
  }
  if (typeof item === 'object' && item !== null && 'path' in item) {
    const p = (item as { readonly path: unknown }).path;
    if (typeof p === 'string' && resolveSymbolDts(schema, p) !== undefined) {
      return p;
    }
  }
  return undefined;
}

function formatSearchEvalResult(schema: ApiSchema, value: unknown): string {
  if (value === undefined || value === null) {
    return '// 0 matches. Tip: filter `methods` (each has `{ path, group, name, httpMethod, route, summary, description }`), inspect `Object.keys(groups)`, or call `dts("<symbol>")`.';
  }
  if (typeof value === 'string') {
    return resolveSymbolDts(schema, value) ?? value;
  }
  const singleSym = extractSymbolFromItem(schema, value);
  if (singleSym !== undefined) {
    return resolveSymbolDts(schema, singleSym) ?? JSON.stringify(value, null, 2);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '// 0 matches. Tip: filter `methods` (each has `{ path, group, name, httpMethod, route, summary, description }`), inspect `Object.keys(groups)`, or call `dts("<symbol>")`.';
    }
    if (value.every((item) => typeof item === 'string')) {
      const strItems = value as readonly string[];
      if (strItems.every((s) => s.includes('export ') || s.startsWith('// '))) {
        return strItems.join('\n\n');
      }
    }
    const symbols = value.map((item) => extractSymbolFromItem(schema, item));
    if (symbols.every((s): s is string => s !== undefined)) {
      if (symbols.length === 1) {
        return resolveSymbolDts(schema, symbols[0]!)!;
      }
      const allMethodsByPath = new Map<string, MethodSchema>();
      for (const g of Object.values(schema.groups)) {
        for (const m of g.methods) {
          allMethodsByPath.set(m.path, m);
        }
      }
      if (symbols.every((s) => allMethodsByPath.has(s))) {
        return renderMethodListDts(
          symbols.map((s) => allMethodsByPath.get(s)!),
          'Search result',
        );
      }
      const preview = symbols
        .slice(0, 25)
        .map((s) => {
          const g = schema.groups[s];
          if (g) {
            return `  readonly ${formatPropertyKey(g.path)}: ${g.path}.Client; // ${countGroupMethods(schema, g.path)} methods`;
          }
          return `  // ${s}`;
        })
        .join('\n');
      const more = symbols.length > 25 ? `\n  // ... +${symbols.length - 25} more` : '';
      return `// ${symbols.length} matching symbols - call dts("<symbol>") to inspect:\nexport interface SearchMatches {\n${preview}${more}\n}`;
    }
    return JSON.stringify(value, null, 2);
  }
  if (isPlainRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.length <= 10) {
      return entries
        .map(([k, v]) => `// === ${k} ===\n${formatSearchEvalResult(schema, v)}`)
        .join('\n\n');
    }
  }
  return JSON.stringify(value, null, 2);
}

function createSearchSymbolProxy(path = ''): unknown {
  const target = () => undefined;
  Object.defineProperty(target, SYMBOL_PATH, { value: path || 'client' });
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === SYMBOL_PATH) {
        return path || 'client';
      }
      if (typeof prop === 'symbol') {
        return undefined;
      }
      return createSearchSymbolProxy(path ? `${path}.${prop}` : prop);
    },
  });
}

function cleanSymbolPath(schema: ApiSchema, rawSymbol?: string): string {
  const cleaned = (rawSymbol ?? '')
    .trim()
    .replace(/;+$/, '')
    .replace(/^await\s+/, '')
    .replace(/^return\s+/, '')
    .replace(/^dts\s*\(\s*([^()]*?)\s*\)$/, '$1')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^client\./, '')
    .replace(/\.Client$/, '')
    .replace(/^([A-Za-z0-9_.$]+)\([^()]*\)$/, '$1')
    .trim();
  const camelized = cleaned
    .split('.')
    .map((seg) => seg.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()))
    .join('.');
  return (
    !schema.groups[cleaned] &&
    !schema.models[cleaned] &&
    (schema.groups[camelized] !== undefined ||
      schema.models[camelized] !== undefined ||
      (camelized.includes('.') &&
        schema.groups[camelized.slice(0, camelized.lastIndexOf('.'))] !== undefined))
      ? camelized
      : cleaned
  );
}

const FILTERED_SCHEMA_CACHE = new WeakMap<
  (method: MethodSchema) => boolean,
  WeakMap<ApiSchema, ApiSchema>
>();

/**
 * Returns a view of `schema` containing only methods where `include(method)` returns `true`,
 * pruning groups that have no remaining methods in their subtree.
 */
export function filterSchema(
  schema: ApiSchema,
  include?: ((method: MethodSchema) => boolean) | undefined,
): ApiSchema {
  if (!include) {
    return schema;
  }
  let bySchema = FILTERED_SCHEMA_CACHE.get(include);
  if (!bySchema) {
    bySchema = new WeakMap<ApiSchema, ApiSchema>();
    FILTERED_SCHEMA_CACHE.set(include, bySchema);
  }
  const cached = bySchema.get(schema);
  if (cached) {
    return cached;
  }

  const filteredMethods = new Map<string, readonly MethodSchema[]>();
  for (const [path, group] of Object.entries(schema.groups)) {
    filteredMethods.set(path, group.methods.filter(include));
  }

  const hasSubtreeMethods = new Map<string, boolean>();
  const checkSubtree = (path: string): boolean => {
    const existing = hasSubtreeMethods.get(path);
    if (existing !== undefined) {
      return existing;
    }
    const group = schema.groups[path];
    if (!group) {
      hasSubtreeMethods.set(path, false);
      return false;
    }
    let keep = (filteredMethods.get(path)?.length ?? 0) > 0;
    for (const childName of group.children) {
      if (checkSubtree(`${path}.${childName}`)) {
        keep = true;
      }
    }
    hasSubtreeMethods.set(path, keep);
    return keep;
  };

  for (const path of Object.keys(schema.groups)) {
    checkSubtree(path);
  }

  const groups: Record<string, GroupSchema> = {};
  for (const [path, group] of Object.entries(schema.groups)) {
    if (!hasSubtreeMethods.get(path)) {
      continue;
    }
    groups[path] = {
      ...group,
      children: group.children.filter((childName) => hasSubtreeMethods.get(`${path}.${childName}`)),
      methods: filteredMethods.get(path) ?? [],
    };
  }

  const filtered: ApiSchema = {
    ...schema,
    rootChildren: schema.rootChildren.filter((name) => hasSubtreeMethods.get(name)),
    groups,
  };
  bySchema.set(schema, filtered);
  return filtered;
}

/**
 * Renders a progressive 1-level `.d.ts` TypeScript & JSDoc definition for an SDK symbol,
 * method/group/model object, or array of matches.
 */
export function dts(
  schema: ApiSchema,
  target?: unknown,
  options?: SearchOptions | undefined,
): string {
  const activeSchema = filterSchema(schema, options?.include);
  if (typeof target === 'string' || target === undefined || target === null) {
    const rawSymbol = typeof target === 'string' ? target : '';
    const resolved = resolveSymbolDts(activeSchema, rawSymbol);
    if (resolved !== undefined) {
      return resolved;
    }
    return renderUnknownSymbolDiagnostic(activeSchema, rawSymbol);
  }
  return formatSearchEvalResult(activeSchema, target);
}

function resolveSymbolDts(schema: ApiSchema, rawSymbol?: string): string | undefined {
  const trimmed = cleanSymbolPath(schema, rawSymbol);

  // 1. Root Client view
  if (trimmed === '' || trimmed === 'Client') {
    const lines: string[] = [];
    const totalGroups = Object.keys(schema.groups).length;
    const totalMethods = Object.values(schema.groups).reduce((sum, g) => sum + g.methods.length, 0);
    const totalModels = Object.keys(schema.models).length;
    lines.push(
      `// API Version: ${schema.version}${schema.baseUrl ? ` | Base URL: ${schema.baseUrl}` : ''}`,
    );
    lines.push(`// ${totalGroups} groups, ${totalMethods} methods, ${totalModels} models`);
    lines.push(
      '// Tip: call dts("<group>") or filter `methods` in search({ code }) to drill down 1 level at a time.',
    );
    const rootSummary = firstSummaryLine(schema.description);
    if (rootSummary) {
      lines.push(formatJsDoc(rootSummary, false, '').trimEnd());
    }
    lines.push('export interface Client {');
    for (const childName of schema.rootChildren) {
      const childGroup = schema.groups[childName];
      if (!childGroup) {
        continue;
      }
      const methodCount = countGroupMethods(schema, childName);
      const childList =
        childGroup.children.length > 4
          ? `${childGroup.children.slice(0, 4).join(', ')}, +${childGroup.children.length - 4}`
          : childGroup.children.join(', ');
      const subSummary = childGroup.children.length > 0 ? `${childList} (${methodCount}m)` : `${methodCount}m`;
      lines.push(`  readonly ${formatPropertyKey(childName)}: ${childName}.Client; // ${subSummary}`);
    }
    lines.push('}');
    if (schema.rootModels.length > 0) {
      const preview =
        schema.rootModels.length > 10
          ? `${schema.rootModels.slice(0, 10).join(', ')}, ... (+${schema.rootModels.length - 10} more)`
          : schema.rootModels.join(', ');
      lines.push(`\n// Top-level models (${schema.rootModels.length}): ${preview}`);
    }
    return lines.join('\n');
  }

  // 2. Exact group match (e.g. "dns" or "dns.records")
  const group = schema.groups[trimmed];
  if (group) {
    const lines: string[] = [];
    lines.push(`// Group: ${group.path}`);
    if (group.description) {
      lines.push(formatJsDoc(group.description, false, '').trimEnd());
    }
    lines.push(`export namespace ${group.path} {`);
    lines.push('  export interface Client {');
    for (const childName of group.children) {
      const childPath = `${group.path}.${childName}`;
      const childGroup = schema.groups[childPath];
      const doc = formatJsDoc(firstSummaryLine(childGroup?.description), false, '    ');
      const count = countGroupMethods(schema, childPath);
      lines.push(`${doc}    readonly ${formatPropertyKey(childName)}: ${childPath}.Client; // ${count} methods`);
    }
    for (const method of group.methods) {
      lines.push(renderMethodSignature(method, '    ', true));
    }
    lines.push('  }');
    lines.push('}');
    if (group.models.length > 0) {
      const preview =
        group.models.length > 12
          ? `${group.models.slice(0, 12).join(', ')}, ... (+${group.models.length - 12} more)`
          : group.models.join(', ');
      lines.push(`\n// Models in ${group.path} (${group.models.length}): ${preview}`);
    }
    return lines.join('\n');
  }

  // 3. Exact model match (e.g. "pets.Pet" or top-level "Pet")
  const exactModel = schema.models[trimmed];
  if (exactModel) {
    const decl = renderModelDeclaration(schema, exactModel);
    const refs = new Set<string>();
    const flatObj = resolveFlatObjectType(schema, exactModel.type, new Set(), true);
    if (flatObj && flatObj.fields.length > 0) {
      for (const f of flatObj.fields) {
        collectReferencedModels(schema, f.type, refs);
      }
      collectReferencedModels(schema, flatObj.extra, refs);
    } else {
      collectReferencedModels(schema, exactModel.type, refs);
    }
    refs.delete(exactModel.path);
    const footer =
      refs.size > 0
        ? `\n\n// Referenced models (use search("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
        : '';
    return `// Model: ${exactModel.path} (OpenAPI schema '${exactModel.schemaName}')\n${decl}${footer}`;
  }

  // 4. Split "<groupPath>.<leaf>" to check methods or request/response types in that group
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot !== -1) {
    const parentPath = trimmed.slice(0, lastDot);
    const leaf = trimmed.slice(lastDot + 1);
    const parentGroup = schema.groups[parentPath];
    if (parentGroup) {
      const method = parentGroup.methods.find((m) => m.name === leaf);
      if (method) {
        const blocks: string[] = [];
        blocks.push(`// Method: client.${method.path} (${method.httpMethod} ${method.route})`);
        blocks.push(renderMethodSignature(method, ''));
        const reqDecl = renderRequestDeclaration(schema, method);
        if (reqDecl) {
          blocks.push(reqDecl);
        }
        blocks.push(renderResponseDeclaration(schema, method));
        const refs = new Set<string>();
        for (const p of method.requestParams) {
          collectReferencedModels(schema, p.type, refs);
        }
        const flatReqExpanded =
          method.requestFlat && method.requestBody
            ? resolveFlatObjectType(schema, method.requestBody.type, new Set(), true) !== undefined
            : false;
        if (method.requestBody) {
          if (flatReqExpanded) {
            const flatObj = resolveFlatObjectType(schema, method.requestBody.type, new Set(), true);
            if (flatObj) {
              for (const f of flatObj.fields) {
                collectReferencedModels(schema, f.type, refs);
              }
              collectReferencedModels(schema, flatObj.extra, refs);
            }
          } else {
            collectReferencedModels(schema, method.requestBody.type, refs);
          }
        }
        collectReferencedModels(schema, method.responseType, refs);
        // If requestBody or responseType is a direct single model (not already expanded into flat CreateRequest), expand 1 level of that model immediately
        const reqBodyModel =
          !flatReqExpanded && method.requestBody?.type.kind === 'model' ? method.requestBody.type.model : undefined;
        if (reqBodyModel) {
          const reqModel = schema.models[reqBodyModel];
          if (reqModel) {
            blocks.push(`// Model: ${reqModel.path}\n${renderModelDeclaration(schema, reqModel)}`);
            refs.delete(reqModel.path);
            const subRefs = new Set<string>();
            collectReferencedModels(schema, reqModel.type, subRefs);
            if (resolveFlatObjectType(schema, reqModel.type, new Set(), true) === undefined && subRefs.size <= 3) {
              for (const subPath of subRefs) {
                const subModel = schema.models[subPath];
                if (subModel) {
                  blocks.push(`// Model: ${subModel.path}\n${renderModelDeclaration(schema, subModel)}`);
                  refs.delete(subModel.path);
                  collectReferencedModels(schema, subModel.type, refs);
                }
              }
            } else {
              for (const r of subRefs) {
                refs.add(r);
              }
            }
          }
        }
        if (refs.size > 0) {
          blocks.push(`// Referenced models (use search("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`);
        }
        return blocks.join('\n\n');
      }

      const reqMethod = parentGroup.methods.find((m) => m.requestTypeName === leaf);
      if (reqMethod) {
        const reqDecl = renderRequestDeclaration(schema, reqMethod) ?? '';
        const refs = new Set<string>();
        for (const p of reqMethod.requestParams) {
          collectReferencedModels(schema, p.type, refs);
        }
        if (reqMethod.requestBody) {
          collectReferencedModels(schema, reqMethod.requestBody.type, refs);
        }
        const footer =
          refs.size > 0
            ? `\n\n// Referenced models (use search("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
            : '';
        return `// Request type for client.${reqMethod.path}\n${reqDecl}${footer}`;
      }

      const respMethod = parentGroup.methods.find((m) => m.responseTypeName === leaf);
      if (respMethod) {
        const respDecl = renderResponseDeclaration(schema, respMethod);
        const refs = new Set<string>();
        collectReferencedModels(schema, respMethod.responseType, refs);
        const footer =
          refs.size > 0
            ? `\n\n// Referenced models (use search("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
            : '';
        return `// Response type for client.${respMethod.path}\n${respDecl}${footer}`;
      }
    }
  }

  // 5. Unqualified model name lookup (e.g. "RecordSettings" when unique or matching models)
  const matchingModels = Object.values(schema.models).filter(
    (m) => m.name === trimmed || m.schemaName === trimmed,
  );
  if (matchingModels.length === 1) {
    return resolveSymbolDts(schema, matchingModels[0]!.path);
  }
  if (matchingModels.length > 1) {
    return (
      `Multiple models match '${trimmed}': ${matchingModels.map((m) => m.path).join(', ')}.\n\n` +
      (resolveSymbolDts(schema, matchingModels[0]!.path) ?? '')
    );
  }

  // 6. Suffix match on group or method path (e.g. "access.applications" -> "zeroTrust.access.applications")
  const lowerSuffix = `.${trimmed.toLowerCase()}`;
  const suffixGroups = Object.keys(schema.groups).filter((g) =>
    g.toLowerCase().endsWith(lowerSuffix),
  );
  if (suffixGroups.length === 1 && suffixGroups[0]) {
    return `// Note: '${trimmed}' is located at 'client.${suffixGroups[0]}'\n${resolveSymbolDts(schema, suffixGroups[0])}`;
  }
  const suffixMethods: string[] = [];
  for (const g of Object.values(schema.groups)) {
    for (const m of g.methods) {
      if (m.path.toLowerCase().endsWith(lowerSuffix)) {
        suffixMethods.push(m.path);
      }
    }
  }
  if (suffixMethods.length === 1 && suffixMethods[0]) {
    return `// Note: '${trimmed}' is located at 'client.${suffixMethods[0]}'\n${resolveSymbolDts(schema, suffixMethods[0])}`;
  }

  // 7. Exact HTTP route match (e.g. "POST /zones/{zoneId}/dns_records" or "/zones/{zoneId}/purge_cache")
  if (rawSymbol && rawSymbol.includes('/')) {
    const routeResult = matchByHttpRoute(schema, rawSymbol);
    if (routeResult !== undefined) {
      return routeResult;
    }
  }

  return undefined;
}

function renderUnknownSymbolDiagnostic(schema: ApiSchema, rawSymbol: string): string {
  const trimmed = cleanSymbolPath(schema, rawSymbol);
  const lastDot = trimmed.lastIndexOf('.');
  const suggestions = findSuggestions(schema, trimmed);
  const suggestionText =
    suggestions.length > 0 ? ` Did you mean: ${suggestions.map((s) => `'${s}'`).join(', ')}?` : '';
  if (lastDot !== -1) {
    const parentPath = trimmed.slice(0, lastDot);
    if (schema.groups[parentPath]) {
      return `TS2339: Symbol '${trimmed}' does not exist on '${parentPath}'.${suggestionText}\n\n${resolveSymbolDts(schema, parentPath)}`;
    }
  }
  return `TS2304: Cannot find symbol '${trimmed}'.${suggestionText}`;
}

/**
 * Custom JavaScript evaluator / sandbox hook for `search()` and `execute()`.
 *
 * Allows hosts (such as Cloudflare Workers using Dynamic Worker isolates, `@cloudflare/codemode`,
 * QuickJS, or Node `vm.runInNewContext`) to evaluate agent code out-of-process or in an isolated
 * sandbox without calling `new Function` / `new AsyncFunction` in the host isolate.
 *
 * @param code - The raw JavaScript expression or multi-statement snippet from the agent.
 * @param globals - Bound runtime globals (`{ schema, methods, groups, models, dts, client }` for `search`,
 *   or `{ client, search, dts, schema }` for `execute`).
 * @param functionBody - Normalized function body with automatic `return (...)` wrapping on the trailing expression.
 */
export type CodeEvaluator = (
  code: string,
  globals: Readonly<Record<string, unknown>>,
  functionBody: string,
) => unknown | Promise<unknown>;

export interface SearchOptions {
  /**
   * Filter which SDK methods are exposed in `search()`, `dts()`, and `execute()`
   * (e.g. `(m) => !m.deprecated && m.httpMethod === 'GET'`, or checking `m.extensions`).
   */
  readonly include?: ((method: MethodSchema) => boolean) | undefined;
  /**
   * Custom sandbox or JavaScript evaluator for code-based `search()` queries
   * (e.g. Node `vm.runInNewContext`, QuickJS, or a Cloudflare Dynamic Worker isolate).
   * Pass `false` to disable dynamic JS evaluation and restrict `search()` to
   * zero-eval symbol paths (`"dns.records.create"`, `dts("...")`) and HTTP routes.
   */
  readonly evaluator?: CodeEvaluator | false | undefined;
}

function finishSearchEvalValue(schema: ApiSchema, value: unknown): string {
  let resolved = value;
  if (typeof resolved === 'function' && getSymbolPath(resolved) === undefined) {
    resolved = (resolved as (s: ApiSchema) => unknown)(schema);
  }
  return formatSearchEvalResult(schema, resolved);
}

function formatSearchEvalError(schema: ApiSchema, trimmed: string, err: unknown): string {
  const fallback = resolveSymbolDts(schema, trimmed);
  if (fallback !== undefined) {
    return fallback;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof EvalError) {
    return (
      `Search error: Dynamic JavaScript compilation is disallowed in this runtime (${msg}).\n` +
      '// Tip: pass a symbol path ("dns.records.create", dts("dns.records.RecordSettings")) or HTTP route ("POST /zones/{zoneId}/dns_records"), or configure an `evaluator` sandbox in createMcp.'
    );
  }
  return `Search error: ${msg}\n// Tip: write a JS expression using \`methods\` (array of { path, group, name, httpMethod, route, summary, description }), \`groups\`, \`models\`, or \`dts("<symbol>")\`.`;
}

/**
 * Searches or inspects the SDK by running JavaScript against `{ schema, methods, groups, models, dts, client }`
 * or resolving a 1-level `.d.ts` symbol path directly.
 *
 * Direct symbol paths (`"dns.records.create"`), `dts("<symbol>")` calls, and HTTP routes (`"POST /zones/{zoneId}/dns_records"`)
 * resolve via pure static lookup without invoking `new Function` or `evaluator`.
 *
 * Examples:
 * - `search(schema)` or `search(schema, "dts()")` -> top-level `Client` namespaces
 * - `search(schema, "dns.records")` or `search(schema, 'dts("dns.records")')` -> 1-level `dns.records.Client`
 * - `search(schema, "dns.records.create")` -> method signature + 1-level `CreateRequest` & `CreateResponse`
 * - `search(schema, 'methods.filter(m => m.route.includes("purge_cache"))')` -> code-based search returning 1-level `.d.ts`
 */
export function search(schema: ApiSchema, codeOrSymbol?: string): string;
export function search(
  schema: ApiSchema,
  codeOrSymbol: string | undefined,
  options: SearchOptions | undefined,
): string | Promise<string>;
export function search(
  schema: ApiSchema,
  codeOrSymbol?: string,
  options?: SearchOptions,
): string | Promise<string> {
  const activeSchema = filterSchema(schema, options?.include);
  if (!codeOrSymbol || !codeOrSymbol.trim()) {
    return resolveSymbolDts(activeSchema, '')!;
  }
  const trimmed = codeOrSymbol.trim();
  const isSimpleDtsCall = /^dts\s*\(\s*(?:(['"`])[^'"`]*\1)?\s*\)\s*;?$/.test(trimmed);
  const isCodeExpr =
    !isSimpleDtsCall && /^(?:dts|methods|groups|models|schema)\s*[.([]/.test(trimmed);
  if (!isCodeExpr) {
    const direct = resolveSymbolDts(activeSchema, trimmed);
    if (direct !== undefined) {
      return direct;
    }
  }

  const searchGlobals = new Set(['methods', 'groups', 'models', 'schema', 'client', 'dts']);
  const cleaned = cleanSymbolPath(activeSchema, trimmed);
  if (
    !isCodeExpr &&
    /^[a-zA-Z0-9_.$]+$/.test(cleaned) &&
    !searchGlobals.has(cleaned)
  ) {
    return renderUnknownSymbolDiagnostic(activeSchema, trimmed);
  }

  if (options?.evaluator === false) {
    return (
      'Search error: Arbitrary JavaScript evaluation in search() is disabled (evaluator: false).\n' +
      '// Tip: pass a symbol path ("dns.records.create", dts("dns.records.RecordSettings")) or HTTP route ("POST /zones/{zoneId}/dns_records"), or configure an `evaluator` sandbox in createMcp.'
    );
  }

  const allMethods = getAllMethods(activeSchema);
  const boundDts = (target?: unknown): string => dts(activeSchema, target);
  const clientProxy = createSearchSymbolProxy();
  try {
    const body = prepareCodeBody(trimmed);
    if (typeof options?.evaluator === 'function') {
      const globals: Readonly<Record<string, unknown>> = {
        schema: activeSchema,
        methods: allMethods,
        groups: activeSchema.groups,
        models: activeSchema.models,
        dts: boundDts,
        client: clientProxy,
      };
      const rawValue = options.evaluator(trimmed, globals, body);
      if (
        rawValue instanceof Promise ||
        (typeof rawValue === 'object' &&
          rawValue !== null &&
          typeof (rawValue as { readonly then?: unknown }).then === 'function')
      ) {
        return Promise.resolve(rawValue).then(
          (val) => finishSearchEvalValue(activeSchema, val),
          (err: unknown) => formatSearchEvalError(activeSchema, trimmed, err),
        );
      }
      return finishSearchEvalValue(activeSchema, rawValue);
    }
    const runner = new Function('schema', 'methods', 'groups', 'models', 'dts', 'client', body) as (
      schema: ApiSchema,
      methods: readonly SearchMethodEntry[],
      groups: Readonly<Record<string, GroupSchema>>,
      models: Readonly<Record<string, ModelSchema>>,
      dts: (target?: unknown) => string,
      client: unknown,
    ) => unknown;
    const value = runner(
      activeSchema,
      allMethods,
      activeSchema.groups,
      activeSchema.models,
      boundDts,
      clientProxy,
    );
    return finishSearchEvalValue(activeSchema, value);
  } catch (err: unknown) {
    return formatSearchEvalError(activeSchema, trimmed, err);
  }
}
function validateValue(
  schema: ApiSchema,
  type: TypeSchema,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  currentModelSymbol: string | undefined,
  seenModels: Set<string>,
): void {
  switch (type.kind) {
    case 'scalar': {
      switch (type.scalar) {
        case 'unknown':
          return;
        case 'null':
          if (value !== null) {
            issues.push({
              code: 'TS2322',
              path,
              message: `Type '${describeValue(value)}' is not assignable to type 'null'.`,
              symbol: currentModelSymbol,
            });
          }
          return;
        case 'boolean':
          if (typeof value !== 'boolean') {
            issues.push({
              code: 'TS2322',
              path,
              message: `Type '${describeValue(value)}' is not assignable to type 'boolean'.`,
              symbol: currentModelSymbol,
            });
          }
          return;
        case 'string':
          if (typeof value !== 'string') {
            issues.push({
              code: 'TS2322',
              path,
              message: `Type '${describeValue(value)}' is not assignable to type 'string'.`,
              symbol: currentModelSymbol,
            });
          }
          return;
        case 'number':
          if (typeof value !== 'number' || Number.isNaN(value)) {
            issues.push({
              code: 'TS2322',
              path,
              message: `Type '${describeValue(value)}' is not assignable to type 'number'.`,
              symbol: currentModelSymbol,
            });
          }
          return;
        case 'bigint':
          if (typeof value !== 'bigint') {
            issues.push({
              code: 'TS2322',
              path,
              message: `Type '${describeValue(value)}' is not assignable to type 'bigint'.`,
              symbol: currentModelSymbol,
            });
          }
          return;
        case 'Uint8Array':
          if (!(value instanceof Uint8Array)) {
            issues.push({
              code: 'TS2322',
              path,
              message: `Type '${describeValue(value)}' is not assignable to type 'Uint8Array'.`,
              symbol: currentModelSymbol,
            });
          }
          return;
        case 'Temporal.Instant':
          if (
            typeof value !== 'object' ||
            value === null ||
            !('epochNanoseconds' in value) ||
            typeof value.epochNanoseconds !== 'bigint'
          ) {
            issues.push({
              code: 'TS2322',
              path,
              message: `Type '${describeValue(value)}' is not assignable to type 'Temporal.Instant'.`,
              symbol: currentModelSymbol,
            });
          }
          return;
        case 'Temporal.PlainDate':
          if (
            typeof value !== 'object' ||
            value === null ||
            !('year' in value) ||
            typeof value.year !== 'number' ||
            !('month' in value) ||
            typeof value.month !== 'number' ||
            !('day' in value) ||
            typeof value.day !== 'number'
          ) {
            issues.push({
              code: 'TS2322',
              path,
              message: `Type '${describeValue(value)}' is not assignable to type 'Temporal.PlainDate'.`,
              symbol: currentModelSymbol,
            });
          }
          return;
      }
      return;
    }
    case 'enum': {
      if (!type.values.includes(value as string | number | boolean)) {
        issues.push({
          code: 'TS2322',
          path,
          message: `Type '${describeValue(value)}' is not assignable to type '${formatTypeExpr(type)}'.`,
          symbol: currentModelSymbol,
        });
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        issues.push({
          code: 'TS2322',
          path,
          message: `Type '${describeValue(value)}' is not assignable to type '${formatTypeExpr(type)}'.`,
          symbol: currentModelSymbol,
        });
        return;
      }
      if (type.minItems !== undefined && value.length < type.minItems) {
        issues.push({
          code: 'TS2322',
          path,
          message: `Array has ${value.length} element(s), which is fewer than minItems (${type.minItems}).`,
          symbol: currentModelSymbol,
        });
      }
      if (type.maxItems !== undefined && value.length > type.maxItems) {
        issues.push({
          code: 'TS2322',
          path,
          message: `Array has ${value.length} element(s), which exceeds maxItems (${type.maxItems}).`,
          symbol: currentModelSymbol,
        });
      }
      for (let i = 0; i < value.length; i++) {
        validateValue(schema, type.elem, value[i], `${path}[${i}]`, issues, currentModelSymbol, seenModels);
      }
      return;
    }
    case 'object': {
      validateObjectFields(
        schema,
        type.fields,
        type.extra,
        value,
        path,
        issues,
        currentModelSymbol ?? 'object',
        currentModelSymbol,
        seenModels,
      );
      return;
    }
    case 'model': {
      const model = schema.models[type.model];
      if (!model) {
        return;
      }
      const callKey = `${type.model}@${path}`;
      if (seenModels.has(callKey)) {
        return;
      }
      seenModels.add(callKey);
      validateValue(schema, model.type, value, path, issues, model.path, seenModels);
      seenModels.delete(callKey);
      return;
    }
    case 'union': {
      const memberTrials: { member: TypeSchema; trial: ValidationIssue[] }[] = [];
      for (const member of type.members) {
        const trial: ValidationIssue[] = [];
        validateValue(schema, member, value, path, trial, currentModelSymbol, new Set(seenModels));
        if (trial.length === 0) {
          return;
        }
        memberTrials.push({ member, trial });
      }
      if (isPlainRecord(value)) {
        if (type.discriminator && value[type.discriminator] !== undefined) {
          const matching = memberTrials.filter(
            ({ trial }) => !trial.some((iss) => iss.path === `${path}.${type.discriminator}`),
          );
          if (matching.length === 1 && matching[0]) {
            issues.push(...matching[0].trial);
            return;
          }
        }
      }
      const deepMatches = memberTrials
        .filter(
          ({ trial }) =>
            trial.length > 0 && trial.every((iss) => iss.path.startsWith(`${path}.`) || iss.code === 'TS2741'),
        )
        .sort((a, b) => {
          const unknownA = a.trial.filter((i) => i.code === 'TS2353').length;
          const unknownB = b.trial.filter((i) => i.code === 'TS2353').length;
          if (unknownA !== unknownB) {
            return unknownA - unknownB;
          }
          const nonMissingA = a.trial.filter((i) => i.code !== 'TS2741').length;
          const nonMissingB = b.trial.filter((i) => i.code !== 'TS2741').length;
          if (nonMissingA !== nonMissingB) {
            return nonMissingA - nonMissingB;
          }
          return a.trial.length - b.trial.length;
        });
      if (deepMatches[0]) {
        issues.push(...deepMatches[0].trial);
        return;
      }
      issues.push({
        code: 'TS2322',
        path,
        message: `Type '${describeValue(value)}' is not assignable to type '${formatTypeExpr(type, 'top', schema)}'.`,
        symbol: currentModelSymbol,
      });
      return;
    }
    case 'intersection': {
      const merged = resolveFlatObjectType(schema, type);
      if (merged) {
        validateObjectFields(
          schema,
          merged.fields,
          merged.extra,
          value,
          path,
          issues,
          currentModelSymbol ?? formatTypeExpr(type),
          currentModelSymbol ?? merged.modelSymbol,
          seenModels,
        );
        return;
      }
      for (const member of type.members) {
        validateValue(schema, member, value, path, issues, currentModelSymbol, seenModels);
      }
      return;
    }
  }
}

function resolveFlatObjectType(
  schema: ApiSchema,
  type: TypeSchema,
  seen: Set<string> = new Set(),
  allowInlineObjectUnion = false,
):
  | {
      readonly fields: readonly FieldSchema[];
      readonly extra: TypeSchema | undefined;
      readonly modelSymbol: string | undefined;
    }
  | undefined {
  switch (type.kind) {
    case 'object':
      return { fields: type.fields, extra: type.extra, modelSymbol: undefined };
    case 'model': {
      if (seen.has(type.model)) {
        return undefined;
      }
      const model = schema.models[type.model];
      if (!model) {
        return undefined;
      }
      seen.add(type.model);
      const resolved = resolveFlatObjectType(schema, model.type, seen, allowInlineObjectUnion);
      seen.delete(type.model);
      if (!resolved) {
        return undefined;
      }
      return {
        fields: resolved.fields,
        extra: resolved.extra,
        modelSymbol: resolved.modelSymbol ?? model.path,
      };
    }
    case 'intersection': {
      const byName = new Map<string, FieldSchema>();
      let extra: TypeSchema | undefined;
      let modelSymbol: string | undefined;
      for (const member of type.members) {
        const resolved = resolveFlatObjectType(schema, member, seen, allowInlineObjectUnion);
        if (!resolved) {
          return undefined;
        }
        for (const f of resolved.fields) {
          byName.set(f.name, f);
        }
        if (resolved.extra !== undefined) {
          extra = resolved.extra;
        }
        if (modelSymbol === undefined && resolved.modelSymbol !== undefined) {
          modelSymbol = resolved.modelSymbol;
        }
      }
      return { fields: Array.from(byName.values()), extra, modelSymbol };
    }
    case 'union': {
      if (!allowInlineObjectUnion || type.members.length === 0) {
        return undefined;
      }
      const branchObjects: { fields: readonly FieldSchema[]; extra: TypeSchema | undefined }[] = [];
      for (const member of type.members) {
        const resolved = resolveFlatObjectType(schema, member, seen, allowInlineObjectUnion);
        if (!resolved) {
          return undefined;
        }
        branchObjects.push(resolved);
      }
      const fieldBranches = new Map<
        string,
        { field: FieldSchema; count: number; types: TypeSchema[]; typeKeys: Set<string> }
      >();
      for (const branch of branchObjects) {
        for (const f of branch.fields) {
          const memberTypes = f.type.kind === 'union' ? f.type.members : [f.type];
          const existing = fieldBranches.get(f.name);
          if (!existing) {
            const types: TypeSchema[] = [];
            const typeKeys = new Set<string>();
            for (const mt of memberTypes) {
              const tk = formatTypeExpr(mt, 'top', schema);
              if (!typeKeys.has(tk)) {
                typeKeys.add(tk);
                types.push(mt);
              }
            }
            fieldBranches.set(f.name, {
              field: f,
              count: 1,
              types,
              typeKeys,
            });
          } else {
            existing.count++;
            if (!f.required) {
              existing.field = { ...existing.field, required: false };
            }
            for (const mt of memberTypes) {
              const tk = formatTypeExpr(mt, 'top', schema);
              if (!existing.typeKeys.has(tk)) {
                existing.typeKeys.add(tk);
                existing.types.push(mt);
              }
            }
          }
        }
      }
      const mergedFields: FieldSchema[] = [];
      for (const entry of fieldBranches.values()) {
        const isReq = entry.count === branchObjects.length && entry.field.required;
        const mergedType: TypeSchema =
          entry.types.length === 1 ? entry.types[0]! : { kind: 'union', members: entry.types };
        mergedFields.push({
          ...entry.field,
          required: isReq,
          type: mergedType,
        });
      }
      mergedFields.sort((a, b) => (a.required === b.required ? 0 : a.required ? -1 : 1));
      return { fields: mergedFields, extra: undefined, modelSymbol: undefined };
    }
    default:
      return undefined;
  }
}

function validateObjectFields(
  schema: ApiSchema,
  fields: readonly FieldSchema[],
  extra: TypeSchema | undefined,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  typeLabel: string,
  currentModelSymbol: string | undefined,
  seenModels: Set<string>,
): void {
  if (!isPlainRecord(value)) {
    issues.push({
      code: 'TS2322',
      path,
      message: `Type '${describeValue(value)}' is not assignable to type '${typeLabel}'. Expected an object.`,
      symbol: currentModelSymbol,
    });
    return;
  }

  const byName = new Map<string, FieldSchema>();
  const byWireName = new Map<string, FieldSchema>();
  for (const field of fields) {
    byName.set(field.name, field);
    if (field.wireName !== field.name) {
      byWireName.set(field.wireName, field);
    }
  }

  for (const field of fields) {
    if (field.readonly) {
      continue;
    }
    const propVal = value[field.name];
    if (propVal === undefined) {
      if (field.required && !byWireName.has(field.wireName)) {
        issues.push({
          code: 'TS2741',
          path,
          message: `Property '${field.name}' (${formatTypeExpr(field.type)}) is missing in type '${typeLabel}' but required.`,
          symbol: currentModelSymbol,
        });
      } else if (field.required && value[field.wireName] === undefined) {
        issues.push({
          code: 'TS2741',
          path,
          message: `Property '${field.name}' (${formatTypeExpr(field.type)}) is missing in type '${typeLabel}' but required.`,
          symbol: currentModelSymbol,
        });
      }
      continue;
    }
    validateValue(schema, field.type, propVal, `${path}.${field.name}`, issues, currentModelSymbol, seenModels);
  }

  for (const [key, propVal] of Object.entries(value)) {
    const known = byName.get(key);
    if (known) {
      if (known.readonly) {
        issues.push({
          code: 'TS2540',
          path: `${path}.${key}`,
          message: `Cannot assign to '${key}' because it is a read-only property on '${typeLabel}'.`,
          symbol: currentModelSymbol,
        });
      }
      continue;
    }
    const wireMatch = byWireName.get(key);
    if (wireMatch && !wireMatch.readonly) {
      issues.push({
        code: 'TS2561',
        path: `${path}.${key}`,
        message: `Object literal may only specify known properties, but '${key}' does not exist in type '${typeLabel}'. Did you mean '${wireMatch.name}' (the SDK's camelCase name for wire field '${wireMatch.wireName}')?`,
        symbol: currentModelSymbol,
      });
      continue;
    }
    if (extra) {
      validateValue(schema, extra, propVal, `${path}.${key}`, issues, currentModelSymbol, seenModels);
      continue;
    }
    const writableNames = fields.filter((f) => !f.readonly).map((f) => f.name);
    const closest = writableNames
      .map((name) => ({ name, dist: editDistance(key, name) }))
      .sort((a, b) => a.dist - b.dist)[0];
    const hint = closest && closest.dist <= 3 ? ` Did you mean '${closest.name}'?` : '';
    issues.push({
      code: 'TS2353',
      path: `${path}.${key}`,
      message: `Object literal may only specify known properties, and '${key}' does not exist in type '${typeLabel}'.${hint}`,
      symbol: currentModelSymbol,
    });
  }
}

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value.length > 32 ? `${value.slice(0, 32)}...` : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value instanceof Uint8Array) {
    return 'Uint8Array';
  }
  return typeof value;
}

export function validateMethodCall(schema: ApiSchema, method: MethodSchema, args: readonly unknown[]): void {
  const issues: ValidationIssue[] = [];
  if (!method.requestTypeName) {
    if (args.length > 1) {
      issues.push({
        code: 'TS2554',
        path: `client.${method.path}`,
        message: `Expected 0-1 arguments (options?: RequestOptions), but got ${args.length}.`,
      });
    }
  } else {
    const reqArg = args[0];
    if (reqArg === undefined) {
      if (!method.requestOptional) {
        issues.push({
          code: 'TS2554',
          path: `client.${method.path}`,
          message: `Expected 1-2 arguments ('request: ${method.requestTypeName}' is required), but got ${args.length === 0 ? '0' : 'undefined'}.`,
        });
      }
    } else {
      const body = method.requestBody;
      if (!body) {
        validateObjectFields(
          schema,
          method.requestParams,
          undefined,
          reqArg,
          'request',
          issues,
          method.requestTypeName,
          undefined,
          new Set(),
        );
      } else if (method.requestFlat) {
        const flatObj = resolveFlatObjectType(schema, body.type, new Set(), true);
        if (flatObj) {
          const byName = new Map<string, FieldSchema>();
          for (const f of flatObj.fields) {
            byName.set(f.name, f);
          }
          for (const p of method.requestParams) {
            byName.set(p.name, p);
          }
          validateObjectFields(
            schema,
            Array.from(byName.values()),
            flatObj.extra,
            reqArg,
            'request',
            issues,
            method.requestTypeName,
            flatObj.modelSymbol,
            new Set(),
          );
        } else if (method.requestParams.length > 0) {
          validateObjectFields(
            schema,
            method.requestParams,
            { kind: 'scalar', scalar: 'unknown' },
            reqArg,
            'request',
            issues,
            method.requestTypeName,
            undefined,
            new Set(),
          );
          if (isPlainRecord(reqArg)) {
            const paramKeys = new Set<string>();
            for (const param of method.requestParams) {
              paramKeys.add(param.name);
              paramKeys.add(param.wireName);
            }
            const bodyVal: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(reqArg)) {
              if (!paramKeys.has(k)) {
                bodyVal[k] = v;
              }
            }
            validateValue(schema, body.type, bodyVal, 'request', issues, undefined, new Set());
          }
        } else {
          validateValue(schema, body.type, reqArg, 'request', issues, undefined, new Set());
        }
      } else {
        const bodyField: FieldSchema = {
          name: 'body',
          wireName: 'body',
          required: body.required,
          description: body.description,
          type: body.type,
        };
        validateObjectFields(
          schema,
          [...method.requestParams, bodyField],
          undefined,
          reqArg,
          'request',
          issues,
          method.requestTypeName,
          undefined,
          new Set(),
        );
      }
    }
  }

  if (issues.length > 0) {
    const definitions: string[] = [search(schema, method.path)];
    const shownModels = new Set<string>();
    if (
      method.requestFlat &&
      method.requestBody?.type.kind === 'model' &&
      resolveFlatObjectType(schema, method.requestBody.type, new Set(), true)?.fields !== undefined
    ) {
      shownModels.add(method.requestBody.type.model);
    }
    for (const issue of issues) {
      if (issue.symbol && !shownModels.has(issue.symbol) && schema.models[issue.symbol]) {
        shownModels.add(issue.symbol);
        definitions.push(search(schema, issue.symbol));
      }
    }
    throw new TypeFeedbackError(issues, definitions.join('\n\n'));
  }
}

const SYMBOL_PATH = Symbol.for('forge.mcp.symbolPath');

function getSymbolPath(value: unknown): string | undefined {
  if ((typeof value === 'object' || typeof value === 'function') && value !== null && SYMBOL_PATH in value) {
    const sym = Reflect.get(value, SYMBOL_PATH);
    return typeof sym === 'string' ? sym : undefined;
  }
  return undefined;
}

export interface ExecuteOptions extends SearchOptions {}
/**
 * Wraps a generated Forge SDK `Client` in a progressive type-feedback `Proxy`.
 * Unknown property accesses and invalid method arguments throw a `TypeFeedbackError`
 * with compiler diagnostics and the relevant `.d.ts` type definition BEFORE any HTTP request is made.
 *
 * Returning an uninvoked namespace, method, or model from `execute()` inspects its 1-level `.d.ts` signature.
 */
export function wrapClient<T extends object>(
  client: T,
  schema: ApiSchema,
  groupPath = '',
  options?: ExecuteOptions | undefined,
): T {
  const activeSchema = groupPath === '' ? filterSchema(schema, options?.include) : schema;
  const cache = new Map<string | symbol, unknown>();

  return new Proxy(client, {
    has(target, prop) {
      if (prop === SYMBOL_PATH) {
        return true;
      }
      return Reflect.has(target, prop);
    },
    get(target, prop, receiver) {
      if (prop === SYMBOL_PATH) {
        return groupPath;
      }
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') {
        return Reflect.get(target, prop, receiver);
      }
      if (cache.has(prop)) {
        return cache.get(prop);
      }

      const fullPath = groupPath === '' ? prop : `${groupPath}.${prop}`;
      const group = groupPath === '' ? undefined : activeSchema.groups[groupPath];
      const isChildGroup =
        groupPath === ''
          ? activeSchema.rootChildren.includes(prop)
          : (group?.children.includes(prop) ?? false);
      const methodSchema = group?.methods.find((m) => m.name === prop);
      const modelSchema = activeSchema.models[fullPath];

      if (!isChildGroup && !methodSchema) {
        if (modelSchema) {
          const modelHandle = Object.freeze({ [SYMBOL_PATH]: fullPath });
          cache.set(prop, modelHandle);
          return modelHandle;
        }
        const available =
          groupPath === ''
            ? activeSchema.rootChildren
            : [...(group?.children ?? []), ...(group?.methods.map((m) => m.name) ?? [])];
        const closest = available
          .map((name) => ({ name, dist: editDistance(prop, name) }))
          .sort((a, b) => a.dist - b.dist)[0];
        const ownerType = groupPath === '' ? 'Client' : `${groupPath}.Client`;
        const lowerSuffix = `.${fullPath.toLowerCase()}`;
        const suffixGroup = Object.keys(activeSchema.groups).find((g) =>
          g.toLowerCase().endsWith(lowerSuffix),
        );
        const hint = suffixGroup
          ? ` Did you mean 'client.${suffixGroup}'?`
          : closest && closest.dist <= 3
            ? ` Did you mean '${closest.name}'?`
            : available.length > 0
              ? ` Available on '${ownerType}': ${available.slice(0, 8).join(', ')}.`
              : '';
        const defBody = suffixGroup ? dts(activeSchema, suffixGroup) : dts(activeSchema, groupPath);
        throw new TypeFeedbackError(
          [
            {
              code: 'TS2339',
              path: `client.${fullPath}`,
              message: `Property '${prop}' does not exist on type '${ownerType}'.${hint}`,
            },
          ],
          defBody,
        );
      }

      const rawValue: unknown = Reflect.get(target, prop, receiver);

      if (methodSchema && typeof rawValue === 'function') {
        const wrappedFn = (...args: unknown[]) => {
          validateMethodCall(activeSchema, methodSchema, args);
          const res = (rawValue as (...callArgs: unknown[]) => unknown).apply(target, args);
          if (res instanceof Promise) {
            return res.then((val: unknown) => {
              if (isPlainRecord(val) && isPlainRecord(val['result'])) {
                const respFlat = methodSchema.responseType
                  ? resolveFlatObjectType(activeSchema, methodSchema.responseType, new Set(), true)
                  : undefined;
                if (respFlat && !respFlat.fields.some((f) => f.name === 'result')) {
                  return { ...val['result'], ...val };
                }
              }
              return val;
            });
          }
          return res;
        };

        Object.defineProperty(wrappedFn, SYMBOL_PATH, { value: fullPath });

        if (isChildGroup) {
          const childTarget =
            typeof rawValue === 'object' && rawValue !== null ? rawValue : {};
          const childProxy = wrapClient(childTarget, activeSchema, fullPath);
          const hybrid = new Proxy(wrappedFn, {
            has(fnTarget, childProp) {
              return (
                childProp === SYMBOL_PATH ||
                Reflect.has(childProxy, childProp) ||
                Reflect.has(fnTarget, childProp)
              );
            },
            get(_fnTarget, childProp) {
              if (childProp === SYMBOL_PATH) {
                return fullPath;
              }
              return Reflect.get(childProxy, childProp, childProxy);
            },
          });
          cache.set(prop, hybrid);
          return hybrid;
        }

        cache.set(prop, wrappedFn);
        return wrappedFn;
      }

      if (isChildGroup) {
        const childTarget =
          (typeof rawValue === 'object' || typeof rawValue === 'function') && rawValue !== null
            ? rawValue
            : {};
        const wrappedGroup = wrapClient(childTarget, activeSchema, fullPath);
        cache.set(prop, wrappedGroup);
        return wrappedGroup;
      }

      return rawValue;
    },
  });
}

export type ExecuteResult =
  | {
      readonly ok: true;
      readonly result: unknown;
      readonly typeDefinition?: string | undefined;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly issues?: readonly ValidationIssue[] | undefined;
      readonly typeDefinition?: string | undefined;
    };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...callArgs: unknown[]) => Promise<unknown>;

function findLastTopLevelStatementBoundary(src: string): number {
  let depth = 0;
  let lastBoundary = -1;
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i]!;
    const next = src[i + 1];

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && src[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < len) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (depth === 0) {
      if (ch === ';') {
        lastBoundary = i;
      } else if (ch === '\n') {
        const before = src.slice(0, i).trimEnd();
        const after = src.slice(i + 1).trimStart();
        const continuesFromBefore =
          before.length === 0 ||
          /[.,+\-*%&|^=!<>?:({\[]$/.test(before) ||
          /\b(?:return|const|let|var|await|typeof|void|delete|new|in|instanceof|of|else|do|try|finally)\s*$/.test(
            before,
          );
        const continuesOnAfter =
          after.length === 0 ||
          /^[.,+\-*%&|^=!<>?:)\]}]/.test(after) ||
          /^(?:in|instanceof|else|catch|finally|while)\b/.test(after);
        if (!continuesFromBefore && !continuesOnAfter) {
          lastBoundary = i;
        }
      }
    }
    i++;
  }

  return lastBoundary;
}

/**
 * Normalizes an agent JavaScript snippet into a function body that returns its trailing expression
 * using pure lexical scanning (zero `new Function` / `eval` calls).
 */
export function prepareCodeBody(code: string): string {
  const trimmed = code.trim();
  if (trimmed === '') {
    return 'return undefined;';
  }
  const withoutTrailingSemicolon = trimmed.replace(/;+\s*$/, '').trim();
  if (withoutTrailingSemicolon === '') {
    return 'return undefined;';
  }
  const stmtKeywordRe = /^(?:return|const|let|var|if|for|while|do|switch|try|throw|function|class|break|continue)\b/;
  const splitIdx = findLastTopLevelStatementBoundary(withoutTrailingSemicolon);
  if (splitIdx === -1) {
    if (!stmtKeywordRe.test(withoutTrailingSemicolon)) {
      return `return (\n${withoutTrailingSemicolon}\n);`;
    }
    return trimmed;
  }

  const prefix = withoutTrailingSemicolon
    .slice(0, splitIdx)
    .replace(/;+\s*$/, '')
    .trim();
  const suffix = withoutTrailingSemicolon.slice(splitIdx + 1).trim();
  if (prefix && suffix && !stmtKeywordRe.test(suffix)) {
    return `${prefix};\nreturn (\n${suffix}\n);`;
  }
  return trimmed;
}

/**
 * Executes an agent callback or JavaScript snippet against the type-checked Forge SDK `client`.
 * - If the snippet returns an uninvoked SDK namespace, method, or model (e.g. `client.dns.records` or `client.dns.records.create`),
 *   returns its 1-level `.d.ts` TypeScript definition.
 * - When a `TypeFeedbackError` occurs, returns `{ ok: false, error, issues, typeDefinition }` so the
 *   agent receives the exact compiler-style error and `.d.ts` definition in a single turn.
 */
export async function execute<T extends object>(
  client: T,
  schema: ApiSchema,
  codeOrFn:
    | string
    | ((
        client: T,
        searchFn: (query?: string) => string | Promise<string>,
        dtsFn: (target?: unknown) => string,
      ) => unknown | Promise<unknown>),
  options?: ExecuteOptions | undefined,
): Promise<ExecuteResult> {
  const activeSchema = filterSchema(schema, options?.include);
  const checkedClient = wrapClient(client, activeSchema);
  const searchFn = (query?: string): string | Promise<string> =>
    search(activeSchema, query, options);
  const dtsFn = (target?: unknown): string => dts(activeSchema, target);
  try {
    let value: unknown;
    if (typeof codeOrFn === 'function') {
      value = await codeOrFn(checkedClient, searchFn, dtsFn);
    } else if (options?.evaluator === false) {
      return {
        ok: false,
        error:
          'Dynamic JavaScript string evaluation in execute() is disabled (evaluator: false). Configure an `evaluator` sandbox in ExecuteOptions / createMcp or pass a callback function.',
      };
    } else {
      const body = prepareCodeBody(codeOrFn);
      if (typeof options?.evaluator === 'function') {
        const globals: Readonly<Record<string, unknown>> = {
          client: checkedClient,
          search: searchFn,
          dts: dtsFn,
          schema: activeSchema,
        };
        value = await options.evaluator(codeOrFn, globals, body);
      } else {
        let runner: (...callArgs: unknown[]) => Promise<unknown>;
        try {
          runner = new AsyncFunction('client', 'search', 'dts', body);
        } catch (compileErr: unknown) {
          if (compileErr instanceof EvalError) {
            return {
              ok: false,
              error: `Dynamic JavaScript compilation is disallowed in this runtime (${compileErr.message}). Configure an \`evaluator\` sandbox (e.g. Cloudflare Dynamic Worker isolate or VM sandbox) in createMcp / ExecuteOptions, or pass a callback function to execute().`,
            };
          }
          throw compileErr;
        }
        value = await runner(checkedClient, searchFn, dtsFn);
      }
      if (typeof value === 'function' && getSymbolPath(value) === undefined) {
        value = await (
          value as (
            c: T,
            s: (q?: string) => string | Promise<string>,
            d: (t?: unknown) => string,
          ) => unknown | Promise<unknown>
        )(checkedClient, searchFn, dtsFn);
      }
    }
    const inspectedSymbol = getSymbolPath(value);
    if (inspectedSymbol !== undefined) {
      const def = dts(activeSchema, inspectedSymbol);
      return { ok: true, result: def, typeDefinition: def };
    }
    return { ok: true, result: value };
  } catch (err: unknown) {
    if (err instanceof TypeFeedbackError) {
      return {
        ok: false,
        error: err.message,
        issues: err.issues,
        typeDefinition: err.typeDefinition,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ProgressiveMcp<T extends object> {
  readonly schema: ApiSchema;
  readonly client: T;
  search(codeOrSymbol?: string, options?: SearchOptions): string | Promise<string>;
  dts(target?: unknown, options?: SearchOptions): string;
  execute(
    codeOrFn:
      | string
      | ((
          client: T,
          searchFn: (query?: string) => string | Promise<string>,
          dtsFn: (target?: unknown) => string,
        ) => unknown | Promise<unknown>),
    options?: ExecuteOptions | undefined,
  ): Promise<ExecuteResult>;
  readonly tools: readonly [
    {
      readonly name: 'search';
      readonly description: string;
      readonly inputSchema: {
        readonly type: 'object';
        readonly properties: {
          readonly code: { readonly type: 'string'; readonly description: string };
        };
      };
      handler(args?: {
        readonly code?: string;
        readonly query?: string;
      }): string | Promise<string>;
    },
    {
      readonly name: 'execute';
      readonly description: string;
      readonly inputSchema: {
        readonly type: 'object';
        readonly required: readonly ['code'];
        readonly properties: {
          readonly code: { readonly type: 'string'; readonly description: string };
        };
      };
      handler(args: { readonly code: string }): Promise<ExecuteResult>;
    },
  ];
}

/**
 * Creates a progressive Type-Feedback MCP interface over a generated Forge SDK `client`.
 */
export function createProgressiveMcp<T extends object>(
  client: T,
  schema: ApiSchema,
  defaultOptions?: ExecuteOptions | undefined,
): ProgressiveMcp<T> {
  const activeSchema = filterSchema(schema, defaultOptions?.include);
  const checkedClient = wrapClient(client, activeSchema);
  return {
    schema: activeSchema,
    client: checkedClient,
    search(codeOrSymbol?: string, options?: SearchOptions): string | Promise<string> {
      const mergedOpts: SearchOptions | undefined =
        options !== undefined ? { ...defaultOptions, ...options } : defaultOptions;
      return search(schema, codeOrSymbol, mergedOpts);
    },
    dts(target?: unknown, options?: SearchOptions): string {
      const mergedOpts: SearchOptions | undefined =
        options !== undefined ? { ...defaultOptions, ...options } : defaultOptions;
      return dts(schema, target, mergedOpts);
    },
    execute(codeOrFn, options): Promise<ExecuteResult> {
      const mergedOpts: ExecuteOptions | undefined =
        options !== undefined ? { ...defaultOptions, ...options } : defaultOptions;
      return execute(client, schema, codeOrFn, mergedOpts);
    },
    tools: [
      {
        name: 'search',
        description:
          'Search the SDK with JavaScript against `methods`, `groups`, and `models`, or call `dts("<symbol>")` to inspect 1-level TypeScript (.d.ts) definitions and JSDoc (e.g. `methods.filter(m => m.route.includes("purge_cache"))`, `dts("dns.records.create")`). Nested models stay nominal until inspected.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'JavaScript expression/snippet filtering `methods` ({ path, group, name, httpMethod, route, summary, description }), `groups`, `models`, or `dts("<symbol>")` / symbol path (e.g. `methods.filter(m => m.route.includes("purge"))`, `dts("dns.records.create")`, or omit for top-level index).',
            },
          },
        },
        handler(args?: {
          readonly code?: string;
          readonly query?: string;
        }): string | Promise<string> {
          return search(activeSchema, args?.code ?? args?.query, defaultOptions);
        },
      },
      {
        name: 'execute',
        description:
          'Execute TypeScript/JavaScript against the generated `client` SDK instance. Returning `client.<group>` or `client.<group>.<method>` inspects its .d.ts signature; calling `await client.<group>.<method>(...)` validates arguments before making any HTTP call and returns compiler diagnostics + 1-level .d.ts definitions on any type error.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: {
              type: 'string',
              description:
                'JavaScript expression or async function body using `client` (e.g. `await client.dns.records.list({ zoneId: "..." })`).',
            },
          },
        },
        handler(args: { readonly code: string }): Promise<ExecuteResult> {
          return execute(client, activeSchema, args.code, defaultOptions);
        },
      },
    ],
  };
}
