import { compatible } from "../schema/types.js";
import type { ValueType } from "../schema/types.js";
import type { Expr } from "../syntax/ast.js";
import { mismatch } from "./mismatch.js";

/** A function implemented by the library, with signatures too generic for {@link FunctionConfig}. */
export interface BuiltinFunction {
    readonly name: string;
    readonly description: string;
    /** Human-readable signatures, e.g. `contains(list<T>, T) -> boolean`. */
    readonly signatures: readonly string[];
    readonly arity: number;
    /** Type-check arguments (whose count already matches `arity`) and return the result type. */
    check(args: readonly Expr[], infer: (expr: Expr) => ValueType): ValueType;
}

const contains: BuiltinFunction = {
    name: "contains",
    description: "True when a string contains a substring, or when a list contains an element.",
    signatures: ["contains(string, string) -> boolean", "contains(list<T>, T) -> boolean"],
    arity: 2,
    check([containerExpr, needleExpr], infer) {
        if (containerExpr === undefined || needleExpr === undefined) throw new TypeError("Missing contains arguments");
        const container = infer(containerExpr);
        const needle = infer(needleExpr);
        if (container === "string") {
            if (needle !== "string") mismatch(needleExpr, "string", needle);
        } else if (typeof container === "object" && "list" in container) {
            if (!compatible(container.list, needle)) mismatch(needleExpr, container.list, needle);
        } else {
            mismatch(containerExpr, "string or list", container);
        }
        return "boolean";
    },
};

export const BUILTIN_FUNCTIONS: ReadonlyMap<string, BuiltinFunction> = new Map([[contains.name, contains]]);
