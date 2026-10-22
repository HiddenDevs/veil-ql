import type { Span } from "./token.js";

export type Literal = number | string | boolean | null;
export type UnaryOp = "NOT" | "-";

export const COMPARISON_OPERATORS = ["==", "!=", ">", ">=", "<", "<=", "IN", "NOT IN"] as const;
export type ComparisonOp = (typeof COMPARISON_OPERATORS)[number];
export type BinaryOp = ComparisonOp | "AND" | "OR";

export function isComparisonOp(value: unknown): value is ComparisonOp {
    return COMPARISON_OPERATORS.includes(value as ComparisonOp);
}

export type Expr = (
    | { readonly kind: "literal"; readonly value: Literal }
    | { readonly kind: "path"; readonly parts: readonly string[] }
    | { readonly kind: "list"; readonly items: readonly Expr[] }
    | { readonly kind: "call"; readonly name: string; readonly args: readonly Expr[] }
    | { readonly kind: "unary"; readonly op: UnaryOp; readonly expr: Expr }
    | { readonly kind: "binary"; readonly left: Expr; readonly op: BinaryOp; readonly right: Expr }
) & { readonly span: Span };

/** Narrow an expression node by its `kind`. */
export type ExprOf<K extends Expr["kind"]> = Extract<Expr, { kind: K }>;
export type PathExpr = ExprOf<"path">;

export type SortDirection = "ASC" | "DESC";

export interface SortField {
    readonly field: PathExpr;
    readonly direction: SortDirection;
    readonly span: Span;
}

export interface Query {
    readonly filter: Expr;
    readonly sorts: readonly SortField[];
    readonly span: Span;
}
