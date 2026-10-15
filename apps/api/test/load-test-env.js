// Tiny, dependency-free loader for apps/api/.env.test — deliberately NOT the general
// `dotenv` package (avoids adding a new dependency for one variable) and deliberately NOT
// shared with apps/api/.env in any way. Only ever reads TEST_DATABASE_URL-shaped lines
// from this one file; never touches process.env.DATABASE_URL directly (that happens only
// in integration-setup-files.js, after the guard has validated the value).
//
// If a variable is already set in the environment (e.g. exported by a shell, or by CI),
// that value wins — this loader never overwrites an explicit existing value, it only
// fills in what's missing from the file.
const fs = require('fs');
const path = require('path');

function loadTestEnvFile() {
  const envPath = path.join(__dirname, '..', '.env.test');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadTestEnvFile };
