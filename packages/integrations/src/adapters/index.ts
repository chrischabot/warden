import type { ChannelAdapter, ChannelKind } from '../types';
import { EmailAdapter } from './email';
import { GitHubAdapter } from './github';
import { JiraAdapter } from './jira';
import { OpsGenieAdapter } from './opsgenie';
import { PagerDutyAdapter } from './pagerduty';
import { SlackAdapter } from './slack';
import { WebhookAdapter } from './webhook';

export const ADAPTERS: Readonly<Record<ChannelKind, ChannelAdapter>> = Object.freeze({
  slack: SlackAdapter,
  webhook: WebhookAdapter,
  email: EmailAdapter,
  github: GitHubAdapter,
  jira: JiraAdapter,
  pagerduty: PagerDutyAdapter,
  opsgenie: OpsGenieAdapter,
});

export function adapter(kind: ChannelKind): ChannelAdapter {
  return ADAPTERS[kind];
}

export {
  EmailAdapter,
  GitHubAdapter,
  JiraAdapter,
  OpsGenieAdapter,
  PagerDutyAdapter,
  SlackAdapter,
  WebhookAdapter,
};
