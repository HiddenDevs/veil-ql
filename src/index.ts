// Syntax: schema-independent parsing.
export { parse, parseQuery, Parser } from "./syntax/parser.js";
export { Lexer } from "./syntax/lexer.js";
export { COMPARISON_OPERATORS } from "./syntax/ast.js";
export type {
    BinaryOp,
    ComparisonOp,
    Expr,
    ExprOf,
    Literal,
    PathExpr,
    Query,
    SortDirection,
    SortField,
    UnaryOp,
} from "./syntax/ast.js";
export { KEYWORDS } from "./syntax/token.js";
export type { Keyword, Span, Token, TokenKind } from "./syntax/token.js";

// Schema: configuration and validation.
export { Schema } from "./schema/schema.js";
export type { ExampleConfig, FieldConfig, FunctionConfig, ParameterConfig, SchemaConfig } from "./schema/config.js";
export type { Constant, FieldType, PrimitiveType } from "./schema/types.js";

// AI descriptions.
export { LANGUAGE_REFERENCE } from "./describe/language.js";
export type { LanguageReference } from "./describe/language.js";
export type {
    ExampleDescription,
    FieldDescription,
    FunctionDescription,
    ParameterDescription,
    SchemaDescription,
} from "./describe/describe.js";

// Errors.
export { describeErrorDetail, LexError, ParseError, QueryError, SchemaError, ValidationError } from "./errors.js";
export type { LexErrorDetail, ParseErrorDetail, QueryErrorDetail, ValidationErrorDetail } from "./errors.js";
