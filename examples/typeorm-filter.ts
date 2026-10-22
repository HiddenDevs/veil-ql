import { Schema } from "../src/index.js";
import type { Expr, Literal, SortDirection } from "../src/index.js";

const schema = Schema.fromObject({
    fields: {
        "user.age": { type: "number", sortable: true },
        "user.status": { type: "string" },
    },
});

const filterExpression = 'user.age >= 18 AND user.status IN ["active", "pending"] SORT BY user.age DESC';

export interface CompiledSort {
    readonly column: string;
    readonly direction: SortDirection;
}

export interface CompiledFilter {
    readonly sql: string;
    readonly parameters: Readonly<Record<string, Literal>>;
    readonly sorts: readonly CompiledSort[];
}

export interface TypeOrmQueryBuilder<T> {
    where(condition: string, parameters?: Record<string, Literal>): T;
    orderBy(sort: string, direction: SortDirection): T;
    addOrderBy(sort: string, direction: SortDirection): T;
}

export function compileFilter(expr: Expr, columns: Readonly<Record<string, string>>): CompiledFilter {
    const parameters: Record<string, Literal> = {};
    let nextParameter = 0;

    function bind(value: Literal): string {
        const name = `veil_${nextParameter++}`;
        parameters[name] = value;
        return `:${name}`;
    }

    function column(path: string): string {
        if (!Object.hasOwn(columns, path)) {
            throw new Error(`No TypeORM column mapping for '${path}'`);
        }
        const mappedColumn = columns[path];
        if (mappedColumn === undefined) {
            throw new Error(`No TypeORM column mapping for '${path}'`);
        }
        return mappedColumn;
    }

    function value(node: Expr): string {
        switch (node.kind) {
            case "literal":
                return bind(node.value);
            case "path":
                return column(node.parts.join("."));
            case "unary":
                if (node.op !== "-") throw new Error("NOT is only supported as a filter condition");
                return `(-${value(node.expr)})`;
            default:
                throw new Error(`Cannot translate ${node.kind} as a TypeORM value`);
        }
    }

    function listLiteral(node: Expr): Literal {
        if (node.kind === "literal") return node.value;
        if (node.kind === "unary" && node.op === "-" && node.expr.kind === "literal") {
            if (typeof node.expr.value === "number") return -node.expr.value;
        }
        throw new Error("IN lists must contain literal values");
    }

    function condition(node: Expr): string {
        if (node.kind === "unary" && node.op === "NOT") {
            return `(NOT ${condition(node.expr)})`;
        }
        if (node.kind !== "binary") {
            throw new Error("A filter condition must be a comparison or logical expression");
        }
        if (node.op === "AND" || node.op === "OR") {
            return `(${condition(node.left)} ${node.op} ${condition(node.right)})`;
        }
        if (node.op === "IN" || node.op === "NOT IN") {
            if (node.right.kind !== "list") {
                throw new Error(`${node.op} requires a list of literal values in this example`);
            }
            const left = value(node.left);
            if (node.right.items.length === 0) return node.op === "IN" ? "1 = 0" : "1 = 1";
            const values = node.right.items.map((item) => bind(listLiteral(item)));
            return `(${left} ${node.op} (${values.join(", ")}))`;
        }

        const operators = {
            "==": "=",
            "!=": "<>",
            ">": ">",
            ">=": ">=",
            "<": "<",
            "<=": "<=",
        } as const;
        const operator = operators[node.op];
        if (node.right.kind === "literal" && node.right.value === null) {
            if (node.op !== "==" && node.op !== "!=") {
                throw new Error(`${node.op} cannot be compared with null`);
            }
            return `(${value(node.left)} IS ${node.op === "!=" ? "NOT " : ""}NULL)`;
        }
        if (node.left.kind === "literal" && node.left.value === null) {
            if (node.op !== "==" && node.op !== "!=") {
                throw new Error(`${node.op} cannot be compared with null`);
            }
            return `(${value(node.right)} IS ${node.op === "!=" ? "NOT " : ""}NULL)`;
        }
        return `(${value(node.left)} ${operator} ${value(node.right)})`;
    }

    const sql = condition(expr);
    return { sql, parameters, sorts: [] };
}

export function applySorts<TBuilder>(
    queryBuilder: Pick<TypeOrmQueryBuilder<TBuilder>, "orderBy" | "addOrderBy">,
    sorts: readonly CompiledSort[],
): void {
    for (const [index, sort] of sorts.entries()) {
        if (index === 0) queryBuilder.orderBy(sort.column, sort.direction);
        else queryBuilder.addOrderBy(sort.column, sort.direction);
    }
}

export class TypeOrmFilter {
    public constructor(
        private readonly schema: Schema,
        private readonly columns: Readonly<Record<string, string>>,
    ) {}

    public compile(expression: string): CompiledFilter {
        // Validates filter fields and that every SORT BY field is declared sortable.
        const query = this.schema.parseQuery(expression);
        const compiled = compileFilter(query.filter, this.columns);
        const sorts = query.sorts.map((sort) => {
            const path = sort.field.parts.join(".");
            if (!Object.hasOwn(this.columns, path)) {
                throw new Error(`No TypeORM column mapping for sort field '${path}'`);
            }
            const column = this.columns[path];
            if (column === undefined) {
                throw new Error(`No TypeORM column mapping for sort field '${path}'`);
            }
            return { column, direction: sort.direction };
        });
        return { ...compiled, sorts };
    }

    public applyTo<TBuilder>(queryBuilder: TypeOrmQueryBuilder<TBuilder>, expression: string): TBuilder {
        const compiled = this.compile(expression);
        const builder = queryBuilder.where(compiled.sql, { ...compiled.parameters });
        applySorts(queryBuilder, compiled.sorts);
        return builder;
    }
}

const userFilter = new TypeOrmFilter(schema, {
    "user.age": "user.age",
    "user.status": "user.status",
});
const compiled = userFilter.compile(filterExpression);

// In an application, pass the repository's entity type to createQueryBuilder.
// const users = await userFilter
//     .applyTo(userRepository.createQueryBuilder("user"), filterExpression)
//     .getMany();

console.log(compiled);
