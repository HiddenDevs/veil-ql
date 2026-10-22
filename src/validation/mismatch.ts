import { ValidationError } from "../errors.js";
import { typeName } from "../schema/types.js";
import type { ValueType } from "../schema/types.js";
import type { Expr } from "../syntax/ast.js";

export function mismatch(expr: Expr, expected: ValueType | string, actual: ValueType): never {
    throw new ValidationError(
        {
            kind: "TypeMismatch",
            expected: typeof expected === "string" ? expected : typeName(expected),
            actual: typeName(actual),
        },
        expr.span,
    );
}
