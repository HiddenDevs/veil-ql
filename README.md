# Veil QL

Veil QL (`veil-ql`) is a zero-runtime-dependency TypeScript library for parsing
and statically validating filter expressions. Turn a query string into a typed
abstract syntax tree (AST), and check it against the fields, types, values, and
operators your application allows.

Use it as the query-language layer for search APIs, filter builders, or rule
configuration:

```text
user.age >= 18 AND user.status IN ["active", "pending"]
```

Veil QL handles tokenization, parsing, and semantic validation. It does **not**
execute queries, generate SQL, or validate application records. Your application
is responsible for interpreting or translating the resulting AST.

## Features

- Syntax-only parsing or schema-aware validation of boolean filters.
- Dotted field paths, comparisons, logical operators, lists, and `contains`.
- JSON-based schema configuration with field types, nullability, allowed values,
  operator restrictions, and a function allowlist.
- Custom function signatures with argument and return-type validation.
- Readonly, discriminated AST types and structured errors with source spans.
- ESM output, TypeScript declarations, and source maps.

## Getting started

Requires Node.js 22+ and npm. From the repository root:

```sh
npm install
npm run build
npm test
```

The package metadata currently uses the name `bql` and marks the package private.
Until publishing is configured, the examples below use the local build rather
than assuming `veil-ql` is available from a registry.

## Parse and validate a filter

```ts
import { Schema, parse, parseQuery, parseQueryWithSchema, parseWithSchema } from "./dist/src/index.js";

const schema = Schema.fromJson(`{
  "fields": {
    "user.age": {
      "type": "number",
      "operators": ["==", "!=", ">", ">=", "<", "<="]
    },
    "user.status": {
      "type": "string",
      "values": ["active", "pending", "banned"],
      "operators": ["==", "!=", "IN", "NOT IN"]
    },
    "user.email": { "type": "string", "nullable": true },
    "user.tags": { "type": { "list": "string" } }
  },
  "functions": ["contains"]
}`);

const ast = parseWithSchema('user.age >= 18 AND user.status == "active" AND contains(user.tags, "trusted")', schema);

console.log(ast.kind); // "binary"

// Parse without a schema, then validate the AST separately.
schema.validateFilter(parse("user.age >= 18"));

const query = parseQueryWithSchema(
    'user.status IN ["active", "pending"] SORT BY user.age DESC, user.status ASC',
    schema,
);
console.log(query.filter.kind, query.sorts);
```

`parse(source)` checks syntax and returns an `Expr`; it does not check whether
fields exist or whether their types are compatible. `parseWithSchema(source,
schema)` also checks that the expression is a valid, non-nullable boolean filter.

## Schema configuration

Schemas describe the query surface your application exposes, not the shape of
runtime records. Dotted paths such as `user.age` are explicitly declared fields.

| Option      | Purpose                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `fields`    | Map field paths to their definitions. Required.                                                                       |
| `type`      | `"number"`, `"string"`, `"boolean"`, or recursively `{ "list": TYPE }`. Required per field.                           |
| `nullable`  | Allow null for a field. Defaults to `false`.                                                                          |
| `values`    | Restrict literal comparisons to a nonempty set of allowed values. Omitted or `null` means unrestricted.               |
| `operators` | Allow specific direct comparison operators. Omitted or `null` allows type-compatible comparisons; `[]` disables them. |
| `functions` | Allow built-in or registered functions. Defaults to `["contains"]`; `[]` disables function calls.                     |

For a configuration file, use `Schema.fromJson(await readFile(path, "utf8"))`
with `readFile` from `node:fs/promises`. Reuse the resulting schema for queries.

If you already have an object, use `Schema.fromObject(value)` without serializing
it first. It accepts `unknown` and performs the same runtime checks as `fromJson`.
Both factories keep the schema independent of later changes to the input.
`SchemaConfig` and `FieldConfig` types are also exported for authoring
configuration objects with `satisfies`:

```ts
import { Schema, type SchemaConfig } from "./dist/src/index.js";

const config = {
    fields: {
        "user.age": { type: "number" },
        "user.active": { type: "boolean" },
    },
} satisfies SchemaConfig;

const schema = Schema.fromObject(config);
```

Unknown configuration properties, invalid field paths, mismatched allowed values,
and invalid operator/type combinations are rejected with `SchemaError`.

## Custom functions

Register custom function signatures in the second argument to either
`Schema.fromObject(config, options)` or `Schema.fromJson(json, options)`, and
enable their names in the schema's `functions` allowlist:

```ts
import { Schema, parseWithSchema, type SchemaOptions } from "./dist/src/index.js";

const options = {
    functions: {
        startsWith: {
            parameters: ["string", "string"],
            returns: "boolean",
        },
        length: {
            parameters: ["string"],
            returns: "number",
        },
    },
} satisfies SchemaOptions;

const schema = Schema.fromObject(
    {
        fields: { "user.name": { type: "string" } },
        functions: ["contains", "startsWith", "length"],
    },
    options,
);

parseWithSchema('startsWith(user.name, "admin") AND length(user.name) >= 5', schema);
```

`FunctionSignature` describes a fixed-length `parameters` array and a `returns`
type. Both use `FieldType`: `"number"`, `"string"`, `"boolean"`, or recursively
`{ list: TYPE }`. Zero-argument functions use `parameters: []`. Calls may be
nested, and return types are checked in the surrounding expression. Arguments
must match the declared non-nullable types; nullable fields and null literals
are rejected. Empty lists are compatible with declared list element types.
Optional arguments, overloads, and generic custom signatures are not supported.

Registration does not automatically enable a function. Omitting the schema's
`functions` still enables only `contains`, and `[]` disables all calls.
Unknown allowlist entries and invalid registrations throw `SchemaError`.
Names must be single, case-sensitive ASCII identifiers, not reserved words or
dotted paths. Built-in names cannot be overridden.

The built-in `contains` keeps its string and generic list signatures.
Custom signatures are copied when a schema is constructed, so later registry
mutations do not affect it. Registries can be shared across schemas with
different allowlists. Veil QL validates calls only; your application must
implement their execution or translation.

## Filter language

```text
user.age >= 18
user.status IN ["active", "pending"]
NOT (user.status == "banned") AND user.age < 65
user.email != null
contains(user.tags, "trusted")
```

- ASCII identifiers and case-insensitive reserved words; exact case-sensitive
  dotted field paths and function names.
- Finite numbers (including exponent notation), single/double quoted strings,
  booleans, nulls, lists, calls, grouping, `NOT`, and unary minus.
- Precedence, highest first: primary/grouping, unary minus, comparisons, `NOT`,
  `AND`, `OR`. Comparisons cannot chain, including `NOT IN`.
- Strings accept `\n`, `\r`, `\t`, `\\`, `\"`, and `\'` escapes.
- `operators` may contain `==`, `!=`, `>`, `>=`, `<`, `<=`, `IN`, `NOT IN`.
  Restrictions apply to direct field operands, including through unary minus,
  not to boolean field use or function arguments.
- `contains(string, string)` and `contains(list<T>, T)` return boolean.
- Equality requires compatible types. Only nullable fields accept null
  comparisons. Logical operations and filter roots require non-nullable
  booleans; ordering and unary minus require non-nullable numbers.
- Membership is scalar-in-list (or list-in-list-of-lists), not list overlap.
  Lists require compatible element types; empty lists infer compatibility from
  context.
- Enum checks apply to constants opposite direct fields in comparisons and
  members of literal membership lists. They do not prove runtime values in
  field-to-field comparisons or functions. List-field enums describe whole
  lists, not their elements; nullable enums must include null explicitly.

## Sorting

`parseQuery(source)` parses a boolean filter followed by an optional `SORT BY`
clause and returns a `Query` with a `filter` expression and ordered `sorts`
entries. Each entry contains a dotted field path and a direction. The direction
defaults to `ASC`; multiple sort fields are comma-separated:

```ts
const query = parseQuery('user.status == "active" SORT BY user.age DESC, user.name');
```

`parseQueryWithSchema(source, schema)` validates the filter expression as well.
Sort paths are parsed as field paths but are not checked against the schema by
this helper; applications should allowlist sort paths before translating them
to database columns. The existing `parse` and `parseWithSchema` functions
continue to accept filter expressions only.

Validation is static. Nullable values do not acquire flow-sensitive narrowing
from preceding conditions: a null check does not make a subsequent nullable
number comparison valid.

## Error handling

Veil QL distinguishes `LexError` (invalid tokens), `ParseError` (invalid syntax),
`SchemaError` (invalid configuration), and `ValidationError` (invalid filter
semantics). Query errors expose a discriminated `detail` object and a `span`.

```ts
import { LexError, ParseError, ValidationError, parseWithSchema } from "./dist/src/index.js";

// Using the schema from the example above:
try {
    parseWithSchema('user.age >= "eighteen"', schema);
} catch (error) {
    if (error instanceof LexError || error instanceof ParseError || error instanceof ValidationError) {
        console.error(error.detail.kind, error.span);
    } else {
        throw error;
    }
}
```

AST and error spans use half-open **UTF-8 byte offsets**, not JavaScript UTF-16
indices. For JS string slicing, translate offsets to UTF-16 indices or slice
UTF-8 encoded bytes first. Numbers use JavaScript's IEEE-754 `number`, matching
double-precision floating-point semantics.

## Development

| Command                | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `npm run build`        | Emit JavaScript, declarations, and source maps into `dist/`.   |
| `npm run typecheck`    | Run strict TypeScript checking without emitting files.         |
| `npm test`             | Run the lexer, parser, schema, and function tests with Vitest. |
| `npm run lint`         | Check source and tests with ESLint.                            |
| `npm run lint:fix`     | Apply automatic ESLint fixes.                                  |
| `npm run format`       | Format the project with Prettier.                              |
| `npm run format:check` | Check formatting without changing files.                       |

## Project structure

- [index.ts](src/index.ts): public API and parsing helpers.
- [lexer.ts](src/lexer.ts): tokenization via `nextToken()` or `tokenize()`.
- [parser.ts](src/parser.ts): recursive-descent parsing with explicit precedence.
- [ast.ts](src/ast.ts): readonly discriminated expression types.
- [schema.ts](src/schema.ts): checked, reusable schema configuration.
- [validator.ts](src/validator.ts): semantic validation of filter expressions.
- [type-system.ts](src/type-system.ts): type compatibility and constant checks.
- [errors.ts](src/errors.ts): structured lexical, parse, schema, and validation errors.
- [tests](tests): language and validation behavior tests.
