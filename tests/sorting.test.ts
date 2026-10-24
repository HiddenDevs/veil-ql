import assert from "node:assert/strict";
import { test } from "vitest";
import { parseQuery, Schema, ValidationError } from "../src/index.js";
import type { ValidationErrorDetail } from "../src/index.js";

const schema = Schema.fromObject({
    fields: {
        "order.total": { type: "number", sortable: true },
        "order.status": { type: "string" },
        "order.createdAt": { type: "number", filterable: false, sortable: true },
    },
});

test("accepts sortable fields, including sort-only fields", () => {
    const query = schema.parseQuery("order.total > 1 SORT BY order.createdAt DESC, order.total");
    assert.deepEqual(
        query.sorts.map((sort) => [sort.field.parts.join("."), sort.direction]),
        [
            ["order.createdAt", "DESC"],
            ["order.total", "ASC"],
        ],
    );
    assert.deepEqual(schema.parseQuery("order.total > 1").sorts, []);
});

test("accepts sort-only queries through parsing and pre-parsed validation", () => {
    const source = "SORT BY order.createdAt DESC, order.total";
    const query = schema.parseQuery(source);
    assert.deepEqual(query, parseQuery(source));
    assert.deepEqual(query.filter, { kind: "literal", value: true, span: { start: 0, end: 0 } });
    assert.deepEqual(
        query.sorts.map((sort) => [sort.field.parts.join("."), sort.direction]),
        [
            ["order.createdAt", "DESC"],
            ["order.total", "ASC"],
        ],
    );
    assert.doesNotThrow(() => schema.validateQuery(parseQuery(source)));
    assert.throws(() => schema.parse(source));
    assert.throws(() => schema.validateQuery(parseQuery("SORT BY order.status")), ValidationError);
});

const failures: readonly [string, ValidationErrorDetail["kind"], { start: number; end: number }][] = [
    ["order.total > 1 SORT BY order.status", "FieldNotSortable", { start: 24, end: 36 }],
    ["order.total > 1 SORT BY order.missing", "UnknownField", { start: 24, end: 37 }],
    ["order.createdAt > 1", "FieldNotFilterable", { start: 0, end: 15 }],
    ["SORT BY order.status", "FieldNotSortable", { start: 8, end: 20 }],
    ["SORT BY order.missing", "UnknownField", { start: 8, end: 21 }],
];

for (const [source, kind, span] of failures) {
    test(`rejects ${source} with ${kind}`, () => {
        assert.throws(
            () => schema.parseQuery(source),
            (error: unknown) => {
                assert.ok(error instanceof ValidationError);
                assert.equal(error.detail.kind, kind);
                assert.deepEqual(error.span, span);
                return true;
            },
        );
    });
}

test("parse accepts filters only; validateQuery checks pre-parsed queries", () => {
    assert.throws(() => schema.parse("order.total > 1 SORT BY order.total"));
    assert.throws(() => schema.validateQuery(parseQuery("order.total > 1 SORT BY order.status")), ValidationError);
    assert.doesNotThrow(() => schema.validateQuery(parseQuery("order.total > 1 SORT BY order.total")));
});
