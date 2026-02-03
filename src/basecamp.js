const BASECAMP_BASE = "https://3.basecampapi.com";
const USER_AGENT = "BC-Sherpa-bot (https://github.com/your-org/BC-Sherpa-bot)";

async function getToken(config) {
  if (typeof config.getAccessToken === "function") {
    return config.getAccessToken();
  }
  return config.accessToken;
}

async function basecampFetch(config, path, options = {}, retried401 = false) {
  const token = await getToken(config);
  const url = `${BASECAMP_BASE}/${config.accountId}${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 401 && typeof config.getAccessToken === "function" && !retried401) {
    await config.getAccessToken({ forceRefresh: true });
    return basecampFetch(config, path, options, true);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Basecamp API ${res.status}: ${res.statusText} – ${body.slice(0, 500)}`
    );
  }
  return res;
}

/**
 * Create a to-do in the configured project/todolist.
 */
async function createTodo(config, params) {
  const body = {
    content: params.content,
    description: params.description ?? "",
  };
  if (params.assigneeIds?.length) {
    body.assignee_ids = params.assigneeIds;
  }

  const res = await basecampFetch(
    config,
    `/buckets/${config.projectId}/todolists/${config.todolistId}/todos.json`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );

  const data = await res.json();

  return {
    id: data.id,
    appUrl: data.app_url,
    subscriptionUrl: data.subscription_url,
  };
}

/**
 * Add subscribers to a recording (e.g. the new to-do) by person IDs.
 */
async function addSubscribers(config, bucketId, recordingId, personIds) {
  if (personIds.length === 0) return;

  await basecampFetch(
    config,
    `/buckets/${bucketId}/recordings/${recordingId}/subscription.json`,
    {
      method: "PUT",
      body: JSON.stringify({ subscriptions: personIds }),
    }
  );
}

/**
 * List people in the Basecamp account (for optional Slack→BC participant mapping).
 */
async function listPeople(config) {
  const res = await basecampFetch(config, "/people.json");
  return res.json();
}

module.exports = {
  createTodo,
  addSubscribers,
  listPeople,
};
