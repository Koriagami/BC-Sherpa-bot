const OpenAI = require("openai").default;

const TITLE_PREFIX = "TITLE:";
const DESCRIPTION_PREFIX = "DESCRIPTION:";

/**
 * Use OpenAI to turn a Slack thread into a concise title + description for a Basecamp to-do.
 * Prompt is configurable via config.extractionPrompt.
 */
async function extractIssueFromThread(openai, systemPrompt, model, threadText) {
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
