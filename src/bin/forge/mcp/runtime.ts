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
 * and progressive 1-level `.d.ts` type popups for immediate self-correction.
 */
export class TypeFeedbackError extends Error {
  readonly issues: readonly ValidationIssue[];
  readonly typePopup: string;

  constructor(issues: readonly ValidationIssue[], typePopup: string) {
    const summary = issues.map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`).join('\n');
    super(`${summary}\n\n--- Progressive Type Popup ---\n${typePopup}`);
    this.name = 'TypeFeedbackError';
    this.issues = issues;
    this.typePopup = typePopup;
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

function collectReferencedModels(type: TypeSchema | undefined, out: Set<string>): void {
  if (!type) {
    return;
  }
  switch (type.kind) {
    case 'model':
      out.add(type.model);
      break;
    case 'array':
      collectReferencedModels(type.elem, out);
      break;
    case 'object':
      for (const field of type.fields) {
        collectReferencedModels(field.type, out);
      }
      collectReferencedModels(type.extra, out);
      break;
    case 'union':
    case 'intersection':
      for (const member of type.members) {
        collectReferencedModels(member, out);
      }
      break;
    case 'scalar':
    case 'enum':
      break;
  }
}

function formatTypeExpr(type: TypeSchema, prec: 'top' | 'union' | 'intersection' | 'postfix' = 'top'): string {
  switch (type.kind) {
    case 'scalar':
      return type.scalar;
    case 'model':
      return type.model;
    case 'enum': {
      if (type.values.length === 0) {
        return 'never';
      }
      const joined = type.values.map(formatLiteral).join(' | ');
      return type.values.length > 1 && (prec === 'intersection' || prec === 'postfix') ? `(${joined})` : joined;
    }
    case 'array':
      return `${formatTypeExpr(type.elem, 'postfix')}[]`;
    case 'object': {
      const parts: string[] = [];
      for (const field of type.fields) {
        if (field.readonly) {
          continue;
        }
        const opt = field.required ? '' : '?';
        parts.push(`${formatPropertyKey(field.name)}${opt}: ${formatTypeExpr(field.type, 'top')}`);
      }
      if (type.extra) {
        parts.push(`[key: string]: ${formatTypeExpr(type.extra, 'top') === 'unknown' ? 'unknown' : 'unknown'}`);
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
      const joined = type.members.map((m) => formatTypeExpr(m, 'union')).join(' | ');
      return type.members.length > 1 && (prec === 'intersection' || prec === 'postfix') ? `(${joined})` : joined;
    }
    case 'intersection': {
      if (type.members.length === 0) {
        return 'unknown';
      }
      const joined = type.members.map((m) => formatTypeExpr(m, 'intersection')).join(' & ');
      return type.members.length > 1 && prec === 'postfix' ? `(${joined})` : joined;
    }
  }
}

function renderFieldsBlock(
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
    const doc = formatJsDoc(field.description, field.deprecated, indent);
    const ro = field.readonly ? 'readonly ' : '';
    const opt = field.required ? '' : '?';
    const locComment = field.location ? ` // ${field.location} param` : '';
    lines.push(
      `${doc}${indent}${ro}${formatPropertyKey(field.name)}${opt}: ${formatTypeExpr(field.type)};${locComment}`,
    );
  }
  if (extra) {
    const keyType = hasKeptField ? 'unknown' : formatTypeExpr(extra);
    lines.push(`${indent}[key: string]: ${keyType};`);
  }
  return lines.join('\n');
}

function renderMethodSignature(method: MethodSchema, indent = '  ', brief = false): string {
  const docText = brief
    ? firstSummaryLine(method.summary ?? method.description)
    : [method.summary, method.description]
        .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        .filter((s, idx, arr) => idx === 0 || s !== arr[0])
        .join('\n\n');
  const doc = formatJsDoc(docText, method.deprecated, indent);
  const reqParam = method.requestTypeName
    ? `request${method.requestOptional ? '?' : ''}: ${method.requestTypeName}, options?: RequestOptions`
    : 'options?: RequestOptions';
  return `${doc}${indent}${formatPropertyKey(method.name)}(${reqParam}): Promise<${method.responseTypeName}>; // ${method.httpMethod} ${method.route}`;
}

function renderRequestDeclaration(method: MethodSchema): string | undefined {
  const name = method.requestTypeName;
  if (!name) {
    return undefined;
  }
  const params = method.requestParams;
  const body = method.requestBody;
  if (!body) {
    const block = renderFieldsBlock(params, undefined, '  ', false);
    return block === '' ? `export type ${name} = Record<string, never>;` : `export interface ${name} {\n${block}\n}`;
  }
  if (method.requestFlat && body.type.kind === 'object') {
    const combined = [...params, ...body.type.fields.filter((f) => !f.readonly)];
    const block = renderFieldsBlock(combined, body.type.extra, '  ', false);
    return block === '' ? `export type ${name} = Record<string, never>;` : `export interface ${name} {\n${block}\n}`;
  }
  if (method.requestFlat) {
    if (params.length === 0) {
      return `export type ${name} = ${formatTypeExpr(body.type)};`;
    }
    const paramsBlock = renderFieldsBlock(params, undefined, '  ', false);
    return `export type ${name} = {\n${paramsBlock}\n} & ${formatTypeExpr(body.type, 'intersection')};`;
  }
  const bodyField: FieldSchema = {
    name: 'body',
    wireName: 'body',
    required: body.required,
    description: body.description,
    type: body.type,
  };
  const block = renderFieldsBlock([...params, bodyField], undefined, '  ', false);
  return `export interface ${name} {\n${block}\n}`;
}

function renderResponseDeclaration(method: MethodSchema): string {
  const name = method.responseTypeName;
  if (!method.responseType) {
    return `export type ${name} = void;`;
  }
  if (method.responseType.kind === 'object' && !method.responseOptional && method.responseType.fields.length > 0) {
    const block = renderFieldsBlock(method.responseType.fields, method.responseType.extra, '  ', true);
    return `export interface ${name} {\n${block}\n}`;
  }
  const expr = formatTypeExpr(method.responseType);
  return method.responseOptional ? `export type ${name} = ${expr} | undefined;` : `export type ${name} = ${expr};`;
}

function renderModelDeclaration(model: ModelSchema): string {
  const doc = formatJsDoc(model.description, model.deprecated, '');
  if (model.type.kind === 'object' && model.type.fields.length > 0) {
    const block = renderFieldsBlock(model.type.fields, model.type.extra, '  ', true);
    return `${doc}export interface ${model.name} {\n${block}\n}`;
  }
  return `${doc}export type ${model.name} = ${formatTypeExpr(model.type)};`;
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
  const candidates: string[] = [];
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
  return candidates
    .map((candidate) => {
      const short = candidate.split('.').pop() ?? candidate;
      const queryShort = query.split('.').pop() ?? query;
      const score = Math.min(editDistance(query, candidate), editDistance(queryShort, short) + 0.5);
      return { candidate, score };
    })
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((item) => item.candidate);
}

/**
 * Returns a progressive 1-level `.d.ts` type & JSDoc view for a symbol path in the SDK.
 *
 * Examples:
 * - `hover(schema)` or `hover(schema, "client")` -> top-level `Client` namespaces
 * - `hover(schema, "dns.records")` -> 1-level `dns.records.Client` methods & sub-groups
 * - `hover(schema, "dns.records.create")` -> method signature + 1-level `CreateRequest` & `CreateResponse`
 * - `hover(schema, "dns.records.RecordSettings")` -> 1-level `RecordSettings` model declaration
 */
export function hover(schema: ApiSchema, rawSymbol?: string): string {
  const trimmed = (rawSymbol ?? '').trim().replace(/^client\.?/, '');

  // 1. Root Client view
  if (trimmed === '' || trimmed === 'Client') {
    const lines: string[] = [];
    const totalGroups = Object.keys(schema.groups).length;
    const totalMethods = Object.values(schema.groups).reduce((sum, g) => sum + g.methods.length, 0);
    const totalModels = Object.keys(schema.models).length;
    lines.push(`// API Version: ${schema.version}${schema.baseUrl ? ` | Base URL: ${schema.baseUrl}` : ''}`);
    lines.push(`// ${totalGroups} groups, ${totalMethods} methods, ${totalModels} models`);
    lines.push('// Tip: call hover("<group>") or hover("<group>.<method>") to drill down 1 level at a time.');
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
      const doc = formatJsDoc(firstSummaryLine(childGroup.description), false, '  ');
      const methodCount = countGroupMethods(schema, childName);
      const childList =
        childGroup.children.length > 5
          ? `${childGroup.children.slice(0, 5).join(', ')}, +${childGroup.children.length - 5} more`
          : childGroup.children.join(', ');
      const subSummary =
        childGroup.children.length > 0
          ? `${childGroup.children.length} sub-groups (${childList}), ${methodCount} total methods`
          : `${methodCount} methods`;
      lines.push(`${doc}  readonly ${formatPropertyKey(childName)}: ${childName}.Client; // ${subSummary}`);
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
    const decl = renderModelDeclaration(exactModel);
    const refs = new Set<string>();
    collectReferencedModels(exactModel.type, refs);
    refs.delete(exactModel.path);
    const footer =
      refs.size > 0
        ? `\n\n// Referenced models (use hover("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
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
        const reqDecl = renderRequestDeclaration(method);
        if (reqDecl) {
          blocks.push(reqDecl);
        }
        blocks.push(renderResponseDeclaration(method));
        const refs = new Set<string>();
        for (const p of method.requestParams) {
          collectReferencedModels(p.type, refs);
        }
        if (method.requestBody) {
          collectReferencedModels(method.requestBody.type, refs);
        }
        collectReferencedModels(method.responseType, refs);
        // If requestBody or responseType is a direct single model, expand 1 level of that model immediately
        if (method.requestBody?.type.kind === 'model') {
          const reqModel = schema.models[method.requestBody.type.model];
          if (reqModel) {
            blocks.push(`// Model: ${reqModel.path}\n${renderModelDeclaration(reqModel)}`);
            refs.delete(reqModel.path);
            collectReferencedModels(reqModel.type, refs);
          }
        }
        const reqBodyModel = method.requestBody?.type.kind === 'model' ? method.requestBody.type.model : undefined;
        if (method.responseType?.kind === 'model' && method.responseType.model !== reqBodyModel) {
          const respModel = schema.models[method.responseType.model];
          if (respModel) {
            blocks.push(`// Model: ${respModel.path}\n${renderModelDeclaration(respModel)}`);
            refs.delete(respModel.path);
            collectReferencedModels(respModel.type, refs);
          }
        }
        if (refs.size > 0) {
          blocks.push(`// Referenced models (use hover("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`);
        }
        return blocks.join('\n\n');
      }

      const reqMethod = parentGroup.methods.find((m) => m.requestTypeName === leaf);
      if (reqMethod) {
        const reqDecl = renderRequestDeclaration(reqMethod) ?? '';
        const refs = new Set<string>();
        for (const p of reqMethod.requestParams) {
          collectReferencedModels(p.type, refs);
        }
        if (reqMethod.requestBody) {
          collectReferencedModels(reqMethod.requestBody.type, refs);
        }
        const footer =
          refs.size > 0
            ? `\n\n// Referenced models (use hover("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
            : '';
        return `// Request type for client.${reqMethod.path}\n${reqDecl}${footer}`;
      }

      const respMethod = parentGroup.methods.find((m) => m.responseTypeName === leaf);
      if (respMethod) {
        const respDecl = renderResponseDeclaration(respMethod);
        const refs = new Set<string>();
        collectReferencedModels(respMethod.responseType, refs);
        const footer =
          refs.size > 0
            ? `\n\n// Referenced models (use hover("<model>") to inspect): ${Array.from(refs).sort().join(', ')}`
            : '';
        return `// Response type for client.${respMethod.path}\n${respDecl}${footer}`;
      }
    }
  }

  // 5. Unqualified model name lookup (e.g. "RecordSettings" when unique or matching models)
  const matchingModels = Object.values(schema.models).filter((m) => m.name === trimmed || m.schemaName === trimmed);
  if (matchingModels.length === 1) {
    return hover(schema, matchingModels[0]!.path);
  }
  if (matchingModels.length > 1) {
    return (
      `Multiple models match '${trimmed}': ${matchingModels.map((m) => m.path).join(', ')}.\n\n` +
      hover(schema, matchingModels[0]!.path)
    );
  }

  // 6. Symbol not found -> provide closest suggestions + parent group popup if prefix matched
  const suggestions = findSuggestions(schema, trimmed);
  const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.map((s) => `'${s}'`).join(', ')}?` : '';
  if (lastDot !== -1) {
    const parentPath = trimmed.slice(0, lastDot);
    if (schema.groups[parentPath]) {
      return `TS2339: Symbol '${trimmed}' does not exist on '${parentPath}'.${suggestionText}\n\n${hover(schema, parentPath)}`;
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
      if (isPlainRecord(value) && type.discriminator) {
        const discVal = value[type.discriminator];
        if (discVal !== undefined) {
          const matching = memberTrials.filter(
            ({ trial }) => !trial.some((iss) => iss.path === `${path}.${type.discriminator}`),
          );
          if (matching.length === 1 && matching[0]) {
            issues.push(...matching[0].trial);
            return;
          }
        }
      }
      issues.push({
        code: 'TS2322',
        path,
        message: `Type '${describeValue(value)}' is not assignable to type '${formatTypeExpr(type)}'.`,
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
      const resolved = resolveFlatObjectType(schema, model.type, seen);
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
        const resolved = resolveFlatObjectType(schema, member, seen);
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
    if (extra) {
      validateValue(schema, extra, propVal, `${path}.${key}`, issues, currentModelSymbol, seenModels);
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
    const popups: string[] = [hover(schema, method.path)];
    const shownModels = new Set<string>();
    for (const issue of issues) {
      if (issue.symbol && !shownModels.has(issue.symbol) && schema.models[issue.symbol]) {
        shownModels.add(issue.symbol);
        popups.push(hover(schema, issue.symbol));
      }
    }
    throw new TypeFeedbackError(issues, popups.join('\n\n'));
  }
}

/**
 * Wraps a generated Forge SDK `Client` in a progressive type-feedback `Proxy`.
 * Unknown property accesses and invalid method arguments throw a `TypeFeedbackError`
 * with compiler diagnostics and the relevant `.d.ts` type popup BEFORE any HTTP request is made.
 */
export function wrapClient<T extends object>(client: T, schema: ApiSchema, groupPath = ''): T {
  const cache = new Map<string | symbol, unknown>();
  return new Proxy(client, {
    get(target, prop, receiver) {
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

      if (!isChildGroup && !methodSchema) {
        const available =
          groupPath === ''
            ? schema.rootChildren
            : [...(group?.children ?? []), ...(group?.methods.map((m) => m.name) ?? [])];
        const closest = available
          .map((name) => ({ name, dist: editDistance(prop, name) }))
          .sort((a, b) => a.dist - b.dist)[0];
        const ownerType = groupPath === '' ? 'Client' : `${groupPath}.Client`;
        const hint =
          closest && closest.dist <= 3
            ? ` Did you mean '${closest.name}'?`
            : available.length > 0
              ? ` Available on '${ownerType}': ${available.slice(0, 8).join(', ')}.`
              : '';
        throw new TypeFeedbackError(
          [
            {
              code: 'TS2339',
              path: `client.${fullPath}`,
              message: `Property '${prop}' does not exist on type '${ownerType}'.${hint}`,
            },
          ],
          hover(schema, groupPath),
        );
      }

      const rawValue: unknown = Reflect.get(target, prop, receiver);
      if (methodSchema && typeof rawValue === 'function') {
        const wrappedFn = (...args: unknown[]) => {
          validateMethodCall(schema, methodSchema, args);
          return (rawValue as (...callArgs: unknown[]) => unknown).apply(target, args);
        };
        if (isChildGroup) {
          const childProxy = wrapClient(rawValue as object, schema, fullPath);
          const hybrid = new Proxy(wrappedFn, {
            get(_fnTarget, childProp, _fnReceiver) {
              return Reflect.get(childProxy, childProp, childProxy);
            },
          });
          cache.set(prop, hybrid);
          return hybrid;
        }
        cache.set(prop, wrappedFn);
        return wrappedFn;
      }

      if (isChildGroup && (typeof rawValue === 'object' || typeof rawValue === 'function') && rawValue !== null) {
        const wrappedGroup = wrapClient(rawValue, schema, fullPath);
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
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly issues?: readonly ValidationIssue[];
      readonly typePopup?: string;
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
  const isSingleExpression =
    !withoutTrailingSemicolon.includes('\n') &&
    !/^(return|const|let|var|if|for|while|switch|try|throw|function|class)\b/.test(withoutTrailingSemicolon) &&
    !withoutTrailingSemicolon.includes(';');
  if (isSingleExpression) {
    return `return (${withoutTrailingSemicolon});`;
  }
  return trimmed;
}

/**
 * Executes an agent callback or JavaScript snippet against the type-checked Forge SDK `client`.
 * When a `TypeFeedbackError` occurs, returns `{ ok: false, error, issues, typePopup }` so the
 * agent receives the exact compiler-style error and `.d.ts` popup in a single turn.
 */
export async function execute<T extends object>(
  client: T,
  schema: ApiSchema,
  codeOrFn: string | ((client: T, hoverSymbol: (symbol?: string) => string) => unknown | Promise<unknown>),
): Promise<ExecuteResult> {
  const checkedClient = wrapClient(client, schema);
  const hoverSymbol = (symbol?: string) => hover(schema, symbol);
  try {
    let value: unknown;
    if (typeof codeOrFn === 'function') {
      value = await codeOrFn(checkedClient, hoverSymbol);
    } else {
      const runner = new AsyncFunction('client', 'hover', prepareCodeBody(codeOrFn));
      value = await runner(checkedClient, hoverSymbol);
    }
    return { ok: true, result: value };
  } catch (err) {
    if (err instanceof TypeFeedbackError) {
      return {
        ok: false,
        error: err.message,
        issues: err.issues,
        typePopup: err.typePopup,
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
  hover(symbol?: string): string;
  execute(
    codeOrFn: string | ((client: T, hoverSymbol: (symbol?: string) => string) => unknown | Promise<unknown>),
  ): Promise<ExecuteResult>;
  readonly tools: readonly [
    {
      readonly name: 'hover';
      readonly description: string;
      readonly inputSchema: {
        readonly type: 'object';
        readonly properties: {
          readonly symbol: {
            readonly type: 'string';
            readonly description: string;
          };
        };
      };
      handler(args?: { readonly symbol?: string }): string;
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
        };
      };
      handler(args: { readonly code: string }): Promise<ExecuteResult>;
    },
  ];
}

/**
 * Creates a progressive Type-Feedback MCP interface over a generated Forge SDK `client`.
 */
export function createProgressiveMcp<T extends object>(client: T, schema: ApiSchema): ProgressiveMcp<T> {
  const checkedClient = wrapClient(client, schema);
  return {
    schema,
    client: checkedClient,
    hover(symbol?: string): string {
      return hover(schema, symbol);
    },
    execute(codeOrFn): Promise<ExecuteResult> {
      return execute(client, schema, codeOrFn);
    },
    tools: [
      {
        name: 'hover',
        description:
          'Inspect 1-level TypeScript (.d.ts) definitions and JSDoc for any SDK namespace, method, or model (e.g. "", "dns", "dns.records", "dns.records.create", "dns.records.RecordSettings"). Nested models stay nominal until hovered.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description:
                'Dot-separated symbol path in the generated TypeScript SDK (omit or pass "client" for the top-level namespace index).',
            },
          },
        },
        handler(args?: { readonly symbol?: string }): string {
          return hover(schema, args?.symbol);
        },
      },
      {
        name: 'execute',
        description:
          'Execute TypeScript/JavaScript against the generated `client` SDK instance. Validates namespaces, method names, and request types before making any HTTP call, auto-attaching 1-level .d.ts type popups on any error.',
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
          return execute(client, schema, args.code);
        },
      },
    ],
  };
}
