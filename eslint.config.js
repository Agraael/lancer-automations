import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
    {
        files: ["**/*.js"],
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

            // ── Formatting ─────────────────────────────────────────────────────────
            indent: ["error", 4],
            semi: ["error", "always"],
            curly: "off",
            "nonblock-statement-body-position": ["error", "below"],
            "brace-style": ["error", "1tbs"],
            "no-trailing-spaces": "error",
            "eol-last": ["error", "always"],

            "max-len": ["error", {
                code: 300,
                ignoreComments: true,
                ignoreUrls: true,
                ignoreStrings: true,
                ignoreTemplateLiterals: true
            }],

            "object-property-newline": ["error", {
                allowAllPropertiesOnSameLine: true
            }]
        }
    }
]);
