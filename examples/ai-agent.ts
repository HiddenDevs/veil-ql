import { QueryError, Schema } from "../src/index.js";
import type { Query, SchemaDescription } from "../src/index.js";

// 1. Describe the query surface once. Descriptions and examples only affect `describe()`;
//    examples are validated when the schema is created, so they can never drift out of date.
const schema = Schema.fromObject({
    description: "Orders placed in the storefront. Each result is one order.",
    fields: {
        "order.status": {
            type: "string",
            description: "Fulfilment status.",
            values: ["pending", "paid", "shipped", "cancelled"],
        },
        "order.total": { type: "number", description: "Order total in USD.", sortable: true },
        "order.createdAt": {
            type: "number",
            description: "Creation time as a Unix timestamp in seconds.",
            filterable: false,
            sortable: true,
        },
        "customer.email": { type: "string", description: "Customer email address.", nullable: true },
        "customer.tags": { type: { list: "string" }, description: 'Customer labels such as "vip".' },
    },
    functions: {
        contains: true,
        startsWith: {
            description: "True when text begins with prefix (case-sensitive).",
            parameters: [
                { name: "text", type: "string" },
                { name: "prefix", type: "string" },
            ],
            returns: "boolean",
        },
    },
    examples: [
        {
            query: 'order.status IN ["paid", "shipped"] AND order.total >= 100 SORT BY order.total DESC',
            description: "Paid or shipped orders of at least $100, largest first.",
        },
        {
            query: 'contains(customer.tags, "vip") AND customer.email != null',
            description: "Orders from VIP customers with an email address on file.",
        },
    ],
});

const description: SchemaDescription = schema.describe();

// 2a. Render the description into a system prompt. The structure is plain data, so any
//     templating approach works; this is one compact option.
export function renderInstructions(d: SchemaDescription): string {
    const fields = d.fields.map((f) => {
        const traits = [
            f.type,
            f.nullable ? "nullable" : "",
            !f.filterable ? "sort only" : f.sortable ? "sortable" : "",
        ];
        const lines = [
            `- ${f.name} (${traits.filter(Boolean).join(", ")})${f.description ? `: ${f.description}` : ""}`,
        ];
        if (f.filterable) lines.push(`  operators: ${f.operators.join(" ") || "none"}`);
        if (f.values) lines.push(`  allowed values: ${f.values.map((v) => JSON.stringify(v)).join(", ")}`);
        return lines.join("\n");
    });
    const functions = d.functions.map(
        (fn) => `- ${fn.signatures.join(" | ")}${fn.description ? `: ${fn.description}` : ""}`,
    );
    const examples = d.examples.map((e) => `- ${e.description}\n  ${e.query}`);
    return [
        "Write a Veil QL query for the user's request. Respond with the query only.",
        d.description ?? "",
        `${d.language.summary}\nGrammar: ${d.language.grammar}`,
        `Rules:\n${d.language.rules.map((rule) => `- ${rule}`).join("\n")}`,
        `Fields:\n${fields.join("\n")}`,
        functions.length > 0 ? `Functions:\n${functions.join("\n")}` : "Functions: none",
        examples.length > 0 ? `Examples:\n${examples.join("\n")}` : "",
    ]
        .filter(Boolean)
        .join("\n\n");
}

// 2b. Or expose it as a tool for function calling. The shape below matches the common
//     JSON-Schema-based tool format; adapt the wrapper to your provider's SDK.
export const searchOrdersTool = {
    name: "search_orders",
    description: `Search orders with a Veil QL query.\n\n${renderInstructions(description)}`,
    parameters: {
        type: "object",
        properties: { query: { type: "string", description: "A Veil QL query." } },
        required: ["query"],
    },
} as const;

// 3. Validate what the agent produced. Error messages are written to be returned to the
//    agent verbatim so it can correct its query.
export function validateAgentQuery(source: string): { ok: true; query: Query } | { ok: false; error: string } {
    try {
        return { ok: true, query: schema.parseQuery(source) };
    } catch (error) {
        if (error instanceof QueryError) return { ok: false, error: `Invalid query: ${error.message}` };
        throw error;
    }
}

console.log(renderInstructions(description));
console.log(validateAgentQuery('order.status == "refunded"'));
// { ok: false, error: "Invalid query: value is not allowed for field 'order.status'; allowed: \"pending\", \"paid\", \"shipped\", \"cancelled\" (at 16..26)" }
