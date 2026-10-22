export type PrimitiveType = "number" | "string" | "boolean";
export type FieldType = PrimitiveType | { readonly list: FieldType };
export type ValueType =
    PrimitiveType | "null" | "unknown" | { readonly list: ValueType } | { readonly nullable: ValueType };
export type Constant = number | string | boolean | null | readonly Constant[];

export function typeName(type: ValueType): string {
    if (typeof type === "string") return type;
    return "list" in type ? `list<${typeName(type.list)}>` : `nullable<${typeName(type.nullable)}>`;
}

export function compatible(left: ValueType, right: ValueType): boolean {
    if (left === "unknown" || right === "unknown") return true;
    if (typeof left === "object" && "nullable" in left) {
        if (right === "null") return true;
        return compatible(left.nullable, typeof right === "object" && "nullable" in right ? right.nullable : right);
    }
    if (typeof right === "object" && "nullable" in right) return compatible(right, left);
    if (typeof left === "object" && typeof right === "object") return compatible(left.list, right.list);
    return left === right;
}

/** Unify compatible list elements without losing types inferred after empty lists. */
export function mergeTypes(left: ValueType, right: ValueType): ValueType {
    if (left === "unknown") return right;
    if (right === "unknown") return left;
    if (typeof left === "object" && "nullable" in left) {
        if (right === "null") return left;
        return {
            nullable: mergeTypes(
                left.nullable,
                typeof right === "object" && "nullable" in right ? right.nullable : right,
            ),
        };
    }
    if (typeof right === "object" && "nullable" in right) return mergeTypes(right, left);
    if (typeof left === "object" && typeof right === "object") return { list: mergeTypes(left.list, right.list) };
    return left;
}

export function constantMatches(value: unknown, type: ValueType): value is Constant {
    if (typeof type === "object") {
        if ("nullable" in type) return value === null || constantMatches(value, type.nullable);
        return Array.isArray(value) && value.every((item: unknown) => constantMatches(item, type.list));
    }
    return type === "null"
        ? value === null
        : type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : type === "string"
            ? typeof value === "string"
            : type === "boolean" && typeof value === "boolean";
}

export function sameConstant(left: Constant, right: Constant): boolean {
    if (Array.isArray(left) && Array.isArray(right)) {
        return (
            left.length === right.length &&
            left.every((item: Constant, index: number) => {
                const other: Constant | undefined = right[index];
                return other !== undefined && sameConstant(item, other);
            })
        );
    }
    return left === right;
}
