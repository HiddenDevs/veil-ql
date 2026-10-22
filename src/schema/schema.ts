import { describeSchema } from "../describe/describe.js";
import type { SchemaDescription } from "../describe/describe.js";
import { QueryError, SchemaError } from "../errors.js";
import type { Expr, Query } from "../syntax/ast.js";
import { parse, parseQuery } from "../syntax/parser.js";
import { Validator } from "../validation/validator.js";
import { compileSchema } from "./compile.js";
import type { SchemaConfig } from "./config.js";
import type { SchemaModel } from "./model.js";

/** An immutable, validated description of the fields and functions a query may use. */
export class Schema {
    private readonly validator: Validator;

    private constructor(private readonly model: SchemaModel) {
        this.validator = new Validator(model.fields, model.functions);
        for (const [index, example] of model.examples.entries()) {
            try {
                this.parseQuery(example.query);
            } catch (cause) {
                if (!(cause instanceof QueryError)) throw cause;
                throw new SchemaError(`examples[${index}] is not a valid query: ${cause.message}`, { cause });
            }
        }
    }

    /**
     * Create a schema from a configuration object. The input is checked at runtime, so values
     * from untrusted sources (e.g. `JSON.parse`) are safe to pass. The input is not retained.
     */
    public static fromObject(config: SchemaConfig): Schema {
        return new Schema(compileSchema(config));
    }

    /** Create a schema from JSON text, e.g. a configuration file. */
    public static fromJson(json: string): Schema {
        let raw: unknown;
        try {
            raw = JSON.parse(json);
        } catch (cause) {
            if (!(cause instanceof SyntaxError)) throw cause;
            throw new SchemaError("malformed JSON", { cause });
        }
        return new Schema(compileSchema(raw));
    }

    /** Parse and validate a filter expression. Throws a {@link QueryError} subclass on failure. */
    public parse(source: string): Expr {
        const expr = parse(source);
        this.validate(expr);
        return expr;
    }

    /** Parse and validate a filter with an optional `SORT BY` clause. */
    public parseQuery(source: string): Query {
        const query = parseQuery(source);
        this.validateQuery(query);
        return query;
    }

    /** Validate an already-parsed filter expression. */
    public validate(expr: Expr): void {
        this.validator.validateFilter(expr);
    }

    /** Validate an already-parsed query, including that every sort field is sortable. */
    public validateQuery(query: Query): void {
        this.validator.validateFilter(query.filter);
        this.validator.validateSorts(query.sorts);
    }

    /**
     * Describe the query language and this schema for an AI agent. The result is plain,
     * JSON-serializable data intended for prompt templates or tool definitions.
     */
    public describe(): SchemaDescription {
        return describeSchema(this.model);
    }
}
