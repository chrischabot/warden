/**
 * Integration types per spec §5.9.
 *
 * A `Notification` is the platform-neutral payload that integration
 * adapters consume. Adapters render this into channel-specific
 * outbound payloads (Slack Block Kit, Email MIME, PagerDuty Events
 * v2, GitHub issue body, Jira issue body, etc.).
 *
 * Notifications cover three event-categories that integrations
 * care about today: a new/escalated issue, a metric alert firing,
 * and a cron-monitor incident.
 */

export type NotificationKind = 'issue-alert' | 'metric-alert' | 'cron-incident';

export type Severity = 'fatal' | 'error' | 'warning' | 'info';

export interface NotificationLink {
  readonly label: string;
  readonly url: string;
}

export interface NotificationFact {
  readonly label: string;
  readonly value: string;
}

export interface Notification {
  readonly kind: NotificationKind;
  readonly severity: Severity;
  readonly title: string;
  readonly body: string;
  readonly projectSlug: string;
  readonly environment?: string;
  readonly release?: string;
  readonly fingerprint?: string;
  readonly links: readonly NotificationLink[];
  readonly facts?: readonly NotificationFact[];
  readonly occurrenceAt: number;
}

export interface OutboundPayload {
  readonly channel: ChannelKind;
  readonly target: string;
  readonly contentType: string;
  readonly body: string;
}

export type ChannelKind =
  | 'slack'
  | 'webhook'
  | 'email'
  | 'github'
  | 'jira'
  | 'pagerduty'
  | 'opsgenie';

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  format(notification: Notification, options: AdapterOptions): OutboundPayload;
}

export interface AdapterOptions {
  /** Channel-specific target (slack channel, webhook URL, email address, etc.). */
  readonly target: string;
  /** Optional channel-specific configuration. */
  readonly config?: Readonly<Record<string, unknown>>;
}
