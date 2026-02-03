#!/usr/bin/env node
/**
 * One-time Basecamp OAuth flow: opens auth URL, captures callback code, exchanges for tokens,
 * and writes basecamp-tokens.json so the bot can use and refresh tokens automatically.
 *
 * Prerequisites: .env with BASECAMP_CLIENT_ID, BASECAMP_CLIENT_SECRET, BASECAMP_REDIRECT_URI
 * (e.g. BASECAMP_REDIRECT_URI=http://localhost:3456/callback)
 *
 * Run: node scripts/basecamp-oauth.js
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");

require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const LAUNCHPAD_AUTH_URL = "https://launchpad.37signals.com/authorization/new";
const LAUNCHPAD_TOKEN_URL = "https://launchpad.37signals.com/authorization/token";
const DEFAULT_TOKEN_FILE = "basecamp-tokens.json";

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

function main() {
  const clientId = getEnv("BASECAMP_CLIENT_ID");
  const clientSecret = getEnv("BASECAMP_CLIENT_SECRET");
  const redirectUri = getEnv("BASECAMP_REDIRECT_URI");

  const authUrl = `${LAUNCHPAD_AUTH_URL}?type=web_server&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch (e) {
    console.error("Invalid BASECAMP_REDIRECT_URI (must be a full URL, e.g. http://localhost:3456/callback):", e.message);
    process.exit(1);
  }
  const port = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
  const pathname = parsed.pathname || "/";

  console.log("1. Open this URL in your browser and authorize the app:\n");
  console.log(authUrl);
  console.log("\n2. After authorizing you will be redirected. This script is listening for that redirect.\n");

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);
    if (reqUrl.pathname !== pathname) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const code = reqUrl.searchParams.get("code");
    if (!code) {
      res.writeHead(400);
      res.end("No code in URL. Did you authorize the app?");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<!DOCTYPE html><html><body><p>Authorization received. You can close this tab and return to the terminal.</p></body></html>"
    );

    try {
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
    } catch (e) {
      console.error("Error exchanging code:", e.message);
    } finally {
      server.close();
      process.exit(0);
    }
  });

  server.listen(port, () => {
    console.log("Listening on", redirectUri);
  });
}

main();
