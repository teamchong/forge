import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type ApiSchema,
  createProgressiveMcp,
  execute,
  plan,
  search,
  TypeFeedbackError,
  types,
  wrapClient,
} from '../../../mcp/runtime.js';
const schema: ApiSchema = {
  version: '4.0.0',
  description: 'Example API',
  baseUrl: 'https://api.example.com/v1',
  rootChildren: ['dns', 'storage', 'zones'],
  rootModels: ['SharedError'],
  groups: {
    dns: {
      name: 'dns',
      path: 'dns',
      description: 'DNS operations',
      children: ['records', 'firewall'],
      models: [],
      methods: [],
    },
    'dns.records': {
      name: 'records',
      path: 'dns.records',
      description: 'Manage DNS records for a zone.',
      children: [],
      models: ['dns.records.RecordSettings', 'dns.records.RecordResponse'],
      methods: [
        {
          name: 'create',
          path: 'dns.records.create',
          httpMethod: 'POST',
          route: '/zones/{zoneId}/dns_records',
          summary: 'Create DNS Record',
          description: 'Creates a new DNS record for a zone.',
          deprecated: false,
          requestTypeName: 'CreateRequest',
          requestOptional: false,
          requestFlat: true,
          requestParams: [
            {
              name: 'zoneId',
              wireName: 'zone_id',
              required: true,
              readonly: false,
              deprecated: false,
              location: 'path',
              description: 'Zone identifier.',
              type: { kind: 'scalar', scalar: 'string' },
            },
          ],
          requestBody: {
            required: true,
            description: 'DNS record payload.',
            type: {
              kind: 'object',
              fields: [
                {
                  name: 'id',
                  wireName: 'id',
                  required: false,
                  readonly: true,
                  deprecated: false,
                  description: 'Record identifier (read-only).',
                  type: { kind: 'scalar', scalar: 'string' },
                },
                {
                  name: 'name',
                  wireName: 'name',
                  required: true,
                  readonly: false,
                  deprecated: false,
                  description: 'DNS record name.',
                  type: { kind: 'scalar', scalar: 'string' },
                },
                {
                  name: 'type',
                  wireName: 'type',
                  required: true,
                  readonly: false,
                  deprecated: false,
                  description: 'DNS record type.',
                  type: { kind: 'enum', values: ['A', 'AAAA', 'CNAME'] },
                },
                {
                  name: 'ttl',
                  wireName: 'ttl',
                  required: false,
                  readonly: false,
                  deprecated: false,
                  description: 'Time to live in seconds.',
                  type: { kind: 'scalar', scalar: 'number' },
                },
                {
                  name: 'settings',
                  wireName: 'settings',
                  required: false,
                  readonly: false,
                  deprecated: false,
                  description: 'Record-specific settings.',
                  type: { kind: 'model', model: 'dns.records.RecordSettings' },
                },
              ],
            },
          },
          responseTypeName: 'CreateResponse',
          responseType: { kind: 'model', model: 'dns.records.RecordResponse' },
          responseOptional: false,
          extensions: { 'x-required-scopes': ['dns:write', 'dns:read'] },
        },
        {
          name: 'list',
          path: 'dns.records.list',
          httpMethod: 'GET',
          route: '/zones/{zoneId}/dns_records',
          summary: 'List DNS Records',
          description: 'Lists DNS records in a zone.',
          deprecated: false,
          requestTypeName: 'ListRequest',
          requestOptional: false,
          requestFlat: true,
          requestParams: [
            {
              name: 'zoneId',
              wireName: 'zone_id',
              required: true,
              readonly: false,
              deprecated: false,
              location: 'path',
              description: 'Zone identifier.',
              type: { kind: 'scalar', scalar: 'string' },
            },
            {
              name: 'perPage',
              wireName: 'per_page',
              required: false,
              readonly: false,
              deprecated: false,
              location: 'query',
              description: 'Number of records per page.',
              type: { kind: 'scalar', scalar: 'number' },
            },
          ],
          responseTypeName: 'ListResponse',
          responseType: {
            kind: 'array',
            elem: { kind: 'model', model: 'dns.records.RecordResponse' },
          },
          responseOptional: false,
        },
      ],
    },
    'dns.firewall': {
      name: 'firewall',
      path: 'dns.firewall',
      description: 'DNS Firewall',
      children: [],
      models: [],
      methods: [],
    },
    storage: {
      name: 'storage',
      path: 'storage',
      description: 'Object Storage.',
      children: ['buckets'],
      models: [],
      methods: [],
    },
    'storage.buckets': {
      name: 'buckets',
      path: 'storage.buckets',
      description: 'Manage storage buckets.',
      children: [],
      models: [],
      methods: [
        {
          name: 'create',
          path: 'storage.buckets.create',
          httpMethod: 'POST',
          route: '/orgs/{orgId}/buckets',
          summary: 'Create Bucket',
          description: 'Creates a new storage bucket.',
          deprecated: false,
          requestTypeName: 'CreateRequest',
          requestOptional: false,
          requestFlat: true,
          requestParams: [
            {
              name: 'orgId',
              wireName: 'org_id',
              required: true,
              readonly: false,
              deprecated: false,
              location: 'path',
              description: 'Organization identifier.',
              type: { kind: 'scalar', scalar: 'string' },
            },
          ],
          requestBody: {
            required: true,
            type: {
              kind: 'object',
              fields: [
                {
                  name: 'name',
                  wireName: 'name',
                  required: true,
                  readonly: false,
                  deprecated: false,
                  type: { kind: 'scalar', scalar: 'string' },
                },
                {
                  name: 'storageClass',
                  wireName: 'storage_class',
                  required: false,
                  readonly: false,
                  deprecated: false,
                  type: {
                    kind: 'enum',
                    values: ['Standard', 'InfrequentAccess'],
                  },
                },
              ],
            },
          },
          responseTypeName: 'CreateResponse',
          responseType: { kind: 'scalar', scalar: 'unknown' },
          responseOptional: false,
          extensions: { 'x-required-scopes': ['storage:write'] },
        },
      ],
    },
    zones: {
      name: 'zones',
      path: 'zones',
      description: 'Zone management',
      children: [],
      models: [],
      methods: [],
    },
  },
  models: {
    SharedError: {
      name: 'SharedError',
      path: 'SharedError',
      schemaName: 'SharedError',
      description: 'Standard error payload.',
      deprecated: false,
      type: {
        kind: 'object',
        fields: [
          {
            name: 'code',
            wireName: 'code',
            required: true,
            readonly: false,
            deprecated: false,
            type: { kind: 'scalar', scalar: 'number' },
          },
        ],
      },
    },
    'dns.records.RecordSettings': {
      name: 'RecordSettings',
      path: 'dns.records.RecordSettings',
      schemaName: 'RecordSettings',
      description: 'Extra settings for a DNS record.',
      deprecated: false,
      type: {
        kind: 'object',
        fields: [
          {
            name: 'ipv4Only',
            wireName: 'ipv4_only',
            required: false,
            readonly: false,
            deprecated: false,
            description: 'Only resolve IPv4.',
            type: { kind: 'scalar', scalar: 'boolean' },
          },
          {
            name: 'flattenCname',
            wireName: 'flatten_cname',
            required: false,
            readonly: false,
            deprecated: false,
            description: 'Flatten CNAME at apex.',
            type: { kind: 'scalar', scalar: 'boolean' },
          },
        ],
      },
    },
    'dns.records.RecordResponse': {
      name: 'RecordResponse',
      path: 'dns.records.RecordResponse',
      schemaName: 'Record',
      description: 'Created DNS record.',
      deprecated: false,
      type: {
        kind: 'object',
        fields: [
          {
            name: 'id',
            wireName: 'id',
            required: true,
            readonly: true,
            deprecated: false,
            type: { kind: 'scalar', scalar: 'string' },
          },
          {
            name: 'name',
            wireName: 'name',
            required: true,
            readonly: false,
            deprecated: false,
            type: { kind: 'scalar', scalar: 'string' },
          },
          {
            name: 'settings',
            wireName: 'settings',
            required: false,
            readonly: false,
            deprecated: false,
            type: { kind: 'model', model: 'dns.records.RecordSettings' },
          },
        ],
      },
    },
  },
};

function makeFakeClient() {
  const calls: { method: string; args: unknown[] }[] = [];
  const client = {
    dns: {
      records: {
        async create(req?: Record<string, unknown>, ...rest: unknown[]) {
          calls.push({ method: 'dns.records.create', args: [req, ...rest] });
          return { id: 'rec_123', ...req };
        },
        async list(...args: unknown[]) {
          calls.push({ method: 'dns.records.list', args });
          return [{ id: 'rec_123', name: 'example.com' }];
        },
      },
      firewall: {},
    },
    storage: {
      buckets: {
        async create(req?: Record<string, unknown>, ...rest: unknown[]) {
          calls.push({ method: 'storage.buckets.create', args: [req, ...rest] });
          return { name: req?.['name'], orgId: req?.['orgId'] };
        },
      },
    },
    zones: {},
  };
  return { client, calls };
}

describe('Progressive Type-Feedback MCP runtime', () => {
  test('types() at root renders 1-level top namespaces without dumping nested methods', () => {
    const out = types(schema);
    assert.match(out, /export interface Client \{/);
    assert.match(out, /readonly dns: dns\.Client;/);
    assert.match(out, /readonly zones: zones\.Client;/);
    assert.doesNotMatch(out, /CreateRequest/);
  });

  test('types() on namespace renders 1-level sub-groups and method signatures', () => {
    const dnsOut = types(schema, 'dns');
    assert.match(dnsOut, /export namespace dns \{/);
    assert.match(dnsOut, /readonly records: dns\.records\.Client;/);

    const recordsOut = types(schema, 'dns.records');
    assert.match(recordsOut, /export namespace dns\.records \{/);
    assert.match(recordsOut, /create\(request: CreateRequest, options\?: RequestOptions\): Promise<CreateResponse>;/);
    assert.match(recordsOut, /list\(request: ListRequest, options\?: RequestOptions\): Promise<ListResponse>;/);
    // Nested model fields are NOT inlined in the namespace view
    assert.doesNotMatch(recordsOut, /flattenCname/);
  });

  test('types() on method renders 1-level request/response types and keeps nested models nominal', () => {
    const createOut = types(schema, 'dns.records.create');
    assert.match(createOut, /export interface CreateRequest \{/);
    assert.match(createOut, /zoneId: string; \/\/ path param/);
    assert.match(createOut, /type: 'A' \| 'AAAA' \| 'CNAME';/);
    assert.match(createOut, /settings\?: dns\.records\.RecordSettings;/);
    // RecordSettings fields are nominal until inspected
    assert.doesNotMatch(createOut, /flattenCname/);
    assert.match(createOut, /Referenced models \(use types\("<model>"\) to inspect\): .*dns\.records\.RecordSettings/);
  });

  test('types() on model (qualified or unqualified) expands its 1-level fields', () => {
    const byFull = types(schema, 'dns.records.RecordSettings');
    const byShort = types(schema, 'RecordSettings');
    assert.equal(byFull, byShort);
    assert.match(byFull, /export interface RecordSettings \{/);
    assert.match(byFull, /ipv4Only\?: boolean;/);
    assert.match(byFull, /flattenCname\?: boolean;/);
  });

  test('types() on unknown symbol returns compiler-style error and fuzzy suggestions', () => {
    const unknownMember = types(schema, 'dns.records.creat');
    assert.match(unknownMember, /TS2339: Symbol 'dns\.records\.creat' does not exist on 'dns\.records'\./);
    assert.match(unknownMember, /Did you mean: 'dns\.records\.create'/);
  });

  test('execute() inspects uninvoked namespaces, methods, and models directly like a REPL', async () => {
    const { client, calls } = makeFakeClient();
    const groupInspect = await execute(client, schema, 'client.dns.records');
    assert.equal(groupInspect.ok, true);
    assert.match(String(groupInspect.result), /export namespace dns\.records \{/);

    const methodInspect = await execute(client, schema, 'client.dns.records.create');
    assert.equal(methodInspect.ok, true);
    assert.match(String(methodInspect.result), /export interface CreateRequest \{/);

    const modelInspect = await execute(client, schema, 'client.dns.records.RecordSettings');
    assert.equal(modelInspect.ok, true);
    assert.match(String(modelInspect.result), /export interface RecordSettings \{/);
    assert.equal(calls.length, 0);
  });
  test('execute() runs valid SDK calls against wrapped client', async () => {
    const { client, calls } = makeFakeClient();
    const res = await execute(
      client,
      schema,
      `return await client.dns.records.create({
        zoneId: 'zone_1',
        name: 'app.example.com',
        type: 'A',
        settings: { ipv4Only: true }
      });`,
    );
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, 'dns.records.create');
    assert.deepEqual(res.result, {
      id: 'rec_123',
      zoneId: 'zone_1',
      name: 'app.example.com',
      type: 'A',
      settings: { ipv4Only: true },
    });
  });

  test('execute() catches unknown method name with TS2339 and attaches namespace .d.ts definition', async () => {
    const { client, calls } = makeFakeClient();
    const res = await execute(client, schema, `await client.dns.records.add({ zoneId: 'z1' })`);
    assert.equal(res.ok, false);
    assert.equal(calls.length, 0);
    assert.equal(res.issues?.[0]?.code, 'TS2339');
    assert.match(res.error ?? '', /Available on 'dns\.records\.Client': create, list\./);
    assert.match(res.typeDefinition ?? '', /export namespace dns\.records \{/);
  });

  test('execute() catches snake_case wireName mistakes with TS2561 and suggests camelCase SDK property', async () => {
    const { client, calls } = makeFakeClient();
    const res = await execute(client, schema, `await client.dns.records.list({ zone_id: 'z1', per_page: 10 })`);
    assert.equal(res.ok, false);
    assert.equal(calls.length, 0);
    assert.ok(res.issues?.some((i) => i.code === 'TS2561' && i.message.includes("Did you mean 'zoneId'")));
    assert.ok(res.issues?.some((i) => i.code === 'TS2561' && i.message.includes("Did you mean 'perPage'")));
    assert.match(res.typeDefinition ?? '', /export interface ListRequest \{/);
  });

  test('execute() catches read-only field assignment and nested model type errors with both .d.ts definitions', async () => {
    const { client, calls } = makeFakeClient();
    const res = await execute(
      client,
      schema,
      `await client.dns.records.create({
         zoneId: 'z1',
         id: 'cannot_set',
         name: 'example.com',
         type: 'A',
         settings: { ipv4Only: 'not_a_boolean' }
       })`,
    );
    assert.equal(res.ok, false);
    assert.equal(calls.length, 0);
    assert.ok(res.issues?.some((i) => i.code === 'TS2540' && i.path === 'request.id'));
    assert.ok(
      res.issues?.some(
        (i) =>
          i.code === 'TS2322' && i.path === 'request.settings.ipv4Only' && i.symbol === 'dns.records.RecordSettings',
      ),
    );
    assert.match(res.typeDefinition ?? '', /export interface CreateRequest \{/);
    assert.match(res.typeDefinition ?? '', /export interface RecordSettings \{/);
  });

  test('createProgressiveMcp() exposes search/execute MCP tools and SDK group resources', async () => {
    const { client } = makeFakeClient();
    const mcp = createProgressiveMcp(client, schema);
    assert.equal(mcp.tools.length, 2);
    assert.equal(mcp.tools[0]?.name, 'search');
    assert.equal(mcp.tools[1]?.name, 'execute');

    const searchRes = mcp.tools[0]!.handler({ query: 'dns.records.RecordSettings' });
    assert.match(String(searchRes), /export interface RecordSettings/);
    assert.equal(mcp.search('create buckets for organization'), search(schema, 'create buckets for organization'));
    assert.match(mcp.search('create buckets for organization'), /client\.storage\.buckets\.create/);
    assert.ok(mcp.resources.some((r) => r.uri === 'forge://types' && r.name === 'client'));
    assert.ok(
      mcp.resources.some((r) => r.uri === 'forge://types/dns.records' && r.mimeType === 'application/typescript'),
    );
    assert.equal(mcp.resourceTemplates[0]?.uriTemplate, 'forge://types/{symbol}');

    const groupResource = mcp.readResource('forge://types/dns.records');
    assert.equal(groupResource.uri, 'forge://types/dns.records');
    assert.equal(groupResource.mimeType, 'application/typescript');
    assert.match(groupResource.text, /export namespace dns\.records \{/);

    const slashResource = mcp.readResource('forge://types/dns/records/create');
    assert.match(slashResource.text, /\/\/ Method: client\.dns\.records\.create/);

    const wrapped = wrapClient(client, schema);
    assert.throws(() => Reflect.get(wrapped.dns.records, 'nonExistent'), TypeFeedbackError);
  });

  test('plan() builds wire HTTP request with extensions and pathParams in a credential-free isolate', async () => {
    const { client } = makeFakeClient();
    const callPlan = await plan(
      client,
      schema,
      'await client.dns.records.create({ zoneId: "zone_99", name: "api.example.com", type: "A", ttl: 3600, settings: { ipv4Only: true, flattenCname: false } })',
    );
    assert.equal(callPlan.kind, 'request');
    if (callPlan.kind === 'request') {
      assert.equal(callPlan.method, 'POST');
      assert.equal(callPlan.url, 'https://api.example.com/v1/zones/zone_99/dns_records');
      assert.equal(callPlan.methodPath, 'dns.records.create');
      assert.deepEqual(callPlan.pathParams, { zoneId: 'zone_99' });
      assert.deepEqual(callPlan.extensions, { 'x-required-scopes': ['dns:write', 'dns:read'] });
      assert.deepEqual(JSON.parse(callPlan.body ?? '{}'), {
        name: 'api.example.com',
        type: 'A',
        ttl: 3600,
        settings: { ipv4_only: true, flatten_cname: false },
      });
    }
  });

  test('auto-injects defaultParams when omitted, or returns missingParam / missing_param plan when unresolved', async () => {
    const { client, calls } = makeFakeClient();
    // Single-tenant session: auto-injects defaultParams.orgId
    const okRes = await execute(
      client,
      schema,
      'return await client.storage.buckets.create({ name: "assets", storageClass: "InfrequentAccess" })',
      { defaultParams: { orgId: 'org_auto_123' } },
    );
    assert.equal(okRes.ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args[0], {
      orgId: 'org_auto_123',
      name: 'assets',
      storageClass: 'InfrequentAccess',
    });

    // Multi-tenant session without resolved orgId: returns missingParam / missing_param plan
    const missingRes = await execute(client, schema, 'return await client.storage.buckets.create({ name: "assets" })', {
      unresolvedParams: { orgId: 'Select an organization first with orgs.list.' },
    });
    assert.equal(missingRes.ok, false);
    if (!missingRes.ok) {
      assert.equal(missingRes.missingParam, 'orgId');
      assert.equal(missingRes.replaySafe, true);
      assert.match(missingRes.error, /Select an organization first/);
    }

    const missingPlan = await plan(client, schema, 'await client.storage.buckets.create({ name: "assets" })', {
      unresolvedParams: { orgId: 'Select an organization first with orgs.list.' },
    });
    assert.deepEqual(missingPlan, {
      kind: 'missing_param',
      param: 'orgId',
      message: 'Select an organization first with orgs.list.',
      methodPath: 'storage.buckets.create',
    });
  });

  test('execute() surfaces 403 status, OpenAPI extensions, and replaySafe status', async () => {
    const refusingClient = {
      dns: {
        records: {
          async list() {
            return [{ id: 'rec_1' }];
          },
          async create() {
            const err = Object.assign(new Error('403 Forbidden'), {
              status: 403,
            });
            throw err;
          },
        },
        firewall: {},
      },
      storage: { buckets: { async create() {} } },
      zones: {},
    };
    // GET followed by 403 POST -> replaySafe is true!
    const safeRes = await execute(
      refusingClient,
      schema,
      'await client.dns.records.list({ zoneId: "z1" }); return await client.dns.records.create({ zoneId: "z1", name: "a.com", type: "A" });',
    );
    assert.equal(safeRes.ok, false);
    if (!safeRes.ok) {
      assert.equal(safeRes.status, 403);
      assert.deepEqual(safeRes.extensions, { 'x-required-scopes': ['dns:write', 'dns:read'] });
      assert.equal(safeRes.replaySafe, true);
    }
  });

  test('types() supports keyword and route search when the agent only has a search term', () => {
    const byKeyword = types(schema, 'create bucket');
    assert.match(byKeyword, /client\.storage\.buckets\.create/);
    assert.match(byKeyword, /export interface CreateRequest \{/);

    const byMultiMatch = types(schema, 'dns records');
    assert.match(byMultiMatch, /Search matches for 'dns records'/);
    assert.match(byMultiMatch, /create\(request: CreateRequest/);
    assert.match(byMultiMatch, /list\(request: ListRequest/);
  });
  test('flattens nested union-of-models request bodies into a single CreateRequest and prefers TS2561 across union branches', async () => {
    const unionSchema: ApiSchema = {
      ...schema,
      rootChildren: [...schema.rootChildren, 'apps'],
      groups: {
        ...schema.groups,
        apps: {
          name: 'apps',
          path: 'apps',
          children: [],
          models: ['apps.AppRequest', 'apps.SelfHostedApp', 'apps.SaasApp'],
          methods: [
            {
              name: 'create',
              path: 'apps.create',
              httpMethod: 'POST',
              route: '/accounts/{accountId}/apps',
              requestTypeName: 'CreateRequest',
              requestOptional: false,
              requestFlat: true,
              requestParams: [
                {
                  name: 'accountId',
                  wireName: 'account_id',
                  required: true,
                  readonly: false,
                  location: 'path',
                  type: { kind: 'scalar', scalar: 'string' },
                },
              ],
              requestBody: {
                required: true,
                type: { kind: 'model', model: 'apps.AppRequest' },
              },
              responseTypeName: 'CreateResponse',
              responseType: { kind: 'scalar', scalar: 'unknown' },
            },
          ],
        },
      },
      models: {
        ...schema.models,
        'apps.AppRequest': {
          name: 'AppRequest',
          path: 'apps.AppRequest',
          schemaName: 'app_request',
          type: {
            kind: 'union',
            members: [
              { kind: 'model', model: 'apps.SelfHostedApp' },
              { kind: 'model', model: 'apps.SaasApp' },
            ],
          },
        },
        'apps.SelfHostedApp': {
          name: 'SelfHostedApp',
          path: 'apps.SelfHostedApp',
          schemaName: 'self_hosted_app',
          type: {
            kind: 'object',
            fields: [
              {
                name: 'name',
                wireName: 'name',
                required: true,
                readonly: false,
                type: { kind: 'scalar', scalar: 'string' },
              },
              {
                name: 'domain',
                wireName: 'domain',
                required: true,
                readonly: false,
                type: { kind: 'scalar', scalar: 'string' },
              },
              {
                name: 'sessionDuration',
                wireName: 'session_duration',
                required: false,
                readonly: false,
                type: { kind: 'scalar', scalar: 'string' },
              },
            ],
          },
        },
        'apps.SaasApp': {
          name: 'SaasApp',
          path: 'apps.SaasApp',
          schemaName: 'saas_app',
          type: {
            kind: 'object',
            fields: [
              {
                name: 'name',
                wireName: 'name',
                required: false,
                readonly: false,
                type: { kind: 'scalar', scalar: 'string' },
              },
            ],
          },
        },
      },
    };

    const dts = types(unionSchema, 'apps.create');
    assert.match(dts, /export interface CreateRequest \{[\s\S]*accountId: string;[\s\S]*sessionDuration\?: string;/);
    assert.doesNotMatch(dts, /export interface AppRequest \{/);

    const errPlan = await plan(
      {},
      unionSchema,
      'await client.apps.create({ accountId: "a1", name: "app", session_duration: "24h" })',
    );
    assert.equal(errPlan.kind, 'invalid');
    if (errPlan.kind === 'invalid') {
      assert.ok(errPlan.issues?.some((i) => i.code === 'TS2561'));
      assert.match(errPlan.error, /Did you mean 'sessionDuration'/);
      assert.doesNotMatch(errPlan.typeDefinition ?? '', /export interface AppRequest \{/);
    }
  });

  test('types() normalizes .Client / () / snake_case symbols, matches HTTP verb + route, and scopes suggestions to parent group', () => {
    const fromClientSuffix = types(schema, 'dns.records.Client');
    assert.match(fromClientSuffix, /export namespace dns\.records \{/);

    const fromCallExpr = types(schema, 'await client.dns.records.create()');
    assert.match(fromCallExpr, /\/\/ Method: client\.dns\.records\.create/);

    const fromVerbRoute = types(schema, 'POST /zones/{zoneId}/dns_records');
    assert.match(fromVerbRoute, /\/\/ Method: client\.dns\.records\.create/);
    assert.doesNotMatch(fromVerbRoute, /list\(request: ListRequest/);

    const scopedErr = types(schema, 'dns.records.nonexistent');
    assert.match(scopedErr, /Did you mean: 'dns\.records\.create'/);

    const exactStem = search(schema, 'list dns records');
    assert.match(exactStem, /\/\/ Search match for 'list dns records': client\.dns\.records\.list/);
  });

  test('execute() awaits multi-line expressions and returns the trailing expression in multi-statement snippets', async () => {
    const { client, calls } = makeFakeClient();
    const res = await execute(
      client,
      schema,
      'const rows = await client.dns.records.list({ zoneId: "z1" });\nconst first = rows[0];\n({ count: rows.length, id: first?.id })',
    );
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    if (res.ok) {
      assert.deepEqual(res.result, { count: 1, id: 'rec_123' });
    }
  });
});
