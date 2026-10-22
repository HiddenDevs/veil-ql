/** Half-open UTF-8 byte offsets, matching the Rust implementation. */
export interface Span {
    readonly start: number;
    readonly end: number;
}

export function joinSpans(left: Span, right: Span): Span {
    return {
        start: Math.min(left.start, right.start),
        end: Math.max(left.end, right.end),
    };
}

export const KEYWORDS = ["TRUE", "FALSE", "NULL", "AND", "OR", "NOT", "IN", "SORT", "BY", "ASC", "DESC"] as const;
export type Keyword = (typeof KEYWORDS)[number];
export type Symbol = "==" | "!=" | ">" | ">=" | "<" | "<=" | "+" | "-" | "(" | ")" | "[" | "]" | "," | ".";

export type Token = (
    | { readonly kind: "identifier"; readonly value: string }
    | { readonly kind: "number"; readonly value: number }
    | { readonly kind: "string"; readonly value: string }
    | { readonly kind: Keyword | Symbol | "eof" }
) & { readonly span: Span };

export type TokenKind = Token["kind"];

export function isKeyword(word: string): word is Keyword {
    return KEYWORDS.includes(word as Keyword);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True for a single identifier that is not a reserved word (case-insensitively). */
export function isIdentifier(text: string): boolean {
    return IDENTIFIER.test(text) && !isKeyword(text.toUpperCase());
}
