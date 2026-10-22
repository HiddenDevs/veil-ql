import type { FieldDefinition, FunctionDefinition, ParameterDefinition, SchemaModel } from "../schema/model.js";
import { effectiveOperators } from "../schema/model.js";
import { typeName } from "../schema/types.js";
import type { Constant } from "../schema/types.js";
import type { ComparisonOp } from "../syntax/ast.js";
import { LANGUAGE_REFERENCE } from "./language.js";
import type { LanguageReference } from "./language.js";

/**
 * JSON-serializable description of everything an agent needs to write valid queries.
 * Optional properties are omitted rather than set to `undefined`.
 */
export interface SchemaDescription {
    readonly description?: string;
    readonly language: LanguageReference;
    readonly fields: readonly FieldDescription[];
    readonly functions: readonly FunctionDescription[];
    readonly examples: readonly ExampleDescription[];
}

export interface FieldDescription {
    readonly name: string;
    readonly description?: string;
    /** `number`, `string`, `boolean`, or `list<T>`. */
    readonly type: string;
    readonly nullable: boolean;
    readonly filterable: boolean;
    readonly sortable: boolean;
    /** Comparison operators that are valid for this field. Empty when it cannot be compared. */
    readonly operators: readonly ComparisonOp[];
    /** When present, the only values the field may be compared with. */
    readonly values?: readonly Constant[];
}

export interface FunctionDescription {
    readonly name: string;
    readonly description?: string;
    /** Human-readable signatures, e.g. `startsWith(text: string, prefix: string) -> boolean`. */
    readonly signatures: readonly string[];
    /** Present for custom functions only. */
    readonly parameters?: readonly ParameterDescription[];
    /** Present for custom functions only. */
    readonly returns?: string;
}

export interface ParameterDescription {
    readonly name?: string;
    readonly description?: string;
    readonly type: string;
}

export interface ExampleDescription {
    readonly query: string;
    readonly description: string;
}

function withDescription<T extends object>(value: T, description: string | undefined): T & { description?: string } {
    return description === undefined ? value : { ...value, description };
}

function describeField(field: FieldDefinition): FieldDescription {
    const result = withDescription({ name: field.path }, field.description);
    return {
        ...result,
        type: typeName(field.type),
        nullable: field.nullable,
        filterable: field.filterable,
        sortable: field.sortable,
        operators: effectiveOperators(field),
        ...(field.values === undefined ? {} : { values: structuredClone(field.values) }),
    };
}

function describeParameter(parameter: ParameterDefinition): ParameterDescription {
    const type = typeName(parameter.type);
    const named = parameter.name === undefined ? { type } : { name: parameter.name, type };
    return withDescription(named, parameter.description);
}

function describeFunction(fn: FunctionDefinition): FunctionDescription {
    if (fn.kind === "builtin") {
        return { name: fn.name, description: fn.builtin.description, signatures: [...fn.builtin.signatures] };
    }
    const parameters = fn.parameters.map(describeParameter);
    const returns = typeName(fn.returns);
    const args = parameters.map((p) => (p.name === undefined ? p.type : `${p.name}: ${p.type}`)).join(", ");
    return {
        ...withDescription({ name: fn.name }, fn.description),
        signatures: [`${fn.name}(${args}) -> ${returns}`],
        parameters,
        returns,
    };
}

export function describeSchema(model: SchemaModel): SchemaDescription {
    const description = {
        language: structuredClone(LANGUAGE_REFERENCE),
        fields: Array.from(model.fields.values(), describeField),
        functions: Array.from(model.functions.values(), describeFunction),
        examples: model.examples.map((example) => ({ ...example })),
    };
    return model.description === undefined ? description : { description: model.description, ...description };
}
