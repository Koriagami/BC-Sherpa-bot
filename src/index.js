const { App } = require("@slack/bolt");
const OpenAI = require("openai").default;
const { loadConfig } = require("./config");
const {
  fetchThread,
  formatThreadForPrompt,
  postThreadReply,
} = require("./slack");
const { extractIssueFromThread } = require("./openai-extract");
const { createTodo, addSubscribers } = require("./basecamp");
const { resolveBasecampPersonIds } = require("./participants");
const { getValidAccessToken } = require("./basecamp-token");

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

      const threadText = formatThreadForPrompt(messages);
      const { title, description } = await extractIssueFromThread(
        openai,
        config.extractionPrompt,
        config.openai.model,
        threadText
      );

      let completionSubscriberIds;
      if (config.basecamp.addParticipantsAsSubscribers) {
        const uniqueSlackIds = [...new Set(messages.map((m) => m.user))];
        completionSubscriberIds = await resolveBasecampPersonIds(
          client,
          basecampConfig,
          uniqueSlackIds
        );
      }

      const todo = await createTodo(basecampConfig, {
        content: title,
        description,
        completionSubscriberIds,
      });

      if (config.basecamp.addParticipantsAsSubscribers && completionSubscriberIds?.length) {
        try {
          await addSubscribers(
            basecampConfig,
            config.basecamp.projectId,
            todo.id,
            completionSubscriberIds
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

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
