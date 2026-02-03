#!/usr/bin/env node
/**
 * One-time Basecamp OAuth flow: starts a local server, opens the auth URL in your browser,
 * captures the redirect, exchanges the code for tokens, and writes basecamp-tokens.json.
 * After that, the bot refreshes tokens automatically (no more browser).
 *
 * 37signals does not support a fully non-interactive flow (no client credentials).
 * You must authorize once in the browser (log in + click Allow). Then everything is automatic.
 *
 * Prerequisites: .env with BASECAMP_CLIENT_ID, BASECAMP_CLIENT_SECRET, BASECAMP_REDIRECT_URI
 * (e.g. BASECAMP_REDIRECT_URI=http://localhost:3456/callback)
 *
 * Run: npm run basecamp-oauth
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { URL } = require("url");

require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const LAUNCHPAD_AUTH_URL = "https://launchpad.37signals.com/authorization/new";
const LAUNCHPAD_TOKEN_URL = "https://launchpad.37signals.com/authorization/token";
const DEFAULT_TOKEN_FILE = "basecamp-tokens.json";
const LISTEN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function getEnv(key) {
  const v = process.env[key];
  if (!v || v === "") {
    console.error(`Missing: ${key}`);
    process.exit(1);
  }
  return v;
}

async function exchangeCode(clientId, clientSecret, redirectUri, code) {
  const url = `${LAUNCHPAD_TOKEN_URL}?type=web_server&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`;
  const res = await fetch(url, { method: "POST" });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} – ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

async function exchangeAndSaveTokens(clientId, clientSecret, redirectUri, code) {
  const data = await exchangeCode(clientId, clientSecret, redirectUri, code);
  const expiresIn = data.expires_in != null ? Number(data.expires_in) : 14 * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const tokenPath = path.resolve(process.cwd(), process.env.BASECAMP_TOKEN_FILE || DEFAULT_TOKEN_FILE);
  const payload = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: expiresAt,
  };
  fs.writeFileSync(tokenPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log("Tokens saved to", tokenPath);
  console.log("You can now start the bot. It will refresh the token automatically when it expires.");
}

function extractCodeFromPastedInput(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("code=")) return null;
  try {
    const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(trimmed, "http://localhost");
    return url.searchParams.get("code");
  } catch {
    return null;
  }
}

function main() {
  const clientId = getEnv("BASECAMP_CLIENT_ID");
  const clientSecret = getEnv("BASECAMP_CLIENT_SECRET");
  const redirectUri = getEnv("BASECAMP_REDIRECT_URI");

  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch (e) {
    console.error("Invalid BASECAMP_REDIRECT_URI (must be a full URL, e.g. http://localhost:3456/callback):", e.message);
    process.exit(1);
  }
  if (parsed.protocol === "https:") {
    console.error(
      "BASECAMP_REDIRECT_URI must use http (this script cannot serve HTTPS). Use:\n  BASECAMP_REDIRECT_URI=http://localhost:3456/callback\nand register that exact URL in your app at launchpad.37signals.com."
    );
    process.exit(1);
  }
  const port = parsed.port ? parseInt(parsed.port, 10) : 80;
  const pathname = parsed.pathname || "/";

  const authUrl = `${LAUNCHPAD_AUTH_URL}?type=web_server&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  console.log("Starting local server and opening the authorization page in your browser...\n");

  const openBrowser = () => {
    try {
      const open = require("open");
      open(authUrl).catch(() => {});
    } catch (e) {
      console.log("Open this URL in your browser:", authUrl);
    }
  };

  console.log("After you log in (if needed) and click Allow, the script will receive the redirect and save tokens.");
  console.log("If the browser didn't open or the redirect fails, paste the redirect URL here (or run again).");
  console.log(`(Timeout: ${LISTEN_TIMEOUT_MS / 60000} minutes)\n`);

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    server.close();
    if (rl) rl.close();
  }

  async function handleCode(code) {
    finish();
    try {
      await exchangeAndSaveTokens(clientId, clientSecret, redirectUri, code);
    } catch (e) {
      console.error("Error exchanging code:", e.message);
      process.exit(1);
    }
    process.exit(0);
  }

  let timeoutId;
  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);
    if (reqUrl.pathname !== pathname) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const code = reqUrl.searchParams.get("code");
    const oauthError = reqUrl.searchParams.get("error");
    const oauthErrorDesc = reqUrl.searchParams.get("error_description");

    if (!code) {
      const msg = oauthError
        ? `OAuth error: ${oauthError}${oauthErrorDesc ? " – " + oauthErrorDesc : ""}`
        : "No code in URL. Did you click Allow/Authorize? If the redirect URI in .env doesn't match launchpad.37signals.com exactly, 37signals may redirect without a code.";
      console.error(msg);
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><body><p>${msg.replace(/</g, "&lt;")}</p><p>Check the terminal for details. Fix .env and launchpad redirect URI, then run the script again.</p></body></html>`
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<!DOCTYPE html><html><body><p>Authorization received. You can close this tab and return to the terminal.</p></body></html>"
    );
    await handleCode(code);
  });

  server.listen(port, () => {
    console.log("Listening on", redirectUri);
    openBrowser();
  });

  timeoutId = setTimeout(() => {
    if (done) return;
    finish();
    console.error("Timed out waiting for redirect. Run the script again and complete authorization within 5 minutes, or paste the redirect URL when prompted.");
    process.exit(1);
  }, LISTEN_TIMEOUT_MS);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", (line) => {
    if (done) return;
    const code = extractCodeFromPastedInput(line);
    if (code) {
      handleCode(code);
    }
  });
}

main();
