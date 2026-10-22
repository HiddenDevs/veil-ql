import assert from "node:assert/strict";
import { test } from "vitest";
import { LexError, Lexer, ParseError, Parser, parse, parseQuery, parseQueryWithSchema, Schema } from "../src/index.js";
import type { ComparisonOp, ParseErrorDetail } from "../src/index.js";

test("preserves logical and comparison precedence", () => {
    const expr = parse('age >= 18 AND username == "Alice" OR active == true');
    assert.equal(expr.kind, "binary");
    if (expr.kind !== "binary") return;
    assert.equal(expr.op, "OR");
    assert.equal(expr.left.kind, "binary");
    if (expr.left.kind === "binary") assert.equal(expr.left.op, "AND");
});

test("NOT binds below comparisons and unary minus binds above comparisons", () => {
    const expr = parse("NOT -score >= 10");
    assert.equal(expr.kind, "unary");
    if (expr.kind !== "unary") return;
    assert.equal(expr.op, "NOT");
    assert.equal(expr.expr.kind, "binary");
    if (expr.expr.kind !== "binary") return;
    assert.equal(expr.expr.op, ">=");
    assert.equal(expr.expr.left.kind, "unary");
});

test("builds paths, calls, lists, and NOT IN expressions", () => {
    const expr = parse('contains(user.tags, "admin") AND status NOT IN ["blocked", "pending"]');
    assert.equal(expr.kind, "binary");
    if (expr.kind !== "binary") return;
    assert.equal(expr.left.kind, "call");
    if (expr.left.kind === "call") {
        assert.equal(expr.left.name, "contains");
        assert.equal(expr.left.args[0]?.kind, "path");
    }
    assert.equal(expr.right.kind, "binary");
    if (expr.right.kind === "binary") {
        assert.equal(expr.right.op, "NOT IN");
        assert.equal(expr.right.right.kind, "list");
    }
});

test("supports nested lists, empty lists, and arbitrary calls in syntax-only mode", () => {
    assert.equal(parse("[[], [1, 2]]").kind, "list");
    assert.equal(parse("custom()").kind, "call");
    assert.equal(parse("custom(other(1), true OR false)").kind, "call");
});

test("includes parentheses and unary operators in byte spans", () => {
    const expr = parse(' (NOT ("é" == "x")) ');
    assert.deepEqual(expr.span, { start: 1, end: 20 });
});

test("logical operators associate to the left", () => {
    const expr = parse("a OR b OR c");
    assert.equal(expr.kind, "binary");
    if (expr.kind === "binary") assert.equal(expr.left.kind, "binary");
});

test("parses optional single and multiple SORT BY fields", () => {
    const query = parseQuery('status == "paid" SORT BY customer.createdAt DESC, total');
    assert.equal(query.filter.kind, "binary");
    assert.equal(query.sorts.length, 2);
    assert.deepEqual(query.sorts[0], {
        field: {
            kind: "path",
            parts: ["customer", "createdAt"],
            span: { start: 25, end: 43 },
        },
        direction: "DESC",
        span: { start: 25, end: 48 },
    });
    assert.deepEqual(query.sorts[1], {
        field: { kind: "path", parts: ["total"], span: { start: 50, end: 55 } },
        direction: "ASC",
        span: { start: 50, end: 55 },
    });
    assert.deepEqual(query.span, { start: 0, end: 55 });
});

test("parses queries without sorting and validates their filter", () => {
    assert.deepEqual(parseQuery("age >= 18").sorts, []);
    const schema = Schema.fromObject({ fields: { age: { type: "number" } } });
    const query = parseQueryWithSchema("age >= 18 SORT BY age DESC", schema);
    assert.equal(query.sorts[0]?.direction, "DESC");
});

for (const op of ["==", "!=", ">", ">=", "<", "<=", "IN", "NOT IN"] satisfies ComparisonOp[]) {
    test(`parses comparison operator ${op}`, () => {
        const expr = parse(`a ${op} b`);
        assert.equal(expr.kind, "binary");
        if (expr.kind === "binary") assert.equal(expr.op, op);
    });
}

const failures: readonly [string, ParseErrorDetail["kind"]][] = [
    ["", "EmptyExpression"],
    [" \n ", "EmptyExpression"],
    ["1 < age < 100", "ChainedComparison"],
    ["a IN b NOT IN c", "ChainedComparison"],
    ["a NOT IN b == c", "ChainedComparison"],
    ["(age > 18", "UnexpectedToken"],
    ["contains(name,)", "UnexpectedToken"],
    ["[1,]", "UnexpectedToken"],
    ["[1, 2", "UnexpectedToken"],
    ["user.", "UnexpectedToken"],
    ["user.TRUE", "UnexpectedToken"],
    ["age ==", "UnexpectedToken"],
    ["age 18", "UnexpectedToken"],
    ["+1", "UnexpectedToken"],
    ["()", "UnexpectedToken"],
    ['status == "paid" SORT BY', "UnexpectedToken"],
    ['status == "paid" SORT total', "UnexpectedToken"],
    ['status == "paid" SORT BY total,', "UnexpectedToken"],
    ['status == "paid" SORT BY total == 1', "UnexpectedToken"],
    ["SORT BY total", "UnexpectedToken"],
];

for (const [source, kind] of failures) {
    test(`reports ${kind} for ${JSON.stringify(source)}`, () => {
        assert.throws(
            () => parse(source),
            (error: unknown) => {
                assert.ok(error instanceof ParseError);
                assert.equal(error.detail.kind, kind);
                return true;
            },
        );
    });
}

test("preserves lexical errors and validates manually supplied token streams", () => {
    assert.throws(() => parse("@"), LexError);
    assert.throws(() => new Parser([]), TypeError);
    const eof = new Lexer("").nextToken();
    assert.throws(() => new Parser([eof, eof]), TypeError);
});
