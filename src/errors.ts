import type { Constant } from "./schema/types.js";
import type { ComparisonOp } from "./syntax/ast.js";
import type { Span } from "./syntax/token.js";

export type LexErrorDetail =
    | { readonly kind: "UnexpectedCharacter"; readonly character: string }
    | { readonly kind: "InvalidEscape"; readonly character: string }
    | { readonly kind: "UnterminatedString" | "InvalidNumber" };

export type ParseErrorDetail =
    | { readonly kind: "UnexpectedToken"; readonly found: string; readonly expected: readonly string[] }
    | { readonly kind: "ChainedComparison" | "EmptyExpression" };

export type ValidationErrorDetail =
    | { readonly kind: "NonFiniteNumber" }
    | { readonly kind: "UnknownField"; readonly field: string }
    | { readonly kind: "FieldNotFilterable"; readonly field: string }
    | { readonly kind: "FieldNotSortable"; readonly field: string }
    | { readonly kind: "UnknownFunction"; readonly function: string }
    | {
          readonly kind: "InvalidArgumentCount";
          readonly function: string;
          readonly expected: number;
          readonly actual: number;
      }
    | { readonly kind: "TypeMismatch"; readonly expected: string; readonly actual: string }
    | {
          readonly kind: "OperatorNotAllowed";
          readonly field: string;
          readonly operator: ComparisonOp;
          readonly allowed: readonly ComparisonOp[];
      }
    | { readonly kind: "ValueNotAllowed"; readonly field: string; readonly allowed: readonly Constant[] };

export type QueryErrorDetail = LexErrorDetail | ParseErrorDetail | ValidationErrorDetail;

/** A short, human- and LLM-readable explanation of an error detail. */
export function describeErrorDetail(detail: QueryErrorDetail): string {
    switch (detail.kind) {
        case "UnexpectedCharacter":
            return `unexpected character '${detail.character}'`;
        case "InvalidEscape":
            return `invalid escape sequence '\\${detail.character}'`;
        case "UnterminatedString":
            return "unterminated string literal";
        case "InvalidNumber":
            return "invalid number literal";
        case "UnexpectedToken":
            return `unexpected ${detail.found}, expected ${detail.expected.join(" or ")}`;
        case "ChainedComparison":
            return "comparisons cannot be chained; combine them with AND";
        case "EmptyExpression":
            return "expected a filter expression";
        case "NonFiniteNumber":
            return "numbers must be finite";
        case "UnknownField":
            return `unknown field '${detail.field}'`;
        case "FieldNotFilterable":
            return `field '${detail.field}' cannot be used in filters`;
        case "FieldNotSortable":
            return `field '${detail.field}' cannot be used in SORT BY`;
        case "UnknownFunction":
            return `unknown function '${detail.function}'`;
        case "InvalidArgumentCount":
            return `function '${detail.function}' expects ${detail.expected} argument(s) but received ${detail.actual}`;
        case "TypeMismatch":
            return `expected ${detail.expected} but found ${detail.actual}`;
        case "OperatorNotAllowed":
            return detail.allowed.length === 0
                ? `field '${detail.field}' cannot be compared with operators`
                : `operator '${detail.operator}' is not allowed for field '${detail.field}'; allowed: ${detail.allowed.join(", ")}`;
        case "ValueNotAllowed":
            return `value is not allowed for field '${detail.field}'; allowed: ${detail.allowed.map((value) => JSON.stringify(value)).join(", ")}`;
    }
}

/** Base class for every error caused by an invalid query string. */
export abstract class QueryError<TDetail extends QueryErrorDetail = QueryErrorDetail> extends Error {
    protected constructor(
        public readonly detail: TDetail,
        /** Half-open UTF-8 byte offsets into the query source. */
        public readonly span: Span,
    ) {
        super(`${describeErrorDetail(detail)} (at ${span.start}..${span.end})`);
    }
}

export class LexError extends QueryError<LexErrorDetail> {
    public constructor(detail: LexErrorDetail, span: Span) {
        super(detail, span);
        this.name = "LexError";
    }
}

export class ParseError extends QueryError<ParseErrorDetail> {
    public constructor(detail: ParseErrorDetail, span: Span) {
        super(detail, span);
        this.name = "ParseError";
    }
}

export class ValidationError extends QueryError<ValidationErrorDetail> {
    public constructor(detail: ValidationErrorDetail, span: Span) {
        super(detail, span);
        this.name = "ValidationError";
    }
}

/** Thrown when schema configuration is invalid. Never caused by a query string. */
export class SchemaError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(`invalid schema: ${message}`, options);
        this.name = "SchemaError";
    }
}
