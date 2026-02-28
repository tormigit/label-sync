const fs = require("fs");
const path = require("path");

const outFile = path.join(__dirname, "..", "dist", "index.js");

if (!fs.existsSync(outFile)) {
  process.exit(0);
}

const raw = fs.readFileSync(outFile, "utf8");

if (raw.startsWith("#!/usr/bin/env node")) {
  process.exit(0);
}

fs.writeFileSync(outFile, `#!/usr/bin/env node\n\n${raw}`, "utf8");
