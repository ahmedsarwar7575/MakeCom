const chromium = require("@sparticuz/chromium");

async function main() {
  await chromium.executablePath();
}

main().catch(console.error);