const { listPeople } = require("./basecamp");

const cache = new Map();

/**
 * Get Basecamp person IDs for the given Slack user IDs by matching email.
 * Requires Slack users:read.email scope to get emails.
 */
async function resolveBasecampPersonIds(slackClient, basecampConfig, slackUserIds) {
  if (slackUserIds.length === 0) return [];

  let bcPeople = cache.get(basecampConfig.accountId);
  if (!bcPeople) {
    bcPeople = await listPeople(basecampConfig);
    cache.set(basecampConfig.accountId, bcPeople);
  }

  const emailToId = new Map(
    bcPeople.map((p) => [p.email_address.toLowerCase().trim(), p.id])
  );
  const result = [];

  for (const slackUserId of slackUserIds) {
    try {
      const r = await slackClient.users.info({ user: slackUserId });
      const email = r.user?.profile?.email;
      if (email) {
        const bcId = emailToId.get(email.toLowerCase().trim());
        if (bcId && !result.includes(bcId)) result.push(bcId);
      }
    } catch {
      // Skip if we can't resolve (e.g. no email scope)
    }
  }

  return result;
}

module.exports = { resolveBasecampPersonIds };
