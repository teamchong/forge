import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type ApiSchema,
  createProgressiveMcp,
  execute,
  TypeFeedbackError,
  types,
  wrapClient,
} from '../../../mcp/runtime.js';

const schema: ApiSchema = {
  version: '4.0.0',
  description: 'Cloudflare API',
  baseUrl: 'https://api.cloudflare.com/client/v4',
  rootChildren: ['dns', 'zones'],
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

  test('createProgressiveMcp() exposes types and execute MCP tools', async () => {
    const { client } = makeFakeClient();
    const mcp = createProgressiveMcp(client, schema);
    assert.equal(mcp.tools.length, 2);
    assert.equal(mcp.tools[0]?.name, 'types');
    assert.equal(mcp.tools[1]?.name, 'execute');

    const typesRes = await mcp.tools[0]!.handler({ symbol: 'dns.records.RecordSettings' });
    assert.match(String(typesRes), /export interface RecordSettings/);

    const wrapped = wrapClient(client, schema);
    assert.throws(() => Reflect.get(wrapped.dns.records, 'nonExistent'), TypeFeedbackError);
  });
});
