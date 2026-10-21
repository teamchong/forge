//! Generates a TypeScript SDK paired with a Progressive Type-Feedback MCP
//! runtime (`_/mcp.ts` and `mcp.ts`).
//!
//! Instead of dumping thousands of flattened tool schemas into the prompt or
//! searching raw OpenAPI JSON paths, agents inspect the SDK's hierarchical
//! TypeScript definitions one level at a time with `types(symbol)` (or by
//! evaluating `client.<group>.<method>` inside `execute(code)`) and execute
//! typed SDK code with `execute(code)`, receiving compiler-style diagnostics
//! with the relevant `.d.ts` type definition attached on any mistake.

use std::collections::{BTreeMap, HashMap, HashSet};

use forge::ts::{File, Module, PREAMBLE, p};
use forge::{
    Discriminator, EnumValue, Err, Field, Forge, Group, Json, Location, Method, Model, Object, Plugin, Scalar, Type,
    Union,
};
use serde::Serialize;

use crate::ts;

/// Generates a TypeScript SDK and Progressive Type-Feedback MCP runtime.
pub struct Generator;

impl Plugin for Generator {
    type File = ts::File;

    fn generate(&self, forge: &Forge) -> Result<impl Iterator<Item = Self::File>, Err> {
        let mut files: Vec<ts::File> = ts::Generator.generate(forge)?.collect();
        let schema = build_api_schema(forge);
        let schema_json = serde_json::to_string(&schema).map_err(|err| err.to_string())?;
        files.push(ts::File::Runtime {
            path: "_/mcp.ts".to_owned(),
            content: format!("{PREAMBLE}{MCP_RUNTIME}"),
        });
        files.push(ts::File::Ts(mcp_entry_file(&schema_json)));
        Ok(files.into_iter())
    }

    fn generate_group(&self, group: Group<'_>) -> Result<impl Iterator<Item = Self::File>, Err> {
        ts::Generator.generate_group(group)
    }
}

const MCP_RUNTIME: &str = include_str!("mcp/runtime.ts");

fn mcp_entry_file(schema_json: &str) -> File {
    let mut f = File::new(Module::ROOT.sub("mcp.ts"));
    let client_mod = Module::ROOT.sub("client.ts");
    let mcp_mod = Module::new("_/mcp.ts");
    let client_ty = client_mod.ident("Client").ty();
    let client_opts = client_mod.ident("ClientOptions").ty();
    let create_client = client_mod.ident("createClient");
    let api_schema_ty = mcp_mod.ident("ApiSchema").ty();
    let create_progressive = mcp_mod.ident("createProgressiveMcp");
    let execute_fn = mcp_mod.ident("execute");
    let plan_fn = mcp_mod.ident("plan");
    let types_fn = mcp_mod.ident("types");
    let progressive_ty = mcp_mod.ident("ProgressiveMcp").ty();
    let type_err = mcp_mod.ident("TypeFeedbackError");

    p!(
        f,
        "export { ",
        create_progressive,
        ", ",
        execute_fn,
        ", ",
        plan_fn,
        ", ",
        types_fn,
        ", ",
        type_err,
        " };"
    );
    p!(
        f,
        "export type { ",
        api_schema_ty,
        ", ",
        mcp_mod.ident("CallPlan").ty(),
        ", ",
        mcp_mod.ident("ExecuteOptions").ty(),
        ", ",
        mcp_mod.ident("ExecuteResult").ty(),
        ", ",
        progressive_ty,
        ", ",
        mcp_mod.ident("ValidationIssue").ty(),
        " };"
    );
    p!(f);
    f.doc("Progressive 1-level TypeScript schema metadata for type inspection and runtime type-feedback.");
    p!(f, "export const schema: ", api_schema_ty, " = ", schema_json, ";");
    p!(f);
    f.doc("Creates a Progressive Type-Feedback MCP interface for the generated SDK.");
    p!(
        f,
        "export function createMcp(clientOrOptions: ",
        client_ty,
        " | ",
        client_opts,
        "): ",
        progressive_ty,
        "<",
        client_ty,
        "> {"
    );
    f.indent(|f| {
        p!(
            f,
            "const client: ",
            client_ty,
            " = 'token' in clientOrOptions ? ",
            create_client,
            "(clientOrOptions) : clientOrOptions;"
        );
        p!(f, "return ", create_progressive, "(client, schema);");
    });
    p!(f, "}");
    f
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiSchema {
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    root_children: Vec<String>,
    root_models: Vec<String>,
    groups: BTreeMap<String, GroupSchema>,
    models: BTreeMap<String, ModelSchema>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupSchema {
    name: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    children: Vec<String>,
    models: Vec<String>,
    methods: Vec<MethodSchema>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MethodSchema {
    name: String,
    path: String,
    http_method: String,
    route: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    deprecated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_type_name: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    request_optional: bool,
    #[serde(skip_serializing_if = "is_false")]
    request_flat: bool,
    request_params: Vec<FieldSchema>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_body: Option<RequestBodySchema>,
    response_type_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_type: Option<TypeSchema>,
    #[serde(skip_serializing_if = "is_false")]
    response_optional: bool,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    extensions: BTreeMap<String, serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestBodySchema {
    required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(rename = "type")]
    ty: TypeSchema,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelSchema {
    name: String,
    path: String,
    schema_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    deprecated: bool,
    #[serde(rename = "type")]
    ty: TypeSchema,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FieldSchema {
    name: String,
    wire_name: String,
    required: bool,
    #[serde(skip_serializing_if = "is_false")]
    readonly: bool,
    #[serde(skip_serializing_if = "is_false")]
    deprecated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    location: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(rename = "type")]
    ty: TypeSchema,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum TypeSchema {
    Scalar {
        scalar: &'static str,
    },
    Enum {
        values: Vec<serde_json::Value>,
    },
    Array {
        elem: Box<TypeSchema>,
        #[serde(rename = "minItems", skip_serializing_if = "Option::is_none")]
        min_items: Option<u64>,
        #[serde(rename = "maxItems", skip_serializing_if = "Option::is_none")]
        max_items: Option<u64>,
    },
    Object {
        fields: Vec<FieldSchema>,
        #[serde(skip_serializing_if = "Option::is_none")]
        extra: Option<Box<TypeSchema>>,
    },
    Union {
        members: Vec<TypeSchema>,
        #[serde(skip_serializing_if = "Option::is_none")]
        discriminator: Option<String>,
    },
    Intersection {
        members: Vec<TypeSchema>,
    },
    Model {
        model: String,
    },
}

fn is_false(b: &bool) -> bool {
    !*b
}

fn non_empty(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

fn group_prop_name(group: Group<'_>) -> String {
    ts::types::identifier(group.name().camel())
}

fn group_full_path(group: Group<'_>) -> String {
    group
        .path()
        .map(|name| ts::types::identifier(name.camel()))
        .collect::<Vec<_>>()
        .join(".")
}

fn model_prop_name(model: Model<'_>) -> String {
    ts::types::identifier(model.name().pascal())
}

fn model_full_path(model: Model<'_>) -> String {
    let name = model_prop_name(model);
    match model.group() {
        Some(group) => format!("{}.{name}", group_full_path(group)),
        None => name,
    }
}

fn build_api_schema(forge: &Forge) -> ApiSchema {
    let mut root_children: Vec<Group<'_>> = forge.groups().filter(|g| g.parent().is_none()).collect();
    root_children.sort_by_key(|g| group_prop_name(*g));
    let root_children_names = root_children.iter().map(|g| group_prop_name(*g)).collect();

    let mut root_models: Vec<Model<'_>> = forge.models().collect();
    root_models.sort_by_key(|m| m.schema_name());
    let root_model_names = root_models
        .iter()
        .filter(|m| !m.name().is_empty())
        .map(|m| model_full_path(*m))
        .collect();

    let mut groups = BTreeMap::new();
    for group in forge.groups() {
        let path = group_full_path(group);
        let mut children: Vec<Group<'_>> = group.children().collect();
        children.sort_by_key(|c| group_prop_name(*c));
        let children_names = children.iter().map(|c| group_prop_name(*c)).collect();

        let mut group_models: Vec<Model<'_>> = group.models().collect();
        group_models.sort_by_key(|m| m.schema_name());
        let model_paths = group_models
            .iter()
            .filter(|m| !m.name().is_empty())
            .map(|m| model_full_path(*m))
            .collect();

        let group_names: HashMap<String, Group<'_>> = children.iter().map(|&sub| (group_prop_name(sub), sub)).collect();

        let mut methods = Vec::new();
        for m in group.methods() {
            if ts::client::skipped(m) {
                continue;
            }
            methods.push(build_method_schema(m, &path, &group_names));
        }
        methods.sort_by(|a, b| a.name.cmp(&b.name));

        groups.insert(
            path.clone(),
            GroupSchema {
                name: group_prop_name(group),
                path,
                description: non_empty(group.description()),
                children: children_names,
                models: model_paths,
                methods,
            },
        );
    }

    let mut models = BTreeMap::new();
    let mut all_models: Vec<Model<'_>> = forge.models().collect();
    for group in forge.groups() {
        all_models.extend(group.models());
    }
    for model in all_models {
        if model.name().is_empty() {
            continue;
        }
        let path = model_full_path(model);
        models.insert(
            path.clone(),
            ModelSchema {
                name: model_prop_name(model),
                path,
                schema_name: model.schema_name().to_owned(),
                description: non_empty(model.description()),
                deprecated: model.is_deprecated(),
                ty: build_type_schema(model.ty()),
            },
        );
    }

    ApiSchema {
        version: forge.version.clone(),
        description: non_empty(&forge.description),
        base_url: non_empty(&forge.base_url),
        root_children: root_children_names,
        root_models: root_model_names,
        groups,
        models,
    }
}

fn build_method_schema(m: Method<'_>, group_path: &str, group_names: &HashMap<String, Group<'_>>) -> MethodSchema {
    let name = ts::client::method_name(m);
    let path = format!("{group_path}.{name}");
    let req = ts::client::Request::new(m);
    let has_request = !req.params.is_empty() || req.body.is_some();

    let request_type_name = if has_request {
        let base_req_name = ts::client::request_name(m);
        if group_names.contains_key(&name) {
            Some(format!("{base_req_name}$"))
        } else {
            Some(base_req_name)
        }
    } else {
        None
    };

    let request_params = req
        .params
        .iter()
        .map(|param| FieldSchema {
            name: param.name.clone(),
            wire_name: param.field.wire_name().to_owned(),
            required: param.field.is_required(),
            readonly: false,
            deprecated: param.field.is_deprecated(),
            location: Some(match param.location {
                Location::Path => "path",
                Location::Query { .. } => "query",
            }),
            description: non_empty(param.field.description()),
            ty: build_type_schema(param.field.ty()),
        })
        .collect();

    let route = build_route_template(m, &req.params);

    let request_body = req.body.as_ref().map(|body| RequestBodySchema {
        required: body.required,
        description: non_empty(body.description),
        ty: build_type_schema(body.ty),
    });

    let base_resp_name = ts::client::response_name(m);
    let response_type_name = if group_names.contains_key(&name) {
        format!("{base_resp_name}$")
    } else {
        base_resp_name
    };

    let (resp_types, response_optional) = ts::client::response(m);
    let response_type = match resp_types.as_slice() {
        [] => None,
        [ty] => Some(build_type_schema(*ty)),
        many => Some(TypeSchema::Union {
            members: many.iter().copied().map(build_type_schema).collect(),
            discriminator: None,
        }),
    };

    let mut extensions = BTreeMap::new();
    for (k, v) in m.extensions() {
        extensions.insert(k.to_owned(), json_to_serde(v));
    }

    MethodSchema {
        name,
        path,
        http_method: m.http_method().as_str().to_owned(),
        route,
        summary: non_empty(m.summary()),
        description: non_empty(m.description()),
        deprecated: m.is_deprecated(),
        request_type_name,
        request_optional: has_request && req.optional(),
        request_flat: req.flat,
        request_params,
        request_body,
        response_type_name,
        response_type,
        response_optional,
        extensions,
    }
}

fn json_to_serde(val: &Json) -> serde_json::Value {
    if val.is_null() {
        serde_json::Value::Null
    } else if let Some(b) = val.as_bool() {
        serde_json::Value::Bool(b)
    } else if let Some(n) = val.as_f64() {
        serde_json::Number::from_f64(n).map_or(serde_json::Value::Null, serde_json::Value::Number)
    } else if let Some(s) = val.as_str() {
        serde_json::Value::String(s.to_owned())
    } else if let Some(arr) = val.as_array() {
        serde_json::Value::Array(arr.iter().map(json_to_serde).collect())
    } else if let Some(obj) = val.as_object() {
        let mut map = serde_json::Map::with_capacity(obj.len());
        for (k, v) in obj {
            map.insert(k.clone(), json_to_serde(v));
        }
        serde_json::Value::Object(map)
    } else {
        serde_json::Value::Null
    }
}

fn build_route_template(m: Method<'_>, params: &[ts::client::Param<'_>]) -> String {
    let mut path = m.path().to_owned();
    for param in params {
        if param.location == Location::Path {
            let wire = format!("{{{}}}", param.field.wire_name());
            path = path.replace(&wire, &format!("{{{}}}", param.name));
        }
    }
    path
}

fn build_type_schema(ty: Type<'_>) -> TypeSchema {
    match ty {
        Type::Scalar(scalar) => TypeSchema::Scalar {
            scalar: scalar_name(scalar),
        },
        Type::Model(model) => TypeSchema::Model {
            model: model_full_path(model),
        },
        Type::Array(array) => TypeSchema::Array {
            elem: Box::new(build_type_schema(array.elem())),
            min_items: array.min_items(),
            max_items: array.max_items(),
        },
        Type::Object(object) => build_object_schema(object),
        Type::Enum(e) => TypeSchema::Enum {
            values: e
                .values()
                .map(|val| match val {
                    EnumValue::String(s) => serde_json::Value::String(s.to_owned()),
                    EnumValue::Number(n) => {
                        serde_json::Number::from_f64(n).map_or(serde_json::Value::Null, serde_json::Value::Number)
                    }
                    EnumValue::Boolean(b) => serde_json::Value::Bool(b),
                })
                .collect(),
        },
        Type::Union(union) => build_union_schema(union),
        Type::Intersection(intersection) => TypeSchema::Intersection {
            members: intersection.members().map(build_type_schema).collect(),
        },
    }
}

fn scalar_name(scalar: Scalar) -> &'static str {
    match scalar {
        Scalar::Unknown => "unknown",
        Scalar::Null => "null",
        Scalar::Boolean => "boolean",
        Scalar::String | Scalar::Uuid | Scalar::Binary => "string",
        Scalar::Number(forge::Number::Int64 | forge::Number::Uint64) => "bigint",
        Scalar::Number(_) => "number",
        Scalar::DateTime => "Temporal.Instant",
        Scalar::Date => "Temporal.PlainDate",
        Scalar::Bytes => "Uint8Array",
    }
}

fn build_object_schema(object: Object<'_>) -> TypeSchema {
    let mut kept_fields: Vec<Field<'_>> = object.fields().filter(|&f| ts::types::kept(f)).collect();
    kept_fields.sort_by_key(|f| f.wire_name());

    let mut open = object.extra().is_some();
    for field in object.fields() {
        if !ts::types::kept(field) {
            open = true;
            break;
        }
    }

    let fields = kept_fields
        .into_iter()
        .map(|f| FieldSchema {
            name: f.name().camel(),
            wire_name: f.wire_name().to_owned(),
            required: f.is_required(),
            readonly: f.is_read_only(),
            deprecated: f.is_deprecated(),
            location: None,
            description: non_empty(f.description()),
            ty: build_type_schema(f.ty()),
        })
        .collect();

    let extra = if let Some(extra_ty) = object.extra() {
        if open && !matches!(extra_ty, Type::Scalar(Scalar::Unknown)) {
            Some(Box::new(TypeSchema::Scalar { scalar: "unknown" }))
        } else {
            Some(Box::new(build_type_schema(extra_ty)))
        }
    } else if open {
        Some(Box::new(TypeSchema::Scalar { scalar: "unknown" }))
    } else {
        None
    };

    TypeSchema::Object { fields, extra }
}

fn build_union_schema(union: Union<'_>) -> TypeSchema {
    let mut seen: HashSet<Model<'_>> = HashSet::new();
    let members: Vec<TypeSchema> = union
        .members()
        .filter(|&ty| match ty {
            Type::Model(model) => seen.insert(model),
            _ => true,
        })
        .map(build_type_schema)
        .collect();

    let discriminator = union.discriminator().map(|d: Discriminator<'_>| d.name().camel());

    TypeSchema::Union { members, discriminator }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_mcp_files_and_schema() {
        let doc = r##"{
             "openapi": "3.0.3",
                "info": { "title": "Example", "version": "4.0.0", "description": "API" },
                "servers": [{ "url": "https://api.example.com/v1" }],
             "paths": {
                 "/zones/{zone_id}/dns_records": {
                     "post": {
                         "x-fern-sdk-group-name": ["dns", "records"],
                         "x-fern-sdk-method-name": "create",
                            "x-required-scopes": ["dns:write", "zone:read"],
                         "summary": "Create DNS Record",
                         "parameters": [
                             {
                                 "name": "zone_id",
                                 "in": "path",
                                 "required": true,
                                 "schema": { "type": "string" }
                             }
                         ],
                         "requestBody": {
                             "required": true,
                             "content": {
                                 "application/json": {
                                     "schema": { "$ref": "#/components/schemas/CreateRecord" }
                                 }
                             }
                         },
                         "responses": {
                             "200": {
                                 "description": "ok",
                                 "content": {
                                     "application/json": {
                                         "schema": { "$ref": "#/components/schemas/Record" }
                                     }
                                 }
                             }
                         }
                     }
                 }
             },
             "components": {
                 "schemas": {
                     "CreateRecord": {
                         "type": "object",
                         "required": ["name", "type"],
                         "properties": {
                             "name": { "type": "string" },
                             "type": { "type": "string", "enum": ["A", "AAAA", "CNAME"] },
                             "settings": { "$ref": "#/components/schemas/RecordSettings" }
                         }
                     },
                     "RecordSettings": {
                         "type": "object",
                         "properties": {
                             "ipv4_only": { "type": "boolean" }
                         }
                     },
                     "Record": {
                         "type": "object",
                         "required": ["id", "name"],
                         "properties": {
                             "id": { "type": "string", "readOnly": true },
                             "name": { "type": "string" },
                             "settings": { "$ref": "#/components/schemas/RecordSettings" }
                         }
                     }
                 }
             }
         }"##;
        let forge: Forge = serde_json::from_str(doc).unwrap();
        let schema = build_api_schema(&forge);
        assert_eq!(schema.version, "4.0.0");
        assert_eq!(schema.root_children, vec!["dns"]);
        let records = &schema.groups["dns.records"];
        assert_eq!(records.methods.len(), 1);
        assert_eq!(records.methods[0].name, "create");
        assert_eq!(records.methods[0].path, "dns.records.create");
        assert!(records.methods[0].request_flat);
        assert_eq!(
            records.methods[0].extensions.get("x-required-scopes"),
            Some(&serde_json::json!(["dns:write", "zone:read"]))
        );
        assert!(schema.models.contains_key("dns.records.RecordSettings"));

        let files = forge::run(&forge, &Generator).unwrap();
        let paths: Vec<_> = files.iter().map(forge::File::path).collect();
        assert!(paths.contains(&"_/mcp.ts"));
        assert!(paths.contains(&"mcp.ts"));
    }
}
