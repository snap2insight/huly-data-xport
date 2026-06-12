import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  connectHuly,
  resolveWorkspace
} from '@huly-data-xport/core';
import {
  tracker,
  contact,
  core,
  chunter
} from './packages/core/dist/huly/platform.js';

function loadEnv(envPath) {
  if (!existsSync(envPath)) {
    console.error('.env not found at', envPath);
    process.exit(1);
  }
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnv('./.env-local');

const creds = {
  user: process.env.HULY_API_USER,
  password: process.env.HULY_PASSWORD,
  frontUrl: process.env.HULY_FRONT_URL || 'http://localhost:8087'
};

const name = process.env.HULY_WORKSPACE || 'acme-dev';

const dummyLogger = {
  info: (...args) => console.log('INFO:', ...args),
  warn: (...args) => console.warn('WARN:', ...args),
  debug: (...args) => console.log('DEBUG:', ...args),
  error: (...args) => console.error('ERROR:', ...args)
};

async function main() {
  const { slug } = await resolveWorkspace(name, creds, dummyLogger, false);
  const { client, close } = await connectHuly({ ...creds, workspace: slug });
  try {
    console.log('Finding issues...');
    const api1 = await client.findOne(tracker.class.Issue, { identifier: 'API-1' });
    const api2 = await client.findOne(tracker.class.Issue, { identifier: 'API-2' });

    if (!api1 || !api2) {
      console.error('API-1 or API-2 not found in local workspace');
      return;
    }

    console.log(`API-1 ID: ${api1._id}`);
    console.log(`API-2 ID: ${api2._id}`);

    // Add blockedBy relation from API-2 to API-1
    console.log('Adding relations...');
    await client.updateDoc(tracker.class.Issue, api2.space, api2._id, {
      $push: { blockedBy: { _id: api1._id, _class: tracker.class.Issue } }
    });
    console.log('Relation added successfully!');

    // Add comment to API-2
    console.log('Adding comment...');
    await client.addCollection(
      chunter.class.ChatMessage, api2.space, api2._id, tracker.class.Issue, 'comments',
      { message: 'Completed the initial token rotation checks, moving to review.', attachments: 0 }
    );
    console.log('Comment added successfully!');
  } finally {
    await close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
