import type { ComparisonOp } from "./ast.js";
import type { Span } from "./token.js";

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
  | { readonly kind: "UnknownFunction"; readonly function: string }
  | { readonly kind: "InvalidArgumentCount"; readonly function: string; readonly expected: number; readonly actual: number }
  | { readonly kind: "TypeMismatch"; readonly expected: string; readonly actual: string }
  | { readonly kind: "OperatorNotAllowed"; readonly field: string; readonly operator: ComparisonOp }
  | { readonly kind: "ValueNotAllowed"; readonly field: string };

export class LexError extends Error {
  constructor(readonly detail: LexErrorDetail, readonly span: Span) {
    super(`lex error at ${span.start}..${span.end}: ${JSON.stringify(detail)}`);
    this.name = "LexError";
  }
}

export class ParseError extends Error {
  constructor(readonly detail: ParseErrorDetail, readonly span: Span) {
    super(`parse error at ${span.start}..${span.end}: ${JSON.stringify(detail)}`);
    this.name = "ParseError";
  }
}

export class ValidationError extends Error {
  constructor(readonly detail: ValidationErrorDetail, readonly span: Span) {
    super(`validation error at ${span.start}..${span.end}: ${JSON.stringify(detail)}`);
    this.name = "ValidationError";
  }
}

export class SchemaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`invalid schema: ${message}`, options);
    this.name = "SchemaError";
  }
}
