import assert from "node:assert/strict";
import { test } from "vitest";
import { Schema, SchemaError, ValidationError, parseWithSchema } from "../src/index.js";
import type { FunctionSignature, SchemaConfig, SchemaOptions, ValidationErrorDetail } from "../src/index.js";

const options = {
    functions: {
        startsWith: { parameters: ["string", "string"], returns: "boolean" },
        length: { parameters: ["string"], returns: "number" },
        normalize: { parameters: ["string"], returns: "string" },
        tags: { parameters: [], returns: { list: "string" } },
        allPositive: { parameters: [{ list: "number" }], returns: "boolean" },
        matrix: { parameters: [{ list: { list: "number" } }], returns: "boolean" },
        negate: { parameters: ["boolean"], returns: "boolean" },
    },
} satisfies SchemaOptions;

const config = {
    fields: {
        name: { type: "string" },
        email: { type: "string", nullable: true },
        numbers: { type: { list: "number" } },
        nullableNumbers: { type: { list: "number" }, nullable: true },
    },
    functions: ["contains", ...Object.keys(options.functions)],
} satisfies SchemaConfig;

for (const factory of ["fromObject", "fromJson"] as const) {
    const schema =
        factory === "fromObject"
            ? Schema.fromObject(config, options)
            : Schema.fromJson(JSON.stringify(config), options);

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
            assert.doesNotThrow(() => parseWithSchema(query, schema));
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
                () => parseWithSchema(query, schema),
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
    const schema = Schema.fromObject(config, options);
    assert.throws(
        () => parseWithSchema('startsWith("a", 123)', schema),
        (error: unknown) => {
            assert.ok(error instanceof ValidationError);
            assert.deepEqual(error.detail, { kind: "TypeMismatch", expected: "string", actual: "number" });
            assert.deepEqual(error.span, { start: 16, end: 19 });
            return true;
        },
    );
});

test("custom arity errors report the signature count and whole call span", () => {
    const schema = Schema.fromObject(config, options);
    assert.throws(
        () => parseWithSchema("startsWith(name)", schema),
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

test("registration and permission are separate and defaults remain unchanged", () => {
    for (const functions of [undefined, [], ["contains"]]) {
        const schema = Schema.fromObject({ fields: {}, functions }, options);
        assert.throws(() => parseWithSchema('startsWith("a", "a")', schema), ValidationError);
        if (functions?.length === 0) {
            assert.throws(() => parseWithSchema('contains("a", "a")', schema), ValidationError);
        } else {
            assert.doesNotThrow(() => parseWithSchema('contains("a", "a")', schema));
        }
    }
    const customOnly = Schema.fromObject({ fields: {}, functions: ["startsWith"] }, options);
    assert.doesNotThrow(() => parseWithSchema('startsWith("a", "a")', customOnly));
    assert.throws(() => parseWithSchema('contains("a", "a")', customOnly), ValidationError);
    assert.throws(() => Schema.fromObject(config), SchemaError);
});

test("function registrations are copied and isolated between schemas", () => {
    const signature: FunctionSignature = { parameters: [{ list: "number" }], returns: { list: "number" } };
    const registry = structuredClone({ functions: { copy: signature } });
    const schema = Schema.fromObject({ fields: {}, functions: ["copy"] }, registry);
    const parameter = registry.functions.copy.parameters[0];
    if (typeof parameter !== "object" || typeof registry.functions.copy.returns !== "object") {
        assert.fail("Expected list signatures");
    }
    Object.assign(parameter, { list: "string" });
    Object.assign(registry.functions.copy.returns, { list: "string" });
    registry.functions.copy = { parameters: [], returns: "boolean" };
    assert.doesNotThrow(() => parseWithSchema("copy([1]) == [1]", schema));
    assert.throws(() => parseWithSchema('copy(["a"]) == [1]', schema), ValidationError);
    assert.throws(() => Schema.fromObject({ fields: {}, functions: ["copy"] }), SchemaError);
});

for (const raw of [
    "null",
    "[]",
    '{"typo": true}',
    '{"functions": null}',
    '{"functions": []}',
    '{"functions": {"contains": {"parameters": [], "returns": "boolean"}}}',
    '{"functions": {"bad.name": {"parameters": [], "returns": "boolean"}}}',
    '{"functions": {"AND": {"parameters": [], "returns": "boolean"}}}',
    '{"functions": {"": {"parameters": [], "returns": "boolean"}}}',
    '{"functions": {"f": null}}',
    '{"functions": {"f": {"returns": "boolean"}}}',
    '{"functions": {"f": {"parameters": null, "returns": "boolean"}}}',
    '{"functions": {"f": {"parameters": ["integer"], "returns": "boolean"}}}',
    '{"functions": {"f": {"parameters": [], "returns": "integer"}}}',
    '{"functions": {"f": {"parameters": [], "returns": {"list": "integer"}}}}',
    '{"functions": {"f": {"parameters": [], "returns": "boolean", "typo": true}}}',
]) {
    test(`rejects invalid registry ${raw}`, () => {
        const options: SchemaOptions = JSON.parse(raw);
        assert.throws(() => Schema.fromObject({ fields: {} }, options), SchemaError);
        assert.throws(() => Schema.fromJson('{"fields": {}}', options), SchemaError);
    });
}

test("prototype property names are not implicitly registered", () => {
    assert.throws(() => Schema.fromObject({ fields: {}, functions: ["constructor"] }), SchemaError);
    const signature = { parameters: [], returns: "boolean" } satisfies FunctionSignature;
    const schema = Schema.fromObject(
        { fields: {}, functions: ["constructor", "__proto__"] },
        {
            functions: {
                constructor: signature,
                ["__proto__"]: signature,
            },
        },
    );
    assert.doesNotThrow(() => parseWithSchema("constructor() AND __proto__()", schema));
});
