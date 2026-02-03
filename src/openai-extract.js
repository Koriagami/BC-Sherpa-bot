const OpenAI = require("openai").default;

const TITLE_PREFIX = "TITLE:";
const DESCRIPTION_PREFIX = "DESCRIPTION:";
const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Use OpenAI to turn a Slack thread into a concise title + description for a Basecamp to-do.
 * Prompt is configurable via config.extractionPrompt.
 * Retries on 429 (rate limit) with exponential backoff.
 */
async function extractIssueFromThread(openai, systemPrompt, model, threadText) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Slack thread:\n\n${threadText}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content?.trim() ?? "";
      if (!content) {
        throw new Error("OpenAI returned empty content");
      }

      return parseExtractionOutput(content);
    } catch (err) {
      lastError = err;
      const status = err.status ?? err.statusCode;
      const isQuotaExceeded = err.code === "insufficient_quota" || err.error?.code === "insufficient_quota";
      if (status === 429 && isQuotaExceeded) {
        throw new Error(
          "OpenAI quota exceeded. Add payment at platform.openai.com or wait for free-tier reset. Retrying won't help."
        );
      }
      const isRateLimit = status === 429 || (err.message && /rate limit|429/i.test(err.message));
      if (!isRateLimit || attempt === MAX_RETRIES - 1) {
        throw err;
      }
      const raw = err.headers?.["retry-after"] ?? err.headers?.["Retry-After"] ?? (typeof err.headers?.get === "function" ? err.headers.get("retry-after") : null);
      const waitMs = raw ? Math.min(Number(raw) * 1000, 60000) : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(`OpenAI rate limit (429), retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function parseExtractionOutput(content) {
  const lines = content.split("\n");
  let title = "";
  let description = "";
  let inDescription = false;
  const descriptionLines = [];

  for (const line of lines) {
    const t = line.trim();
    if (t.toUpperCase().startsWith(TITLE_PREFIX)) {
      title = t.slice(TITLE_PREFIX.length).trim();
      inDescription = false;
    } else if (t.toUpperCase().startsWith(DESCRIPTION_PREFIX)) {
      const rest = t.slice(DESCRIPTION_PREFIX.length).trim();
      if (rest) descriptionLines.push(rest);
      inDescription = true;
    } else if (inDescription && t) {
      descriptionLines.push(t);
    } else if (!title && t) {
      title = t.slice(0, 200);
    }
  }

  description = descriptionLines.join("\n").trim() || "No description extracted.";
  if (!title) title = "Issue from Slack";

  return { title: title.slice(0, 255), description };
}

module.exports = { extractIssueFromThread };
