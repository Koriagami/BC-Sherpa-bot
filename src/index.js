const { App } = require("@slack/bolt");
const OpenAI = require("openai").default;
const { loadConfig } = require("./config");
const {
  fetchThread,
  formatThreadForPrompt,
  postThreadReply,
  getMessagePermalink,
} = require("./slack");
const { extractIssueFromThread } = require("./openai-extract");
const { createTodo, addSubscribers } = require("./basecamp");
const { resolveBasecampPersonIds, resolveBasecampPersonForSlackUser } = require("./participants");
const { getValidAccessToken } = require("./basecamp-token");
const openaiThrottle = require("./openai-throttle");

async function run() {
  const config = loadConfig();

  const slackApp = new App({
    token: config.slack.botToken,
    signingSecret: config.slack.signingSecret,
    socketMode: true,
    appToken: config.slack.appToken,
  });

  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const tokenOptions = {
    clientId: config.basecamp.clientId || undefined,
    clientSecret: config.basecamp.clientSecret || undefined,
    tokenFilePath: config.basecamp.tokenFilePath,
  };
  const basecampConfig = {
    accountId: config.basecamp.accountId,
    projectId: config.basecamp.projectId,
    todolistId: config.basecamp.todolistId,
    getAccessToken: (opts) => getValidAccessToken(tokenOptions, opts || {}),
  };

  slackApp.event("reaction_added", async ({ event, client }) => {
    if (event.reaction !== config.triggerEmoji) return;
    if (event.item.type !== "message") return;

    const channelId = event.item.channel;
    const messageTs = event.item.ts;

    if (!channelId || !messageTs) return;

    let statusMessageTs;

    try {
      statusMessageTs = await postThreadReply(
        client,
        channelId,
        messageTs,
        "Extracting issue to Basecamp…"
      );

      const messages = await fetchThread(client, channelId, messageTs);
      if (messages.length === 0) {
        await updateOrPost(client, channelId, messageTs, statusMessageTs, "Could not read thread messages.");
        return;
      }

      const throttleResult = openaiThrottle.allow();
      if (!throttleResult.allowed) {
        const msg =
          throttleResult.reason === "circuit_open"
            ? `OpenAI temporarily paused after repeated failures. Try again in ${throttleResult.retryAfterSeconds}s.`
            : `Too many OpenAI requests; try again in ${throttleResult.retryAfterSeconds}s.`;
        await updateOrPost(client, channelId, messageTs, statusMessageTs, msg);
        return;
      }

      const threadText = formatThreadForPrompt(messages);
      let title, description;
      try {
        const extracted = await extractIssueFromThread(
          openai,
          config.extractionPrompt,
          config.openai.model,
          threadText
        );
        openaiThrottle.recordSuccess();
        title = extracted.title;
        description = extracted.description;
      } catch (extractErr) {
        openaiThrottle.recordFailure();
        throw extractErr;
      }

      let participantIds;
      if (config.basecamp.addParticipantsAsSubscribers) {
        const uniqueSlackIds = [...new Set(messages.map((m) => m.user))];
        participantIds = await resolveBasecampPersonIds(
          client,
          basecampConfig,
          uniqueSlackIds
        );
      }

      let descriptionForBc = description;
      const reporterSlackId = messages[0]?.user;
      const reporterBc = reporterSlackId
        ? await resolveBasecampPersonForSlackUser(client, basecampConfig, reporterSlackId)
        : null;
      if (reporterBc) {
        descriptionForBc = descriptionForBc.replace(
          /Reported by (.+?) in Slack/,
          (_, _name) =>
            `Reported by <bc-mention sgid="${reporterBc.attachable_sgid}">${escapeHtml(reporterBc.name)}</bc-mention> in Slack`
        );
      }
      const permalink = await getMessagePermalink(client, channelId, messageTs);
      if (permalink && descriptionForBc.includes(" in Slack")) {
        descriptionForBc = descriptionForBc.replace(/ in Slack/, ` in <a href="${permalink}">Slack</a>`);
      }

      const todo = await createTodo(basecampConfig, {
        content: title,
        description: descriptionForBc,
      });

      if (config.basecamp.addParticipantsAsSubscribers && participantIds?.length) {
        try {
          await addSubscribers(
            basecampConfig,
            config.basecamp.projectId,
            todo.id,
            participantIds
          );
        } catch (e) {
          console.warn("Failed to add subscribers to BC task:", e);
        }
      }

      const reply = `Issue was extracted to Basecamp: ${todo.appUrl}`;
      await updateOrPost(client, channelId, messageTs, statusMessageTs, reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Basecamp extraction failed:", err);
      try {
        await updateOrPost(
          client,
          channelId,
          messageTs,
          statusMessageTs,
          `Failed to extract to Basecamp: ${message.slice(0, 200)}`
        );
      } catch (e) {
        console.error("Could not post error reply:", e);
      }
    }
  });

  await slackApp.start();
  console.log("BC-Sherpa bot is running (Socket Mode). React with :" + config.triggerEmoji + ": to extract to Basecamp.");
}

async function updateOrPost(client, channelId, threadTs, statusMessageTs, text) {
  if (statusMessageTs) {
    try {
      await client.chat.update({ channel: channelId, ts: statusMessageTs, text });
      return;
    } catch {
      // Fall back to new message
    }
  }
  const lastTs = await getLastBotReplyTs(client, channelId, threadTs);
  if (lastTs) {
    try {
      await client.chat.update({ channel: channelId, ts: lastTs, text });
      return;
    } catch {
      // Fall back to new message
    }
  }
  await postThreadReply(client, channelId, threadTs, text);
}

async function getLastBotReplyTs(client, channelId, threadTs) {
  const result = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 50,
  });
  const messages = result.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.bot_id && m.ts) return m.ts;
  }
  return null;
}

function escapeHtml(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
