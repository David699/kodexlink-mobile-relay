import {
  getLocalPanelClientConfig,
  getLocalPanelMessages,
  type LocalPanelLocale,
  type LocalPanelMessages
} from "./local-panel-i18n.js";
import {
  getMobileCompanionDownloadSnapshot,
  type MobileCompanionDownloadAppSnapshot
} from "../product/mobile-companion-download.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function renderLanguageOptions(initialLocale: LocalPanelLocale): string {
  const clientConfig = getLocalPanelClientConfig();
  const messages = getLocalPanelMessages(initialLocale);

  return [
    `<option value="auto" selected>${escapeHtml(messages.autoOptionLabel)}</option>`,
    ...clientConfig.supportedLocales.map(
      (locale) =>
        `<option value="${escapeHtml(locale)}">${escapeHtml(clientConfig.localeNames[locale])}</option>`
    )
  ].join("");
}

function renderMobileCompanionDownloadCard(
  labelKey: keyof LocalPanelMessages,
  qrAltKey: keyof LocalPanelMessages,
  app: MobileCompanionDownloadAppSnapshot,
  messages: LocalPanelMessages
): string {
  const label = messages[labelKey];
  const qrAlt = messages[qrAltKey];
  const statusMessageKey = app.downloadUrl ? "mobileAppDownloadQrUnavailable" : "unavailable";
  const statusMessage = app.downloadUrl ? messages.mobileAppDownloadQrUnavailable : messages.unavailable;
  const qrMarkup = app.qrPngBase64
    ? `<div class="qr-shell"><img alt="${escapeHtml(qrAlt)}" data-i18n-alt="${escapeHtml(String(qrAltKey))}" src="data:image/png;base64,${escapeHtml(app.qrPngBase64)}" /></div>`
    : `<div class="app-status-note" data-i18n="${statusMessageKey}">${escapeHtml(statusMessage)}</div>`;
  const downloadMarkup = app.downloadUrl
    ? `<div class="download-link"><a href="${escapeHtml(app.downloadUrl)}" target="_blank" rel="noreferrer">${escapeHtml(app.downloadUrl)}</a></div>`
    : `<div class="download-link">${escapeHtml(app.packageName ?? messages.unavailable)}</div>`;

  return `<div class="download-card">
                <span class="meta-label" data-i18n="${escapeHtml(String(labelKey))}">${escapeHtml(label)}</span>
                ${qrMarkup}
                ${downloadMarkup}
              </div>`;
}

export async function renderLocalPanelHtml(initialLocale: LocalPanelLocale): Promise<string> {
  const messages = getLocalPanelMessages(initialLocale);
  const clientConfig = getLocalPanelClientConfig();
  const mobileCompanion = await getMobileCompanionDownloadSnapshot();
  const iosApp = mobileCompanion.apps.ios;
  const androidApp = mobileCompanion.apps.android;

  return `<!doctype html>
<html lang="${escapeHtml(initialLocale)}" dir="${escapeHtml(messages.direction)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(messages.pageTitle)}</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <style>
      :root {
        color-scheme: light;
        --bg: #efe6d8;
        --panel: rgba(255, 251, 245, 0.82);
        --panel-strong: rgba(255, 251, 245, 0.94);
        --line: rgba(95, 75, 54, 0.14);
        --text: #1f1a14;
        --muted: #6e6154;
        --accent: #b15a31;
        --accent-deep: #7b3818;
        --accent-soft: rgba(177, 90, 49, 0.12);
        --ok: #287c4d;
        --warn: #9a6b10;
        --danger: #b0372d;
        --shadow: 0 26px 70px rgba(61, 42, 24, 0.14);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Avenir Next", "Helvetica Neue", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(255, 212, 164, 0.72), transparent 30%),
          radial-gradient(circle at bottom right, rgba(177, 90, 49, 0.18), transparent 26%),
          linear-gradient(135deg, #f5ecde 0%, #ede0cf 45%, #e4d1bf 100%);
      }

      button,
      input,
      select,
      textarea {
        font: inherit;
      }

      button {
        cursor: pointer;
        border: none;
      }

      .page {
        width: min(1200px, calc(100vw - 36px));
        margin: 20px auto 34px;
        display: grid;
        gap: 18px;
      }

      .hero,
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 28px;
        backdrop-filter: blur(18px);
        box-shadow: var(--shadow);
      }

      .hero {
        padding: 26px 28px;
        display: grid;
        grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.9fr);
        gap: 24px;
      }

      .hero-copy {
        display: grid;
        gap: 18px;
      }

      .hero-topbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }

      .hero h1 {
        margin: 0;
        font-size: clamp(32px, 4vw, 50px);
        line-height: 1.02;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent-deep);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .language-control {
        display: grid;
        gap: 8px;
        min-width: 168px;
      }

      .language-control span {
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .language-control select {
        min-height: 44px;
        padding: 0 14px;
        border-radius: 14px;
        border: 1px solid rgba(95, 75, 54, 0.12);
        background: rgba(255, 255, 255, 0.84);
        color: var(--text);
      }

      .hero p {
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
      }

      .hero-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .hero-stat {
        padding: 16px 18px;
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.56);
        border: 1px solid rgba(95, 75, 54, 0.08);
      }

      .hero-stat .label,
      .meta-label,
      .section-title small {
        display: block;
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .hero-stat .value {
        margin-top: 6px;
        font-size: 15px;
        line-height: 1.5;
        word-break: break-word;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.18fr) minmax(320px, 0.82fr);
        gap: 18px;
      }

      .stack {
        display: grid;
        gap: 18px;
      }

      .card {
        padding: 22px;
      }

      .section-title {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 18px;
      }

      .section-title h2 {
        margin: 0;
        font-size: 22px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 12px;
        background: rgba(255, 255, 255, 0.72);
        color: var(--muted);
      }

      .badge.ok {
        background: rgba(40, 124, 77, 0.12);
        color: var(--ok);
      }

      .badge.warn {
        background: rgba(154, 107, 16, 0.12);
        color: var(--warn);
      }

      .badge.danger {
        background: rgba(176, 55, 45, 0.12);
        color: var(--danger);
      }

      .summary-grid,
      .details-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .summary-item,
      .detail-item {
        padding: 16px 18px;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.58);
      }

      .detail-item.full {
        grid-column: 1 / -1;
      }

      .meta-value {
        margin-top: 6px;
        line-height: 1.55;
        word-break: break-word;
      }

      .pairing-expiry-stack {
        display: grid;
        gap: 4px;
      }

      .pairing-countdown {
        font-variant-numeric: tabular-nums;
        font-size: 13px;
        color: var(--accent-deep);
      }

      .pairing-countdown.expiring {
        color: #8c5209;
      }

      .pairing-countdown.expired {
        color: var(--danger);
        font-weight: 600;
      }

      .inline-actions,
      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.88);
        color: var(--text);
        border: 1px solid rgba(95, 75, 54, 0.1);
      }

      .button.primary {
        background: linear-gradient(135deg, #c26a3f 0%, #a84d2a 100%);
        color: white;
        border-color: transparent;
      }

      .button.subtle {
        background: rgba(177, 90, 49, 0.08);
        color: var(--accent-deep);
      }

      .button:disabled {
        opacity: 0.55;
        cursor: default;
      }

      .field {
        display: grid;
        gap: 10px;
      }

      .field label {
        font-size: 14px;
        color: var(--muted);
      }

      .field input,
      .payload {
        width: 100%;
        border-radius: 18px;
        border: 1px solid rgba(95, 75, 54, 0.12);
        background: rgba(255, 255, 255, 0.82);
        color: var(--text);
      }

      .field input {
        min-height: 52px;
        padding: 0 16px;
      }

      .hint {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }

      .status-note {
        min-height: 24px;
        padding: 0;
        color: var(--accent-deep);
        font-size: 14px;
        line-height: 1.6;
        transition: all 160ms ease;
      }

      .status-note.info,
      .status-note.warn,
      .status-note.error {
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid transparent;
        background: rgba(255, 255, 255, 0.6);
      }

      .status-note.info {
        color: var(--accent-deep);
        border-color: rgba(177, 90, 49, 0.18);
        background: rgba(177, 90, 49, 0.08);
      }

      .status-note.warn {
        color: #7a4205;
        border-color: rgba(154, 107, 16, 0.28);
        background: linear-gradient(135deg, rgba(250, 220, 168, 0.5), rgba(255, 245, 230, 0.96));
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
      }

      .status-note.error {
        color: var(--danger);
        border-color: rgba(176, 55, 45, 0.22);
        background: rgba(176, 55, 45, 0.08);
      }

      .qr-shell {
        padding: 18px;
        border-radius: 24px;
        background: linear-gradient(160deg, rgba(255,255,255,0.96), rgba(245,235,222,0.92));
        border: 1px solid rgba(95, 75, 54, 0.08);
      }

      .qr-shell img {
        width: 100%;
        display: block;
        border-radius: 18px;
        background: white;
      }

      .qr-shell.expired {
        border-color: rgba(176, 55, 45, 0.18);
        background: linear-gradient(160deg, rgba(255, 244, 241, 0.98), rgba(247, 228, 225, 0.92));
      }

      .qr-shell.expired img {
        opacity: 0.42;
        filter: grayscale(1);
      }

      .download-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .download-card {
        display: grid;
        gap: 12px;
        padding: 16px;
        border-radius: 24px;
        border: 1px solid rgba(95, 75, 54, 0.08);
        background: rgba(255, 255, 255, 0.5);
      }

      .download-card .qr-shell {
        padding: 14px;
      }

      .download-link {
        color: var(--accent-deep);
        font-size: 13px;
        line-height: 1.6;
        word-break: break-all;
      }

      .download-link a {
        color: inherit;
      }

      .app-status-note {
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px dashed rgba(177, 90, 49, 0.22);
        background: rgba(177, 90, 49, 0.08);
        color: var(--accent-deep);
        font-size: 13px;
        line-height: 1.6;
      }

      .payload {
        min-height: 120px;
        padding: 14px 16px;
        resize: vertical;
        line-height: 1.55;
      }

      @media (max-width: 980px) {
        .hero,
        .layout {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 720px) {
        .page {
          width: min(100vw - 18px, 100%);
          margin: 10px auto 22px;
        }

        .download-grid {
          grid-template-columns: 1fr;
        }

        .hero,
        .card {
          border-radius: 24px;
          padding: 18px;
        }

        .summary-grid,
        .details-grid,
        .hero-grid {
          grid-template-columns: 1fr;
        }

        .hero-topbar {
          flex-direction: column;
        }

        .language-control {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="hero-copy">
          <div class="hero-topbar">
            <span class="eyebrow" data-i18n="panelEyebrow">${escapeHtml(messages.panelEyebrow)}</span>
            <label class="language-control" for="language-select">
              <span data-i18n="languageLabel">${escapeHtml(messages.languageLabel)}</span>
              <select id="language-select" aria-label="${escapeHtml(messages.languageLabel)}">
                ${renderLanguageOptions(initialLocale)}
              </select>
            </label>
          </div>
          <div class="stack" style="gap: 10px;">
            <h1 data-i18n="panelTitle">${escapeHtml(messages.panelTitle)}</h1>
            <p data-i18n="heroDescription">${escapeHtml(messages.heroDescription)}</p>
          </div>
        </div>
        <div class="hero-grid">
          <div class="hero-stat">
            <span class="label" data-i18n="currentRelayLabel">${escapeHtml(messages.currentRelayLabel)}</span>
            <div class="value" id="hero-relay-url">${escapeHtml(messages.loading)}</div>
          </div>
          <div class="hero-stat">
            <span class="label" data-i18n="relaySourceLabel">${escapeHtml(messages.relaySourceLabel)}</span>
            <div class="value" id="hero-relay-source">${escapeHtml(messages.loading)}</div>
          </div>
          <div class="hero-stat">
            <span class="label" data-i18n="serviceLabel">${escapeHtml(messages.serviceLabel)}</span>
            <div class="value" id="hero-service-status">${escapeHtml(messages.loading)}</div>
          </div>
          <div class="hero-stat">
            <span class="label" data-i18n="panelAddressLabel">${escapeHtml(messages.panelAddressLabel)}</span>
            <div class="value" id="hero-local-panel-url">${escapeHtml(messages.loading)}</div>
          </div>
        </div>
      </section>

      <section class="layout">
        <div class="stack">
          <article class="card">
            <div class="section-title">
              <div>
                <h2 data-i18n="pairingTitle">${escapeHtml(messages.pairingTitle)}</h2>
                <small data-i18n="pairingSubtitle">${escapeHtml(messages.pairingSubtitle)}</small>
              </div>
              <div class="inline-actions">
                <button class="button subtle" id="reset-identity-button" type="button" data-i18n="resetIdentityButton">${escapeHtml(messages.resetIdentityButton)}</button>
                <button class="button subtle" id="refresh-pairing-button" type="button" data-i18n="refreshQrButton">${escapeHtml(messages.refreshQrButton)}</button>
              </div>
            </div>
            <div class="status-note" id="pairing-feedback"></div>
            <div class="hint" data-i18n="resetIdentityHint">${escapeHtml(messages.resetIdentityHint)}</div>
            <div class="qr-shell" id="pairing-qr-shell">
              <img id="pairing-qr" alt="${escapeHtml(messages.pairingQrAlt)}" data-i18n-alt="pairingQrAlt" />
            </div>
            <div class="details-grid" style="margin-top: 14px;">
              <div class="detail-item">
                <span class="meta-label" data-i18n="pairingLabelLabel">${escapeHtml(messages.pairingLabelLabel)}</span>
                <div class="meta-value" id="pairing-agent-label">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="detail-item">
                <span class="meta-label" data-i18n="expiresAtLabel">${escapeHtml(messages.expiresAtLabel)}</span>
                <div class="meta-value pairing-expiry-stack">
                  <div id="pairing-expires-at">${escapeHtml(messages.loading)}</div>
                  <div class="pairing-countdown" id="pairing-countdown">${escapeHtml(messages.loading)}</div>
                </div>
              </div>
              <div class="detail-item full">
                <span class="meta-label" data-i18n="pairingRelayLabel">${escapeHtml(messages.pairingRelayLabel)}</span>
                <div class="meta-value" id="pairing-relay-url">${escapeHtml(messages.loading)}</div>
              </div>
            </div>
            <div class="field" style="margin-top: 14px;">
              <label for="pairing-payload" data-i18n="manualPayloadLabel">${escapeHtml(messages.manualPayloadLabel)}</label>
              <textarea id="pairing-payload" class="payload" readonly spellcheck="false"></textarea>
            </div>
          </article>

          <article class="card">
            <div class="section-title">
              <div>
                <h2 data-i18n="overviewTitle">${escapeHtml(messages.overviewTitle)}</h2>
                <small data-i18n="overviewSubtitle">${escapeHtml(messages.overviewSubtitle)}</small>
              </div>
              <span class="badge" id="service-badge">${escapeHtml(messages.loading)}</span>
            </div>
            <div class="summary-grid">
              <div class="summary-item">
                <span class="meta-label" data-i18n="deviceNameLabel">${escapeHtml(messages.deviceNameLabel)}</span>
                <div class="meta-value" id="profile-device-name">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="agentIdLabel">${escapeHtml(messages.agentIdLabel)}</span>
                <div class="meta-value" id="profile-agent-id">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="machineIdLabel">${escapeHtml(messages.machineIdLabel)}</span>
                <div class="meta-value" id="profile-machine-id">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="agentVersionLabel">${escapeHtml(messages.agentVersionLabel)}</span>
                <div class="meta-value" id="agent-version">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="savedRelayAuthLabel">${escapeHtml(messages.savedRelayAuthLabel)}</span>
                <div class="meta-value" id="profile-auth-count">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="relayConnectionLabel">${escapeHtml(messages.relayConnectionLabel)}</span>
                <div class="meta-value" id="relay-connection-status">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="lastOnlineLabel">${escapeHtml(messages.lastOnlineLabel)}</span>
                <div class="meta-value" id="relay-last-online">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="nextReconnectLabel">${escapeHtml(messages.nextReconnectLabel)}</span>
                <div class="meta-value" id="relay-next-retry">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="logDirectoryLabel">${escapeHtml(messages.logDirectoryLabel)}</span>
                <div class="meta-value" id="log-directory">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item">
                <span class="meta-label" data-i18n="settingsFileLabel">${escapeHtml(messages.settingsFileLabel)}</span>
                <div class="meta-value" id="settings-file-path">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="summary-item" style="grid-column: 1 / -1;">
                <span class="meta-label" data-i18n="lastRelayErrorLabel">${escapeHtml(messages.lastRelayErrorLabel)}</span>
                <div class="meta-value" id="relay-last-error">${escapeHtml(messages.loading)}</div>
              </div>
            </div>
          </article>

          <article class="card">
            <div class="section-title">
              <div>
                <h2 data-i18n="relaySettingsTitle">${escapeHtml(messages.relaySettingsTitle)}</h2>
                <small data-i18n="relaySettingsSubtitle">${escapeHtml(messages.relaySettingsSubtitle)}</small>
              </div>
              <div class="inline-actions">
                <button class="button subtle" id="restart-service-button" type="button" data-i18n="restartServiceButton">${escapeHtml(messages.restartServiceButton)}</button>
              </div>
            </div>
            <div class="stack">
              <div class="details-grid">
                <div class="detail-item">
                  <span class="meta-label" data-i18n="currentRelayAddressLabel">${escapeHtml(messages.currentRelayAddressLabel)}</span>
                  <div class="meta-value" id="current-relay-url">${escapeHtml(messages.loading)}</div>
                </div>
                <div class="detail-item">
                  <span class="meta-label" data-i18n="currentRelaySourceLabel">${escapeHtml(messages.currentRelaySourceLabel)}</span>
                  <div class="meta-value" id="current-relay-source">${escapeHtml(messages.loading)}</div>
                </div>
                <div class="detail-item full">
                  <span class="meta-label" data-i18n="localOverrideLabel">${escapeHtml(messages.localOverrideLabel)}</span>
                  <div class="meta-value" id="relay-override-value">${escapeHtml(messages.loading)}</div>
                </div>
              </div>
              <div class="hint" data-i18n="relayHint">${escapeHtml(messages.relayHint)}</div>
              <div class="status-note" id="action-feedback"></div>
            </div>
          </article>
        </div>

        <div class="stack">
          <article class="card">
            <div class="section-title">
              <div>
                <h2 data-i18n="mobileAppTitle">${escapeHtml(messages.mobileAppTitle)}</h2>
                <small data-i18n="mobileAppSubtitle">${escapeHtml(messages.mobileAppSubtitle)}</small>
              </div>
            </div>
            <div class="hint" data-i18n="mobileAppNotice">${escapeHtml(messages.mobileAppNotice)}</div>
            <div class="download-grid" style="margin-top: 14px;">
              ${renderMobileCompanionDownloadCard(
                "mobileAppIosLabel",
                "mobileAppIosQrAlt",
                iosApp,
                messages
              )}
              ${renderMobileCompanionDownloadCard(
                "mobileAppAndroidLabel",
                "mobileAppAndroidQrAlt",
                androidApp,
                messages
              )}
            </div>
          </article>

          <article class="card">
            <div class="section-title">
              <div>
                <h2 data-i18n="runtimeInfoTitle">${escapeHtml(messages.runtimeInfoTitle)}</h2>
                <small data-i18n="runtimeInfoSubtitle">${escapeHtml(messages.runtimeInfoSubtitle)}</small>
              </div>
            </div>
            <div class="details-grid">
              <div class="detail-item full">
                <span class="meta-label" data-i18n="panelUrlLabel">${escapeHtml(messages.panelUrlLabel)}</span>
                <div class="meta-value" id="local-panel-url">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="detail-item full">
                <span class="meta-label" data-i18n="plistPathLabel">${escapeHtml(messages.plistPathLabel)}</span>
                <div class="meta-value" id="service-plist-path">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="detail-item full">
                <span class="meta-label" data-i18n="stdoutLogLabel">${escapeHtml(messages.stdoutLogLabel)}</span>
                <div class="meta-value" id="service-stdout-path">${escapeHtml(messages.loading)}</div>
              </div>
              <div class="detail-item full">
                <span class="meta-label" data-i18n="stderrLogLabel">${escapeHtml(messages.stderrLogLabel)}</span>
                <div class="meta-value" id="service-stderr-path">${escapeHtml(messages.loading)}</div>
              </div>
            </div>
          </article>
        </div>
      </section>
    </main>

    <script>
      const INITIAL_LOCALE = ${serializeForScript(initialLocale)};
      const PANEL_CONFIG = ${serializeForScript(clientConfig)};

      const elements = {
        languageSelect: document.getElementById("language-select"),
        heroRelayUrl: document.getElementById("hero-relay-url"),
        heroRelaySource: document.getElementById("hero-relay-source"),
        heroServiceStatus: document.getElementById("hero-service-status"),
        heroLocalPanelUrl: document.getElementById("hero-local-panel-url"),
        serviceBadge: document.getElementById("service-badge"),
        profileDeviceName: document.getElementById("profile-device-name"),
        profileAgentId: document.getElementById("profile-agent-id"),
        profileMachineId: document.getElementById("profile-machine-id"),
        agentVersion: document.getElementById("agent-version"),
        profileAuthCount: document.getElementById("profile-auth-count"),
        relayConnectionStatus: document.getElementById("relay-connection-status"),
        relayLastOnline: document.getElementById("relay-last-online"),
        relayNextRetry: document.getElementById("relay-next-retry"),
        relayLastError: document.getElementById("relay-last-error"),
        logDirectory: document.getElementById("log-directory"),
        settingsFilePath: document.getElementById("settings-file-path"),
        currentRelayUrl: document.getElementById("current-relay-url"),
        currentRelaySource: document.getElementById("current-relay-source"),
        relayOverrideValue: document.getElementById("relay-override-value"),
        actionFeedback: document.getElementById("action-feedback"),
        restartServiceButton: document.getElementById("restart-service-button"),
        resetIdentityButton: document.getElementById("reset-identity-button"),
        refreshPairingButton: document.getElementById("refresh-pairing-button"),
        pairingFeedback: document.getElementById("pairing-feedback"),
        pairingQrShell: document.getElementById("pairing-qr-shell"),
        pairingQr: document.getElementById("pairing-qr"),
        pairingAgentLabel: document.getElementById("pairing-agent-label"),
        pairingExpiresAt: document.getElementById("pairing-expires-at"),
        pairingCountdown: document.getElementById("pairing-countdown"),
        pairingRelayUrl: document.getElementById("pairing-relay-url"),
        pairingPayload: document.getElementById("pairing-payload"),
        localPanelUrl: document.getElementById("local-panel-url"),
        servicePlistPath: document.getElementById("service-plist-path"),
        serviceStdoutPath: document.getElementById("service-stdout-path"),
        serviceStderrPath: document.getElementById("service-stderr-path")
      };

      let localeSelection = readStoredLocaleSelection();
      let currentLocale = resolveLocaleForSelection(localeSelection);
      let currentMessages = PANEL_CONFIG.translations[currentLocale];
      let lastStatus = null;
      let lastPairing = null;
      let pairingUnavailableMessage = null;
      let feedbackState = null;
      let pairingFeedbackState = null;
      let pairingCountdownTimer = null;

      function readStoredLocaleSelection() {
        try {
          const raw = window.localStorage.getItem(PANEL_CONFIG.storageKey);
          if (raw === "auto") {
            return "auto";
          }
          if (PANEL_CONFIG.supportedLocales.includes(raw)) {
            return raw;
          }
        } catch {}

        return "auto";
      }

      function persistLocaleSelection(selection) {
        try {
          window.localStorage.setItem(PANEL_CONFIG.storageKey, selection);
        } catch {}
      }

      function normalizeLocaleCandidate(rawValue) {
        if (typeof rawValue !== "string") {
          return null;
        }

        const normalized = rawValue.trim().toLowerCase();
        if (!normalized) {
          return null;
        }

        const directMatch = PANEL_CONFIG.supportedLocales.find(function (locale) {
          return locale.toLowerCase() === normalized;
        });
        if (directMatch) {
          return directMatch;
        }

        return PANEL_CONFIG.localeAliases[normalized] || null;
      }

      function getBrowserLocales() {
        const locales = [];
        if (Array.isArray(navigator.languages)) {
          locales.push.apply(locales, navigator.languages);
        }
        if (navigator.language) {
          locales.push(navigator.language);
        }
        return locales;
      }

      function resolveLocaleForSelection(selection) {
        if (selection && selection !== "auto") {
          return normalizeLocaleCandidate(selection) || PANEL_CONFIG.defaultLocale;
        }

        const browserLocales = getBrowserLocales();
        for (const locale of browserLocales) {
          const resolved = normalizeLocaleCandidate(locale);
          if (resolved) {
            return resolved;
          }
        }

        return normalizeLocaleCandidate(INITIAL_LOCALE) || PANEL_CONFIG.defaultLocale;
      }

      function renderLanguageOptions() {
        const options = [
          {
            value: "auto",
            label: currentMessages.autoOptionLabel
          }
        ].concat(
          PANEL_CONFIG.supportedLocales.map(function (locale) {
            return {
              value: locale,
              label: PANEL_CONFIG.localeNames[locale]
            };
          })
        );

        elements.languageSelect.innerHTML = options
          .map(function (option) {
            const selected = option.value === localeSelection ? ' selected' : "";
            return '<option value="' + escapeHtmlForClient(option.value) + '"' + selected + ">" + escapeHtmlForClient(option.label) + "</option>";
          })
          .join("");
        elements.languageSelect.setAttribute("aria-label", currentMessages.languageLabel);
      }

      function escapeHtmlForClient(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function applyStaticTranslations() {
        document.documentElement.lang = currentLocale;
        document.documentElement.dir = currentMessages.direction;
        document.title = currentMessages.pageTitle;

        document.querySelectorAll("[data-i18n]").forEach(function (element) {
          const key = element.getAttribute("data-i18n");
          if (!key) {
            return;
          }
          element.textContent = currentMessages[key] || "";
        });

        document.querySelectorAll("[data-i18n-alt]").forEach(function (element) {
          const key = element.getAttribute("data-i18n-alt");
          if (!key) {
            return;
          }
          element.setAttribute("alt", currentMessages[key] || "");
        });
      }

      function renderLoadingState() {
        const loading = currentMessages.loading;
        elements.heroRelayUrl.textContent = loading;
        elements.heroRelaySource.textContent = loading;
        elements.heroServiceStatus.textContent = loading;
        elements.heroLocalPanelUrl.textContent = loading;
        elements.serviceBadge.textContent = loading;
        elements.serviceBadge.className = "badge";
        elements.profileDeviceName.textContent = loading;
        elements.profileAgentId.textContent = loading;
        elements.profileMachineId.textContent = loading;
        elements.agentVersion.textContent = loading;
        elements.profileAuthCount.textContent = loading;
        elements.relayConnectionStatus.textContent = loading;
        elements.relayLastOnline.textContent = loading;
        elements.relayNextRetry.textContent = loading;
        elements.relayLastError.textContent = loading;
        elements.logDirectory.textContent = loading;
        elements.settingsFilePath.textContent = loading;
        elements.currentRelayUrl.textContent = loading;
        elements.currentRelaySource.textContent = loading;
        elements.relayOverrideValue.textContent = loading;
        elements.localPanelUrl.textContent = loading;
        elements.servicePlistPath.textContent = loading;
        elements.serviceStdoutPath.textContent = loading;
        elements.serviceStderrPath.textContent = loading;
      }

      function renderPairingLoadingState() {
        const loading = currentMessages.loading;
        clearPairingCountdownTimer();
        elements.pairingQrShell.classList.remove("expired");
        elements.pairingQr.removeAttribute("src");
        elements.pairingAgentLabel.textContent = loading;
        elements.pairingExpiresAt.textContent = loading;
        elements.pairingCountdown.textContent = loading;
        elements.pairingCountdown.className = "pairing-countdown";
        elements.pairingRelayUrl.textContent = loading;
        elements.pairingPayload.value = "";
      }

      function applyPairingFeedbackState() {
        if (!pairingFeedbackState) {
          elements.pairingFeedback.textContent = "";
          elements.pairingFeedback.className = "status-note";
          return;
        }

        const message = pairingFeedbackState.messageKey
          ? currentMessages[pairingFeedbackState.messageKey] || pairingFeedbackState.messageKey
          : pairingFeedbackState.message || "";

        elements.pairingFeedback.textContent = message;
        elements.pairingFeedback.className = "status-note " + (pairingFeedbackState.variant || "info");
      }

      function applyFeedbackState() {
        if (!feedbackState) {
          elements.actionFeedback.textContent = "";
          elements.actionFeedback.className = "status-note";
          return;
        }

        const message = feedbackState.messageKey
          ? currentMessages[feedbackState.messageKey] || feedbackState.messageKey
          : feedbackState.message || "";

        elements.actionFeedback.textContent = message;
        elements.actionFeedback.className = "status-note " + (feedbackState.variant || "info");
      }

      function setFeedbackMessage(message, isError, variant) {
        feedbackState = {
          message: message || "",
          isError: Boolean(isError),
          variant: variant || (isError ? "error" : "info")
        };
        applyFeedbackState();
      }

      function setFeedbackKey(messageKey, isError, variant) {
        feedbackState = {
          messageKey: messageKey,
          isError: Boolean(isError),
          variant: variant || (isError ? "error" : "info")
        };
        applyFeedbackState();
      }

      function setPairingFeedbackMessage(message, isError, variant) {
        pairingFeedbackState = {
          message: message || "",
          isError: Boolean(isError),
          variant: variant || (isError ? "error" : "info")
        };
        applyPairingFeedbackState();
      }

      function setPairingFeedbackKey(messageKey, isError, variant) {
        pairingFeedbackState = {
          messageKey: messageKey,
          isError: Boolean(isError),
          variant: variant || (isError ? "error" : "info")
        };
        applyPairingFeedbackState();
      }

      function setBusy(isBusy) {
        elements.restartServiceButton.disabled = isBusy;
        elements.resetIdentityButton.disabled = isBusy;
        elements.refreshPairingButton.disabled = isBusy;
      }

      function requestJson(url, init) {
        return fetch(url, {
          headers: {
            "content-type": "application/json"
          },
          ...init
        }).then(async function (response) {
          const text = await response.text();
          const json = text ? JSON.parse(text) : {};
          if (!response.ok) {
            throw new Error((json && json.error) || "request failed");
          }
          return json;
        });
      }

      function formatDateTime(value) {
        if (!value) {
          return currentMessages.unavailable;
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          return value;
        }

        return new Intl.DateTimeFormat(currentLocale, {
          dateStyle: "medium",
          timeStyle: "medium"
        }).format(date);
      }

      function formatPairingCountdown(remainingMs) {
        const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
          return String(hours).padStart(2, "0") + ":" +
            String(minutes).padStart(2, "0") + ":" +
            String(seconds).padStart(2, "0");
        }

        return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
      }

      function getPairingExpiryState(expiresAt) {
        const expiryTime = Number(expiresAt);
        if (!Number.isFinite(expiryTime)) {
          return {
            isExpired: false,
            isExpiringSoon: false,
            remainingMs: 0
          };
        }

        const remainingMs = Math.max(0, expiryTime - Date.now());
        return {
          isExpired: remainingMs <= 0,
          isExpiringSoon: remainingMs > 0 && remainingMs <= 60000,
          remainingMs: remainingMs
        };
      }

      function clearPairingCountdownTimer() {
        if (!pairingCountdownTimer) {
          return;
        }

        window.clearInterval(pairingCountdownTimer);
        pairingCountdownTimer = null;
      }

      function renderPairingCountdown(pairing) {
        const expiry = getPairingExpiryState(pairing.expiresAt);
        let countdownText = "";
        let countdownClassName = "pairing-countdown";

        if (expiry.isExpired) {
          countdownText = currentMessages.expiredLabel;
          countdownClassName += " expired";
          elements.pairingQrShell.classList.add("expired");
        } else {
          countdownText = currentMessages.expiresInLabel + " " + formatPairingCountdown(expiry.remainingMs);
          if (expiry.isExpiringSoon) {
            countdownClassName += " expiring";
          }
          elements.pairingQrShell.classList.remove("expired");
        }

        elements.pairingCountdown.textContent = countdownText;
        elements.pairingCountdown.className = countdownClassName;
        return expiry;
      }

      function startPairingCountdown(pairing) {
        clearPairingCountdownTimer();
        const expiry = renderPairingCountdown(pairing);
        if (expiry.isExpired) {
          return;
        }

        pairingCountdownTimer = window.setInterval(function () {
          const nextExpiry = renderPairingCountdown(pairing);
          if (nextExpiry.isExpired) {
            clearPairingCountdownTimer();
          }
        }, 1000);
      }

      function translateRelaySource(source) {
        switch (source) {
          case "cli":
            return currentMessages.relaySourceCli;
          case "env":
            return currentMessages.relaySourceEnv;
          case "settings":
            return currentMessages.relaySourceSettings;
          case "default":
          default:
            return currentMessages.relaySourceDefault;
        }
      }

      function translateRelayConnectionStatus(status) {
        switch (status) {
          case "connecting":
            return currentMessages.relayStatusConnecting;
          case "online":
            return currentMessages.relayStatusOnline;
          case "reconnecting":
            return currentMessages.relayStatusReconnecting;
          case "offline":
            return currentMessages.relayStatusOffline;
          case "unknown":
          default:
            return currentMessages.relayStatusUnknown;
        }
      }

      function renderRelayConnectionBadge(connection) {
        const text = translateRelayConnectionStatus(connection.status);
        elements.serviceBadge.textContent = text;
        elements.serviceBadge.className = "badge";

        if (connection.status === "online") {
          elements.serviceBadge.className = "badge ok";
        } else if (connection.status === "connecting" || connection.status === "reconnecting") {
          elements.serviceBadge.className = "badge warn";
        } else if (connection.status === "offline") {
          elements.serviceBadge.className = "badge danger";
        }

        return text;
      }

      function renderServiceStatus(service) {
        if (!service.supported) {
          return currentMessages.serviceUnsupported;
        }

        if (service.loaded) {
          return currentMessages.serviceRunning;
        }

        if (service.installed) {
          return currentMessages.serviceInstalledNotRunning;
        }

        return currentMessages.serviceNotInstalled;
      }

      function renderStatus(status) {
        lastStatus = status;
        const serviceText = renderServiceStatus(status.service);
        const relayConnectionText = renderRelayConnectionBadge(status.relayConnection);
        const profile = status.profile;

        elements.heroRelayUrl.textContent = status.relayUrl;
        elements.heroRelaySource.textContent = translateRelaySource(status.relaySource);
        elements.heroServiceStatus.textContent = serviceText + " · " + relayConnectionText;
        elements.heroLocalPanelUrl.textContent = status.currentLocalPanelUrl || currentMessages.notRunning;

        elements.profileDeviceName.textContent = profile ? profile.deviceName : currentMessages.notInitialized;
        elements.profileAgentId.textContent = profile ? profile.agentId : currentMessages.notInitialized;
        elements.profileMachineId.textContent = profile ? profile.machineId : currentMessages.notInitialized;
        elements.agentVersion.textContent = status.agentVersion || currentMessages.unavailable;
        elements.profileAuthCount.textContent = profile ? String(profile.authRelayCount) : "0";
        elements.relayConnectionStatus.textContent = relayConnectionText;
        elements.relayLastOnline.textContent = status.relayConnection.lastConnectedAt
          ? formatDateTime(status.relayConnection.lastConnectedAt)
          : currentMessages.notSet;
        elements.relayNextRetry.textContent = status.relayConnection.nextRetryAt
          ? formatDateTime(status.relayConnection.nextRetryAt)
          : currentMessages.notScheduled;
        elements.relayLastError.textContent = status.relayConnection.lastError || currentMessages.none;
        elements.logDirectory.textContent = status.logDirectory;
        elements.settingsFilePath.textContent = status.settingsFilePath;

        elements.currentRelayUrl.textContent = status.relayUrl;
        elements.currentRelaySource.textContent = translateRelaySource(status.relaySource);
        elements.relayOverrideValue.textContent = status.relayUrlOverride || currentMessages.none;

        elements.localPanelUrl.textContent = status.currentLocalPanelUrl || currentMessages.notRunning;
        elements.servicePlistPath.textContent = status.service.plistPath || currentMessages.unavailable;
        elements.serviceStdoutPath.textContent = status.service.stdoutPath || currentMessages.unavailable;
        elements.serviceStderrPath.textContent = status.service.stderrPath || currentMessages.unavailable;
        elements.restartServiceButton.disabled = !status.service.supported;
        elements.resetIdentityButton.disabled = !status.service.supported;

        if (pairingUnavailableMessage) {
          renderPairingUnavailable(pairingUnavailableMessage);
        }
      }

      function renderPairing(pairing) {
        lastPairing = pairing;
        pairingUnavailableMessage = null;
        if (pairing.qrPngBase64) {
          elements.pairingQr.src = "data:image/png;base64," + pairing.qrPngBase64;
        } else {
          elements.pairingQr.removeAttribute("src");
        }

        elements.pairingAgentLabel.textContent = pairing.agentLabel || currentMessages.notGenerated;
        elements.pairingExpiresAt.textContent = formatDateTime(pairing.expiresAt);
        startPairingCountdown(pairing);
        elements.pairingRelayUrl.textContent = pairing.relayUrl || currentMessages.unavailable;
        elements.pairingPayload.value = pairing.payloadRaw || "";
        setPairingFeedbackMessage("", false);
      }

      function renderPairingUnavailable(message) {
        lastPairing = null;
        pairingUnavailableMessage = message || currentMessages.unavailable;
        clearPairingCountdownTimer();
        elements.pairingQrShell.classList.remove("expired");
        elements.pairingQr.removeAttribute("src");
        elements.pairingAgentLabel.textContent = currentMessages.notGenerated;
        elements.pairingExpiresAt.textContent = currentMessages.unavailable;
        elements.pairingCountdown.textContent = currentMessages.unavailable;
        elements.pairingCountdown.className = "pairing-countdown";
        elements.pairingRelayUrl.textContent = (lastStatus && lastStatus.relayUrl) || currentMessages.unavailable;
        elements.pairingPayload.value = "";
        setPairingFeedbackMessage(pairingUnavailableMessage, true);
      }

      function getCurrentAgentId() {
        const profile = lastStatus && lastStatus.profile;
        if (!profile || typeof profile.agentId !== "string" || !profile.agentId) {
          return null;
        }

        return profile.agentId;
      }

      function applyLocale(selection) {
        localeSelection = selection;
        currentLocale = resolveLocaleForSelection(selection);
        currentMessages = PANEL_CONFIG.translations[currentLocale];
        renderLanguageOptions();
        applyStaticTranslations();

        if (lastStatus) {
          renderStatus(lastStatus);
        } else {
          renderLoadingState();
        }

        if (lastPairing) {
          renderPairing(lastPairing);
        } else if (pairingUnavailableMessage) {
          renderPairingUnavailable(pairingUnavailableMessage);
        } else {
          renderPairingLoadingState();
        }

        applyFeedbackState();
        applyPairingFeedbackState();
      }

      async function loadStatus() {
        const status = await requestJson("/api/status");
        renderStatus(status);
        return status;
      }

      async function loadPairing() {
        const pairing = await requestJson("/api/pairing/current");
        renderPairing(pairing);
        return pairing;
      }

      function toErrorMessage(error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (currentMessages[detail]) {
          return currentMessages[detail];
        }
        return currentMessages.requestFailedPrefix + ": " + detail;
      }

      elements.languageSelect.addEventListener("change", function (event) {
        const nextSelection = event.target.value === "auto" ? "auto" : event.target.value;
        persistLocaleSelection(nextSelection);
        applyLocale(nextSelection);
      });

      elements.restartServiceButton.addEventListener("click", async function () {
        setBusy(true);
        setFeedbackMessage("", false);
        try {
          const response = await requestJson("/api/service/restart", {
            method: "POST"
          });
          renderStatus(response.status);
          setFeedbackKey("serviceRestartedMessage", false);
        } catch (error) {
          setFeedbackMessage(toErrorMessage(error), true);
        } finally {
          setBusy(false);
        }
      });

      elements.refreshPairingButton.addEventListener("click", async function () {
        setBusy(true);
        setPairingFeedbackMessage("", false);
        try {
          const pairing = await requestJson("/api/pairing/refresh", {
            method: "POST"
          });
          renderPairing(pairing);
          setPairingFeedbackKey("qrRefreshedMessage", false);
        } catch (error) {
          renderPairingUnavailable(toErrorMessage(error));
        } finally {
          setBusy(false);
        }
      });

      elements.resetIdentityButton.addEventListener("click", async function () {
        setPairingFeedbackMessage("", false);

        const agentId = getCurrentAgentId();
        if (!agentId) {
          setPairingFeedbackKey("resetIdentityUnavailableMessage", true);
          return;
        }

        const confirmed = window.confirm(
          currentMessages.resetIdentityConfirmWarning + "\\n\\n" +
            currentMessages.resetIdentityConfirmLossNotice + "\\n\\n" +
            currentMessages.agentIdLabel + ": " + agentId
        );
        if (!confirmed) {
          return;
        }

        const confirmationText = window.prompt(
          currentMessages.resetIdentityPrompt + "\\n\\n" + currentMessages.agentIdLabel + ": " + agentId,
          ""
        );
        if (confirmationText === null) {
          return;
        }

        const normalizedConfirmation = confirmationText.trim();
        if (normalizedConfirmation !== agentId) {
          setPairingFeedbackKey("resetIdentityConfirmationMismatchMessage", true);
          return;
        }

        setBusy(true);
        try {
          const response = await requestJson("/api/pairing/reset-identity", {
            method: "POST",
            body: JSON.stringify({
              confirmationText: normalizedConfirmation
            })
          });
          renderStatus(response.status);
          renderPairing(response.pairing);
          setPairingFeedbackKey("identityResetMessage", false);
        } catch (error) {
          setPairingFeedbackMessage(toErrorMessage(error), true);
        } finally {
          setBusy(false);
        }
      });

      applyLocale(localeSelection);
      void loadStatus().catch(function (error) {
        setFeedbackMessage(toErrorMessage(error), true);
      });
      void loadPairing().catch(function (error) {
        renderPairingUnavailable(toErrorMessage(error));
      });
    </script>
  </body>
</html>`;
}
