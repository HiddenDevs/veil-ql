import type { Span } from "./token.js";

export type Literal = number | string | boolean | null;
export type UnaryOp = "NOT" | "-";
export type ComparisonOp = "==" | "!=" | ">" | ">=" | "<" | "<=" | "IN" | "NOT IN";
export type BinaryOp = ComparisonOp | "AND" | "OR";

export type Expr = (
    | { readonly kind: "literal"; readonly value: Literal }
    | { readonly kind: "path"; readonly parts: readonly string[] }
    | { readonly kind: "list"; readonly items: readonly Expr[] }
    | { readonly kind: "call"; readonly name: string; readonly args: readonly Expr[] }
    | { readonly kind: "unary"; readonly op: UnaryOp; readonly expr: Expr }
    | { readonly kind: "binary"; readonly left: Expr; readonly op: BinaryOp; readonly right: Expr }
) & { readonly span: Span };
