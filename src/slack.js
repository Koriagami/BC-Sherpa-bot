/**
 * Fetch the parent message and all replies in a thread.
 * Returns messages in chronological order (parent first, then replies).
 */
async function fetchThread(client, channelId, threadTs) {
  const result = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 200,
  });

  if (!result.messages || result.messages.length === 0) {
    return [];
  }

  const messages = [];
  const userIds = new Set();

  for (const msg of result.messages) {
    if (msg.user && msg.text) {
      userIds.add(msg.user);
      messages.push({
        user: msg.user,
        text: msg.text,
        ts: msg.ts ?? "",
        displayName: undefined,
      });
    }
  }

  if (userIds.size > 0) {
    const names = await resolveUserNames(client, [...userIds]);
    for (const m of messages) {
      m.displayName = names.get(m.user);
    }
  }

  return messages;
}

async function resolveUserNames(client, userIds) {
  const map = new Map();
  for (const id of userIds) {
    try {
      const r = await client.users.info({ user: id });
      const name = r.user?.real_name ?? r.user?.name ?? id;
      map.set(id, name);
    } catch {
      map.set(id, id);
    }
  }
  return map;
}

/**
 * Format thread messages as a single text block for the LLM.
 */
function formatThreadForPrompt(messages) {
  return messages
    .map((m) => {
      const who = m.displayName ?? m.user;
      return `[${who}]: ${m.text}`;
    })
    .join("\n\n");
}

/**
 * Post a reply in the thread. Returns the message ts so it can be updated later.
 */
async function postThreadReply(client, channelId, threadTs, text) {
  const result = await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text,
  });
  return result.ts;
}

module.exports = {
  fetchThread,
  formatThreadForPrompt,
  postThreadReply,
};
