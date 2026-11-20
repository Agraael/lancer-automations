import globals from "globals";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";

const isDeclaration = node => node?.type === "VariableDeclaration" && ["const", "let"].includes(node.kind);

const blankAfterDeclarationGroup = {
    meta: {
        type: "layout",
        fixable: "whitespace",
        messages: { missing: "Expected a blank line between a group of declarations and this if." }
    },
    create(context)
    {
        const { sourceCode } = context;
        const eol = sourceCode.text.includes("\r\n") ? "\r\n" : "\n";

        const hasBlankLine = (previous, next) =>
        {
            const tokens = [previous, ...sourceCode.getCommentsBefore(next), next];
            return tokens.some((token, index) => index > 0 && token.loc.start.line - tokens[index - 1].loc.end.line > 1);
        };

        const check = statements => statements.forEach((statement, index) =>
        {
            const first = statements[index - 2];
            const previous = statements[index - 1];
            if (statement.type !== "IfStatement" || !isDeclaration(first) || !isDeclaration(previous))
                return;

            if (hasBlankLine(first, previous) || hasBlankLine(previous, statement))
                return;

            context.report({
                node: statement,
                messageId: "missing",
                fix: fixer =>
                {
                    const trailing = sourceCode.getCommentsBefore(statement).filter(comment => comment.loc.start.line === previous.loc.end.line);
                    return fixer.insertTextAfter(trailing.at(-1) ?? previous, eol);
                }
            });
        });

        return {
            "Program, BlockStatement, StaticBlock": node => check(node.body),
            SwitchCase: node => check(node.consequent)
        };
    }
};

export default defineConfig([
    {
        files: ["**/*.js"],
        plugins: {
            "@stylistic": stylistic,
            local: { rules: { "blank-after-declaration-group": blankAfterDeclarationGroup } }
        },
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,

                // Foundry VTT v13 globals
                game: "readonly",
                canvas: "readonly",
                ui: "readonly",
                Hooks: "readonly",
                CONFIG: "readonly",
                CONST: "readonly",
                foundry: "readonly",
                Actor: "readonly",
                Item: "readonly",
                Token: "readonly",
                TokenDocument: "readonly",
                CanvasAnimation: "readonly",
                ChatMessage: "readonly",
                Dialog: "readonly",
                Roll: "readonly",
                TextEditor: "readonly",
                FormApplication: "readonly",
                Application: "readonly",
                Macro: "readonly",
                Scene: "readonly",
                User: "readonly",
                Folder: "readonly",
                JournalEntry: "readonly",
                JournalEntryPage: "readonly",
                Combat: "readonly",
                Setting: "readonly",
                Color: "readonly",
                fromUuid: "readonly",
                fromUuidSync: "readonly",
                mergeObject: "readonly",
                expandObject: "readonly",
                flattenObject: "readonly",
                duplicate: "readonly",
                getProperty: "readonly",
                setProperty: "readonly",
                hasProperty: "readonly",
                randomID: "readonly",
                PIXI: "readonly",
                FilePicker: "readonly",
                PreciseText: "readonly",
                Handlebars: "readonly",
                Ray: "readonly",
                ClipperLib: "readonly",

                // lancer-automations startup scripts
                api: "readonly",

                // Common module globals
                libWrapper: "readonly",
                ForceClientControls: "readonly",
                ForceClientSettings: "readonly",
                CodeMirror: "readonly",
                Sequencer: "readonly",
                Sequence: "readonly",
                MidiQOL: "readonly",
                $: "readonly",
                jQuery: "readonly",
                TurnMarker: "readonly",
                StartTurnMarker: "readonly"
            }
        },
        rules: {
            // ── Bug detection ──────────────────────────────────────────────────────
            "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
            "no-undef": "error",
            "eqeqeq": ["error", "always", { null: "ignore" }],
            "no-unreachable": "error",
            "no-constant-condition": "warn",
            "no-self-compare": "error",
            "use-isnan": "error",
            "no-loss-of-precision": "error",

            // ── Brace style ────────────────────────────────────────────────────────
            curly: ["error", "multi-or-nest"],
            "@stylistic/brace-style": ["error", "allman"],
            "@stylistic/nonblock-statement-body-position": ["error", "below"],

            // ── Formatting (@stylistic; core versions removed in ESLint 10) ──────────
            "@stylistic/indent": ["error", 4],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/eol-last": ["error", "always"],

            "@stylistic/max-len": ["error", {
                code: 300,
                ignoreComments: true,
                ignoreUrls: true,
                ignoreStrings: true,
                ignoreTemplateLiterals: true
            }],

            "@stylistic/object-property-newline": ["error", {
                allowAllPropertiesOnSameLine: true
            }],

            "@stylistic/padding-line-between-statements": ["error",
                { blankLine: "always", prev: "*", next: ["multiline-block-like", "multiline-const", "multiline-let"] },
                { blankLine: "always", prev: ["multiline-block-like", "multiline-const", "multiline-let"], next: "*" },
                { blankLine: "always", prev: ["if", "for", "while", "multiline-expression"], next: ["const", "let"] }
            ],

            "local/blank-after-declaration-group": "error"
        }
    }
]);
