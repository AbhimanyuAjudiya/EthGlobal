import type { AgentPolicyView } from '@ethglobal/protocol/schemas';

import { apiGet, claimFreeBundle, expect, test } from './fixtures';

test('agent: policy sheet persists via signed PUT; sentence updates; receipts rows show the UAID', async ({
  page,
}) => {
  const key = await claimFreeBundle(page);
  await page.goto('/agent');
  const sentence = page.getByTestId('agent-sentence');
  await expect(sentence).toHaveText(
    /^When your plan drops below 20 % or expires, your agent buys 100 MB for \$0\.40 on .+, up to \$10\.00 a day\.$/,
  );
  await page.getByTestId('agent-cap').getByRole('radio', { name: '≤ $5 / day' }).click();
  await expect(page.getByTestId('agent-status')).toHaveText(
    /^Saved · signed by 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/,
  );
  await expect(sentence).toContainText('up to $5.00 a day');

  const saved = await apiGet<AgentPolicyView>(page, `/agent/policy/${encodeURIComponent(key)}`);
  expect(saved.policy.maxUsd6PerDay).toBe('5000000');
  expect(saved.owner.toLowerCase()).toBe('0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'); // demo wallet · Anvil #5

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(sentence).toHaveText('Your agent is paused. It buys nothing until you resume it.');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await apiGet<AgentPolicyView>(page, `/agent/policy/${encodeURIComponent(key)}`)).policy
          .paused,
    )
    .toBe(true);

  // persisted: a reload reads the signed policy back from the API
  await page.reload();
  await expect(sentence).toHaveText('Your agent is paused. It buys nothing until you resume it.');
  // no agent top-up yet: the ghost row (rows carry the agent's UAID once it buys); never a chat UI
  await expect(page.getByText("Your agent's top-ups will appear here")).toBeVisible();
  await expect(page.locator('textarea, [role="log"]')).toHaveCount(0);
});
