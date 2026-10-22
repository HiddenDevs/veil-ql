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
import { Schema, parse, parseWithSchema } from "./dist/src/index.js";

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
| `functions` | Allow implemented functions. Defaults to `["contains"]`; `[]` disables function calls.                                |

For a configuration file, use `Schema.fromJson(await readFile(path, "utf8"))`
with `readFile` from `node:fs/promises`. Reuse the resulting schema for queries.
`SchemaConfig` and `FieldConfig` types are exported for authoring configuration
objects with `satisfies`; JSON is still checked at runtime, not cast to trusted
types.

Unknown configuration properties, invalid field paths, mismatched allowed values,
and invalid operator/type combinations are rejected with `SchemaError`.

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

| Command                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `npm run build`        | Emit JavaScript, declarations, and source maps into `dist/`. |
| `npm run typecheck`    | Run strict TypeScript checking without emitting files.       |
| `npm test`             | Run the lexer, parser, and schema tests with Vitest.         |
| `npm run lint`         | Check source and tests with ESLint.                          |
| `npm run lint:fix`     | Apply automatic ESLint fixes.                                |
| `npm run format`       | Format the project with Prettier.                            |
| `npm run format:check` | Check formatting without changing files.                     |

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
