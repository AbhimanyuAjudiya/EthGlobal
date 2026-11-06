import type { AgentPolicyView, MeResponse } from '@ethglobal/protocol/schemas';

import { apiGet, claimFreeBundle, expect, test } from './fixtures';

test('agent: policy sheet persists via signed PUT; sentence updates; receipts rows show the UAID', async ({
  page,
}) => {
  const key = await claimFreeBundle(page);
  await page.goto('/agent');
  const sentence = page.getByTestId('agent-sentence');
  await expect(sentence).toHaveText(
    /^Set up 1\sGB top-ups for \$4\.00 on .+ when your plan has less than \d+\sMB remaining or nears expiry, up to \$8\.00 a day\.$/,
  );
  const current = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}`);
  await expect(sentence).toContainText(`less than ${Math.floor(current.mbTotal * 0.2)} MB`);
  // every cap buys at least one 1 GB top-up: $4 · $8 · $20
  const cap = page.getByTestId('agent-cap');
  await expect(cap.getByRole('radio')).toHaveCount(3);
  await expect(cap.locator('.chip')).toHaveText(['$4', '$8', '$20']);
  await cap.getByText('$20', { exact: true }).click();
  await expect(cap.getByRole('radio', { name: '$20' })).toBeChecked();
  // no Pause control before a policy exists
  await expect(page.getByRole('switch', { name: 'Pause' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and enable policy' }).click();
  await expect(page.getByTestId('agent-status')).toHaveText(
    /^Saved · signed by 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/,
  );
  await expect(sentence).toContainText('up to $20.00 a day');

  const saved = await apiGet<AgentPolicyView>(page, `/agent/policy/${encodeURIComponent(key)}`);
  expect(saved.policy.maxUsd6PerDay).toBe('20000000');
  expect(saved.policy.stepMb).toBe(1000);
  expect(saved.owner.toLowerCase()).toBe('0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'); // demo wallet · Anvil #5

  const pause = page.getByRole('switch', { name: 'Pause' });
  await expect(pause).not.toBeChecked();
  await pause.click();
  await expect(sentence).toHaveText('Your agent is paused. It buys nothing until you resume it.');
  // Resume is the same switch, now on
  await expect(pause).toBeChecked();
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
