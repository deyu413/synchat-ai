module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true // Adding node env for module.exports if used in other JS files
  },
  extends: 'standard',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // Add any specific rule overrides here if necessary
    // For now, mainly concerned with syntax errors
    "no-unused-vars": ["warn", { "vars": "all", "args": "after-used", "ignoreRestSiblings": false, "argsIgnorePattern": "^_" }],
    "no-undef": "error", // Ensures we catch undefined variables, which can be syntax-related
    "no-extra-semi": "error",
    "semi": ["error", "always"],
    "quotes": ["error", "single"],
    "indent": ["error", 4], // Example: Enforce 4-space indentation, adjust as needed
    "comma-dangle": ["error", "always-multiline"],
    "space-before-function-paren": ["error", {
        "anonymous": "always",
        "named": "never",
        "asyncArrow": "always"
    }],
     "padded-blocks": "off", // Turn off padded-blocks warning/error
     "eol-last": ["warn", "always"], // Warn if no newline at EOF
     "no-multiple-empty-lines": ["warn", { "max": 2, "maxEOF": 1, "maxBOF": 0 }], // Warn on multiple empty lines
     "keyword-spacing": ["warn", { "before": true, "after": true }],
     "space-infix-ops": "warn",
     "spaced-comment": "warn",
     "arrow-spacing": "warn",
     "block-spacing": "warn",
     "comma-spacing": "warn",
     "dot-location": ["warn", "property"],
     "func-call-spacing": "warn",
     "key-spacing": "warn",
     "no-trailing-spaces": "warn",
     "object-curly-spacing": ["warn", "always"],
     "semi-spacing": "warn",
     "template-curly-spacing": "warn"

  },
  globals: {
    // If you have global variables (like from a <script> tag in HTML), define them here
    // For example:
    // MyGlobal: 'readonly',
    Chart: 'readonly', // Assuming Chart.js is loaded globally
    window: 'readonly', // Standard browser global
    document: 'readonly', // Standard browser global
    localStorage: 'readonly', // Standard browser global
    fetch: 'readonly', // Standard browser global
    alert: 'readonly', // Standard browser global
    confirm: 'readonly', // Standard browser global
    FormData: 'readonly', // Standard browser global
    console: 'readonly', // Standard browser global
    module: 'writable', // For .eslintrc.js itself
    SYNCHAT_CONFIG: 'readonly' // For the config object
  }
};
