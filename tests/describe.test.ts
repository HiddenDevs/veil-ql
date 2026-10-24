import assert from "node:assert/strict";
import { test } from "vitest";
import { LANGUAGE_REFERENCE, Schema, SchemaError } from "../src/index.js";
import type { SchemaConfig } from "../src/index.js";

const config = {
    description: "Orders placed in the storefront.",
    fields: {
        "order.status": {
            type: "string",
            description: "Fulfilment status.",
            values: ["pending", "paid", "shipped"],
            sortable: true,
        },
        "order.total": { type: "number", description: "Order total in USD.", sortable: true },
        "order.createdAt": { type: "number", filterable: false, sortable: true },
        "order.tags": { type: { list: "string" } },
        "customer.email": { type: "string", nullable: true },
        "customer.vip": { type: "boolean", operators: ["=="] },
    },
    functions: {
        contains: true,
        startsWith: {
            description: "True when text begins with prefix.",
            parameters: [
                { name: "text", type: "string", description: "Text to search." },
                { name: "prefix", type: "string" },
            ],
            returns: "boolean",
        },
        length: { parameters: ["string"], returns: "number" },
    },
    examples: [
        { query: 'order.status == "paid" SORT BY order.total DESC', description: "Paid orders, largest first." },
        { query: "SORT BY order.createdAt DESC", description: "All orders, newest first." },
    ],
} satisfies SchemaConfig;

test("describes fields with effective operators, values, and capabilities", () => {
    const description = Schema.fromObject(config).describe();
    assert.equal(description.description, "Orders placed in the storefront.");
    assert.deepEqual(description.fields, [
        {
            name: "order.status",
            description: "Fulfilment status.",
            type: "string",
            nullable: false,
            filterable: true,
            sortable: true,
            operators: ["==", "!=", "IN", "NOT IN"],
            values: ["pending", "paid", "shipped"],
        },
        {
            name: "order.total",
            description: "Order total in USD.",
            type: "number",
            nullable: false,
            filterable: true,
            sortable: true,
            operators: ["==", "!=", ">", ">=", "<", "<=", "IN", "NOT IN"],
        },
        {
            name: "order.createdAt",
            type: "number",
            nullable: false,
            filterable: false,
            sortable: true,
            operators: [],
        },
        {
            name: "order.tags",
            type: "list<string>",
            nullable: false,
            filterable: true,
            sortable: false,
            operators: ["==", "!=", "IN", "NOT IN"],
        },
        {
            name: "customer.email",
            type: "string",
            nullable: true,
            filterable: true,
            sortable: false,
            operators: ["==", "!=", "IN", "NOT IN"],
        },
        {
            name: "customer.vip",
            type: "boolean",
            nullable: false,
            filterable: true,
            sortable: false,
            operators: ["=="],
        },
    ]);
});

test("describes built-in and custom functions with signatures", () => {
    const { functions } = Schema.fromObject(config).describe();
    assert.equal(functions[0]?.name, "contains");
    assert.deepEqual(functions[0]?.signatures, [
        "contains(string, string) -> boolean",
        "contains(list<T>, T) -> boolean",
    ]);
    assert.ok(functions[0]?.description);
    assert.deepEqual(functions[1], {
        name: "startsWith",
        description: "True when text begins with prefix.",
        signatures: ["startsWith(text: string, prefix: string) -> boolean"],
        parameters: [
            { name: "text", type: "string", description: "Text to search." },
            { name: "prefix", type: "string" },
        ],
        returns: "boolean",
    });
    assert.deepEqual(functions[2], {
        name: "length",
        signatures: ["length(string) -> number"],
        parameters: [{ type: "string" }],
        returns: "number",
    });
});

test("description includes the language reference and examples, and is JSON-serializable", () => {
    const description = Schema.fromObject(config).describe();
    assert.deepEqual(description.language, LANGUAGE_REFERENCE);
    assert.deepEqual(description.examples, config.examples);
    assert.deepEqual(JSON.parse(JSON.stringify(description)), description);
});

test("omits optional properties that were not configured", () => {
    const description = Schema.fromObject({ fields: { x: { type: "number" } }, functions: {} }).describe();
    assert.equal("description" in description, false);
    assert.equal("description" in (description.fields[0] ?? {}), false);
    assert.equal("values" in (description.fields[0] ?? {}), false);
    assert.deepEqual(description.functions, []);
    assert.deepEqual(description.examples, []);
});

test("descriptions are copies that cannot mutate the schema or each other", () => {
    const schema = Schema.fromObject({ fields: { s: { type: "string", values: ["a"] } } });
    const first = schema.describe();
    (first.fields[0]?.values as string[]).push("b");
    (first.language.rules as string[]).length = 0;
    (first.functions[0]?.signatures as string[]).length = 0;
    const second = schema.describe();
    assert.deepEqual(second.fields[0]?.values, ["a"]);
    assert.notEqual(second.language.rules.length, 0);
    assert.equal(second.functions[0]?.signatures.length, 2);
    assert.throws(() => schema.parse('s == "b"'));
});

test("examples are validated when the schema is created", () => {
    const fields = { "order.total": { type: "number" } } as const;
    assert.doesNotThrow(() =>
        Schema.fromObject({ fields, examples: [{ query: "order.total > 5", description: "Over 5." }] }),
    );
    for (const query of ["order.missing > 5", "order.total >", "order.total > 5 SORT BY order.total"]) {
        assert.throws(
            () => Schema.fromObject({ fields, examples: [{ query, description: "Broken." }] }),
            (error: unknown) => {
                assert.ok(error instanceof SchemaError);
                assert.match(error.message, /examples\[0\] is not a valid query/);
                return true;
            },
        );
    }
});
