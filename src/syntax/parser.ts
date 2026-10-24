import { isComparisonOp } from "./ast.js";
import type { BinaryOp, ComparisonOp, Expr, PathExpr, Query, SortDirection, SortField } from "./ast.js";
import { ParseError } from "../errors.js";
import { Lexer } from "./lexer.js";
import { joinSpans } from "./token.js";
import type { Token, TokenKind } from "./token.js";

/** Parse a boolean filter expression. Checks syntax only; use `Schema#parse` to also validate it. */
export function parse(source: string): Expr {
    return new Parser(new Lexer(source).tokenize()).parse();
}

/** Parse a filter, a `SORT BY` clause, or both. Omitted filters become `true`. Checks syntax only. */
export function parseQuery(source: string): Query {
    return new Parser(new Lexer(source).tokenize()).parseQuery();
}

/** Recursive descent, with one method per precedence level. */
export class Parser {
    private current = 0;

    public constructor(private readonly tokens: readonly Token[]) {
        if (
            tokens.length === 0 ||
            tokens.at(-1)?.kind !== "eof" ||
            tokens.slice(0, -1).some((token) => token.kind === "eof")
        ) {
            throw new TypeError("Parser requires tokens ending in exactly one EOF token");
        }
    }

    private peek(): Token {
        const token = this.tokens[this.current];
        if (token === undefined) throw new TypeError("Parser token stream was modified");
        return token;
    }

    private advance(): Token {
        const token = this.peek();
        if (token.kind !== "eof") this.current++;
        return token;
    }

    private match(kind: TokenKind): Token | undefined {
        return this.peek().kind === kind ? this.advance() : undefined;
    }

    private expect(kind: TokenKind): Token {
        const token = this.match(kind);
        if (token === undefined) throw this.unexpected(this.peek(), [kind]);
        return token;
    }

    private unexpected(token: Token, expected: readonly string[]): ParseError {
        return new ParseError({ kind: "UnexpectedToken", found: token.kind, expected }, token.span);
    }

    public parse(): Expr {
        const expr = this.filter();
        this.expect("eof");
        return expr;
    }

    public parseQuery(): Query {
        const start = this.peek().span.start;
        const filter: Expr =
            this.peek().kind === "SORT" ? { kind: "literal", value: true, span: { start, end: start } } : this.filter();
        const sorts = this.sorts();
        this.expect("eof");
        const lastSort = sorts.at(-1);
        return {
            filter,
            sorts,
            span: lastSort === undefined ? filter.span : joinSpans(filter.span, lastSort.span),
        };
    }

    private filter(): Expr {
        if (this.peek().kind === "eof") {
            throw new ParseError({ kind: "EmptyExpression" }, this.peek().span);
        }
        return this.or();
    }

    private sorts(): SortField[] {
        if (this.match("SORT") === undefined) return [];
        this.expect("BY");
        const sorts: SortField[] = [];
        do {
            const field = this.path(this.expect("identifier"));
            const fieldSpan = field.span;
            const directionToken = this.match("ASC") ?? this.match("DESC");
            const direction: SortDirection = directionToken?.kind === "DESC" ? "DESC" : "ASC";
            sorts.push({
                field,
                direction,
                span: directionToken === undefined ? fieldSpan : joinSpans(fieldSpan, directionToken.span),
            });
        } while (this.match(",") !== undefined);
        return sorts;
    }

    /** Continue a dotted field path whose first identifier has already been consumed. */
    private path(first: Token): PathExpr {
        if (first.kind !== "identifier") throw this.unexpected(first, ["identifier"]);
        const parts = [first.value];
        let span = first.span;
        while (this.match(".") !== undefined) {
            const part = this.expect("identifier");
            if (part.kind !== "identifier") throw this.unexpected(part, ["identifier"]);
            parts.push(part.value);
            span = joinSpans(span, part.span);
        }
        return { kind: "path", parts, span };
    }

    private binary(left: Expr, op: BinaryOp, right: Expr): Expr {
        return { kind: "binary", left, op, right, span: joinSpans(left.span, right.span) };
    }

    private or(): Expr {
        let expr = this.and();
        while (this.match("OR") ?? this.match("|")) expr = this.binary(expr, "OR", this.and());
        return expr;
    }

    private and(): Expr {
        let expr = this.not();
        while (this.match("AND") ?? this.match("&")) expr = this.binary(expr, "AND", this.not());
        return expr;
    }

    private not(): Expr {
        const token = this.match("NOT");
        if (token === undefined) return this.comparison();
        const expr = this.not();
        return { kind: "unary", op: "NOT", expr, span: joinSpans(token.span, expr.span) };
    }

    private comparisonOp(): ComparisonOp | undefined {
        const kind = this.peek().kind;
        if (isComparisonOp(kind)) return kind;
        if (kind === "NOT" && this.tokens[this.current + 1]?.kind === "IN") return "NOT IN";
        return undefined;
    }

    private comparison(): Expr {
        const left = this.unary();
        const op = this.comparisonOp();
        if (op === undefined) return left;
        this.advance();
        if (op === "NOT IN") this.advance();
        const right = this.unary();
        if (this.comparisonOp() !== undefined) {
            throw new ParseError({ kind: "ChainedComparison" }, this.peek().span);
        }
        return this.binary(left, op, right);
    }

    private unary(): Expr {
        const token = this.match("-");
        if (token === undefined) return this.primary();
        const expr = this.unary();
        return { kind: "unary", op: "-", expr, span: joinSpans(token.span, expr.span) };
    }

    private sequence(end: ")" | "]"): { items: Expr[]; close: Token } {
        const items: Expr[] = [];
        if (this.peek().kind !== end) {
            do {
                if (this.peek().kind === end) {
                    throw this.unexpected(this.peek(), ["expression after comma"]);
                }
                items.push(this.or());
            } while (this.match(","));
        }
        return { items, close: this.expect(end) };
    }

    private primary(): Expr {
        const token = this.advance();
        switch (token.kind) {
            case "number":
            case "string":
                return { kind: "literal", value: token.value, span: token.span };
            case "TRUE":
            case "FALSE":
            case "NULL":
                return {
                    kind: "literal",
                    value: token.kind === "NULL" ? null : token.kind === "TRUE",
                    span: token.span,
                };
            case "(": {
                const expr = this.or();
                const close = this.expect(")");
                return { ...expr, span: joinSpans(token.span, close.span) };
            }
            case "[": {
                const { items, close } = this.sequence("]");
                return { kind: "list", items, span: joinSpans(token.span, close.span) };
            }
            case "identifier": {
                if (this.match("(")) {
                    const { items: args, close } = this.sequence(")");
                    return { kind: "call", name: token.value, args, span: joinSpans(token.span, close.span) };
                }
                return this.path(token);
            }
            default:
                throw this.unexpected(token, ["literal", "identifier", "list", "("]);
        }
    }
}
