import { AgentSheet } from '../../components/AgentSheet';
import { AppShell } from '../../components/kit';

export const metadata = { title: 'Auto top-up' };

export default function Agent() {
  return (
    <AppShell nav="more" back="/" money>
      <AgentSheet />
    </AppShell>
  );
}
