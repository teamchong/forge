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
    value instanceof Uint8Array ||
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
  return proto === Object.prototype || proto === null;
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

const QUERY_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'how',
  'can',
  'you',
  'our',
  'all',
  'any',
  'existing',
  'new',
  'using',
]);

function stemToken(word: string): string {
  if (word.length <= 3) {
    return word;
  }
  if (word.endsWith('ies') && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (
    word.endsWith('ches') ||
    word.endsWith('shes') ||
    word.endsWith('xes') ||
    word.endsWith('zes') ||
    word.endsWith('sses')
  ) {
    return word.slice(0, -2);
  }
  if (word.endsWith('ed') && word.length > 4) {
    const base = word.slice(0, -2);
    return base.endsWith('ch') || base.endsWith('sh') ? base : word.slice(0, -1);
  }
  if (
    word.endsWith('s') &&
    !word.endsWith('ss') &&
    !word.endsWith('us') &&
    !word.endsWith('is') &&
    !word.endsWith('dns')
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function tokenizeText(text: string): Set<string> {
  const words = new Set<string>();
  const lower = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  for (const part of lower.split(/[^a-z0-9]+/)) {
    if (part.length >= 2) {
      words.add(part);
      words.add(stemToken(part));
    }
  }
  return words;
}

function tokenizeQuery(text: string): string[] {
  const lower = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const rawParts: string[] = [];
  for (const part of lower.split(/[^a-z0-9]+/)) {
    if (part.length >= 2) {
      rawParts.push(part);
    }
  }
  const filtered = rawParts.filter((p) => !QUERY_STOP_WORDS.has(p));
  const active = filtered.length > 0 ? filtered : rawParts;
  const seenStems = new Set<string>();
  const out: string[] = [];
  for (const part of active) {
    const stem = stemToken(part);
    if (!seenStems.has(stem)) {
      seenStems.add(stem);
      out.push(part);
    }
  }
  return out;
}

function normalizeRoutePattern(route: string): string {
  return route
    .trim()
    .replace(/\{[^}]+\}/g, '{}')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function searchByKeywords(schema: ApiSchema, rawQuery: string): string | undefined {
  const queryTokens = tokenizeQuery(rawQuery);
  if (queryTokens.length === 0) {
    return undefined;
  }
  const routeMatch = rawQuery.trim().match(/^(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/\S+)$/i);
  const queryHttpVerb = routeMatch?.[1]?.toUpperCase();
  const queryNormRoute = routeMatch?.[2] ? normalizeRoutePattern(routeMatch[2]) : undefined;
  const queryStems = new Set(queryTokens.map(stemToken));
  const exactMethodMatches: MethodSchema[] = [];
  const scoredMethods: { method: MethodSchema; score: number; matchedCount: number }[] = [];
  for (const group of Object.values(schema.groups)) {
    const groupWords = tokenizeText(`${group.path} ${group.description ?? ''}`);
    for (const method of group.methods) {
      const methodPathStems = new Set(tokenizeQuery(method.path).map(stemToken));
      if (
        queryNormRoute === undefined &&
        methodPathStems.size === queryStems.size &&
        Array.from(queryStems).every((s) => methodPathStems.has(s))
      ) {
        exactMethodMatches.push(method);
      }
      const pathRouteWords = tokenizeText(`${method.httpMethod} ${method.path} ${method.route}`);
      const summaryWords = tokenizeText(method.summary ?? '');
      const descWords = tokenizeText(method.description ?? '');
      let score = 0;
      let matchedCount = 0;
      for (const qt of queryTokens) {
        const qtStem = stemToken(qt);
        let tokenScore = 0;
        if (pathRouteWords.has(qt) || pathRouteWords.has(qtStem)) {
          tokenScore += 5;
        } else if (
          Array.from(pathRouteWords).some((w) => w.includes(qt) || (qtStem.length >= 3 && w.includes(qtStem)))
        ) {
          tokenScore += 3;
        }
        if (summaryWords.has(qt) || summaryWords.has(qtStem)) {
          tokenScore += 4;
        } else if (Array.from(summaryWords).some((w) => w.includes(qt) || (qtStem.length >= 3 && w.includes(qtStem)))) {
          tokenScore += 2;
        }
        if (groupWords.has(qt) || groupWords.has(qtStem)) {
          tokenScore += 2;
        }
        if (descWords.has(qt) || descWords.has(qtStem)) {
          tokenScore += 1;
        }
        if (tokenScore > 0) {
          matchedCount++;
          score += tokenScore;
        }
      }
      if (queryNormRoute !== undefined) {
        const methodNormRoute = normalizeRoutePattern(method.route);
        if (methodNormRoute === queryNormRoute) {
          score += 50;
          matchedCount = queryTokens.length;
          if (queryHttpVerb && method.httpMethod.toUpperCase() === queryHttpVerb) {
            score += 40;
          }
        }
      }
      const minRequiredMatches =
        queryTokens.length <= 1
          ? 1
          : queryTokens.length <= 3
            ? queryTokens.length - 1
            : Math.min(3, Math.ceil(queryTokens.length * 0.4));
      if (matchedCount >= minRequiredMatches) {
        const depthPenalty = method.path.split('.').length * 0.2 + method.route.split('/').length * 0.1;
        scoredMethods.push({ method, score: score + matchedCount * 10 - depthPenalty, matchedCount });
      }
    }
  }
  if (exactMethodMatches.length === 1 && exactMethodMatches[0]) {
    return `// Search match for '${rawQuery}': client.${exactMethodMatches[0].path}\n${types(schema, exactMethodMatches[0].path)}`;
  }
  if (scoredMethods.length === 0) {
    return undefined;
  }
  scoredMethods.sort((a, b) => b.score - a.score || a.method.path.localeCompare(b.method.path));
  const maxMatched = scoredMethods.reduce((max, m) => (m.matchedCount > max ? m.matchedCount : max), 0);
  const bestMatches = scoredMethods.filter((m) => m.matchedCount === maxMatched);
  const topPool = maxMatched >= 2 && bestMatches.length > 0 ? bestMatches : scoredMethods;
  if (topPool.length === 1 && topPool[0]) {
    return `// Search match for '${rawQuery}': client.${topPool[0].method.path}\n${types(schema, topPool[0].method.path)}`;
  }
  if (queryNormRoute !== undefined && queryHttpVerb !== undefined && topPool[0]) {
    const topMethod = topPool[0].method;
    if (
      normalizeRoutePattern(topMethod.route) === queryNormRoute &&
      topMethod.httpMethod.toUpperCase() === queryHttpVerb
    ) {
      return `// Search match for '${rawQuery}': client.${topMethod.path}\n${types(schema, topMethod.path)}`;
    }
  }
  const byGroup = new Map<string, { maxScore: number; methods: MethodSchema[] }>();
  for (const { method, score } of topPool) {
    const dot = method.path.lastIndexOf('.');
    const gPath = dot !== -1 ? method.path.slice(0, dot) : '';
    const existing = byGroup.get(gPath);
    if (!existing) {
      byGroup.set(gPath, { maxScore: score, methods: [method] });
    } else {
      if (score > existing.maxScore) {
        existing.maxScore = score;
      }
      existing.methods.push(method);
    }
  }

  // When > 12 methods match across multiple groups, roll up by group so all matching groups fit in ~300-500 tokens without truncation
  if (topPool.length > 12 && byGroup.size > 2) {
    const sortedGroups = Array.from(byGroup.entries()).sort(
      (a, b) => b[1].maxScore - a[1].maxScore || b[1].methods.length - a[1].methods.length || a[0].localeCompare(b[0]),
    );
    const lines: string[] = [
      `// Search matches for '${rawQuery}' (${topPool.length} matching methods across ${byGroup.size} groups — call types("<group>") or types("<group>.<method>") to drill down):`,
      'export interface SearchMatches {',
    ];
    for (const [gPath, info] of sortedGroups.slice(0, 30)) {
      const methodNames = info.methods.map((m) => m.name);
      const previewNames =
        methodNames.length > 6
          ? `${methodNames.slice(0, 6).join(', ')}, +${methodNames.length - 6}`
          : methodNames.join(', ');
      const sampleRoute = info.methods[0]?.route ?? '';
      lines.push(
        `  readonly ${formatPropertyKey(gPath)}: ${gPath}.Client; // ${info.methods.length} matching: ${previewNames} (${sampleRoute})`,
      );
    }
    if (sortedGroups.length > 30) {
      lines.push(`  // ... +${sortedGroups.length - 30} more groups (use a more specific search term)`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  const top = topPool.slice(0, 12);
  const lines: string[] = [
    `// Search matches for '${rawQuery}' (${topPool.length} matching methods; call types("<methodPath>") for full request/response types):`,
  ];
  const topByGroup = new Map<string, MethodSchema[]>();
  for (const { method } of top) {
    const dot = method.path.lastIndexOf('.');
    const gPath = dot !== -1 ? method.path.slice(0, dot) : '';
    const list = topByGroup.get(gPath) ?? [];
    list.push(method);
    topByGroup.set(gPath, list);
  }
  for (const [gPath, methods] of topByGroup.entries()) {
    lines.push(`\n// Group: client.${gPath}`);
    lines.push(`export namespace ${gPath} {`);
    lines.push('  export interface Client {');
    for (const m of methods) {
      lines.push(renderMethodSignature(m, '    ', true));
    }
    lines.push('  }');
    lines.push('}');
  }
  return lines.join('\n');
}

/**
 * Returns a progressive 1-level `.d.ts` TypeScript & JSDoc definition for a symbol path in the SDK.
 *
 * Examples:
 * - `types(schema)` or `types(schema, "client")` -> top-level `Client` namespaces
 * - `types(schema, "dns.records")` -> 1-level `dns.records.Client` methods & sub-groups
 * - `types(schema, "dns.records.create")` -> method signature + 1-level `CreateRequest` & `CreateResponse`
 * - `types(schema, "dns.records.RecordSettings")` -> 1-level `RecordSettings` model declaration
 */
export function types(schema: ApiSchema, rawSymbol?: string): string {
  const cleaned = (rawSymbol ?? '')
    .trim()
    .replace(/^await\s+/, '')
    .replace(/^client\.?/, '')
    .replace(/\(.*\)$/, '')
    .replace(/\.Client$/, '')
    .trim();
  const camelized = cleaned
    .split('.')
    .map((seg) => seg.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()))
    .join('.');
  const trimmed =
    cleaned !== '' &&
    !schema.groups[cleaned] &&
    !schema.models[cleaned] &&
    (schema.groups[camelized] !== undefined ||
      schema.models[camelized] !== undefined ||
      (camelized.includes('.') && schema.groups[camelized.slice(0, camelized.lastIndexOf('.'))] !== undefined))
      ? camelized
      : cleaned;

  // 1. Root Client view
  if (trimmed === '' || trimmed === 'Client') {
    const lines: string[] = [];
    const totalGroups = Object.keys(schema.groups).length;
    const totalMethods = Object.values(schema.groups).reduce((sum, g) => sum + g.methods.length, 0);
    const totalModels = Object.keys(schema.models).length;
    lines.push(`// API Version: ${schema.version}${schema.baseUrl ? ` | Base URL: ${schema.baseUrl}` : ''}`);
    lines.push(`// ${totalGroups} groups, ${totalMethods} methods, ${totalModels} models`);
    lines.push('// Tip: inspect `client.<group>` or call `types("<group>.<method>")` to drill down 1 level at a time.');
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
        ? `\n\n// Referenced models (use types("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
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
          blocks.push(`// Referenced models (use types("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`);
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
            ? `\n\n// Referenced models (use types("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
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
            ? `\n\n// Referenced models (use types("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
            : '';
        return `// Response type for client.${respMethod.path}\n${respDecl}${footer}`;
      }
    }
  }

  // 5. Unqualified model name lookup (e.g. "RecordSettings" when unique or matching models)
  const matchingModels = Object.values(schema.models).filter((m) => m.name === trimmed || m.schemaName === trimmed);
  if (matchingModels.length === 1) {
    return types(schema, matchingModels[0]!.path);
  }
  if (matchingModels.length > 1) {
    return (
      `Multiple models match '${trimmed}': ${matchingModels.map((m) => m.path).join(', ')}.\n\n` +
      types(schema, matchingModels[0]!.path)
    );
  }
  // 6. Suffix match on group or method path (e.g. "access.applications" -> "zeroTrust.access.applications")
  const lowerSuffix = `.${trimmed.toLowerCase()}`;
  const suffixGroups = Object.keys(schema.groups).filter((g) => g.toLowerCase().endsWith(lowerSuffix));
  if (suffixGroups.length === 1 && suffixGroups[0]) {
    return `// Note: '${trimmed}' is located at 'client.${suffixGroups[0]}'\n${types(schema, suffixGroups[0])}`;
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
    return `// Note: '${trimmed}' is located at 'client.${suffixMethods[0]}'\n${types(schema, suffixMethods[0])}`;
  }

  // 7. Keyword / route / summary search when symbol is not an exact path (e.g. "kv", "purge cache", "/storage/kv")
  if (lastDot === -1 || trimmed.includes(' ') || !schema.groups[trimmed.slice(0, lastDot)]) {
    const keywordResults = searchByKeywords(schema, trimmed);
    if (keywordResults !== undefined) {
      return keywordResults;
    }
  }

  // 8. Symbol not found -> provide closest suggestions + parent group popup if prefix matched
  const suggestions = findSuggestions(schema, trimmed);
  const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.map((s) => `'${s}'`).join(', ')}?` : '';
  if (lastDot !== -1) {
    const parentPath = trimmed.slice(0, lastDot);
    if (schema.groups[parentPath]) {
      return `TS2339: Symbol '${trimmed}' does not exist on '${parentPath}'.${suggestionText}\n\n${types(schema, parentPath)}`;
    }
  }
  return `TS2304: Cannot find symbol '${trimmed}'.${suggestionText}`;
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
        const flatObj = resolveFlatObjectType(schema, body.type);
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
    const definitions: string[] = [types(schema, method.path)];
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
        definitions.push(types(schema, issue.symbol));
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

/**
 * Wraps a generated Forge SDK `Client` in a progressive type-feedback `Proxy`.
 * Unknown property accesses and invalid method arguments throw a `TypeFeedbackError`
 * with compiler diagnostics and the relevant `.d.ts` type definition BEFORE any HTTP request is made.
 * Returning an uninvoked namespace, method, or model from `execute()` inspects its 1-level `.d.ts` signature.
 */
export interface ExecuteOptions {
  /**
   * Default parameter values for the session (e.g. `{ orgId: 'org_123' }`).
   * Automatically injected into methods that declare a matching required parameter
   * when omitted by the caller.
   */
  readonly defaultParams?: Readonly<Record<string, unknown>> | undefined;
  /**
   * Custom guidance messages for required parameters when omitted by both the caller
   * and `defaultParams` (e.g. `{ orgId: 'Select an organization first with orgs.list.' }`).
   */
  readonly unresolvedParams?: Readonly<Record<string, string>> | undefined;
  /**
   * Override base URL when building requests in `plan()`.
   */
  readonly baseUrl?: string | undefined;
}

class MissingParamError extends Error {
  readonly param: string;
  readonly methodPath: string;
  constructor(message: string, param: string, methodPath: string) {
    super(message);
    this.name = 'MissingParamError';
    this.param = param;
    this.methodPath = methodPath;
  }
}

interface CallLogEntry {
  readonly methodSchema: MethodSchema;
  status?: number | undefined;
}

interface WrapContext {
  readonly options?: ExecuteOptions | undefined;
  readonly callLog?: CallLogEntry[] | undefined;
  readonly onPlanRequest?: ((method: MethodSchema, reqArg: unknown) => never) | undefined;
}

function resolveDefaultArgs(
  methodSchema: MethodSchema,
  args: unknown[],
  options?: ExecuteOptions | undefined,
): unknown[] {
  const defaultParams = options?.defaultParams;
  const unresolvedParams = options?.unresolvedParams;
  if (!defaultParams && !unresolvedParams) {
    return args;
  }
  const requiredParams = methodSchema.requestParams.filter(
    (p) =>
      p.required &&
      ((defaultParams !== undefined && (p.name in defaultParams || p.wireName in defaultParams)) ||
        (unresolvedParams !== undefined && (p.name in unresolvedParams || p.wireName in unresolvedParams))),
  );
  if (requiredParams.length === 0) {
    return args;
  }
  const first = args[0];
  const record = isPlainRecord(first) ? first : undefined;
  let injected: Record<string, unknown> | undefined;
  for (const param of requiredParams) {
    const existing = record?.[param.name] ?? record?.[param.wireName];
    if (existing !== undefined && existing !== '') {
      continue;
    }
    const fallback = defaultParams?.[param.name] ?? defaultParams?.[param.wireName];
    if (fallback !== undefined && fallback !== '') {
      injected ??= record ? { ...record } : {};
      injected[param.name] = fallback;
      continue;
    }
    const unresolvedMessage = unresolvedParams?.[param.name] ?? unresolvedParams?.[param.wireName];
    if (unresolvedMessage !== undefined) {
      throw new MissingParamError(unresolvedMessage, param.name, methodSchema.path);
    }
  }
  if (!injected) {
    return args;
  }
  return first === undefined ? [injected] : [injected, ...args.slice(1)];
}

/**
 * Wraps a generated Forge SDK `Client` in a progressive type-feedback `Proxy`.
 * Unknown property accesses and invalid method arguments throw a `TypeFeedbackError`
 * with compiler diagnostics and the relevant `.d.ts` type definition BEFORE any HTTP request is made.
 * Returning an uninvoked namespace, method, or model from `execute()` inspects its 1-level `.d.ts` signature.
 */
export function wrapClient<T extends object>(
  client: T,
  schema: ApiSchema,
  groupPath = '',
  ctx?: WrapContext | undefined,
): T {
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
      const group = groupPath === '' ? undefined : schema.groups[groupPath];
      const isChildGroup =
        groupPath === '' ? schema.rootChildren.includes(prop) : (group?.children.includes(prop) ?? false);
      const methodSchema = group?.methods.find((m) => m.name === prop);
      const modelSchema = schema.models[fullPath];

      if (!isChildGroup && !methodSchema) {
        if (modelSchema) {
          const modelHandle = Object.freeze({ [SYMBOL_PATH]: fullPath });
          cache.set(prop, modelHandle);
          return modelHandle;
        }
        const available =
          groupPath === ''
            ? schema.rootChildren
            : [...(group?.children ?? []), ...(group?.methods.map((m) => m.name) ?? [])];
        const closest = available
          .map((name) => ({ name, dist: editDistance(prop, name) }))
          .sort((a, b) => a.dist - b.dist)[0];
        const ownerType = groupPath === '' ? 'Client' : `${groupPath}.Client`;
        const lowerSuffix = `.${fullPath.toLowerCase()}`;
        const suffixGroup = Object.keys(schema.groups).find((g) => g.toLowerCase().endsWith(lowerSuffix));
        const keywordMatches = !suffixGroup && groupPath === '' ? searchByKeywords(schema, fullPath) : undefined;
        const hint = suffixGroup
          ? ` Did you mean 'client.${suffixGroup}'?`
          : closest && closest.dist <= 3
            ? ` Did you mean '${closest.name}'?`
            : available.length > 0
              ? ` Available on '${ownerType}': ${available.slice(0, 8).join(', ')}.`
              : '';
        const defBody = suffixGroup ? types(schema, suffixGroup) : (keywordMatches ?? types(schema, groupPath));
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
      if (methodSchema && (typeof rawValue === 'function' || ctx?.onPlanRequest !== undefined)) {
        const wrappedFn = (...args: unknown[]) => {
          const effectiveArgs = resolveDefaultArgs(methodSchema, args, ctx?.options);
          validateMethodCall(schema, methodSchema, effectiveArgs);
          if (ctx?.onPlanRequest) {
            return ctx.onPlanRequest(methodSchema, effectiveArgs[0]);
          }
          const logEntry: CallLogEntry = { methodSchema };
          ctx?.callLog?.push(logEntry);
          const res = (rawValue as (...callArgs: unknown[]) => unknown).apply(target, effectiveArgs);
          if (res instanceof Promise) {
            return res.then(
              (val) => {
                logEntry.status = 200;
                if (isPlainRecord(val) && isPlainRecord(val['result'])) {
                  const respFlat = methodSchema.responseType
                    ? resolveFlatObjectType(schema, methodSchema.responseType, new Set(), true)
                    : undefined;
                  if (respFlat && !respFlat.fields.some((f) => f.name === 'result')) {
                    return { ...val['result'], ...val };
                  }
                }
                return val;
              },
              (err: unknown) => {
                if (typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number') {
                  logEntry.status = err.status;
                }
                throw err;
              },
            );
          }
          logEntry.status = 200;
          return res;
        };
        Object.defineProperty(wrappedFn, SYMBOL_PATH, { value: fullPath });
        if (isChildGroup) {
          const childTarget = typeof rawValue === 'object' && rawValue !== null ? rawValue : {};
          const childProxy = wrapClient(childTarget, schema, fullPath, ctx);
          const hybrid = new Proxy(wrappedFn, {
            has(fnTarget, childProp) {
              return (
                childProp === SYMBOL_PATH || Reflect.has(childProxy, childProp) || Reflect.has(fnTarget, childProp)
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
          (typeof rawValue === 'object' || typeof rawValue === 'function') && rawValue !== null ? rawValue : {};
        const wrappedGroup = wrapClient(childTarget, schema, fullPath, ctx);
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
      readonly status?: number | undefined;
      readonly extensions?: Readonly<Record<string, unknown>> | undefined;
      readonly replaySafe?: boolean | undefined;
      readonly missingParam?: string | undefined;
    };

export type CallPlan =
  | {
      readonly kind: 'request';
      readonly method: string;
      readonly url: string;
      readonly route: string;
      readonly methodPath: string;
      readonly headers: Record<string, string>;
      readonly body?: string | undefined;
      readonly extensions?: Readonly<Record<string, unknown>> | undefined;
      readonly pathParams?: Readonly<Record<string, string>> | undefined;
    }
  | {
      readonly kind: 'missing_param';
      readonly param: string;
      readonly message: string;
      readonly methodPath: string;
    }
  | {
      readonly kind: 'invalid';
      readonly error: string;
      readonly issues?: readonly ValidationIssue[] | undefined;
      readonly typeDefinition?: string | undefined;
    };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...callArgs: unknown[]) => Promise<unknown>;

function prepareCodeBody(code: string): string {
  const trimmed = code.trim();
  if (trimmed === '') {
    return 'return undefined;';
  }
  const withoutTrailingSemicolon = trimmed.replace(/;+\s*$/, '');
  const stmtKeywordRe = /^(return|const|let|var|if|for|while|switch|try|throw|function|class)\b/;
  if (!stmtKeywordRe.test(withoutTrailingSemicolon)) {
    const candidate = `return (\n${withoutTrailingSemicolon}\n);`;
    try {
      new AsyncFunction('client', 'search', 'types', candidate);
      return candidate;
    } catch {
      // Multi-statement body; fall through
    }
  }
  for (let i = withoutTrailingSemicolon.length - 1; i >= 0; i--) {
    const ch = withoutTrailingSemicolon[i];
    if (ch !== ';' && ch !== '\n') {
      continue;
    }
    const prefix = withoutTrailingSemicolon.slice(0, i).trim();
    const suffix = withoutTrailingSemicolon.slice(i + 1).trim();
    if (!prefix || !suffix || stmtKeywordRe.test(suffix)) {
      continue;
    }
    const candidate = `${prefix};\nreturn (\n${suffix}\n);`;
    try {
      new AsyncFunction('client', 'search', 'types', candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return trimmed;
}
function isCallLogReplaySafe(callLog: readonly CallLogEntry[]): boolean {
  return callLog.every(
    (entry) =>
      entry.methodSchema.httpMethod === 'GET' ||
      entry.methodSchema.httpMethod === 'HEAD' ||
      entry.status === 401 ||
      entry.status === 403,
  );
}

/**
 * Executes an agent callback or JavaScript snippet against the type-checked Forge SDK `client`.
 * - If the snippet returns an uninvoked SDK namespace, method, or model (e.g. `client.dns.records` or `client.dns.records.create`),
 *   returns its 1-level `.d.ts` TypeScript definition.
 * - When a `TypeFeedbackError` occurs, returns `{ ok: false, error, issues, typeDefinition, replaySafe: true }` so the
 *   agent receives the exact compiler-style error and `.d.ts` definition in a single turn.
 * - When an HTTP 401/403 refusal occurs, surfaces `status`, `extensions` (OpenAPI `x-*` metadata), and `replaySafe`.
 */
export async function execute<T extends object>(
  client: T,
  schema: ApiSchema,
  codeOrFn: string | ((client: T, typesFn: (symbol?: string) => string) => unknown | Promise<unknown>),
  options?: ExecuteOptions | undefined,
): Promise<ExecuteResult> {
  const callLog: CallLogEntry[] = [];
  const checkedClient = wrapClient(client, schema, '', { options, callLog });
  const typesFn = (symbol?: string) => types(schema, symbol);
  try {
    let value: unknown;
    if (typeof codeOrFn === 'function') {
      value = await codeOrFn(checkedClient, typesFn);
    } else {
      const runner = new AsyncFunction('client', 'search', 'types', prepareCodeBody(codeOrFn));
      value = await runner(checkedClient, typesFn, typesFn);
    }
    if (typeof value === 'function' && getSymbolPath(value) === undefined) {
      value = await (value as (c: T, t: (s?: string) => string) => unknown)(checkedClient, typesFn);
    }
    const inspectedSymbol = getSymbolPath(value);
    if (inspectedSymbol !== undefined) {
      const def = types(schema, inspectedSymbol);
      return { ok: true, result: def, typeDefinition: def };
    }
    return { ok: true, result: value };
  } catch (err) {
    const replaySafe = isCallLogReplaySafe(callLog);
    if (err instanceof TypeFeedbackError) {
      return {
        ok: false,
        error: err.message,
        issues: err.issues,
        typeDefinition: err.typeDefinition,
        replaySafe,
      };
    }
    if (err instanceof MissingParamError) {
      return {
        ok: false,
        error: err.message,
        missingParam: err.param,
        replaySafe,
      };
    }
    const lastCall = callLog[callLog.length - 1];
    const status =
      typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
        ? err.status
        : undefined;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status,
      extensions: lastCall?.methodSchema.extensions,
      replaySafe,
    };
  }
}

function encodeWireValue(
  schema: ApiSchema,
  type: TypeSchema | undefined,
  value: unknown,
  seen = new Set<string>(),
): unknown {
  if (!type || value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (type.kind === 'model') {
    if (seen.has(type.model)) {
      return value;
    }
    const model = schema.models[type.model];
    if (!model) {
      return value;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(type.model);
    return encodeWireValue(schema, model.type, value, nextSeen);
  }
  if (type.kind === 'union') {
    for (const member of type.members) {
      const trial: ValidationIssue[] = [];
      validateValue(schema, member, value, 'body', trial, undefined, new Set());
      if (trial.length === 0) {
        return encodeWireValue(schema, member, value, seen);
      }
    }
  }
  if (Array.isArray(value)) {
    return type.kind === 'array' ? value.map((item) => encodeWireValue(schema, type.elem, item, seen)) : value;
  }
  const flatObj = resolveFlatObjectType(schema, type, new Set(), true);
  if (flatObj && isPlainRecord(value)) {
    const byName = new Map<string, FieldSchema>();
    for (const f of flatObj.fields) {
      byName.set(f.name, f);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) {
        continue;
      }
      const field = byName.get(k);
      if (field) {
        out[field.wireName] = encodeWireValue(schema, field.type, v, seen);
      } else {
        out[k] = encodeWireValue(schema, flatObj.extra, v, seen);
      }
    }
    return out;
  }
  return value;
}

class PlannedCallSignal {
  readonly plan: CallPlan;
  constructor(plan: CallPlan) {
    this.plan = plan;
  }
}

function buildCallPlan(
  schema: ApiSchema,
  method: MethodSchema,
  reqArg: unknown,
  options?: ExecuteOptions | undefined,
): CallPlan {
  const baseUrl = (options?.baseUrl ?? schema.baseUrl ?? 'http://localhost').replace(/\/+$/, '');
  const rec = isPlainRecord(reqArg) ? reqArg : {};
  let resolvedPath = method.route;
  const paramNames = new Set<string>();
  const pathParams: Record<string, string> = {};
  for (const param of method.requestParams) {
    paramNames.add(param.name);
    const val = rec[param.name];
    if (param.location === 'path' && val !== undefined) {
      pathParams[param.name] = String(val);
      resolvedPath = resolvedPath.replace(`{${param.name}}`, encodeURIComponent(String(val)));
    }
  }
  const url = new URL(`${baseUrl}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`);
  for (const param of method.requestParams) {
    if (param.location === 'query') {
      const val = rec[param.name];
      if (val !== undefined && val !== null) {
        url.searchParams.set(param.wireName, String(val));
      }
    }
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  let bodyStr: string | undefined;
  if (method.requestBody) {
    let rawBody: unknown;
    if (method.requestFlat) {
      const bodyObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) {
        if (!paramNames.has(k) && v !== undefined) {
          bodyObj[k] = v;
        }
      }
      rawBody = encodeWireValue(schema, method.requestBody.type, bodyObj);
    } else {
      rawBody = encodeWireValue(schema, method.requestBody.type, rec['body']);
    }
    if (rawBody !== undefined) {
      headers['content-type'] = 'application/json';
      bodyStr = JSON.stringify(rawBody);
    }
  }
  return {
    kind: 'request',
    method: method.httpMethod,
    url: url.toString(),
    route: method.route,
    methodPath: method.path,
    headers,
    body: bodyStr,
    extensions: method.extensions,
    pathParams: Object.keys(pathParams).length > 0 ? pathParams : undefined,
  };
}

/**
 * Plans an SDK call in a credential-free isolate without making any network request.
 * Validates types, resolves `defaultParams`, encodes `camelCase` SDK properties into wire JSON,
 * and returns the `CallPlan` (`request` with OpenAPI `extensions`, `missing_param`, or `invalid`).
 */
export async function plan<T extends object>(
  client: T,
  schema: ApiSchema,
  codeOrFn: string | ((client: T, typesFn: (symbol?: string) => string) => unknown | Promise<unknown>),
  options?: ExecuteOptions | undefined,
): Promise<CallPlan> {
  const checkedClient = wrapClient(client, schema, '', {
    options,
    onPlanRequest(methodSchema, reqArg) {
      throw new PlannedCallSignal(buildCallPlan(schema, methodSchema, reqArg, options));
    },
  });
  const typesFn = (symbol?: string) => types(schema, symbol);
  try {
    let value: unknown;
    if (typeof codeOrFn === 'function') {
      value = await codeOrFn(checkedClient, typesFn);
    } else {
      const runner = new AsyncFunction('client', 'search', 'types', prepareCodeBody(codeOrFn));
      value = await runner(checkedClient, typesFn, typesFn);
    }
    if (typeof value === 'function' && getSymbolPath(value) === undefined) {
      await (value as (c: T, t: (s?: string) => string) => unknown)(checkedClient, typesFn);
    }
    return {
      kind: 'invalid',
      error: 'Code did not invoke any SDK method on `client`.',
    };
  } catch (err) {
    if (err instanceof PlannedCallSignal) {
      return err.plan;
    }
    if (err instanceof MissingParamError) {
      return {
        kind: 'missing_param',
        param: err.param,
        message: err.message,
        methodPath: err.methodPath,
      };
    }
    if (err instanceof TypeFeedbackError) {
      return {
        kind: 'invalid',
        error: err.message,
        issues: err.issues,
        typeDefinition: err.typeDefinition,
      };
    }
    return {
      kind: 'invalid',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface McpResource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType: 'application/typescript';
}

export interface McpResourceTemplate {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: 'application/typescript';
}

export interface McpResourceContent {
  readonly uri: string;
  readonly mimeType: 'application/typescript';
  readonly text: string;
}

/**
 * Lists MCP resources (`resources/list`) for the SDK's groups.
 * - Includes `forge://types` for the top-level `Client` index and `forge://types/<group>` for every top-level SDK group.
 * - When `options.allGroups` is true (or total groups <= 64), also lists nested subgroups.
 */
export function listResources(
  schema: ApiSchema,
  options?: { readonly allGroups?: boolean | undefined } | undefined,
): McpResource[] {
  const rootSummary = firstSummaryLine(schema.description);
  const out: McpResource[] = [
    {
      uri: 'forge://types',
      name: 'client',
      description: rootSummary ? `${rootSummary} (top-level SDK index)` : 'Top-level SDK client index (.d.ts)',
      mimeType: 'application/typescript',
    },
  ];
  const groupKeys =
    (options?.allGroups ?? Object.keys(schema.groups).length <= 64) ? Object.keys(schema.groups) : schema.rootChildren;
  for (const groupPath of groupKeys) {
    const group = schema.groups[groupPath];
    if (!group) {
      continue;
    }
    const methodCount = countGroupMethods(schema, groupPath);
    const childPreview =
      group.children.length > 0
        ? `subgroups: ${group.children.slice(0, 6).join(', ')}${group.children.length > 6 ? `, +${group.children.length - 6} more` : ''}; ${methodCount} methods`
        : `${methodCount} method${methodCount === 1 ? '' : 's'}`;
    const summary = firstSummaryLine(group.description);
    out.push({
      uri: `forge://types/${groupPath}`,
      name: `client.${groupPath}`,
      description: summary ? `${summary} (${childPreview})` : childPreview,
      mimeType: 'application/typescript',
    });
  }
  return out;
}

/**
 * Lists MCP resource templates (`resources/templates/list`) for drilling into any SDK symbol or search query.
 */
export function listResourceTemplates(): McpResourceTemplate[] {
  return [
    {
      uriTemplate: 'forge://types/{symbol}',
      name: 'SDK Type Definition (.d.ts)',
      description:
        'Progressive 1-level TypeScript (.d.ts) declaration for any SDK group (e.g. forge://types/dns.records), method (e.g. forge://types/dns.records.create), model (e.g. forge://types/dns.records.RecordSettings), or search query.',
      mimeType: 'application/typescript',
    },
  ];
}

/**
 * Reads an MCP resource URI (`resources/read`, e.g. `forge://types`, `forge://types/dns.records`, `forge://types/dns/records/create`)
 * and returns its 1-level `.d.ts` TypeScript definition.
 */
export function readResource(schema: ApiSchema, uri: string): McpResourceContent {
  const trimmed = uri.trim();
  let rawSymbol = trimmed.replace(/^forge:\/\/(?:types|client)\/?/i, '');
  try {
    rawSymbol = decodeURIComponent(rawSymbol);
  } catch {
    // Keep rawSymbol if percent-decoding fails
  }
  if (
    rawSymbol.includes('/') &&
    !rawSymbol.includes(' ') &&
    !schema.groups[rawSymbol] &&
    (schema.groups[rawSymbol.replace(/\//g, '.')] !== undefined ||
      schema.models[rawSymbol.replace(/\//g, '.')] !== undefined ||
      schema.groups[rawSymbol.replace(/\//g, '.').slice(0, rawSymbol.lastIndexOf('/'))] !== undefined)
  ) {
    rawSymbol = rawSymbol.replace(/\//g, '.');
  }
  const canonicalUri =
    rawSymbol === '' || rawSymbol === 'client' || rawSymbol === 'Client'
      ? 'forge://types'
      : trimmed.startsWith('forge://')
        ? trimmed
        : `forge://types/${rawSymbol}`;
  return {
    uri: canonicalUri,
    mimeType: 'application/typescript',
    text: types(schema, rawSymbol === '' ? undefined : rawSymbol),
  };
}

export function search(schema: ApiSchema, query?: string): string {
  return types(schema, query);
}

export interface ProgressiveMcp<T extends object> {
  readonly schema: ApiSchema;
  readonly client: T;
  search(query?: string): string;
  types(symbol?: string): string;
  execute(
    codeOrFn: string | ((client: T, typesFn: (symbol?: string) => string) => unknown | Promise<unknown>),
    options?: ExecuteOptions | undefined,
  ): Promise<ExecuteResult>;
  plan(
    codeOrFn: string | ((client: T, typesFn: (symbol?: string) => string) => unknown | Promise<unknown>),
    options?: ExecuteOptions | undefined,
  ): Promise<CallPlan>;
  readonly resources: readonly McpResource[];
  readonly resourceTemplates: readonly McpResourceTemplate[];
  readResource(uri: string): McpResourceContent;
  readonly tools: readonly [
    {
      readonly name: 'search';
      readonly description: string;
      readonly inputSchema: {
        readonly type: 'object';
        readonly properties: {
          readonly query: {
            readonly type: 'string';
            readonly description: string;
          };
          readonly symbol: {
            readonly type: 'string';
            readonly description: string;
          };
        };
      };
      handler(args?: { readonly query?: string; readonly symbol?: string }): string;
    },
    {
      readonly name: 'execute';
      readonly description: string;
      readonly inputSchema: {
        readonly type: 'object';
        readonly required: readonly ['code'];
        readonly properties: {
          readonly code: {
            readonly type: 'string';
            readonly description: string;
          };
          readonly params?: {
            readonly type: 'object';
            readonly description: string;
          };
        };
      };
      handler(args: {
        readonly code: string;
        readonly params?: Readonly<Record<string, unknown>> | undefined;
      }): Promise<ExecuteResult>;
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
  const checkedClient = wrapClient(client, schema, '', { options: defaultOptions });
  const resources = listResources(schema);
  const resourceTemplates = listResourceTemplates();
  return {
    schema,
    client: checkedClient,
    search(query?: string): string {
      return types(schema, query);
    },
    types(symbol?: string): string {
      return types(schema, symbol);
    },
    execute(codeOrFn, options): Promise<ExecuteResult> {
      return execute(client, schema, codeOrFn, options ?? defaultOptions);
    },
    plan(codeOrFn, options): Promise<CallPlan> {
      return plan(client, schema, codeOrFn, options ?? defaultOptions);
    },
    resources,
    resourceTemplates,
    readResource(uri: string): McpResourceContent {
      return readResource(schema, uri);
    },
    tools: [
      {
        name: 'search',
        description:
          'Search or inspect 1-level TypeScript (.d.ts) definitions and JSDoc for any SDK namespace, method, model, HTTP route, or keyword query (e.g. "dns.records", "dns.records.create", "purge cache", "POST /zones/{zoneId}/dns_records"). Nested models stay nominal until inspected.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Search query, HTTP route, or dot-separated SDK symbol path (e.g. "purge cache", "kv", "dns.records", "dns.records.create", or omit for top-level index).',
            },
            symbol: {
              type: 'string',
              description:
                'Alias for `query`: dot-separated SDK symbol path or search term (e.g. "dns.records.create").',
            },
          },
        },
        handler(args?: { readonly query?: string; readonly symbol?: string }): string {
          return types(schema, args?.query ?? args?.symbol);
        },
      },
      {
        name: 'execute',
        description:
          'Execute TypeScript/JavaScript against the generated `client` SDK instance. Returning `client.<group>` or `client.<group>.<method>` inspects its .d.ts types; calling `await client.<group>.<method>(...)` validates arguments before making any HTTP call and returns compiler diagnostics + 1-level .d.ts definitions on any type error.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: {
              type: 'string',
              description:
                'JavaScript expression or async function body using `client` (e.g. `await client.dns.records.list({ zoneId: "..." })`).',
            },
            params: {
              type: 'object',
              description:
                'Optional default parameter values automatically injected into methods that declare a matching required parameter when omitted in `code`.',
            },
          },
        },
        handler(args: {
          readonly code: string;
          readonly params?: Readonly<Record<string, unknown>> | undefined;
        }): Promise<ExecuteResult> {
          const opts: ExecuteOptions | undefined =
            args.params !== undefined
              ? {
                  ...defaultOptions,
                  defaultParams: { ...defaultOptions?.defaultParams, ...args.params },
                }
              : defaultOptions;
          return execute(client, schema, args.code, opts);
        },
      },
    ],
  };
}
