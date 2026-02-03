/**
 * Failsafe for OpenAI usage: per-minute cap + circuit breaker.
 * Prevents runaway usage from bugs (e.g. reaction_added firing in a loop).
 */

const WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_PER_MINUTE = 15;
const DEFAULT_CIRCUIT_FAILURES = 5;
const DEFAULT_CIRCUIT_SECONDS = 120;

let requestTimestamps = [];
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function getOptions() {
  const maxPerMinute = Math.max(1, parseInt(process.env.OPENAI_MAX_REQUESTS_PER_MINUTE || "", 10) || DEFAULT_MAX_PER_MINUTE);
  const circuitFailures = Math.max(1, parseInt(process.env.OPENAI_CIRCUIT_BREAKER_FAILURES || "", 10) || DEFAULT_CIRCUIT_FAILURES);
  const circuitSeconds = Math.max(30, parseInt(process.env.OPENAI_CIRCUIT_BREAKER_SECONDS || "", 10) || DEFAULT_CIRCUIT_SECONDS);
  return { maxPerMinute, circuitFailures, circuitSeconds };
}

/**
 * Returns true if an OpenAI request is allowed (under per-minute cap and circuit closed).
 * When true, the caller should record the request by calling recordSuccess() or recordFailure() after the call.
 */
function allow() {
  const now = Date.now();
  const { maxPerMinute, circuitFailures, circuitSeconds } = getOptions();

  if (now < circuitOpenUntil) {
    return { allowed: false, reason: "circuit_open", retryAfterSeconds: Math.ceil((circuitOpenUntil - now) / 1000) };
  }

  const cutoff = now - WINDOW_MS;
  requestTimestamps = requestTimestamps.filter((t) => t > cutoff);
  if (requestTimestamps.length >= maxPerMinute) {
    const oldestInWindow = Math.min(...requestTimestamps);
    return { allowed: false, reason: "rate_limit", retryAfterSeconds: Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000) };
  }

  requestTimestamps.push(now);
  return { allowed: true };
}

/**
 * Call after a successful OpenAI request. Resets circuit breaker failure count.
 */
function recordSuccess() {
  consecutiveFailures = 0;
}

/**
 * Call after a failed OpenAI request. Opens circuit after N consecutive failures.
 */
function recordFailure() {
  consecutiveFailures += 1;
  const { circuitFailures, circuitSeconds } = getOptions();
  if (consecutiveFailures >= circuitFailures) {
    circuitOpenUntil = Date.now() + circuitSeconds * 1000;
    console.warn(
      `OpenAI circuit breaker open: ${consecutiveFailures} consecutive failures. No OpenAI calls for ${circuitSeconds}s.`
    );
  }
}

module.exports = {
  allow,
  recordSuccess,
  recordFailure,
};
