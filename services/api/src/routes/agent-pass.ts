/**
 * POST /agent/policy/:key/pass/start and /pass/poll (docs/WORLD_AGENT_PASS.md): the World ID Agent Pass human
 * checkpoint of an agent policy. Both exist only while WORLD_AGENT_PASS_CLIENT_ID is set (404 otherwise, like any
 * unknown route); the entitlement key is the capability, as for GET /agent/policy/:key. The device code never
 * appears in either response.
 */
import { fail } from '../errors.js';

import type { AppEnv } from '../context.js';
import type { Deps } from '../deps.js';
import type { AgentPass } from '../world-agent-pass.js';
import type { Hono } from 'hono';

function passOf(deps: Deps): AgentPass {
  if (deps.agentPass === undefined) throw fail('not_found', { detail: 'agent pass is off' });
  return deps.agentPass;
}

export function registerAgentPass(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/agent/policy/:key/pass/start', async (c) => {
    const key = c.req.param('key');
    const pass = passOf(deps);
    if (!(await deps.stores.policies.get(key))) throw fail('not_found');
    return c.json(await pass.start(key));
  });

  app.post('/agent/policy/:key/pass/poll', async (c) => {
    const key = c.req.param('key');
    const pass = passOf(deps);
    if (!(await deps.stores.policies.get(key))) throw fail('not_found');
    return c.json(await pass.poll(key));
  });
}
