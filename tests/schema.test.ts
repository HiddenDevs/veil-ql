import assert from "node:assert/strict";
import { test } from "vitest";
import { Schema, SchemaError, ValidationError, parse } from "../src/index.js";
import type { Expr, SchemaConfig, ValidationErrorDetail } from "../src/index.js";

const config = {
    fields: {
        "user.age": { type: "number" },
        "account.age": { type: "number" },
        "user.status": {
            type: "string",
            values: ["active", "pending", "banned"],
            operators: ["==", "!=", "IN", "NOT IN"],
        },
        "user.active": { type: "boolean" },
        "user.email": { type: "string", nullable: true },
        "user.score": { type: "number", values: [-1, 0, 1] },
        "user.tags": { type: { list: "string" } },
        "user.matrix": { type: { list: { list: "number" } } },
        restricted: { type: "number", operators: ["=="] },
        nullable_number: { type: "number", nullable: true },
    },
} satisfies SchemaConfig;
const schema = Schema.fromJson(JSON.stringify(config));

test("constructs a schema from typed configuration or an already parsed object", () => {
    const parsed: unknown = JSON.parse(JSON.stringify(config));
    for (const input of [config, parsed]) {
        const schema = Schema.fromObject(input as SchemaConfig);
        assert.doesNotThrow(() => schema.parse('user.age >= 18 AND contains(user.tags, "trusted")'));
        assert.throws(() => schema.parse('user.age >= "eighteen"'), ValidationError);
        assert.throws(() => schema.parse("missing == 1"), ValidationError);
        assert.throws(() => schema.parse('user.status == "deleted"'), ValidationError);
    }
});

test("does not retain mutable references to object configuration", () => {
    const config = {
        fields: {
            numbers: { type: { list: "number" }, values: [[1, 2]], operators: ["=="] },
        },
        functions: { contains: true },
    };
    const schema = Schema.fromObject(config as SchemaConfig);
    config.fields.numbers.type.list = "string";
    config.fields.numbers.values[0]?.push(3);
    config.fields.numbers.operators.length = 0;
    Object.assign(config.functions, { contains: { parameters: [], returns: "boolean" } });

    assert.doesNotThrow(() => schema.parse("numbers == [1, 2]"));
    assert.throws(() => schema.parse("numbers == [1, 2, 3]"), ValidationError);
    assert.doesNotThrow(() => schema.parse("contains(numbers, 1)"));
});

test("rejects non-JSON values in object configuration", () => {
    for (const value of [undefined, "{}", 1, true, { fields: { x: { type: "number", values: [NaN] } } }]) {
        assert.throws(() => Schema.fromObject(value as SchemaConfig), SchemaError);
    }
});

for (const query of [
    "user.age >= 18 AND user.active",
    "NOT user.active OR -user.age < 0",
    "user.age > account.age",
    'user.status IN ["active", "pending"]',
    'user.status NOT IN ["banned"]',
    "user.email == null",
    "null != user.email",
    "user.email == user.status",
    'contains(user.tags, "trusted")',
    'contains("hello", "ell")',
    "contains([1, 2], 1)",
    "contains([], 1)",
    "user.age IN []",
    "user.tags == []",
    "user.matrix == [[], [1, 2]]",
    "user.score == -1",
    "user.score == 1.0",
    "[1, 2] IN [[1, 2], []]",
]) {
    test(`accepts ${query}`, () => {
        assert.doesNotThrow(() => schema.parse(query));
    });
}

const failures: readonly [string, ValidationErrorDetail["kind"]][] = [
    ["user.missing == true", "UnknownField"],
    ['user.age >= "eighteen"', "TypeMismatch"],
    ["user.age == user.active", "TypeMismatch"],
    ["user.age AND true", "TypeMismatch"],
    ["NOT user.age", "TypeMismatch"],
    ["-user.active == 1", "TypeMismatch"],
    ["user.age == null", "TypeMismatch"],
    ["user.active > false", "TypeMismatch"],
    ["user.age IN 18", "TypeMismatch"],
    ['user.age IN [18, "19"]', "TypeMismatch"],
    ['user.tags IN ["trusted"]', "TypeMismatch"],
    ["user.matrix == [[], [1], [true]]", "TypeMismatch"],
    ["user.age", "TypeMismatch"],
    ["[true]", "TypeMismatch"],
    ["user.email", "TypeMismatch"],
    ["nullable_number > 1", "TypeMismatch"],
    ["-nullable_number == 1", "TypeMismatch"],
    ['user.status == "deleted"', "ValueNotAllowed"],
    ['"deleted" != user.status', "ValueNotAllowed"],
    ['user.status IN ["active", "deleted"]', "ValueNotAllowed"],
    ['user.status NOT IN ["deleted"]', "ValueNotAllowed"],
    ["user.score == -2", "ValueNotAllowed"],
    ["user.score IN [0, -2]", "ValueNotAllowed"],
    ["restricted > 1", "OperatorNotAllowed"],
    ["1 < restricted", "OperatorNotAllowed"],
    ["-restricted > 1", "OperatorNotAllowed"],
    ["restricted IN [1]", "OperatorNotAllowed"],
    ["missing(user.age)", "UnknownFunction"],
    ["contains()", "InvalidArgumentCount"],
    ["contains(user.tags)", "InvalidArgumentCount"],
    ["contains(user.tags, 1, 2)", "InvalidArgumentCount"],
    ["contains(user.tags, 1)", "TypeMismatch"],
    ["contains(user.age, 1)", "TypeMismatch"],
    ['contains(user.email, "@")', "TypeMismatch"],
    ["contains(user.tags, missing)", "UnknownField"],
    ["contains([1, true], 1)", "TypeMismatch"],
];

for (const [query, kind] of failures) {
    test(`rejects ${query} with ${kind}`, () => {
        assert.throws(
            () => schema.parse(query),
            (error: unknown) => {
                assert.ok(error instanceof ValidationError);
                assert.equal((error as ValidationError).detail.kind, kind);
                return true;
            },
        );
    });
}

test("reports UTF-8 spans and supports validating an existing AST", () => {
    schema.validate(parse("user.age >= 18"));
    assert.equal(parse("unknown == true").kind, "binary");
    assert.throws(
        () => schema.parse('"é" == user.missing'),
        (error: unknown) => {
            assert.ok(error instanceof ValidationError);
            assert.deepEqual((error as ValidationError).span, { start: 8, end: 20 });
            return true;
        },
    );
});

test("functions can be disabled and unknown names cannot be configured", () => {
    const disabled = Schema.fromJson('{"fields": {}, "functions": {}}');
    assert.throws(() => disabled.parse('contains("a", "a")'), ValidationError);
    assert.doesNotThrow(() => disabled.parse("true"));
    assert.throws(() => Schema.fromJson('{"fields": {}, "functions": {"eval": true}}'), SchemaError);
});

for (const raw of [
    "null",
    "[]",
    "{}",
    '{"fields": []}',
    '{"fields": {}, "typo": true}',
    '{"fields": {"x": {"type": "integer"}}}',
    '{"fields": {"x": {"type": "number", "typo": true}}}',
    '{"fields": {"x": {"type": {"list": "string", "typo": true}}}}',
    '{"fields": {"x": {"type": "string", "operators": [">"]}}}',
    '{"fields": {"x": {"type": "number", "nullable": true, "operators": [">"]}}}',
    '{"fields": {"x": {"type": "boolean", "operators": ["LIKE"]}}}',
    '{"fields": {"x": {"type": "number", "values": ["1"]}}}',
    '{"fields": {"x": {"type": "number", "values": [null]}}}',
    '{"fields": {"x": {"type": "number", "values": []}}}',
    '{"fields": {"x": {"type": {"list": "number"}, "values": [[1, true]]}}}',
    '{"fields": {"x": {"type": "number", "nullable": "true"}}}',
    '{"fields": {"x": {"type": "number", "nullable": null}}}',
    '{"fields": {"x": {"type": "number", "operators": {}}}}',
    '{"fields": {"x": {"type": "number", "values": {}}}}',
    '{"fields": {}, "functions": null}',
    '{"fields": {}, "functions": "contains"}',
    '{"fields": {}, "functions": ["contains"]}',
    '{"fields": {}, "description": 1}',
    '{"fields": {}, "description": " "}',
    '{"fields": {"x": {"type": "number", "description": 1}}}',
    '{"fields": {"x": {"type": "number", "sortable": "yes"}}}',
    '{"fields": {"x": {"type": "number", "filterable": false}}}',
    '{"fields": {"x": {"type": {"list": "number"}, "sortable": true}}}',
    '{"fields": {}, "examples": {}}',
    '{"fields": {}, "examples": [{"query": "true"}]}',
    '{"fields": {}, "examples": [{"query": 1, "description": "d"}]}',
    '{"fields": {}, "examples": [{"query": "true", "description": "d", "typo": 1}]}',
]) {
    test(`rejects invalid schema ${raw}`, () => {
        assert.throws(() => Schema.fromJson(raw), SchemaError);
        assert.throws(() => Schema.fromObject(JSON.parse(raw)), SchemaError);
    });
}

test("malformed JSON preserves the underlying syntax error as its cause", () => {
    assert.throws(
        () => Schema.fromJson("{"),
        (error: unknown) => {
            assert.ok(error instanceof SchemaError);
            assert.ok((error as SchemaError).cause instanceof SyntaxError);
            return true;
        },
    );
});

test("validates field paths and treats prototype property names as ordinary fields", () => {
    for (const path of ["", ".", "user.", ".user", "user..age", "a b", "1age", "user.IN", "true", "é"]) {
        assert.throws(() => Schema.fromJson(JSON.stringify({ fields: { [path]: { type: "number" } } })), SchemaError);
    }
    const special = Schema.fromJson('{"fields": {"_user.age2": {"type": "number"}, "__proto__": {"type": "boolean"}}}');
    assert.doesNotThrow(() => special.parse("_user.age2 == 1 AND __proto__"));
    assert.throws(() => special.parse("constructor == 1"), ValidationError);
});

test("supports whole-list enums, nullable enums, and empty operator lists", () => {
    const enums = Schema.fromJson(
        JSON.stringify({
            fields: {
                numbers: { type: { list: "number" }, values: [[1, 2], []] },
                status: { type: "string", nullable: true, values: ["active", null] },
                disabled: { type: "number", operators: [] },
            },
        }),
    );
    for (const query of ["numbers == [1.0, 2.0]", "numbers == []", "status == null"]) {
        assert.doesNotThrow(() => enums.parse(query));
    }
    assert.throws(() => enums.parse("numbers == [3]"), ValidationError);
    assert.throws(() => enums.parse("disabled == 1"), ValidationError);
});

test("does not lose inferred types after nullable or empty list elements", () => {
    for (const query of [
        "contains([user.email, user.email], 1)",
        "contains([user.email, null], 1)",
        "contains([null, user.email], 1)",
        "user.matrix == [[], [1], [false]]",
    ]) {
        assert.throws(() => schema.parse(query), ValidationError);
    }
});

test("rejects nonfinite values in a manually constructed AST", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
        const expr: Expr = { kind: "literal", value, span: { start: 0, end: 1 } };
        assert.throws(
            () => schema.validate(expr),
            (error: unknown) => {
                assert.ok(error instanceof ValidationError);
                assert.equal((error as ValidationError).detail.kind, "NonFiniteNumber");
                return true;
            },
        );
    }
});

test("validates a larger composed filter with field-to-field comparisons", () => {
    assert.doesNotThrow(() =>
        schema.parse(`
    NOT (user.status == "banned" OR user.age < 18)
    AND (user.active AND contains(user.tags, "trusted"))
    AND user.age >= account.age
    AND user.email != null
    AND user.status IN ["active", "pending"]
  `),
    );
});
