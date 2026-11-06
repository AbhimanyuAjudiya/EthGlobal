import { AppShell } from '../../components/kit';
import { MyPlans } from '../../components/MyPlans';

export const metadata = { title: 'Your plans' };

export default function Plan() {
  return (
    <AppShell nav="plan" layout="wide">
      <MyPlans />
    </AppShell>
  );
}
