import { CampaignForm } from '../../components/CampaignForm';

export const metadata = { title: 'Campaigns' };

export default function Sponsor() {
  return (
    <>
      <h1 className="console__title">Campaigns</h1>
      <CampaignForm />
    </>
  );
}
