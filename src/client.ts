import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import {
  IncomingWebhook,
  IncomingWebhookSendArguments,
  IncomingWebhookDefaultArguments,
} from '@slack/webhook';
import { FieldFactory } from './fields';
import { HttpsProxyAgent } from 'https-proxy-agent';

export const ReportIssue = 'report-issue';
export const Success = 'success';
type SuccessType = 'success';
export const Failure = 'failure';
type FailureType = 'failure';
export const Cancelled = 'cancelled';
type CancelledType = 'cancelled';
export const Custom = 'custom';
export const Always = 'always';
type AlwaysType = 'always';
const offset = 1000 * 60 * 60 * 9;

export type Octokit = InstanceType<typeof GitHub>;

export interface With {
  status: string;
  mention: string;
  author_name: string;
  if_mention: string;
  username: string;
  icon_emoji: string;
  icon_url: string;
  channel: string;
  fields: string;
  job_name: string;
}

export interface Field {
  title: string;
  value: string;
  short: boolean;
}

const groupMention = ['here', 'channel'];
const subteamMention = 'subteam^';

export class Client {
  private fieldFactory: FieldFactory;
  private webhook: IncomingWebhook;
  private octokit: Octokit;
  private with: With;

  constructor(
    props: With,
    token: string,
    gitHubBaseUrl: string,
    webhookUrl?: string | null,
  ) {
    this.with = props;
    if (this.with.fields === '') this.with.fields = 'repo,commit';

    this.octokit = getOctokit(token);

    if (webhookUrl === undefined || webhookUrl === null || webhookUrl === '') {
      throw new Error('Specify secrets.SLACK_WEBHOOK_URL');
    }

    const options: IncomingWebhookDefaultArguments = {};
    const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
    if (proxy) {
      options.agent = new HttpsProxyAgent(proxy);
    }

    this.webhook = new IncomingWebhook(webhookUrl, options);
    this.fieldFactory = new FieldFactory(
      this.with.fields,
      this.jobName,
      gitHubBaseUrl,
      this.octokit,
    );
  }

  private get jobName() {
    const name = this.with.job_name === '' ? context.job : this.with.job_name;
    if (
      process.env.MATRIX_CONTEXT == null ||
      process.env.MATRIX_CONTEXT === 'null'
    )
      return name;
    const matrix = JSON.parse(process.env.MATRIX_CONTEXT);
    const value = Object.values(matrix).join(', ');
    return value !== '' ? `${name} (${value})` : name;
  }

  async custom(payload: string) {
    await this.fieldFactory.attachments();
    /* eslint-disable no-var */
    var template: IncomingWebhookSendArguments = eval(`template = ${payload}`);
    /* eslint-enable */
    return template;
  }

  async reportIssue(
    milestoneName: string | undefined,
  ): Promise<IncomingWebhookSendArguments | undefined> {
    await this.fieldFactory.attachments();

    const parsedIssues = await this.fieldFactory.issues(milestoneName);
    core.setOutput('issues', parsedIssues);

    if (!parsedIssues || parsedIssues.length == 0) {
      return undefined;
    }

    let milestone = '';
    let fields = '';

    for (const [index, issue] of parsedIssues.entries()) {
      milestone = issue.milestone?.title ? `[${issue.milestone?.title}]` : '';
      const new_date = new Date(new Date(issue.created_at).getTime() + offset);
      const dateFormat = `${new_date.getFullYear()}년 ${
        new_date.getMonth() + 1
      }월 ${new_date.getDate()}일 ${new_date.getHours()}시 ${new_date.getMinutes()}분`;

      fields += `
      {
        "title": "Issue",
        "value": "<${issue.html_url}|${issue.title}>",
        "short": false
      },
      {
        "title": "CreatedAt",
        "value": "${dateFormat}",
        "short": true
      }`;

      if (!milestoneName) {
        fields += `,
        {
          "title": "Milestone",
          "value": "${issue.milestone?.title ?? 'None'}",
          "short": true
        }
        `;
      }

      if (index + 1 < parsedIssues.length) {
        fields += `,`;
      }
    }

    console.log(`workflow: `, context.workflow);

    const emoji = context.workflow?.toLowerCase().startsWith('settag')
      ? ':no_entry:'
      : ':warning:';
    const color = context.workflow?.toLowerCase().startsWith('settag')
      ? 'danger'
      : 'warning';
    const issueLink = await this.fieldFactory.issueLink();
    const milestoneInput = milestoneName
      ? `\\n *Milestone*: ${milestoneName}`
      : '';

    const result = `{
      "blocks": [
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "${emoji} *${process.env.AS_REPO} has some open issues*"
          }
        },
        {
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "*Workflow*: ${process.env.AS_WORKFLOW}\\n*Open issue*: <${issueLink}|Total ${parsedIssues.length}>${milestoneInput}\\n\\n*Please check issues:*"
          }
        },
        {
          "type": "divider"
        }
      ],
      "attachments": [
        {
          "mrkdwn_in": ["text"],
          "color": "${color}",
          "fields": [
            ${fields}
          ],
          "footer": "@${process.env.AS_REF}",
          "footer_icon": "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png"
        }
      ]
    }`;

    core.debug(`example: ${result}`);
    console.log(`result: ${result}`);

    const template: IncomingWebhookSendArguments = JSON.parse(result);

    return template;
  }

  async prepare(text: string) {
    const template = await this.payloadTemplate();
    template.text = this.injectText(text);
    template.attachments[0].color = this.injectColor();
    return template;
  }

  async send(payload: string | IncomingWebhookSendArguments | undefined) {
    if (!payload) {
      console.warn('cannot send payload is empty');
      return;
    }
    core.debug(JSON.stringify(context, null, 2));
    core.debug('send');
    core.debug(JSON.stringify(payload));
    await this.webhook.send(payload);
    console.log('send message');
    core.debug('send message');
  }

  injectColor() {
    switch (this.with.status) {
      case Success:
        return 'good';
      case Cancelled:
        return 'warning';
      case Failure:
        return 'danger';
    }
    throw new Error(`invalid status: ${this.with.status}`);
  }

  injectText(value: string) {
    let text = '';
    switch (this.with.status) {
      case Success:
        text += this.mentionText(Success);
        text += this.insertText(
          ':white_check_mark: Succeeded GitHub Actions\n',
          value,
        );
        return text;
      case Cancelled:
        text += this.mentionText(Cancelled);
        text += this.insertText(':warning: Canceled GitHub Actions\n', value);
        return text;
      case Failure:
        text += this.mentionText(Failure);
        text += this.insertText(':no_entry: Failed GitHub Actions\n', value);
        return text;
    }
    throw new Error(`invalid status: ${this.with.status}`);
  }

  mentionText(status: SuccessType | FailureType | CancelledType | AlwaysType) {
    const { mention, if_mention } = this.with;
    if (!if_mention.includes(status) && if_mention !== Always) {
      return '';
    }

    const normalized = mention.replace(/ /g, '');
    if (normalized !== '') {
      const text = normalized
        .split(',')
        .map(id => this.getIdString(id))
        .join(' ');
      return `${text} `;
    }
    return '';
  }

  private insertText(defaultText: string, text: string) {
    return text === '' ? defaultText : text;
  }

  private async payloadTemplate() {
    const text = '';
    const { username, icon_emoji, icon_url, channel } = this.with;

    return {
      text,
      username,
      icon_emoji,
      icon_url,
      channel,
      attachments: [
        {
          color: '',
          author_name: this.with.author_name,
          fields: await this.fieldFactory.attachments(),
        },
      ],
    };
  }

  private getIdString(id: string): string {
    if (id.includes(subteamMention) || groupMention.includes(id))
      return `<!${id}>`;

    return `<@${id}>`;
  }
}
