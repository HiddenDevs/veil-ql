import type { ComparisonOp, Expr } from "./ast.js";
import { SchemaError } from "./errors.js";
import { Lexer } from "./lexer.js";
import { isComparisonOp } from "./parser.js";
import { constantMatches, typeName } from "./type-system.js";
import type { Constant, FieldType, ValueType } from "./type-system.js";
import { Validator } from "./validator.js";

export interface FieldConfig {
    readonly type: FieldType;
    readonly nullable?: boolean;
    readonly values?: readonly Constant[] | null;
    readonly operators?: readonly ComparisonOp[] | null;
}

export interface SchemaConfig {
    readonly fields: Readonly<Record<string, FieldConfig>>;
    readonly functions?: readonly "contains"[];
}

export interface FieldDefinition {
    readonly type: ValueType;
    readonly values: readonly Constant[] | undefined;
    readonly operators: readonly ComparisonOp[] | undefined;
}

function object(value: unknown, location: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new SchemaError(`${location} must be an object`);
    }
    // Only own properties are read from JSON objects.
    return Object.fromEntries(Object.entries(value));
}

function keys(value: Record<string, unknown>, allowed: readonly string[], location: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) throw new SchemaError(`unknown property '${key}' in ${location}`);
    }
}

function fieldType(value: unknown, location: string): FieldType {
    if (value === "number" || value === "string" || value === "boolean") return value;
    const spec = object(value, `${location}.type`);
    keys(spec, ["list"], `${location}.type`);
    return { list: fieldType(spec["list"], `${location}.list`) };
}

function fieldPath(path: string): boolean {
    return path.split(".").every((part) => {
        // Tokenize only identifier-shaped text, so invalid config is always a SchemaError.
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) return false;
        return new Lexer(part).nextToken().kind === "identifier";
    });
}

function definition(value: unknown, path: string): FieldDefinition {
    const field = object(value, path);
    keys(field, ["type", "nullable", "values", "operators"], path);
    const base = fieldType(field["type"], path);
    const nullable = field["nullable"];
    if (nullable !== undefined && typeof nullable !== "boolean") {
        throw new SchemaError(`nullable for '${path}' must be a boolean`);
    }
    const type: ValueType = nullable === true ? { nullable: base } : base;
    let values: Constant[] | undefined;
    const rawValues = field["values"];
    if (rawValues !== undefined && rawValues !== null) {
        if (!Array.isArray(rawValues) || rawValues.length === 0) {
            throw new SchemaError(`values for '${path}' must be a nonempty array`);
        }
        values = rawValues.map((value: unknown) => {
            if (!constantMatches(value, type)) {
                throw new SchemaError(`values for '${path}' must match ${typeName(type)}`);
            }
            return value;
        });
    }
    let operators: ComparisonOp[] | undefined;
    const rawOperators = field["operators"];
    if (rawOperators !== undefined && rawOperators !== null) {
        if (!Array.isArray(rawOperators)) throw new SchemaError(`operators for '${path}' must be an array`);
        operators = rawOperators.map((operator: unknown) => {
            if (typeof operator !== "string" || !isComparisonOp(operator)) {
                throw new SchemaError(`unknown operator for '${path}': ${String(operator)}`);
            }
            if ([">", ">=", "<", "<="].includes(operator) && type !== "number") {
                throw new SchemaError(`ordering operators require a non-nullable number field: '${path}'`);
            }
            return operator;
        });
    }
    return { type, values, operators };
}

/** A checked schema. Configuration is parsed once and never exposed for mutation. */
export class Schema {
    private constructor(private readonly validator: Validator) {}

    static fromJson(source: string): Schema {
        let raw: unknown;
        try {
            raw = JSON.parse(source);
        } catch (cause) {
            if (!(cause instanceof SyntaxError)) throw cause;
            throw new SchemaError("malformed JSON", { cause });
        }
        const config = object(raw, "schema");
        keys(config, ["fields", "functions"], "schema");
        const fields = new Map<string, FieldDefinition>();
        for (const [path, value] of Object.entries(object(config["fields"], "fields"))) {
            if (!fieldPath(path)) throw new SchemaError(`invalid field path '${path}'`);
            fields.set(path, definition(value, path));
        }
        const functions = config["functions"] ?? ["contains"];
        if (
            config["functions"] === null ||
            !Array.isArray(functions) ||
            !functions.every((name: unknown) => name === "contains")
        ) {
            throw new SchemaError("functions must be an array of implemented names: 'contains'");
        }
        return new Schema(new Validator(fields, functions.includes("contains")));
    }

    validateFilter(expr: Expr): void {
        this.validator.validateFilter(expr);
    }
}
