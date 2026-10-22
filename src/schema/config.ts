import type { ComparisonOp } from "../syntax/ast.js";
import type { Constant, FieldType } from "./types.js";

/**
 * Public, JSON-compatible schema configuration.
 *
 * Every `description` is optional and has no effect on validation. Descriptions are
 * returned by `Schema#describe()` so they can be rendered into instructions for an AI agent.
 */
export interface SchemaConfig {
    /** What the queried data represents, e.g. "Orders placed in the storefront". */
    readonly description?: string;
    /** Queryable fields keyed by their exact, case-sensitive dotted path, e.g. `"user.age"`. */
    readonly fields: Readonly<Record<string, FieldConfig>>;
    /**
     * Functions callable from filters, keyed by name. Use `true` to enable a built-in function
     * (currently only `contains`) or a {@link FunctionConfig} to declare a custom function.
     * Defaults to `{ contains: true }`; `{}` disables all calls.
     */
    readonly functions?: Readonly<Record<string, FunctionConfig | true>>;
    /** Example queries. They are validated against the schema when it is created. */
    readonly examples?: readonly ExampleConfig[];
}

export interface FieldConfig {
    readonly type: FieldType;
    readonly description?: string;
    /** Allow comparing the field with `null`. Defaults to `false`. */
    readonly nullable?: boolean;
    /** Restrict literal comparisons to these values. Omitted or `null` means unrestricted. */
    readonly values?: readonly Constant[] | null;
    /** Restrict comparison operators. Omitted or `null` allows every type-compatible operator. */
    readonly operators?: readonly ComparisonOp[] | null;
    /** Allow the field in filter expressions. Defaults to `true`. */
    readonly filterable?: boolean;
    /** Allow the field in `SORT BY`. Defaults to `false`. List fields cannot be sortable. */
    readonly sortable?: boolean;
}

export interface FunctionConfig {
    readonly description?: string;
    /** Fixed-length parameter list. Use a bare type or an object to name and describe a parameter. */
    readonly parameters: readonly (FieldType | ParameterConfig)[];
    readonly returns: FieldType;
}

export interface ParameterConfig {
    readonly type: FieldType;
    readonly name?: string;
    readonly description?: string;
}

export interface ExampleConfig {
    readonly query: string;
    /** What the query does, in plain language. */
    readonly description: string;
}
