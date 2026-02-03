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
const channelBindings = require("./channel-bindings");

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
  const bindingsPath = config.basecamp.channelBindingsPath;

  function resolveProjectAndTodolist(channelId) {
    const binding = channelBindings.get(channelId, bindingsPath);
    if (binding?.projectId && binding?.todolistId) return binding;
    if (config.basecamp.projectId && config.basecamp.todolistId) {
      return { projectId: config.basecamp.projectId, todolistId: config.basecamp.todolistId };
    }
    return null;
  }

  function getBasecampConfigForChannel(channelId) {
    const resolved = resolveProjectAndTodolist(channelId);
    if (!resolved) return null;
    return {
      accountId: config.basecamp.accountId,
      projectId: resolved.projectId,
      todolistId: resolved.todolistId,
      getAccessToken: (opts) => getValidAccessToken(tokenOptions, opts || {}),
    };
  }

  const BIND_INSTRUCTIONS =
    "This channel isn't bound to a Basecamp project. Use `/sherpa bind <project_id> <todolist_id>` in this channel to bind it, or set BASECAMP_PROJECT_ID and BASECAMP_TODOLIST_ID in .env as default.";

  slackApp.command("/sherpa", async ({ command, ack, client }) => {
    try {
      await ack();
    } catch (ackErr) {
      console.error("Slash command ack failed:", ackErr);
      return;
    }
    try {
      const text = (command.text || "").trim();
      const channelId = command.channel_id;
      const args = text.split(/\s+/).filter(Boolean);

      if (args[0] === "bind" && args.length >= 3) {
        const [, projectId, todolistId] = args;
        channelBindings.set(channelId, { projectId, todolistId }, bindingsPath);
        await client.chat.postEphemeral({
          channel: channelId,
          user: command.user_id,
          text: `This channel is now bound to Basecamp project \`${projectId}\` and to-do list \`${todolistId}\`. React with :${config.triggerEmoji}: on a thread to extract issues there.`,
        });
        return;
      }

      if (args[0] === "unbind") {
        channelBindings.unset(channelId, bindingsPath);
        await client.chat.postEphemeral({
          channel: channelId,
          user: command.user_id,
          text: "Channel binding removed. Use `/sherpa bind <project_id> <todolist_id>` to bind again, or set BASECAMP_PROJECT_ID and BASECAMP_TODOLIST_ID in .env as default.",
        });
        return;
      }

      const current = resolveProjectAndTodolist(channelId);
      const help = current
        ? `This channel uses project \`${current.projectId}\`, to-do list \`${current.todolistId}\` (${channelBindings.get(channelId, bindingsPath) ? "channel binding" : "env default"}).`
        : BIND_INSTRUCTIONS;
      await client.chat.postEphemeral({
        channel: channelId,
        user: command.user_id,
        text: `*BC-Sherpa commands*\n• \`/sherpa bind <project_id> <todolist_id>\` – bind this channel to a BC project and to-do list\n• \`/sherpa unbind\` – remove channel binding\n• \`/sherpa\` – show this help\n\n${help}`,
      });
    } catch (err) {
      console.error("Slash command /sherpa failed:", err);
      try {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
        });
      } catch (e) {
        console.error("Could not post error to user:", e);
      }
    }
  });

  slackApp.event("reaction_added", async ({ event, client }) => {
    if (event.reaction !== config.triggerEmoji) return;
    if (event.item.type !== "message") return;

    const channelId = event.item.channel;
    const messageTs = event.item.ts;

    if (!channelId || !messageTs) return;

    const basecampConfig = getBasecampConfigForChannel(channelId);
    if (!basecampConfig) {
      try {
        await postThreadReply(client, channelId, messageTs, BIND_INSTRUCTIONS);
      } catch (e) {
        console.warn("Could not post bind-instructions reply:", e);
      }
      return;
    }
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

      let descriptionForBc = escapeHtml(description);
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
      descriptionForBc = descriptionForBc.replace(/\n/g, "<br>");

      const todo = await createTodo(basecampConfig, {
        content: title,
        description: descriptionForBc,
      });

      if (config.basecamp.addParticipantsAsSubscribers && participantIds?.length) {
        try {
          await addSubscribers(
            basecampConfig,
            basecampConfig.projectId,
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
