import { SchemaError } from "../errors.js";
import { isComparisonOp } from "../syntax/ast.js";
import type { ComparisonOp } from "../syntax/ast.js";
import { isIdentifier } from "../syntax/token.js";
import { BUILTIN_FUNCTIONS } from "../validation/builtins.js";
import { isOrderingOp } from "./model.js";
import type {
    ExampleDefinition,
    FieldDefinition,
    FunctionDefinition,
    ParameterDefinition,
    SchemaModel,
} from "./model.js";
import { constantMatches, typeName } from "./types.js";
import type { Constant, FieldType, ValueType } from "./types.js";

// Configuration is treated as untrusted JSON: every value is checked at runtime, only own
// properties are read, and nothing from the input is retained by reference.

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown, location: string, allowed: readonly string[]): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new SchemaError(`${location} must be an object`);
    }
    const result = Object.fromEntries(Object.entries(value));
    for (const key of Object.keys(result)) {
        if (!allowed.includes(key)) throw new SchemaError(`unknown property '${key}' in ${location}`);
    }
    return result;
}

function record(value: unknown, location: string): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new SchemaError(`${location} must be an object`);
    }
    return Object.fromEntries(Object.entries(value));
}

function optionalString(value: unknown, location: string): string | undefined {
    if (value !== undefined && typeof value !== "string") throw new SchemaError(`${location} must be a string`);
    return value;
}

function optionalBoolean(value: unknown, location: string): boolean | undefined {
    if (value !== undefined && typeof value !== "boolean") throw new SchemaError(`${location} must be a boolean`);
    return value;
}

function description(value: unknown, location: string): string | undefined {
    const text = optionalString(value, `${location}.description`);
    if (text !== undefined && text.trim() === "") throw new SchemaError(`${location}.description must not be empty`);
    return text;
}

function fieldType(value: unknown, location: string): FieldType {
    if (value === "number" || value === "string" || value === "boolean") return value;
    if (typeof value === "string") throw new SchemaError(`${location} has unknown type '${value}'`);
    const spec = object(value, location, ["list"]);
    return { list: fieldType(spec["list"], `${location}.list`) };
}

function isFieldPath(path: string): boolean {
    return path.split(".").every(isIdentifier);
}

function values(raw: unknown, path: string, type: ValueType): Constant[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!Array.isArray(raw) || raw.length === 0) throw new SchemaError(`values for '${path}' must be a nonempty array`);
    return raw.map((value: unknown) => {
        if (!constantMatches(value, type)) throw new SchemaError(`values for '${path}' must match ${typeName(type)}`);
        return structuredClone(value);
    });
}

function operators(raw: unknown, path: string, type: ValueType): ComparisonOp[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!Array.isArray(raw)) throw new SchemaError(`operators for '${path}' must be an array`);
    return raw.map((operator: unknown) => {
        if (!isComparisonOp(operator)) throw new SchemaError(`unknown operator for '${path}': ${String(operator)}`);
        if (isOrderingOp(operator) && type !== "number") {
            throw new SchemaError(`ordering operators require a non-nullable number field: '${path}'`);
        }
        return operator;
    });
}

function field(raw: unknown, path: string): FieldDefinition {
    if (!isFieldPath(path)) throw new SchemaError(`invalid field path '${path}'`);
    const location = `field '${path}'`;
    const config = object(raw, location, [
        "type",
        "description",
        "nullable",
        "values",
        "operators",
        "filterable",
        "sortable",
    ]);
    const type = fieldType(config["type"], `${location}.type`);
    const nullable = optionalBoolean(config["nullable"], `${location}.nullable`) ?? false;
    const filterable = optionalBoolean(config["filterable"], `${location}.filterable`) ?? true;
    const sortable = optionalBoolean(config["sortable"], `${location}.sortable`) ?? false;
    if (!filterable && !sortable) throw new SchemaError(`${location} must be filterable or sortable`);
    if (sortable && typeof type === "object") throw new SchemaError(`list ${location} cannot be sortable`);
    const valueType: ValueType = nullable ? { nullable: type } : type;
    return {
        path,
        description: description(config["description"], location),
        type,
        nullable,
        valueType,
        values: values(config["values"], path, valueType),
        operators: operators(config["operators"], path, valueType),
        filterable,
        sortable,
    };
}

function parameter(raw: unknown, location: string): ParameterDefinition {
    if (typeof raw === "string" || (typeof raw === "object" && raw !== null && "list" in raw)) {
        return { type: fieldType(raw, location), name: undefined, description: undefined };
    }
    const config = object(raw, location, ["type", "name", "description"]);
    const name = optionalString(config["name"], `${location}.name`);
    if (name !== undefined && !isIdentifier(name)) throw new SchemaError(`${location}.name must be an identifier`);
    return {
        type: fieldType(config["type"], `${location}.type`),
        name,
        description: description(config["description"], location),
    };
}

function func(name: string, raw: unknown): FunctionDefinition {
    if (!isIdentifier(name)) throw new SchemaError(`invalid function name '${name}'`);
    const builtin = BUILTIN_FUNCTIONS.get(name);
    if (raw === true) {
        if (builtin === undefined) throw new SchemaError(`'${name}' is not a built-in function`);
        return { kind: "builtin", name, builtin };
    }
    if (builtin !== undefined) throw new SchemaError(`cannot override built-in function '${name}'; use true`);
    const location = `function '${name}'`;
    const config = object(raw, location, ["description", "parameters", "returns"]);
    const parameters = config["parameters"];
    if (!Array.isArray(parameters)) throw new SchemaError(`${location}.parameters must be an array`);
    return {
        kind: "custom",
        name,
        description: description(config["description"], location),
        parameters: parameters.map((type: unknown, index) => parameter(type, `${location}.parameters[${index}]`)),
        returns: fieldType(config["returns"], `${location}.returns`),
    };
}

function example(raw: unknown, index: number): ExampleDefinition {
    const location = `examples[${index}]`;
    const config = object(raw, location, ["query", "description"]);
    const query = config["query"];
    const text = description(config["description"], location);
    if (typeof query !== "string") throw new SchemaError(`${location}.query must be a string`);
    if (text === undefined) throw new SchemaError(`${location}.description is required`);
    return { query, description: text };
}

/** Check untrusted configuration and convert it into an immutable model. */
export function compileSchema(raw: unknown): SchemaModel {
    const config = object(raw, "schema", ["description", "fields", "functions", "examples"]);

    const fields = new Map<string, FieldDefinition>();
    for (const [path, value] of Object.entries(record(config["fields"], "fields"))) {
        fields.set(path, field(value, path));
    }

    const functions = new Map<string, FunctionDefinition>();
    const rawFunctions = config["functions"] === undefined ? { contains: true } : config["functions"];
    for (const [name, value] of Object.entries(record(rawFunctions, "functions"))) {
        functions.set(name, func(name, value));
    }

    const rawExamples = config["examples"] ?? [];
    if (!Array.isArray(rawExamples)) throw new SchemaError("examples must be an array");

    return {
        description: description(config["description"], "schema"),
        fields,
        functions,
        examples: rawExamples.map(example),
    };
}
