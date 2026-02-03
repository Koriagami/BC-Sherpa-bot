const fs = require("fs");
const path = require("path");

const DEFAULT_EXTRACTION_PROMPT = `You are given a Slack thread where someone reported an issue. Your job is to extract only the core information about the problem and format it for a Basecamp to-do.

Rules:
- Ignore off-topic chatter, thanks, "following", "+1", and social filler.
- Output exactly two sections in plain text, no markdown headers:
  1. TITLE: A single short line (under ~80 chars) summarizing the issue for the to-do title.
  2. DESCRIPTION: Must follow this structure exactly. Use the display name of the person who posted the original (first) message for "Reported by ... in Slack". The word "Slack" will be turned into a link by the system; do not add a URL yourself.

DESCRIPTION structure (copy this structure and fill in; skip optional sections if information is insufficient):

Reported by [display name of person who reported] in Slack

[Main issue description - mandatory. One or more brief, clear paragraphs describing the issue.]

Steps:
1) [step one]
2) [step two]
...
[Optional: numbered list of steps to reproduce. Include only if clear from the thread; otherwise omit the entire Steps section.]

Expected result: [Optional: brief description of expected result. Omit if unavailable.]

Actual result: [Optional: brief description of actual result. Omit if unavailable.]

Important comments:
- [Optional: bullet list of important clues, follow-ups, or context from the thread. Omit section if none.]`;

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    require("dotenv").config({ path: envPath });
  }
}

function getEnv(key) {
  const v = process.env[key];
  if (v == null || v === "") {
    throw new Error(`Missing required env: ${key}`);
  }
  return v;
}

function getEnvOptional(key, defaultValue) {
  return process.env[key] ?? defaultValue;
}

function loadExtractionPrompt() {
  const promptPath = process.env.EXTRACTION_PROMPT_FILE;
  if (promptPath) {
    const fullPath = path.isAbsolute(promptPath)
      ? promptPath
      : path.resolve(process.cwd(), promptPath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, "utf-8").trim();
    }
  }
  return DEFAULT_EXTRACTION_PROMPT;
}

function loadConfig() {
  loadEnv();

  return {
    slack: {
      botToken: getEnv("SLACK_BOT_TOKEN"),
      signingSecret: getEnv("SLACK_SIGNING_SECRET"),
      appToken: getEnv("SLACK_APP_TOKEN"),
    },
    triggerEmoji: getEnvOptional("TRIGGER_EMOJI", "basecamp"),
    openai: {
      apiKey: getEnv("OPENAI_API_KEY"),
      model: getEnvOptional("OPENAI_MODEL", "gpt-4o-mini"),
    },
    basecamp: {
      accountId: getEnv("BASECAMP_ACCOUNT_ID"),
      accessToken: getEnvOptional("BASECAMP_ACCESS_TOKEN", ""),
      projectId: getEnv("BASECAMP_PROJECT_ID"),
      todolistId: getEnv("BASECAMP_TODOLIST_ID"),
      addParticipantsAsSubscribers: getEnvOptional(
        "BASECAMP_ADD_PARTICIPANTS_AS_SUBSCRIBERS",
        "false"
      ).toLowerCase() === "true",
      clientId: getEnvOptional("BASECAMP_CLIENT_ID", ""),
      clientSecret: getEnvOptional("BASECAMP_CLIENT_SECRET", ""),
      tokenFilePath: getEnvOptional("BASECAMP_TOKEN_FILE", "basecamp-tokens.json"),
    },
    extractionPrompt: loadExtractionPrompt(),
  };
}

module.exports = { loadConfig };
