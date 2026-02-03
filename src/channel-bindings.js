const fs = require("fs");
const path = require("path");

const DEFAULT_PATH = path.resolve(process.cwd(), "channel-bindings.json");

/**
 * Load channel -> { projectId, todolistId } bindings from disk.
 */
function load(filePath = DEFAULT_PATH) {
  const p = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(p)) return {};
  try {
    const data = fs.readFileSync(p, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.warn("channel-bindings: could not load", p, e.message);
    return {};
  }
}

/**
 * Save bindings to disk.
 */
function save(bindings, filePath = DEFAULT_PATH) {
  const p = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  fs.writeFileSync(p, JSON.stringify(bindings, null, 2), "utf-8");
}

/**
 * Get binding for a Slack channel ID. Returns { projectId, todolistId } or null.
 */
function get(channelId, filePath = DEFAULT_PATH) {
  const bindings = load(filePath);
  const b = bindings[channelId];
  return b && b.projectId && b.todolistId ? b : null;
}

/**
 * Bind a channel to a Basecamp project and to-do list.
 */
function set(channelId, { projectId, todolistId }, filePath = DEFAULT_PATH) {
  const bindings = load(filePath);
  bindings[channelId] = { projectId: String(projectId), todolistId: String(todolistId) };
  save(bindings, filePath);
  return bindings[channelId];
}

/**
 * Remove binding for a channel.
 */
function unset(channelId, filePath = DEFAULT_PATH) {
  const bindings = load(filePath);
  delete bindings[channelId];
  save(bindings, filePath);
}

module.exports = { load, save, get, set, unset, DEFAULT_PATH };
