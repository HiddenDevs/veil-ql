import type { Expr, Query } from "./ast.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import type { Schema } from "./schema.js";

export type { BinaryOp, ComparisonOp, Expr, Literal, Query, SortDirection, SortField, UnaryOp } from "./ast.js";
export { LexError, ParseError, SchemaError, ValidationError } from "./errors.js";
export type { LexErrorDetail, ParseErrorDetail, ValidationErrorDetail } from "./errors.js";
export { Lexer } from "./lexer.js";
export { Parser } from "./parser.js";
export { Schema } from "./schema.js";
export type { FieldConfig, FunctionSignature, SchemaConfig, SchemaOptions } from "./schema.js";
export type { Span, Token, TokenKind } from "./token.js";
export type { Constant, FieldType, PrimitiveType } from "./type-system.js";

/** Parse syntax only, without requiring a schema. */
export function parse(source: string): Expr {
    return new Parser(new Lexer(source).tokenize()).parse();
}

/** Parse a boolean filter with an optional SORT BY clause. */
export function parseQuery(source: string): Query {
    return new Parser(new Lexer(source).tokenize()).parseQuery();
}

/** Parse and statically validate a boolean filter against a reusable schema. */
export function parseWithSchema(source: string, schema: Schema): Expr {
    const expr = parse(source);
    schema.validateFilter(expr);
    return expr;
}

/** Parse and validate the filter portion of a query with optional sorting. */
export function parseQueryWithSchema(source: string, schema: Schema): Query {
    const query = parseQuery(source);
    schema.validateFilter(query.filter);
    return query;
}
