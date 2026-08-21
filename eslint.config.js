import globals from "globals";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";

export default defineConfig([
    {
        files: ["**/*.js"],
        plugins: { "@stylistic": stylistic },
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,

                // Foundry VTT v12 globals
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

                // lancer-automations startup scripts
                api: "readonly",

                // Common module globals
                libWrapper: "readonly",
                Sequencer: "readonly",
                Sequence: "readonly",
                MidiQOL: "readonly",
                $: "readonly"
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
            }]
        }
    }
]);
