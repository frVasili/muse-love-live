import crypto from 'node:crypto';
import {Client} from 'discord.js';

const webhookUrl = process.env.KOMODO_IDLE_UPDATE_WEBHOOK_URL;
const webhookSecret = process.env.KOMODO_WEBHOOK_SECRET;
const delaySeconds = Number(process.env.KOMODO_IDLE_UPDATE_DELAY_SECONDS ?? 120);
const cooldownMinutes = Number(process.env.KOMODO_IDLE_UPDATE_COOLDOWN_MINUTES ?? 720);

let lastTriggered = 0;
let timer: NodeJS.Timeout | undefined;

function botIsInAnyVoiceChannel (client: Client): boolean {
  return client.guilds.cache.some (guild => Boolean (guild.members.me?.voice.channelId));
}

async function triggerWebhook (): Promise<void> {
  if (!webhookUrl || !webhookSecret) {
    return;
  }

  const now = Date.now ();

  if (now - lastTriggered < cooldownMinutes * 60 * 1000) {
    return;
  }

  const payload = JSON.stringify ({
    ref: 'refs/heads/main',
    repository: {
      full_name: 'muse-idle-update',
    },
    sender: {
      login: 'muse',
    },
  });

  const signature = crypto
    .createHmac ('sha256', webhookSecret)
    .update (payload)
    .digest ('hex');

  const res = await fetch (webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'push',
      'X-Hub-Signature-256': `sha256=${signature}`,
    },
    body: payload,
  });

  if (!res.ok) {
    console.error (`Komodo idle update webhook failed: ${res.status} ${res.statusText}`);
    return;
  }

  lastTriggered = now;
  console.log ('Triggered Komodo idle update webhook');
}

export function startIdleUpdateWebhook (client: Client): void {
  if (!webhookUrl || !webhookSecret) {
    return;
  }

  client.on ('voiceStateUpdate', () => {
    if (timer) {
      clearTimeout (timer);
    }

    timer = setTimeout (() => {
      if (!botIsInAnyVoiceChannel (client)) {
        void triggerWebhook ();
      }
    }, delaySeconds * 1000);
  });
}
