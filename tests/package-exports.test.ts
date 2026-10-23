import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("..", import.meta.url));

describe("built package exports", () => {
    it.each(["module", "commonjs"])("loads and validates queries from %s", (mode) => {
        const load = mode === "module" ? 'await import("@hiddendevs/veil-ql")' : 'require("@hiddendevs/veil-ql")';
        execFileSync(
            process.execPath,
            [
                `--input-type=${mode}`,
                "-e",
                `
                const { Schema, parse } = ${load};
                const schema = Schema.fromObject({ fields: { age: { type: "number" } } });
                const actual = JSON.stringify(schema.parse("age >= 18"));
                const expected = JSON.stringify(parse("age >= 18"));
                if (actual !== expected) throw new Error("Unexpected parsed query");
                `,
            ],
            { cwd, stdio: "pipe" },
        );
    });

    it("shares classes between import and require", () => {
        const output = execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `
                import { createRequire } from "node:module";
                import { Schema, ValidationError } from "@hiddendevs/veil-ql";
                const cjs = createRequire(import.meta.url)("@hiddendevs/veil-ql");
                console.log(Schema === cjs.Schema && ValidationError === cjs.ValidationError);
                `,
            ],
            { cwd, encoding: "utf8" },
        );
        expect(output.trim()).toBe("true");
    });
});
