import type { ComparisonOp } from "../syntax/ast.js";
import { KEYWORDS } from "../syntax/token.js";

export interface LanguageReference {
    readonly summary: string;
    readonly grammar: string;
    readonly rules: readonly string[];
    readonly operators: readonly { readonly operator: ComparisonOp; readonly meaning: string }[];
    readonly keywords: readonly string[];
}

/** Schema-independent description of the query language, written for an AI agent. */
export const LANGUAGE_REFERENCE: LanguageReference = {
    summary: "A query is a boolean filter expression over the listed fields, optionally followed by a SORT BY clause.",
    grammar: "<filter> [SORT BY <field> [ASC|DESC] {, <field> [ASC|DESC]}]",
    rules: [
        "Reference fields by their exact, case-sensitive name such as user.age. Only the listed fields may be used.",
        "Literals: numbers (42, -1.5, 1e3), strings in single or double quotes (escapes: \\n \\r \\t \\\\ \\\" \\'), true, false, null, and lists such as [1, 2, 3].",
        "Combine conditions with AND, OR, NOT and parentheses. Precedence from highest to lowest: unary minus, comparisons, NOT, AND, OR.",
        "Comparisons cannot be chained: write a > 1 AND a < 10, not 1 < a < 10.",
        "Both sides of a comparison must have compatible types. Strings are never coerced to numbers.",
        "A non-nullable boolean field can be used directly as a condition, e.g. user.active or NOT user.active.",
        "Only nullable fields may be compared with null, and only using == or !=.",
        ">, >=, < and <= require non-nullable numbers on both sides.",
        'IN and NOT IN test whether a value is a member of a list, e.g. status IN ["active", "pending"].',
        "When a field lists allowed values, every literal compared with it, including each member of an IN list, must be one of those values.",
        "When a field lists operators, use only those operators with it.",
        "Call functions as name(arg1, arg2). Only the listed functions may be used, with exactly the listed arguments.",
        "SORT BY accepts only fields marked sortable. Direction defaults to ASC; separate multiple sort fields with commas.",
        "Keywords are case-insensitive. Field and function names are case-sensitive.",
    ],
    operators: [
        { operator: "==", meaning: "equal to" },
        { operator: "!=", meaning: "not equal to" },
        { operator: ">", meaning: "greater than" },
        { operator: ">=", meaning: "greater than or equal to" },
        { operator: "<", meaning: "less than" },
        { operator: "<=", meaning: "less than or equal to" },
        { operator: "IN", meaning: "is one of the values in a list" },
        { operator: "NOT IN", meaning: "is none of the values in a list" },
    ],
    keywords: KEYWORDS,
};
