# Veil-QL

Veil-QL (`veil-ql`) is a zero-runtime-dependency TypeScript library for parsing
and statically validating filter expressions. Turn a query string into a typed
abstract syntax tree (AST), and check it against the fields, types, values, and
operators your application allows.

Use it as the query-language layer for search APIs, filter builders, or rule
configuration:

```text
user.age >= 18 AND user.status IN ["active", "pending"]
```

Veil-QL handles tokenization, parsing, and semantic validation. It does **not**
execute queries, generate SQL, or validate application records. Your application
is responsible for interpreting or translating the resulting AST.

## Features

- Syntax-only parsing or schema-aware validation of boolean filters and `SORT BY`.
- Dotted field paths, comparisons, logical operators, lists, and function calls.
- JSON-compatible schema configuration with field types, nullability, allowed
  values, operator restrictions, sortable/filterable fields, and functions.
- Descriptions and validated example queries in the schema, exported as
  structured JSON for building AI-agent instructions or tool definitions.
- Readonly, discriminated AST types and structured errors with readable
  messages and source spans.
- ESM output, TypeScript declarations, and source maps.

## Getting started

Requires Node.js 22.12+ and npm. Install Veil-QL from npm:

```sh
npm install @hiddendevs/veil-ql
```

TypeScript declarations are included; no separate `@types` package is needed.
The package supports `node` (legacy), `node16`/`nodenext`, and `bundler` TypeScript
module resolution. Both ESM `import` and CommonJS `require()` are supported.
The runtime output is ESM; CommonJS uses Node.js 22.12+'s synchronous ESM
loading, so both entry points share the same classes and module state.

```js
const { Schema, parse } = require("@hiddendevs/veil-ql");
```

## Parse and validate a query

```ts
import { Schema, parse } from "@hiddendevs/veil-ql";

const schema = Schema.fromObject({
    description: "Registered users.",
    fields: {
        "user.age": { type: "number", description: "Age in years.", sortable: true },
        "user.status": {
            type: "string",
            values: ["active", "pending", "banned"],
            operators: ["==", "!=", "IN", "NOT IN"],
        },
        "user.email": { type: "string", nullable: true },
        "user.tags": { type: { list: "string" } },
        "user.createdAt": { type: "number", filterable: false, sortable: true },
    },
});

// Filter only.
const ast = schema.parse('user.age >= 18 AND user.status == "active" AND contains(user.tags, "trusted")');

// Filter with optional sorting.
const query = schema.parseQuery('user.status IN ["active", "pending"] SORT BY user.age DESC, user.createdAt');
console.log(query.filter.kind, query.sorts);

// Parse syntax without a schema, then validate the AST separately.
schema.validate(parse("user.age >= 18"));
```

| API                         | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `parse(source)`             | Parse a filter. Syntax only: fields and types are not checked.        |
| `parseQuery(source)`        | Parse a filter with an optional `SORT BY` clause. Syntax only.        |
| `schema.parse(source)`      | Parse and validate a filter as a non-nullable boolean expression.     |
| `schema.parseQuery(source)` | Parse and validate a filter and check that sort fields are sortable.  |
| `schema.validate(expr)`     | Validate an already-parsed filter.                                    |
| `schema.validateQuery(q)`   | Validate an already-parsed query, including its sort fields.          |
| `schema.describe()`         | Describe the language and schema as JSON for an AI agent (see below). |

## Schema configuration

Schemas describe the query surface your application exposes, not the shape of
runtime records. Dotted paths such as `user.age` are explicitly declared fields.

| Schema option | Purpose                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `fields`      | Map field paths to field definitions. Required.                                                  |
| `functions`   | Map function names to `true` (built-in) or a custom signature. Defaults to `{ contains: true }`. |
| `description` | What the queried data represents. Used only by `describe()`.                                     |
| `examples`    | `{ query, description }` pairs. Validated when the schema is created; returned by `describe()`.  |

| Field option  | Purpose                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `type`        | `"number"`, `"string"`, `"boolean"`, or recursively `{ "list": TYPE }`. Required.                                     |
| `description` | What the field means, including units or formats. Used only by `describe()`.                                          |
| `nullable`    | Allow null for a field. Defaults to `false`.                                                                          |
| `values`      | Restrict literal comparisons to a nonempty set of allowed values. Omitted or `null` means unrestricted.               |
| `operators`   | Allow specific direct comparison operators. Omitted or `null` allows type-compatible comparisons; `[]` disables them. |
| `filterable`  | Allow the field in filter expressions. Defaults to `true`.                                                            |
| `sortable`    | Allow the field in `SORT BY`. Defaults to `false`. List fields cannot be sortable.                                    |

A field must be filterable, sortable, or both. Use `filterable: false` for
sort-only fields such as a creation timestamp.

`Schema.fromObject(config)` accepts a typed `SchemaConfig`, so object literals get
autocompletion. It still checks every value at runtime, so it is also safe for
already-parsed untrusted data such as `JSON.parse` output. For a configuration
file, use `Schema.fromJson(await readFile(path, "utf8"))`. Both factories copy
the input, so later changes to it do not affect the schema. Reuse a schema across
queries.

Unknown configuration properties, invalid field paths, mismatched allowed values,
invalid operator/type combinations, and invalid examples are rejected with
`SchemaError`.

## Functions

The `functions` map is the complete set of functions a query may call. Enable a
built-in function with `true`, or declare a custom function with its signature:

```ts
import { Schema, type FunctionConfig } from "@hiddendevs/veil-ql";

// Plain objects can be shared between schemas.
const stringFunctions = {
    startsWith: {
        description: "True when text begins with prefix (case-sensitive).",
        parameters: [
            { name: "text", type: "string" },
            { name: "prefix", type: "string", description: "Prefix to match." },
        ],
        returns: "boolean",
    },
    length: { parameters: ["string"], returns: "number" },
} satisfies Record<string, FunctionConfig>;

const schema = Schema.fromObject({
    fields: { "user.name": { type: "string" } },
    functions: { contains: true, ...stringFunctions },
});

schema.parse('startsWith(user.name, "admin") AND length(user.name) >= 5');
```

Omitting `functions` enables only `contains`; `{}` disables all calls. The
built-in `contains` supports `contains(string, string)` and
`contains(list<T>, T)`, and cannot be redefined.

Custom `parameters` is a fixed-length array. Each entry is either a bare type or
`{ type, name?, description? }`; names and descriptions only appear in
`describe()`. Types are `"number"`, `"string"`, `"boolean"`, or recursively
`{ list: TYPE }`. Calls may be nested, and return types are checked in the
surrounding expression. Arguments must match the declared non-nullable types;
nullable fields and null literals are rejected. Empty lists are compatible with
declared list element types. Optional arguments, overloads, and generic custom
signatures are not supported.

Function names must be single, case-sensitive ASCII identifiers, not reserved
words or dotted paths. Veil-QL validates calls only; your application must
implement their execution or translation.

## AI agent instructions

`schema.describe()` returns a plain, JSON-serializable `SchemaDescription` with
everything an agent needs to write valid queries:

- `description`: the schema description, if configured.
- `language`: a schema-independent `LanguageReference` with a summary, grammar,
  rules, operator meanings, and reserved keywords. Also exported as
  `LANGUAGE_REFERENCE`.
- `fields`: name, description, type, nullability, `filterable`, `sortable`, the
  effective `operators` the field accepts, and allowed `values`.
- `functions`: name, description, readable `signatures` (for example
  `startsWith(text: string, prefix: string) -> boolean`), and for custom
  functions, `parameters` and `returns`.
- `examples`: the schema's example queries. They are validated when the schema
  is created, so they always match the schema.

Optional properties are omitted rather than set to `undefined`, so the result
serializes cleanly with `JSON.stringify`. Render it into a system prompt, embed it
in a tool definition, or pass it to a template:

```ts
const description = schema.describe();

const systemPrompt = [
    "Write a Veil-QL query for the user's request.",
    description.language.summary,
    ...description.language.rules,
    "Schema:",
    JSON.stringify({ fields: description.fields, functions: description.functions }, null, 2),
].join("\n");
```

Error messages are written to be returned to the agent so it can correct its
query, for example `value is not allowed for field 'order.status'; allowed:
"pending", "paid" (at 16..26)`. See [examples/ai-agent.ts](examples/ai-agent.ts)
for a full prompt renderer, tool definition, and validation loop.

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

`parseQuery(source)` and `schema.parseQuery(source)` parse a boolean filter
followed by an optional `SORT BY` clause and return a `Query` with a `filter`
expression and ordered `sorts` entries. Each entry contains a dotted field path
and a direction. The direction defaults to `ASC`; multiple sort fields are
comma-separated:

```ts
const query = schema.parseQuery('user.status == "active" SORT BY user.age DESC, user.createdAt');
```

`schema.parseQuery` rejects unknown sort fields with `UnknownField` and fields
not marked `sortable` with `FieldNotSortable`. `parse` and `schema.parse` accept
filter expressions only.

Validation is static. Nullable values do not acquire flow-sensitive narrowing
from preceding conditions: a null check does not make a subsequent nullable
number comparison valid.

## Error handling

Query errors extend `QueryError`: `LexError` (invalid tokens), `ParseError`
(invalid syntax), and `ValidationError` (invalid semantics). Each exposes a
discriminated `detail` object, a `span`, and a readable `message`. `SchemaError`
reports invalid configuration and is never caused by a query string.

```ts
import { QueryError } from "@hiddendevs/veil-ql";

try {
    schema.parse('user.age >= "eighteen"');
} catch (error) {
    if (!(error instanceof QueryError)) throw error;
    console.error(error.message); // expected number but found string (at 12..22)
    console.error(error.detail.kind, error.span);
}
```

`describeErrorDetail(detail)` returns the message text without the span.

AST and error spans use half-open **UTF-8 byte offsets**, not JavaScript UTF-16
indices. For JS string slicing, translate offsets to UTF-16 indices or slice
UTF-8 encoded bytes first. Numbers use JavaScript's IEEE-754 `number`, matching
double-precision floating-point semantics.

## Development

| Command                | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `npm run build`        | Emit JavaScript, declarations, and source maps into `dist/`.    |
| `npm run typecheck`    | Run strict TypeScript checking without emitting files.          |
| `npm test`             | Build, then run Vitest, including native import/require checks. |
| `npm run lint`         | Check source and tests with ESLint.                             |
| `npm run lint:fix`     | Apply automatic ESLint fixes.                                   |
| `npm run format`       | Format the project with Prettier.                               |
| `npm run format:check` | Check formatting without changing files.                        |

## Project structure

- [src/index.ts](src/index.ts): public API.
- [src/errors.ts](src/errors.ts): query and schema errors with readable messages.
- [src/syntax/](src/syntax): schema-independent tokens, lexer, recursive-descent parser, and AST.
- [src/schema/](src/schema): public configuration types, runtime configuration checks, the
  normalized model, the type system, and the `Schema` class.
- [src/validation/](src/validation): semantic validation and built-in functions.
- [src/describe/](src/describe): the language reference and `describe()` output for AI agents.
- [tests](tests): language, validation, sorting, description, and error tests.
- [examples](examples): TypeORM translation and AI-agent integration examples.
