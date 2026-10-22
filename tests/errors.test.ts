import assert from "node:assert/strict";
import { test } from "vitest";
import { LexError, ParseError, QueryError, Schema, ValidationError } from "../src/index.js";

const schema = Schema.fromObject({
    fields: {
        "user.status": { type: "string", values: ["active", "banned"] },
        "user.age": { type: "number", operators: ["==", ">"] },
        "user.flag": { type: "boolean", operators: [] },
    },
});

const cases: readonly [string, new (...args: never[]) => QueryError, string][] = [
    ["user.age @ 1", LexError, "unexpected character '@' (at 9..10)"],
    ['"a\\q"', LexError, "invalid escape sequence '\\q' (at 0..4)"],
    ["user.age ==", ParseError, "unexpected eof, expected literal or identifier or list or ( (at 11..11)"],
    ["1 < user.age < 5", ParseError, "comparisons cannot be chained; combine them with AND (at 13..14)"],
    ["user.name == 1", ValidationError, "unknown field 'user.name' (at 0..9)"],
    [
        'user.status == "x"',
        ValidationError,
        `value is not allowed for field 'user.status'; allowed: "active", "banned" (at 15..18)`,
    ],
    ["user.age < 5", ValidationError, "operator '<' is not allowed for field 'user.age'; allowed: ==, > (at 0..8)"],
    ["user.flag == true", ValidationError, "field 'user.flag' cannot be compared with operators (at 0..9)"],
    ['user.age == "1"', ValidationError, "expected number but found string (at 12..15)"],
    ["contains(user.age)", ValidationError, "function 'contains' expects 2 argument(s) but received 1 (at 0..18)"],
];

for (const [source, type, message] of cases) {
    test(`explains ${source}`, () => {
        assert.throws(
            () => schema.parseQuery(source),
            (error: unknown) => {
                assert.ok(error instanceof type);
                assert.ok(error instanceof QueryError);
                assert.equal(error.message, message);
                return true;
            },
        );
    });
}

test("error details include allowed values and operators", () => {
    assert.throws(
        () => schema.parse('user.status IN ["x"]'),
        (error: unknown) => {
            assert.ok(error instanceof ValidationError);
            assert.deepEqual(error.detail, {
                kind: "ValueNotAllowed",
                field: "user.status",
                allowed: ["active", "banned"],
            });
            return true;
        },
    );
});

test("mutating error details does not change the schema", () => {
    for (const source of ['user.status == "x"', "user.age < 5"]) {
        try {
            schema.parse(source);
        } catch (error) {
            assert.ok(error instanceof ValidationError);
            (error.detail as unknown as { allowed: unknown[] }).allowed.push("x", "<");
        }
    }
    assert.throws(() => schema.parse('user.status == "x"'), ValidationError);
    assert.throws(() => schema.parse("user.age < 5"), ValidationError);
});
