import { InstallSteps } from '../../components/InstallSteps';

export const metadata = { title: 'Install your eSIM' };

/** Takes no URL parameter: the activation code comes only from this device's storage (T-62). */
export default function Install() {
  return <InstallSteps />;
}
