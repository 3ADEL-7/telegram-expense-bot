const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT_DIR, ".env");

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) {
    return;
  }

  const content = fs.readFileSync(ENV_FILE, "utf8");
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const config = {
  botToken: process.env.BOT_TOKEN,
  timezone: process.env.BOT_TIMEZONE || "Asia/Riyadh",
  dataDir: path.join(ROOT_DIR, "data"),
  dataFile: path.join(ROOT_DIR, "data", "expenses.json"),
  pollingTimeoutSeconds: 30
};

function validateConfig() {
  if (!config.botToken) {
    throw new Error("BOT_TOKEN is missing. Open .env and add your Telegram bot token.");
  }
}

module.exports = {
  config,
  validateConfig
};
