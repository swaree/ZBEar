import { useMemo, useState, type FormEvent } from "react";
import { recommend } from "../domain/recommend";
import type { LatLng, Option, Recommendation, TripRequest } from "../domain/types";
import { seedCandidates } from "../data/seedCandidates";
import { transitousEngine } from "../routing/transitous";
import { MapView } from "./MapView";

/** Operators' timetables (notably Rodalies) only reach a few days ahead. */
const TIMETABLE_HORIZON_DAYS = 3;

export function App() {
  const engine = useMemo(() => transitousEngine(), []);
  const [originText, setOriginText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [arriveByText, setArriveByText] = useState(defaultArriveBy);
  const [planned, setPlanned] = useState<{ trip: TripRequest; recommendation: Recommendation } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const origin = parseLatLng(originText);
  const destination = parseLatLng(destinationText);
  const arriveBy = arriveByText ? new Date(arriveByText) : null;
  const beyondHorizon = arriveBy != null && arriveBy.getTime() - Date.now() > TIMETABLE_HORIZON_DAYS * 86_400_000;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!origin || !destination || !arriveBy) return;
    setBusy(true);
    setError(null);
    try {
      const trip: TripRequest = { origin, destination, arriveBy };
      const recommendation = await recommend(trip, seedCandidates, engine);
      setPlanned({ trip, recommendation });
      setSelected(recommendation.options[0]?.candidate.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>ZBEar</h1>
        <p>Where to park outside the ZBE, and how to continue by transit.</p>
      </header>

      <form className="trip-form" onSubmit={onSubmit}>
        <label>
          Origin <span className="hint">lat, lng</span>
          <input
            value={originText}
            onChange={(e) => setOriginText(e.target.value)}
            placeholder="41.40, 2.00"
            inputMode="decimal"
            aria-invalid={originText !== "" && !origin}
          />
        </label>
        <label>
          Destination <span className="hint">lat, lng</span>
          <input
            value={destinationText}
            onChange={(e) => setDestinationText(e.target.value)}
            placeholder="41.387, 2.170"
            inputMode="decimal"
            aria-invalid={destinationText !== "" && !destination}
          />
        </label>
        <label>
          Arrive by
          <input type="datetime-local" value={arriveByText} onChange={(e) => setArriveByText(e.target.value)} />
        </label>
        {beyondHorizon && (
          <p className="notice">
            More than {TIMETABLE_HORIZON_DAYS} days ahead: some operators (notably Rodalies) may not have published
            timetables yet, so Options using them may be missing.
          </p>
        )}
        <button type="submit" disabled={!origin || !destination || !arriveBy || busy}>
          {busy ? "Planning…" : "Find parking"}
        </button>
      </form>

      {error && <p className="error">Could not plan this Trip: {error}</p>}

      {planned && (
        <section className="results">
          {planned.recommendation.options.length === 0 ? (
            <p>No Parking Candidate can reach this Destination by that time.</p>
          ) : (
            <ol className="options">
              {planned.recommendation.options.map((o) => (
                <OptionCard
                  key={o.candidate.id}
                  option={o}
                  selected={o.candidate.id === selected}
                  onSelect={() => setSelected(o.candidate.id)}
                />
              ))}
            </ol>
          )}
        </section>
      )}

      <MapView
        origin={planned?.trip.origin ?? origin}
        destination={planned?.trip.destination ?? destination}
        candidates={seedCandidates}
        selectedId={selected}
      />

      <footer className="attribution">
        Transit and driving times by <a href="https://transitous.org/sources/">Transitous</a> and its data sources. Map
        data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles by{" "}
        <a href="https://openfreemap.org">OpenFreeMap</a>.
      </footer>
    </div>
  );
}

function OptionCard({ option, selected, onSelect }: { option: Option; selected: boolean; onSelect: () => void }) {
  return (
    <li className={selected ? "option selected" : "option"}>
      <button type="button" onClick={onSelect}>
        <div className="option-head">
          <span className="option-name">{option.candidate.name}</span>
          <span className="option-total">{minutes(option.doorToDoorS)}</span>
        </div>
        <div className="option-split">
          drive {minutes(option.driveS)} · find a space {minutes(option.timeToFindSpaceS)} · transit{" "}
          {minutes(option.transitS)} ({option.transfers} {option.transfers === 1 ? "transfer" : "transfers"})
        </div>
        <div className="option-times">
          Leave the Origin at {clock(option.leaveOriginAt)} · leave the parking at {clock(option.leaveParkingAt)}
        </div>
      </button>
    </li>
  );
}

function parseLatLng(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const minutes = (s: number) => `${Math.round(s / 60)} min`;
const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function defaultArriveBy(): string {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
