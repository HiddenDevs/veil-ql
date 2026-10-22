import type { ComparisonOp } from "../syntax/ast.js";
import type { BuiltinFunction } from "../validation/builtins.js";
import type { Constant, FieldType, ValueType } from "./types.js";

/** Normalized, immutable schema produced from a validated {@link SchemaConfig}. Internal. */
export interface SchemaModel {
    readonly description: string | undefined;
    readonly fields: ReadonlyMap<string, FieldDefinition>;
    readonly functions: ReadonlyMap<string, FunctionDefinition>;
    readonly examples: readonly ExampleDefinition[];
}

export interface FieldDefinition {
    readonly path: string;
    readonly description: string | undefined;
    readonly type: FieldType;
    readonly nullable: boolean;
    /** `type`, wrapped as nullable when the field is nullable. */
    readonly valueType: ValueType;
    readonly values: readonly Constant[] | undefined;
    /** `undefined` means every type-compatible operator is allowed. */
    readonly operators: readonly ComparisonOp[] | undefined;
    readonly filterable: boolean;
    readonly sortable: boolean;
}

export interface ParameterDefinition {
    readonly type: FieldType;
    readonly name: string | undefined;
    readonly description: string | undefined;
}

export type FunctionDefinition =
    | {
          readonly kind: "custom";
          readonly name: string;
          readonly description: string | undefined;
          readonly parameters: readonly ParameterDefinition[];
          readonly returns: FieldType;
      }
    | { readonly kind: "builtin"; readonly name: string; readonly builtin: BuiltinFunction };

export interface ExampleDefinition {
    readonly query: string;
    readonly description: string;
}

const ORDERING: readonly ComparisonOp[] = [">", ">=", "<", "<="];

export function isOrderingOp(op: ComparisonOp): boolean {
    return ORDERING.includes(op);
}

/** Operators that can type-check against a field, after applying any configured restriction. */
export function effectiveOperators(field: FieldDefinition): readonly ComparisonOp[] {
    if (!field.filterable) return [];
    const compatible: readonly ComparisonOp[] =
        field.valueType === "number"
            ? ["==", "!=", ">", ">=", "<", "<=", "IN", "NOT IN"]
            : ["==", "!=", "IN", "NOT IN"];
    return field.operators === undefined ? compatible : compatible.filter((op) => field.operators?.includes(op));
}
