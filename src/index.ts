import type { Expr } from "./ast.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import type { Schema } from "./schema.js";

export type { BinaryOp, ComparisonOp, Expr, Literal, UnaryOp } from "./ast.js";
export { LexError, ParseError, SchemaError, ValidationError } from "./errors.js";
export type { LexErrorDetail, ParseErrorDetail, ValidationErrorDetail } from "./errors.js";
export { Lexer } from "./lexer.js";
export { Parser } from "./parser.js";
export { Schema } from "./schema.js";
export type { FieldConfig, SchemaConfig } from "./schema.js";
export type { Span, Token, TokenKind } from "./token.js";
export type { Constant, FieldType, PrimitiveType } from "./type-system.js";

/** Parse syntax only, without requiring a schema. */
export function parse(source: string): Expr {
  return new Parser(new Lexer(source).tokenize()).parse();
}

/** Parse and statically validate a boolean filter against a reusable schema. */
export function parseWithSchema(source: string, schema: Schema): Expr {
  const expr = parse(source);
  schema.validateFilter(expr);
  return expr;
}
