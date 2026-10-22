import assert from "node:assert/strict";
import { test } from "vitest";
import { Schema, SchemaError, ValidationError } from "../src/index.js";
import type { FunctionConfig, SchemaConfig, ValidationErrorDetail } from "../src/index.js";

const customFunctions = {
    startsWith: {
        parameters: [
            { name: "text", type: "string" },
            { name: "prefix", type: "string" },
        ],
        returns: "boolean",
    },
    length: { parameters: ["string"], returns: "number" },
    normalize: { parameters: ["string"], returns: "string" },
    tags: { parameters: [], returns: { list: "string" } },
    allPositive: { parameters: [{ list: "number" }], returns: "boolean" },
    matrix: { parameters: [{ list: { list: "number" } }], returns: "boolean" },
    negate: { parameters: ["boolean"], returns: "boolean" },
} satisfies Record<string, FunctionConfig>;

const config = {
    fields: {
        name: { type: "string" },
        email: { type: "string", nullable: true },
        numbers: { type: { list: "number" } },
        nullableNumbers: { type: { list: "number" }, nullable: true },
    },
    functions: { contains: true, ...customFunctions },
} satisfies SchemaConfig;

for (const factory of ["fromObject", "fromJson"] as const) {
    const schema = factory === "fromObject" ? Schema.fromObject(config) : Schema.fromJson(JSON.stringify(config));

    for (const query of [
        'startsWith(name, "admin")',
        "length(name) >= 3",
        'startsWith(normalize(name), "admin")',
        'contains(tags(), "trusted")',
        "name IN tags()",
        "allPositive(numbers)",
        "allPositive([])",
        "matrix([[], [1, 2]])",
        'negate(startsWith(name, "admin"))',
    ]) {
        test(`${factory} validates custom call ${query}`, () => {
            assert.doesNotThrow(() => schema.parse(query));
        });
    }

    const failures: readonly [string, ValidationErrorDetail["kind"]][] = [
        ["startsWith(name)", "InvalidArgumentCount"],
        ['startsWith(name, "a", "b")', "InvalidArgumentCount"],
        ["tags(1) == []", "InvalidArgumentCount"],
        ["startsWith(name, 1)", "TypeMismatch"],
        ['startsWith(email, "a")', "TypeMismatch"],
        ['startsWith(null, "a")', "TypeMismatch"],
        ["length(name)", "TypeMismatch"],
        ["tags()", "TypeMismatch"],
        ["allPositive(nullableNumbers)", "TypeMismatch"],
        ["allPositive([null])", "TypeMismatch"],
        ["allPositive([1, null])", "TypeMismatch"],
        ["allPositive([1, true])", "TypeMismatch"],
        ['allPositive(["1"])', "TypeMismatch"],
        ["matrix([[true]])", "TypeMismatch"],
        ["negate(1)", "TypeMismatch"],
        ["length(missing) == 1", "UnknownField"],
        ["unknown()", "UnknownFunction"],
        ['STARTSWITH(name, "a")', "UnknownFunction"],
    ];
    for (const [query, kind] of failures) {
        test(`${factory} rejects custom call ${query} with ${kind}`, () => {
            assert.throws(
                () => schema.parse(query),
                (error: unknown) => {
                    assert.ok(error instanceof ValidationError);
                    assert.equal(error.detail.kind, kind);
                    return true;
                },
            );
        });
    }
}

test("custom argument errors identify the offending argument span", () => {
    const schema = Schema.fromObject(config);
    assert.throws(
        () => schema.parse('startsWith("a", 123)'),
        (error: unknown) => {
            assert.ok(error instanceof ValidationError);
            assert.deepEqual(error.detail, { kind: "TypeMismatch", expected: "string", actual: "number" });
            assert.deepEqual(error.span, { start: 16, end: 19 });
            return true;
        },
    );
});

test("custom arity errors report the signature count and whole call span", () => {
    const schema = Schema.fromObject(config);
    assert.throws(
        () => schema.parse("startsWith(name)"),
        (error: unknown) => {
            assert.ok(error instanceof ValidationError);
            assert.deepEqual(error.detail, {
                kind: "InvalidArgumentCount",
                function: "startsWith",
                expected: 2,
                actual: 1,
            });
            assert.deepEqual(error.span, { start: 0, end: 16 });
            return true;
        },
    );
});

test("only configured functions are enabled and contains is the default", () => {
    for (const functions of [undefined, {}, { contains: true as const }]) {
        const schema = Schema.fromObject(functions === undefined ? { fields: {} } : { fields: {}, functions });
        assert.throws(() => schema.parse('startsWith("a", "a")'), ValidationError);
        if (functions !== undefined && Object.keys(functions).length === 0) {
            assert.throws(() => schema.parse('contains("a", "a")'), ValidationError);
        } else {
            assert.doesNotThrow(() => schema.parse('contains("a", "a")'));
        }
    }
    const customOnly = Schema.fromObject({ fields: {}, functions: { startsWith: customFunctions.startsWith } });
    assert.doesNotThrow(() => customOnly.parse('startsWith("a", "a")'));
    assert.throws(() => customOnly.parse('contains("a", "a")'), ValidationError);
});

test("function configurations are copied and isolated between schemas", () => {
    const shared = structuredClone({ copy: { parameters: [{ list: "number" }], returns: { list: "number" } } });
    const schema = Schema.fromObject({ fields: {}, functions: shared as Record<string, FunctionConfig> });
    Object.assign(shared.copy.parameters[0] ?? {}, { list: "string" });
    Object.assign(shared.copy.returns, { list: "string" });
    assert.doesNotThrow(() => schema.parse("copy([1]) == [1]"));
    assert.throws(() => schema.parse('copy(["a"]) == [1]'), ValidationError);
});

for (const functions of [
    "null",
    "[]",
    '{"contains": {"parameters": [], "returns": "boolean"}}',
    '{"startsWith": true}',
    '{"contains": false}',
    '{"bad.name": {"parameters": [], "returns": "boolean"}}',
    '{"AND": {"parameters": [], "returns": "boolean"}}',
    '{"": {"parameters": [], "returns": "boolean"}}',
    '{"f": null}',
    '{"f": {"returns": "boolean"}}',
    '{"f": {"parameters": null, "returns": "boolean"}}',
    '{"f": {"parameters": ["integer"], "returns": "boolean"}}',
    '{"f": {"parameters": [], "returns": "integer"}}',
    '{"f": {"parameters": [], "returns": {"list": "integer"}}}',
    '{"f": {"parameters": [], "returns": "boolean", "typo": true}}',
    '{"f": {"parameters": [{"name": "x"}], "returns": "boolean"}}',
    '{"f": {"parameters": [{"type": "string", "name": "not valid"}], "returns": "boolean"}}',
    '{"f": {"parameters": [{"type": "string", "typo": 1}], "returns": "boolean"}}',
    '{"f": {"parameters": [], "returns": "boolean", "description": 1}}',
]) {
    test(`rejects invalid function configuration ${functions}`, () => {
        const json = `{"fields": {}, "functions": ${functions}}`;
        assert.throws(() => Schema.fromJson(json), SchemaError);
        assert.throws(() => Schema.fromObject(JSON.parse(json)), SchemaError);
    });
}

test("prototype property names are not implicitly treated as built-ins", () => {
    assert.throws(() => Schema.fromJson('{"fields": {}, "functions": {"constructor": true}}'), SchemaError);
    const signature = { parameters: [], returns: "boolean" } satisfies FunctionConfig;
    const schema = Schema.fromJson(
        JSON.stringify({ fields: {}, functions: { constructor: signature, ["__proto__"]: signature } }),
    );
    assert.doesNotThrow(() => schema.parse("constructor() AND __proto__()"));
});
