// Formatting stays the author's call, so CI gates the bug-detection rules only.
import base from "./eslint.config.js";

export default [
    ...base,
    {
        files: ["**/*.js"],
        rules: {
            "no-unused-vars": "off",
            curly: "off",
            "@stylistic/brace-style": "off",
            "@stylistic/nonblock-statement-body-position": "off",
            "@stylistic/indent": "off",
            "@stylistic/semi": "off",
            "@stylistic/no-trailing-spaces": "off",
            "@stylistic/eol-last": "off",
            "@stylistic/max-len": "off",
            "@stylistic/object-property-newline": "off"
        }
    }
];
