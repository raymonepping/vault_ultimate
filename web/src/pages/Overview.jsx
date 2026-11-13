import { ErrorNotice, Loading } from '../components/ui.jsx';
import { Hero, useNow, usePlaces } from '../components/sync.jsx';
import { PlacesTable } from '../components/places.jsx';

export default function Overview() {
  const places = usePlaces();
  const now = useNow();
  if (places.error?.status === 401) return <ErrorNotice error={places.error} />;
  const data = places.sources.data;
  return (
    <>
      <Hero
        compact={false}
        places={places}
        title="Pulled in once, pushed out everywhere"
        lede="Tidewell Ferries keeps its old secrets in an AWS-shaped store. Vault pulls them in once with Secrets Import and becomes their system of record, then pushes them out with Secrets Sync, so one change in Vault lands in GitHub Actions and in the AWS copy."
      />
      <ErrorNotice error={places.error} />
      <div className="grid-2">
        <section className="vg-card" aria-labelledby="pull-h">
          <h3 id="pull-h">Pull: Secrets Import</h3>
          <p className="card-sub">Vault reads the legacy store once, shows a plan of what it will write, and writes each secret to kv/parcel/ as version 1, with the store&apos;s tags as labels. Vault refuses a second import: it would write a new version over the first.</p>
        </section>
        <section className="vg-card" aria-labelledby="push-h">
          <h3 id="push-h">Push: Secrets Sync</h3>
          <p className="card-sub">Vault keeps a copy where workloads read it: a GitHub Actions secret and an AWS Secrets Manager secret. A new version in Vault reaches both within seconds. Remove the association and Vault deletes the copy.</p>
        </section>
      </div>
      <section className="vg-card" aria-labelledby="places-h">
        <div className="card-head">
          <h3 id="places-h">What each place holds</h3>
          <span className="card-sub">Fingerprints (first 8 hex of SHA-256), never values</span>
        </div>
        {!data ? <Loading /> : <PlacesTable secrets={data.secrets} now={now} />}
      </section>
    </>
  );
}
