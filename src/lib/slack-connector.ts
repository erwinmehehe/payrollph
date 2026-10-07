const SLACK_API_ROOT = "https://slack.com/api";
const REQUEST_TIMEOUT_MS = 8_000;

export type SlackConnectorConfig = {
  defaultChannelId: string;
  allowedChannelIds: string[];
};

function slackRequestHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

export function normalizeSlackChannelIds(value: unknown) {
  if (!Array.isArray(value)) return null;
  const channels = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (channels.length < 1 || channels.length > 50) return null;
  if (channels.some((channel) => !/^[CGD][A-Z0-9]{6,20}$/.test(channel))) return null;
  return channels;
}

export function validateSlackBotToken(token: string) {
  return /^xoxb-[A-Za-z0-9-]{20,}$/.test(token.trim());
}

export function normalizeSlackConnectorConfig(value: unknown): SlackConnectorConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const allowedChannelIds = normalizeSlackChannelIds(row.allowedChannelIds);
  const defaultChannelId = String(row.defaultChannelId ?? "").trim();
  if (!allowedChannelIds || !allowedChannelIds.includes(defaultChannelId)) return null;
  return { defaultChannelId, allowedChannelIds };
}

async function slackApi(token: string, method: "auth.test" | "chat.postMessage", body?: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SLACK_API_ROOT}/${method}`, {
      method: "POST",
      headers: slackRequestHeaders(token),
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(`Slack returned HTTP ${response.status}.`);
    if (!payload || payload.ok !== true) {
      throw new Error(`Slack rejected the request: ${String(payload?.error ?? "unknown_error").slice(0, 160)}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Slack request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifySlackConnector(token: string) {
  const payload = await slackApi(token, "auth.test");
  return {
    teamId: String(payload.team_id ?? ""),
    team: String(payload.team ?? ""),
    botId: String(payload.bot_id ?? payload.user_id ?? ""),
    url: String(payload.url ?? ""),
  };
}

export async function sendSlackConnectorMessage(input: {
  token: string;
  channelId: string;
  text: string;
}) {
  const text = input.text.trim();
  if (!text || text.length > 4_000) throw new Error("Slack messages must contain 1-4,000 characters.");
  if (!/^[CGD][A-Z0-9]{6,20}$/.test(input.channelId)) throw new Error("Slack channel ID is invalid.");

  const payload = await slackApi(input.token, "chat.postMessage", {
    channel: input.channelId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
  return {
    channelId: String(payload.channel ?? input.channelId),
    messageId: String(payload.ts ?? ""),
  };
}

export const SLACK_API_ORIGIN = "https://slack.com";
