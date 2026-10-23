import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test } from "vitest";

test("the packed package provides types for legacy and modern consumers", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const consumer = mkdtempSync(join(tmpdir(), "veil-ql-consumer-"));
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";

    try {
        execFileSync(npm, ["run", "build"], { cwd: root, stdio: "pipe" });
        const tarball = execFileSync(npm, ["pack", "--ignore-scripts", "--pack-destination", consumer], {
            cwd: root,
            encoding: "utf8",
            stdio: "pipe",
        }).trim();
        writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
        execFileSync(
            npm,
            ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", join(consumer, tarball)],
            { cwd: consumer, stdio: "pipe" },
        );
        const entry = join(consumer, "index.ts");
        writeFileSync(
            entry,
            `
import { Schema, parse, type Expr, type SchemaConfig } from "@hiddendevs/veil-ql";

const config: SchemaConfig = { fields: { age: { type: "number" } } };
const schema = Schema.fromObject(config);
const expression: Expr = schema.parse("age >= 18");
parse("age >= 18");
console.log(expression.kind);

// @ts-expect-error Invalid field types must not be accepted.
const invalid: SchemaConfig = { fields: { age: { type: "invalid" } } };
console.log(invalid);
`,
        );

        for (const [moduleResolution, module] of [
            [ts.ModuleResolutionKind.Node10, ts.ModuleKind.ESNext],
            [ts.ModuleResolutionKind.NodeNext, ts.ModuleKind.NodeNext],
            [ts.ModuleResolutionKind.Bundler, ts.ModuleKind.ESNext],
        ] as const) {
            const program = ts.createProgram([entry], {
                target: ts.ScriptTarget.ES2022,
                module,
                moduleResolution,
                strict: true,
                noEmit: true,
                types: [],
            });
            const diagnostics = ts.getPreEmitDiagnostics(program);
            assert.equal(
                diagnostics.length,
                0,
                `${ts.ModuleResolutionKind[moduleResolution]}:\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, {
                    getCurrentDirectory: () => consumer,
                    getCanonicalFileName: (name) => name,
                    getNewLine: () => "\n",
                })}`,
            );
        }
        execFileSync(process.execPath, ["--input-type=module", "-e", 'import("@hiddendevs/veil-ql")'], {
            cwd: consumer,
            stdio: "pipe",
        });
    } finally {
        rmSync(consumer, { recursive: true, force: true });
    }
}, 30_000);
