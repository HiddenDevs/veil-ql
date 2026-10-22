import type { BinaryOp, ComparisonOp, Expr } from "./ast.js";
import { ValidationError } from "./errors.js";
import type { FieldDefinition, FunctionSignature } from "./schema.js";
import { compatible, mergeTypes, sameConstant, typeName } from "./type-system.js";
import type { Constant, FieldType, ValueType } from "./type-system.js";

function matchesParameter(expected: FieldType, actual: ValueType): boolean {
    if (actual === "unknown") return true;
    if (typeof expected === "string") return expected === actual;
    return typeof actual === "object" && "list" in actual && matchesParameter(expected.list, actual.list);
}

function mismatch(expr: Expr, expected: ValueType, actual: ValueType): never {
    throw new ValidationError(
        {
            kind: "TypeMismatch",
            expected: typeName(expected),
            actual: typeName(actual),
        },
        expr.span,
    );
}

function constant(expr: Expr): Constant | undefined {
    switch (expr.kind) {
        case "literal":
            return expr.value;
        case "unary": {
            const value = constant(expr.expr);
            return expr.op === "-" && typeof value === "number" ? -value : undefined;
        }
        case "list": {
            const values: Constant[] = [];
            for (const item of expr.items) {
                const value = constant(item);
                if (value === undefined) return undefined;
                values.push(value);
            }
            return values;
        }
        default:
            return undefined;
    }
}

/** Internal semantic pass; syntax parsing remains schema independent. */
export class Validator {
    public constructor(
        private readonly fields: ReadonlyMap<string, FieldDefinition>,
        private readonly functions: ReadonlyMap<string, FunctionSignature | "contains">,
    ) {}

    public validateFilter(expr: Expr): void {
        const actual = this.infer(expr);
        if (actual !== "boolean") mismatch(expr, "boolean", actual);
    }

    private field(expr: Expr): { path: string; definition: FieldDefinition } | undefined {
        if (expr.kind !== "path") return undefined;
        const path = expr.parts.join(".");
        const definition = this.fields.get(path);
        return definition === undefined ? undefined : { path, definition };
    }

    private checkValues(fieldExpr: Expr, valueExpr: Expr): void {
        const field = this.field(fieldExpr);
        if (field?.definition.values === undefined) return;
        const value = constant(valueExpr);
        if (value !== undefined && !field.definition.values.some((allowed) => sameConstant(allowed, value))) {
            throw new ValidationError({ kind: "ValueNotAllowed", field: field.path }, valueExpr.span);
        }
    }

    private checkOperator(expr: Expr, operator: ComparisonOp): void {
        if (expr.kind === "unary" && expr.op === "-") {
            this.checkOperator(expr.expr, operator);
            return;
        }
        const field = this.field(expr);
        if (field?.definition.operators !== undefined && !field.definition.operators.includes(operator)) {
            throw new ValidationError({ kind: "OperatorNotAllowed", field: field.path, operator }, expr.span);
        }
    }

    private infer(expr: Expr): ValueType {
        switch (expr.kind) {
            case "literal":
                if (expr.value === null) return "null";
                switch (typeof expr.value) {
                    case "number":
                        if (!Number.isFinite(expr.value))
                            throw new ValidationError({ kind: "NonFiniteNumber" }, expr.span);
                        return "number";
                    case "string":
                        return "string";
                    case "boolean":
                        return "boolean";
                }
                throw new TypeError("Invalid literal in AST");
            case "path": {
                const field = this.field(expr);
                if (field === undefined) {
                    throw new ValidationError({ kind: "UnknownField", field: expr.parts.join(".") }, expr.span);
                }
                return field.definition.type;
            }
            case "list": {
                let type: ValueType = "unknown";
                for (const item of expr.items) {
                    const actual = this.infer(item);
                    if (!compatible(type, actual)) mismatch(item, type, actual);
                    type = mergeTypes(type, actual);
                }
                return { list: type };
            }
            case "unary": {
                const actual = this.infer(expr.expr);
                const expected = expr.op === "NOT" ? "boolean" : "number";
                if (actual !== expected) mismatch(expr.expr, expected, actual);
                return expected;
            }
            case "binary":
                return this.binary(expr.left, expr.op, expr.right);
            case "call":
                return this.call(expr);
        }
    }

    private call(expr: Extract<Expr, { kind: "call" }>): ValueType {
        const signature = this.functions.get(expr.name);
        if (signature === undefined) {
            throw new ValidationError({ kind: "UnknownFunction", function: expr.name }, expr.span);
        }
        const expected = signature === "contains" ? 2 : signature.parameters.length;
        if (expr.args.length !== expected) {
            throw new ValidationError(
                { kind: "InvalidArgumentCount", function: expr.name, expected, actual: expr.args.length },
                expr.span,
            );
        }
        if (signature !== "contains") {
            for (const [index, argument] of expr.args.entries()) {
                const parameter = signature.parameters[index];
                if (parameter === undefined) throw new TypeError("Missing function parameter definition");
                const actual = this.infer(argument);
                if (!matchesParameter(parameter, actual)) mismatch(argument, parameter, actual);
            }
            return signature.returns;
        }
        const [containerExpr, needleExpr] = expr.args;
        if (containerExpr === undefined || needleExpr === undefined) {
            throw new TypeError("Missing contains arguments in AST");
        }
        const container = this.infer(containerExpr);
        const needle = this.infer(needleExpr);
        if (container === "string") {
            if (needle !== "string") mismatch(needleExpr, "string", needle);
        } else if (typeof container === "object" && "list" in container) {
            if (!compatible(container.list, needle)) mismatch(needleExpr, container.list, needle);
        } else {
            throw new ValidationError(
                {
                    kind: "TypeMismatch",
                    expected: "string or list",
                    actual: typeName(container),
                },
                containerExpr.span,
            );
        }
        return "boolean";
    }

    private binary(left: Expr, op: BinaryOp, right: Expr): ValueType {
        const leftType = this.infer(left);
        const rightType = this.infer(right);
        if (op === "AND" || op === "OR") {
            if (leftType !== "boolean") mismatch(left, "boolean", leftType);
            if (rightType !== "boolean") mismatch(right, "boolean", rightType);
            return "boolean";
        }
        this.checkOperator(left, op);
        this.checkOperator(right, op);
        switch (op) {
            case "==":
            case "!=":
                if (!compatible(leftType, rightType)) mismatch(right, leftType, rightType);
                this.checkValues(left, right);
                this.checkValues(right, left);
                break;
            case "IN":
            case "NOT IN":
                if (typeof rightType !== "object" || !("list" in rightType) || !compatible(leftType, rightType.list)) {
                    mismatch(right, { list: leftType }, rightType);
                }
                if (right.kind === "list") {
                    for (const item of right.items) this.checkValues(left, item);
                }
                break;
            case ">":
            case ">=":
            case "<":
            case "<=":
                if (leftType !== "number") mismatch(left, "number", leftType);
                if (rightType !== "number") mismatch(right, "number", rightType);
                this.checkValues(left, right);
                this.checkValues(right, left);
                break;
        }
        return "boolean";
    }
}
