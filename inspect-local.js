import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  connectHuly,
  resolveWorkspace
} from '@huly-data-xport/core';
import {
  tracker,
  contact,
  core
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
  console.log('Credentials:', creds);
  console.log('Resolving workspace:', name);
  const { slug } = await resolveWorkspace(name, creds, dummyLogger, false);
  console.log('Workspace slug resolved:', slug);
  
  console.log('Connecting to Huly...');
  const { client, close } = await connectHuly({ ...creds, workspace: slug });
  try {
    console.log('Fetching projects...');
    const projects = await client.findAll(tracker.class.Project, {});
    console.log('Projects count:', projects.length);
    for (const p of projects) {
      console.log(`- Project: ${p.name} (${p.identifier}), ID: ${p._id}`);
    }
  } finally {
    await close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
