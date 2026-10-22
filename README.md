# BQL in TypeScript

A standalone, zero-runtime-dependency implementation of the Rust BQL lexer,
parser, and JSON-schema validation pass. The Rust project is unchanged.

Requires Node.js 22+ and npm.

```sh
cd typescript
npm install
npm test
npm run example
```

`npm run build` emits JavaScript, declarations, and source maps into `dist/`.
`npm run typecheck` runs strict TypeScript checking without emitting files.

## Usage

```ts
import { Schema, ValidationError, parse, parseWithSchema } from "./src/index.js";

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

const ast = parseWithSchema(
  'user.age >= 18 AND user.status == "active" AND contains(user.tags, "trusted")',
  schema,
);

// Syntax-only parsing and separate validation are also supported.
schema.validateFilter(parse("user.age >= 18"));

try {
  parseWithSchema('user.age >= "eighteen"', schema);
} catch (error) {
  if (!(error instanceof ValidationError)) throw error;
  console.error(error.detail, error.span);
}
```

For a configuration file, use `Schema.fromJson(await readFile(path, "utf8"))`
with `readFile` from `node:fs/promises`. Reuse the resulting schema for queries.
`SchemaConfig` and `FieldConfig` types are exported for authoring configuration
objects with `satisfies`; JSON is still checked at runtime, not cast to trusted
types.

## Design

- [lexer.ts](src/lexer.ts): stateful scanner; `nextToken()` or `tokenize()`.
- [parser.ts](src/parser.ts): recursive descent with explicit precedence levels.
- [ast.ts](src/ast.ts): readonly discriminated unions, rather than an inheritance
  hierarchy or mutable untyped nodes.
- [schema.ts](src/schema.ts): factory that checks unknown JSON and constructs a
  reusable schema without exposing its configuration.
- [validator.ts](src/validator.ts): separate semantic pass over the AST.
- [type-system.ts](src/type-system.ts): shared type compatibility, list unification,
  and constant comparison.
- [errors.ts](src/errors.ts): distinct lexical, parse, schema, and validation
  exceptions, with discriminated details for query errors.
- [index.ts](src/index.ts): public API, without example-program side effects.
- [main.ts](src/main.ts): runnable valid and invalid query examples.

Separation of concerns and exhaustive typed switches keep the implementation
extensible without unnecessary factories, visitor classes, or dependency
injection frameworks.

## Language and configuration

The grammar and schema format follow the [Rust implementation](../README.md):

- ASCII identifiers and case-insensitive reserved words; exact case-sensitive
  dotted field paths and function names.
- Finite numbers (including exponent notation), single/double quoted strings,
  booleans, nulls, lists, calls, grouping, `NOT`, and unary minus.
- Precedence, highest first: primary/grouping, unary minus, comparisons, `NOT`,
  `AND`, `OR`. Comparisons cannot chain, including `NOT IN`.
- Strings accept `\n`, `\r`, `\t`, `\\`, `\"`, and `\'` escapes.
- Types are `"number"`, `"string"`, `"boolean"`, or recursively `{"list": TYPE}`.
- Optional `nullable`, `values`, and `operators` control field validation.
  Unknown properties, invalid types, reserved-word paths, mistyped enum values,
  and impossible ordering configurations are rejected.
- `operators` may contain `==`, `!=`, `>`, `>=`, `<`, `<=`, `IN`, `NOT IN`.
  Omission allows type-compatible comparisons; `[]` disables direct comparisons.
  Restrictions apply to direct field operands, including through unary minus,
  not to boolean field use or function arguments.
- `functions` defaults to `["contains"]`; `[]` disables functions.
  `contains(string, string)` and `contains(list<T>, T)` return boolean.
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

Spans use half-open **UTF-8 byte offsets**, matching Rust, not JavaScript UTF-16
indices. For JS string slicing, translate offsets to UTF-16 indices or slice
UTF-8 encoded bytes first. Numbers use JavaScript's IEEE-754 `number`, matching
Rust's `f64` semantics.

Validation is static, not evaluation or runtime record validation. Nullable
values do not acquire flow-sensitive narrowing from preceding conditions.
