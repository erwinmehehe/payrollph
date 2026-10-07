"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, RefreshCw, Save, ShieldCheck } from "lucide-react";

type SlackConnector = {
  id: number;
  provider: "slack";
  name: string;
  active: boolean;
  verifiedAt: string | null;
  verifiedIdentity: Record<string, unknown> | null;
  config: {
    defaultChannelId: string;
    allowedChannelIds: string[];
  };
};

export function SlackConnectorAdmin({
  organizationId,
  setNotice,
  onChanged,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const [connectors, setConnectors] = useState<SlackConnector[]>([]);
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [defaultChannelId, setDefaultChannelId] = useState("");
  const [allowedChannels, setAllowedChannels] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/integration-connectors?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load integration connectors.");
      setConnectors(Array.isArray(payload.connectors) ? payload.connectors.filter((row: SlackConnector) => row.provider === "slack") : []);
      const slack = Array.isArray(payload.providers) ? payload.providers.find((row: { id?: string }) => row.id === "slack") : null;
      setCredentialConfigured(Boolean(slack?.credentialConfigured));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load integration connectors.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => { void load(); }, [load]);

  function reset() {
    setEditingId(null);
    setName("");
    setBotToken("");
    setDefaultChannelId("");
    setAllowedChannels("");
  }

  function edit(connector: SlackConnector) {
    setEditingId(connector.id);
    setName(connector.name);
    setBotToken("");
    setDefaultChannelId(connector.config.defaultChannelId);
    setAllowedChannels(connector.config.allowedChannelIds.join("\n"));
  }

  async function save() {
    const allowedChannelIds = allowedChannels.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
    if (!name.trim() || !defaultChannelId.trim() || !allowedChannelIds.length) {
      setNotice("Connector name, default channel ID and at least one allowed Slack channel ID are required.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/integration-connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "save-slack",
          id: editingId,
          name,
          botToken: botToken || undefined,
          defaultChannelId,
          allowedChannelIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save Slack connector.");
      setNotice(`${payload.name} verified and saved. Slack bot credentials remain server-side and encrypted.`);
      reset();
      await load();
      await onChanged?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save Slack connector.");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(connector: SlackConnector, active: boolean) {
    try {
      const response = await fetch("/api/integration-connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          action: "set-active",
          id: connector.id,
          active,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not update Slack connector.");
      setNotice(`${connector.name} ${active ? "enabled" : "disabled"}.`);
      await load();
      await onChanged?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update Slack connector.");
    }
  }

  return (
    <article className="card" style={{ marginTop: 16 }} data-slack-connector-admin>
      <div className="card-header">
        <div>
          <div className="card-kicker">PROVIDER CONNECTOR</div>
          <h2>Slack</h2>
          <p>Send Automation Studio messages through Slack's Bot API using verified, encrypted credentials and allow-listed channel IDs.</p>
        </div>
        <div className="run-actions" style={{ margin: 0 }}>
          <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} /> Refresh
          </button>
          <MessageSquare size={18} className="i-purple" />
        </div>
      </div>

      <div className="card-body">
        <div className={credentialConfigured ? "notice notice-slate" : "notice notice-amber"} style={{ marginBottom: 14 }}>
          <ShieldCheck size={15} className="i-purple" />
          <span>
            {credentialConfigured
              ? "Slack tokens are verified with auth.test, encrypted at rest, never returned to the browser, and messages can target only configured channel IDs."
              : "INTEGRATION_CREDENTIAL_ENCRYPTION_KEY must be configured in the deployment before a Slack connector can be saved."}
          </span>
        </div>

        <div className="setting-form">
          <label>Connector name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Payroll operations Slack" />
          </label>
          <label>Bot token
            <input
              type="password"
              autoComplete="new-password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              placeholder={editingId ? "Leave blank to keep current token" : "xoxb-…"}
            />
          </label>
          <label>Default channel ID
            <input value={defaultChannelId} onChange={(event) => setDefaultChannelId(event.target.value.toUpperCase())} placeholder="C0123456789" />
          </label>
          <label>Allowed channel IDs
            <textarea
              rows={4}
              value={allowedChannels}
              onChange={(event) => setAllowedChannels(event.target.value.toUpperCase())}
              placeholder={"C0123456789\nG0123456789"}
            />
          </label>
        </div>

        <div className="run-actions" style={{ marginTop: 12 }}>
          {editingId && <button type="button" className="secondary-button" onClick={reset}>Cancel edit</button>}
          <button type="button" className="primary-button" disabled={saving || !credentialConfigured} onClick={() => void save()}>
            <Save size={14} /> {saving ? "Verifying…" : editingId ? "Save connector" : "Add Slack connector"}
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          {connectors.length === 0 && <div className="empty-state">No Slack connector configured yet.</div>}
          {connectors.map((connector) => {
            const team = String(connector.verifiedIdentity?.team ?? connector.verifiedIdentity?.teamId ?? "Verified Slack workspace");
            return (
              <div className="leave-request" key={connector.id}>
                <div className="inline-icon purple"><MessageSquare size={15} /></div>
                <div style={{ flex: 1 }}>
                  <strong>{connector.name}</strong>
                  <span>
                    {team} · default {connector.config.defaultChannelId} · {connector.config.allowedChannelIds.length} allowed channel{connector.config.allowedChannelIds.length === 1 ? "" : "s"} · {connector.active ? "active" : "disabled"}
                  </span>
                </div>
                <button type="button" className="secondary-button" onClick={() => edit(connector)}>Edit</button>
                <button type="button" className="secondary-button" onClick={() => void setActive(connector, !connector.active)}>
                  {connector.active ? "Disable" : "Enable"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
