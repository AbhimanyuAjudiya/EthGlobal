/**
 * Child process for rt-agent.test.ts: a second (third, …) agent process sharing one AGENT_STATE_DIR.
 * argv: <mode: claim|record> <stateDir> <count> <startAtMs>
 * claim  — races claimTrigger on triggers 0..count-1, prints the indices it won (JSON)
 * record — recordPurchase(key, 400000) count times on one key
 */
import { AgentState } from '../../src/journal.js';

const [mode, dir, countArg, startArg] = process.argv.slice(2);
const count = Number(countArg);
const startAt = Number(startArg);
const state = new AgentState(dir!);
const NOW = Date.UTC(2026, 10, 4, 12);

while (Date.now() < startAt) {
  // spin until the common start instant so both processes hit the same triggers together
}
if (mode === 'claim') {
  const won: number[] = [];
  for (let i = 0; i < count; i++) {
    if ((await state.claimTrigger(`rt-key:threshold:${i}`, NOW)).ok) won.push(i);
  }
  process.stdout.write(JSON.stringify(won));
} else {
  for (let i = 0; i < count; i++) {
    await state.recordPurchase({ key: 'rt-key', now: NOW, usd6: 400_000n });
  }
  process.stdout.write('done');
}
