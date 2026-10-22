import { Schema, ValidationError, parseWithSchema } from "./index.js";

const schema = Schema.fromJson(
    JSON.stringify({
        fields: {
            "user.age": { type: "number", operators: ["==", "!=", ">", ">=", "<", "<="] },
            "user.status": {
                type: "string",
                values: ["active", "pending", "banned"],
                operators: ["==", "!=", "IN", "NOT IN"],
            },
            "user.email": { type: "string", nullable: true },
            "user.tags": { type: { list: "string" } },
        },
        functions: ["contains"],
    }),
);

const query = `
  user.age >= 18
  AND user.status IN ["active", "pending"]
  AND user.email != null
  AND contains(user.tags, "trusted")
`;

console.log("Validated AST:");
console.dir(parseWithSchema(query, schema), { depth: null });

for (const invalid of [
    "user.unknown == true",
    'user.age >= "eighteen"',
    'user.status == "deleted"',
    "user.age IN [18, 21]",
]) {
    try {
        parseWithSchema(invalid, schema);
    } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        console.log(`Rejected ${JSON.stringify(invalid)}:\n  ${error.message}`);
        continue;
    }
    throw new Error(`Expected example query to be rejected: ${invalid}`);
}
