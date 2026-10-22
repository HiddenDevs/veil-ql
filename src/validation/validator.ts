import { ValidationError } from "../errors.js";
import type { FieldDefinition, FunctionDefinition } from "../schema/model.js";
import { compatible, mergeTypes, sameConstant } from "../schema/types.js";
import type { Constant, FieldType, ValueType } from "../schema/types.js";
import type { BinaryOp, ComparisonOp, Expr, ExprOf, PathExpr, SortField } from "../syntax/ast.js";
import { mismatch } from "./mismatch.js";

function matchesParameter(expected: FieldType, actual: ValueType): boolean {
    if (actual === "unknown") return true;
    if (typeof expected === "string") return expected === actual;
    return typeof actual === "object" && "list" in actual && matchesParameter(expected.list, actual.list);
}

/** Fold a literal, negated number, or list of those into a constant. */
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

/** Static semantic checks against a schema. Syntax parsing stays schema independent. */
export class Validator {
    public constructor(
        private readonly fields: ReadonlyMap<string, FieldDefinition>,
        private readonly functions: ReadonlyMap<string, FunctionDefinition>,
    ) {}

    public validateFilter(expr: Expr): void {
        const actual = this.infer(expr);
        if (actual !== "boolean") mismatch(expr, "boolean", actual);
    }

    public validateSorts(sorts: readonly SortField[]): void {
        for (const { field } of sorts) {
            const definition = this.lookup(field);
            if (!definition.sortable) {
                throw new ValidationError({ kind: "FieldNotSortable", field: definition.path }, field.span);
            }
        }
    }

    private lookup(expr: PathExpr): FieldDefinition {
        const path = expr.parts.join(".");
        const definition = this.fields.get(path);
        if (definition === undefined) throw new ValidationError({ kind: "UnknownField", field: path }, expr.span);
        return definition;
    }

    /** The field definition when `expr` is a direct field reference. */
    private field(expr: Expr): FieldDefinition | undefined {
        return expr.kind === "path" ? this.fields.get(expr.parts.join(".")) : undefined;
    }

    private checkValues(fieldExpr: Expr, valueExpr: Expr): void {
        const allowed = this.field(fieldExpr)?.values;
        if (allowed === undefined) return;
        const value = constant(valueExpr);
        if (value !== undefined && !allowed.some((candidate) => sameConstant(candidate, value))) {
            const field = (fieldExpr as PathExpr).parts.join(".");
            throw new ValidationError(
                { kind: "ValueNotAllowed", field, allowed: structuredClone(allowed) },
                valueExpr.span,
            );
        }
    }

    private checkOperator(expr: Expr, operator: ComparisonOp): void {
        if (expr.kind === "unary" && expr.op === "-") {
            this.checkOperator(expr.expr, operator);
            return;
        }
        const field = this.field(expr);
        if (field?.operators !== undefined && !field.operators.includes(operator)) {
            throw new ValidationError(
                { kind: "OperatorNotAllowed", field: field.path, operator, allowed: [...field.operators] },
                expr.span,
            );
        }
    }

    private infer(expr: Expr): ValueType {
        switch (expr.kind) {
            case "literal":
                if (expr.value === null) return "null";
                switch (typeof expr.value) {
                    case "number":
                        if (!Number.isFinite(expr.value)) {
                            throw new ValidationError({ kind: "NonFiniteNumber" }, expr.span);
                        }
                        return "number";
                    case "string":
                        return "string";
                    case "boolean":
                        return "boolean";
                }
                throw new TypeError("Invalid literal in AST");
            case "path": {
                const field = this.lookup(expr);
                if (!field.filterable) {
                    throw new ValidationError({ kind: "FieldNotFilterable", field: field.path }, expr.span);
                }
                return field.valueType;
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

    private call(expr: ExprOf<"call">): ValueType {
        const fn = this.functions.get(expr.name);
        if (fn === undefined) {
            throw new ValidationError({ kind: "UnknownFunction", function: expr.name }, expr.span);
        }
        const expected = fn.kind === "builtin" ? fn.builtin.arity : fn.parameters.length;
        if (expr.args.length !== expected) {
            throw new ValidationError(
                { kind: "InvalidArgumentCount", function: expr.name, expected, actual: expr.args.length },
                expr.span,
            );
        }
        if (fn.kind === "builtin") return fn.builtin.check(expr.args, (arg) => this.infer(arg));
        for (const [index, argument] of expr.args.entries()) {
            const parameter = fn.parameters[index];
            if (parameter === undefined) throw new TypeError("Missing function parameter definition");
            const actual = this.infer(argument);
            if (!matchesParameter(parameter.type, actual)) mismatch(argument, parameter.type, actual);
        }
        return fn.returns;
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
