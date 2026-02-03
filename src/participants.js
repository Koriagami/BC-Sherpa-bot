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
    bcPeople
      .filter((p) => p.email_address != null && String(p.email_address).trim() !== "")
      .map((p) => [String(p.email_address).toLowerCase().trim(), p.id])
  );
  const result = [];

  for (const slackUserId of slackUserIds) {
    try {
      const r = await slackClient.users.info({ user: slackUserId });
      const email = r.user?.profile?.email;
      if (email != null && String(email).trim() !== "") {
        const bcId = emailToId.get(String(email).toLowerCase().trim());
        if (bcId && !result.includes(bcId)) result.push(bcId);
      }
    } catch {
      // Skip if we can't resolve (e.g. no email scope)
    }
  }

  return result;
}

/**
 * Resolve a single Slack user to the matching Basecamp person (by email).
 * Returns { id, attachable_sgid, name } for use in a BC mention, or null.
 */
async function resolveBasecampPersonForSlackUser(slackClient, basecampConfig, slackUserId) {
  const ids = await resolveBasecampPersonIds(slackClient, basecampConfig, [slackUserId]);
  if (ids.length === 0) return null;

  let bcPeople = cache.get(basecampConfig.accountId);
  if (!bcPeople) {
    bcPeople = await listPeople(basecampConfig);
    cache.set(basecampConfig.accountId, bcPeople);
  }
  const person = bcPeople.find((p) => p.id === ids[0]);
  if (!person || !person.attachable_sgid) return null;
  return {
    id: person.id,
    attachable_sgid: person.attachable_sgid,
    name: person.name ?? "Someone",
  };
}

module.exports = { resolveBasecampPersonIds, resolveBasecampPersonForSlackUser };
