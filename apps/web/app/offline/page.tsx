import { AppHeader } from '../../components/Shell';
import { T } from '../../i18n/lang';

export const metadata = { title: 'Offline' };

/** The service worker's fallback page (precached). */
export default function Offline() {
  return (
    <main className="screen">
      <AppHeader />
      <h1 className="screen__title">
        <T k="offline.title" />
      </h1>
      <p className="note">
        <T k="offline.body" />
      </p>
      <a className="ui-button ui-button--block" data-variant="secondary" href="/plan">
        <T k="tab.plan" />
      </a>
    </main>
  );
}
