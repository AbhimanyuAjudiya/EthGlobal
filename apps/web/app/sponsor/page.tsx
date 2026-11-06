import { CampaignForm } from '../../components/CampaignForm';
import { ButtonLink, PageHeader } from '../../components/kit';

export const metadata = { title: 'Campaigns' };

export default function Sponsor() {
  return (
    <>
      <PageHeader
        title="Campaigns"
        action={
          <ButtonLink href="#create-title" native variant="secondary">
            New campaign
          </ButtonLink>
        }
      />
      <CampaignForm />
    </>
  );
}
