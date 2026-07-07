// Entry point. Some hosts (incl. Catalyst AppSail defaults) launch the app with
// `node index.js` or `node .` from package.json "main" rather than `npm start`.
// This makes every one of those launch the HTTP server.
require("./scripts/runPromptUi.js")
