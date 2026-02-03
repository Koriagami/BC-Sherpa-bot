const fs = require("fs");
const path = require("path");

const LAUNCHPAD_TOKEN_URL = "https://launchpad.37signals.com/authorization/token";
const DEFAULT_TOKEN_FILE = "basecamp-tokens.json";
const EXPIRY_BUFFER_SECONDS = 5 * 60; // refresh 5 min before expiry

/**
 * Load tokens from file or env. Returns { accessToken, refreshToken?, expiresAt? } or null.
 */
function loadTokens(options) {
  const tokenPath = options.tokenFilePath
    ? path.resolve(process.cwd(), options.tokenFilePath)
    : path.resolve(process.cwd(), DEFAULT_TOKEN_FILE);

  if (fs.existsSync(tokenPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
      if (data.access_token) {
        return {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null,
          expiresAt: data.expires_at || null,
        };
      }
    } catch (e) {
      console.warn("Basecamp token file read failed:", e.message);
    }
  }

  const accessToken = process.env.BASECAMP_ACCESS_TOKEN;
  const refreshToken = process.env.BASECAMP_REFRESH_TOKEN || null;
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: null, // env doesn't store expiry; we'll refresh on 401 if we have refresh_token
  };
}

/**
 * Save tokens to file.
 */
function saveTokens(options, data) {
  const tokenPath = options.tokenFilePath
    ? path.resolve(process.cwd(), options.tokenFilePath)
    : path.resolve(process.cwd(), DEFAULT_TOKEN_FILE);
  fs.writeFileSync(
    tokenPath,
    JSON.stringify(
      {
        access_token: data.accessToken,
        refresh_token: data.refreshToken || undefined,
        expires_at: data.expiresAt || undefined,
      },
      null,
      2
    ),
    "utf-8"
  );
}

/**
 * Call 37signals token endpoint to refresh. Returns { accessToken, refreshToken, expiresAt }.
 */
async function refreshTokens(options) {
  const { clientId, clientSecret } = options;
  if (!clientId || !clientSecret) {
    throw new Error("BASECAMP_CLIENT_ID and BASECAMP_CLIENT_SECRET required for token refresh");
  }
  const current = loadTokens(options);
  if (!current?.refreshToken) {
    throw new Error("No refresh token available (set BASECAMP_REFRESH_TOKEN or use token file)");
  }

  const url = `${LAUNCHPAD_TOKEN_URL}?type=refresh&refresh_token=${encodeURIComponent(current.refreshToken)}&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
  const res = await fetch(url, { method: "POST" });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Basecamp token refresh failed: ${res.status} – ${body.slice(0, 300)}`);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Basecamp token refresh: invalid JSON response");
  }
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token || current.refreshToken;
  const expiresIn = data.expires_in != null ? Number(data.expires_in) : 14 * 24 * 60 * 60; // default 2 weeks
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Returns a valid access token, refreshing if necessary. Uses token file or env.
 * options: { clientId?, clientSecret?, tokenFilePath? }
 * opts: { forceRefresh?: boolean } - set true after 401 to force a refresh and retry
 */
async function getValidAccessToken(options = {}, opts = {}) {
  const tokens = loadTokens(options);
  if (!tokens) {
    throw new Error(
      "No Basecamp token. Set BASECAMP_ACCESS_TOKEN in .env or run: node scripts/basecamp-oauth.js"
    );
  }

  const now = Date.now();
  const expiresAt = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : null;
  const shouldRefresh =
    opts.forceRefresh ||
    (options.clientId &&
      options.clientSecret &&
      tokens.refreshToken &&
      (expiresAt == null || expiresAt - EXPIRY_BUFFER_SECONDS * 1000 <= now));

  if (shouldRefresh && options.clientId && options.clientSecret && tokens.refreshToken) {
    try {
      const refreshed = await refreshTokens(options);
      saveTokens(options, refreshed);
      return refreshed.accessToken;
    } catch (e) {
      if (tokens.accessToken && !expiresAt) {
        return tokens.accessToken;
      }
      throw e;
    }
  }

  return tokens.accessToken;
}

module.exports = {
  loadTokens,
  saveTokens,
  refreshTokens,
  getValidAccessToken,
};
