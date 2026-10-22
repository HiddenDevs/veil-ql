import assert from "node:assert/strict";
import { test } from "vitest";
import { LexError, Lexer } from "../src/index.js";
import type { LexErrorDetail } from "../src/index.js";

test("lexes a basic filter with typed tokens and byte spans", () => {
    assert.deepEqual(new Lexer('age >= 18 AND username == "Alice"').tokenize(), [
        { kind: "identifier", value: "age", span: { start: 0, end: 3 } },
        { kind: ">=", span: { start: 4, end: 6 } },
        { kind: "number", value: 18, span: { start: 7, end: 9 } },
        { kind: "AND", span: { start: 10, end: 13 } },
        { kind: "identifier", value: "username", span: { start: 14, end: 22 } },
        { kind: "==", span: { start: 23, end: 25 } },
        { kind: "string", value: "Alice", span: { start: 26, end: 33 } },
        { kind: "eof", span: { start: 33, end: 33 } },
    ]);
});

test("matches whole keywords case-insensitively", () => {
    assert.deepEqual(
        new Lexer("AND ANDrew true TRUE null nOt iN or false sort by asc desc _user2")
            .tokenize()
            .map((token) => token.kind),
        [
            "AND",
            "identifier",
            "TRUE",
            "TRUE",
            "NULL",
            "NOT",
            "IN",
            "OR",
            "FALSE",
            "SORT",
            "BY",
            "ASC",
            "DESC",
            "identifier",
            "eof",
        ],
    );
});

test("lexes all symbols and scientific notation", () => {
    assert.deepEqual(
        new Lexer("== != > >= < <= + - ( ) [ ] , .").tokenize().map((token) => token.kind),
        ["==", "!=", ">", ">=", "<", "<=", "+", "-", "(", ")", "[", "]", ",", ".", "eof"],
    );
    const tokens = new Lexer("1e3 2.5E-4 0 1e+2").tokenize();
    assert.deepEqual(
        tokens.flatMap((token) => (token.kind === "number" ? [token.value] : [])),
        [1000, 0.00025, 0, 100],
    );
});

test("decodes only supported string escapes in either quote style", () => {
    const token = new Lexer(String.raw`"hello\n\"world\"\t\r\\\'"`).nextToken();
    assert.equal(token.kind, "string");
    if (token.kind === "string") assert.equal(token.value, 'hello\n"world"\t\r\\\'');
    assert.equal(new Lexer("'hello'").nextToken().kind, "string");
});

test("counts UTF-8 bytes for accented characters and astral characters", () => {
    const tokens = new Lexer('"é😀" == "x"').tokenize();
    assert.deepEqual(
        tokens.map((token) => token.span),
        [
            { start: 0, end: 8 },
            { start: 9, end: 11 },
            { start: 12, end: 15 },
            { start: 15, end: 15 },
        ],
    );
});

test("accepts Unicode White_Space and returns stable EOF tokens", () => {
    const lexer = new Lexer("\u0085\u2003 \n");
    const eof = lexer.nextToken();
    assert.deepEqual(eof, { kind: "eof", span: { start: 7, end: 7 } });
    assert.deepEqual(lexer.nextToken(), eof);
    assert.deepEqual(lexer.tokenize(), [eof]);
});

const failures: readonly [string, LexErrorDetail["kind"]][] = [
    ['"unfinished', "UnterminatedString"],
    ['"unfinished\\', "UnterminatedString"],
    [String.raw`"hello\q"`, "InvalidEscape"],
    ["1e+", "InvalidNumber"],
    ["1e", "InvalidNumber"],
    ["1e999", "InvalidNumber"],
    ["@", "UnexpectedCharacter"],
    ["=", "UnexpectedCharacter"],
    ["!", "UnexpectedCharacter"],
    ["😀", "UnexpectedCharacter"],
];

for (const [source, kind] of failures) {
    test(`reports ${kind} for ${JSON.stringify(source)}`, () => {
        assert.throws(
            () => new Lexer(source).tokenize(),
            (error: unknown) => {
                assert.ok(error instanceof LexError);
                assert.equal(error.detail.kind, kind);
                assert.equal(error.span.start, 0);
                if (source === "😀") assert.equal(error.span.end, 4);
                return true;
            },
        );
    });
}
