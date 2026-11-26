import { useEffect, useMemo, useState, type FormEvent } from "react";
import { recommend, returnStartsAt } from "../domain/recommend";
import type { Baseline, LatLng, Option, ParkingCandidate, Recommendation, TripRequest, TripReturn } from "../domain/types";
import { ENVIRONMENTAL_LABELS, type EnvironmentalLabel, type Zbe } from "../domain/zbe";
import { loadDiscoveredParkingCandidates } from "../data/parkingCandidates";
import { loadZbeDataset } from "../data/zbeDataset";
import { mapboxEngine } from "../routing/mapbox";
import type { RoutingEngine } from "../routing/RoutingEngine";
import { transitousEngine } from "../routing/transitous";
import { MapView } from "./MapView";
import { googleMapsTransitUrl } from "./mapLinks";
import { readTripReturn, type ReturnForm, type ReturnMode } from "./tripReturn";

/** Operators' timetables (notably Rodalies) only reach a few days ahead. */
const TIMETABLE_HORIZON_DAYS = 3;

type TapTarget = "origin" | "destination";

const RETURN_MODES: { mode: ReturnMode; label: string }[] = [
  { mode: "none", label: "None" },
  { mode: "getBackAt", label: "Get back at" },
  { mode: "stayFor", label: "Stay for" },
];

const NO_ZBES: Zbe[] = [];
const NO_CANDIDATES: ParkingCandidate[] = [];

/** Until the personal store (#14) holds vehicle settings, the label is remembered on this device only. */
const LABEL_STORAGE_KEY = "zbear:vehicle-label";

export function App() {
  const engine = useMemo<RoutingEngine>(
    () => ({ ...transitousEngine(), ...mapboxEngine({ token: import.meta.env.VITE_MAPBOX_TOKEN }) }),
    [],
  );
  const [vehicleLabel, setVehicleLabel] = useState<EnvironmentalLabel>(loadVehicleLabel);
  const [originText, setOriginText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [arriveByText, setArriveByText] = useState(defaultArriveBy);
  const [returnForm, setReturnForm] = useState<ReturnForm>({ mode: "none", getBackAt: "18:00", stayFor: "" });
  const [planned, setPlanned] = useState<{ trip: TripRequest; recommendation: Recommendation; fitTo: LatLng[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tapTarget, setTapTarget] = useState<TapTarget>("origin");
  // Planning without the ZBEs could recommend parking inside one, so it waits for them.
  const [zbes, setZbes] = useState<Zbe[] | null>(null);
  const [zbeError, setZbeError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ParkingCandidate[] | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
    loadZbeDataset().then(
      (dataset) => !cancelled && setZbes(dataset.zbes),
      (err: unknown) => !cancelled && setZbeError(message(err)),
    );
    loadDiscoveredParkingCandidates().then(
      (loaded) => !cancelled && setCandidates(loaded),
      (err: unknown) => !cancelled && setCandidateError(message(err)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const optionCandidates = useMemo(
    () => planned?.recommendation.options.map((o) => o.candidate) ?? NO_CANDIDATES,
    [planned],
  );

  const origin = parseLatLng(originText);
  const destination = parseLatLng(destinationText);
  const arriveBy = arriveByText ? new Date(arriveByText) : null;
  const tripReturn = arriveBy && readTripReturn(returnForm, arriveBy);
  const outdated =
    planned != null &&
    (!samePoint(planned.trip.origin, origin) ||
      !samePoint(planned.trip.destination, destination) ||
      planned.trip.vehicleLabel !== vehicleLabel ||
      returnKey(planned.trip) !== returnKey({ arriveBy, return: tripReturn }));
  const returnStart =
    arriveBy && tripReturn !== "invalid" ? returnStartsAt({ arriveBy, return: tripReturn ?? undefined }) : null;
  const latest = returnStart ?? arriveBy;
  const beyondHorizon = latest != null && latest.getTime() - Date.now() > TIMETABLE_HORIZON_DAYS * 86_400_000;

  function onMapTap(point: LatLng) {
    if (tapTarget === "origin") {
      setOriginText(formatLatLng(point));
      // Origin first, then the Destination: save a tap on the control when the Destination is still empty.
      if (!destination) setTapTarget("destination");
    } else {
      setDestinationText(formatLatLng(point));
    }
  }

  function onVehicleLabelChange(label: EnvironmentalLabel) {
    setVehicleLabel(label);
    try {
      localStorage.setItem(LABEL_STORAGE_KEY, label);
    } catch {
      // Storage blocked: the setting still applies until the page is reloaded.
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!origin || !destination || !arriveBy || tripReturn === "invalid" || !zbes || !candidates) return;
    setBusy(true);
    setError(null);
    try {
      const trip: TripRequest = { origin, destination, arriveBy, vehicleLabel, return: tripReturn ?? undefined };
      const recommendation = await recommend(trip, candidates, { zbes }, engine);
      const fitTo = [origin, destination, ...recommendation.options.map((o) => o.candidate.location)];
      setPlanned({ trip, recommendation, fitTo });
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
        <fieldset className="return">
          <legend>
            Return <span className="hint">optional: ranks by the round trip</span>
          </legend>
          <div className="segmented" role="radiogroup" aria-label="Return">
            {RETURN_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={returnForm.mode === mode}
                className={returnForm.mode === mode ? "active" : undefined}
                onClick={() => setReturnForm({ ...returnForm, mode })}
              >
                {label}
              </button>
            ))}
          </div>
          {returnForm.mode === "getBackAt" && (
            <label>
              Get back at <span className="hint">leave the Destination then; the next day if not after the arrival</span>
              <input
                type="time"
                value={returnForm.getBackAt}
                onChange={(e) => setReturnForm({ ...returnForm, getBackAt: e.target.value })}
                aria-invalid={tripReturn === "invalid"}
              />
            </label>
          )}
          {returnForm.mode === "stayFor" && (
            <label>
              Stay for <span className="hint">after the arrive-by time, e.g. 2h30 or 90 min</span>
              <input
                value={returnForm.stayFor}
                onChange={(e) => setReturnForm({ ...returnForm, stayFor: e.target.value })}
                placeholder="2h30"
                aria-invalid={returnForm.stayFor !== "" && tripReturn === "invalid"}
              />
            </label>
          )}
          {returnStart && arriveBy && (
            <span className="hint">Leaving the Destination {dayAndClock(returnStart, arriveBy)}</span>
          )}
        </fieldset>
        <label>
          Environmental Label <span className="hint">decides which ZBEs bar the car</span>
          <select value={vehicleLabel} onChange={(e) => onVehicleLabelChange(e.target.value as EnvironmentalLabel)}>
            {ENVIRONMENTAL_LABELS.map((label) => (
              <option key={label} value={label}>
                {label === "none" ? "None" : label}
              </option>
            ))}
          </select>
        </label>
        {beyondHorizon && (
          <p className="notice">
            More than {TIMETABLE_HORIZON_DAYS} days ahead: some operators (notably Rodalies) may not have published
            timetables yet, so Options using them may be missing.
          </p>
        )}
        {zbeError && <p className="error">Could not load the ZBEs ({zbeError}), so no Trip can be planned.</p>}
        {candidateError && (
          <p className="error">Could not load the Parking Candidates ({candidateError}), so no Trip can be planned.</p>
        )}
        <button
          type="submit"
          disabled={!origin || !destination || !arriveBy || tripReturn === "invalid" || !zbes || !candidates || busy}
        >
          {busy ? "Planning…" : zbes && candidates ? "Find parking" : "Loading map data…"}
        </button>
      </form>

      {error && <p className="error">Could not plan this Trip: {error}</p>}

      {planned && (
        <section className={outdated ? "results outdated" : "results"}>
          {outdated && (
            <p className="notice">
              The Origin, Destination, return or Environmental Label changed since planning: press Find parking again.
            </p>
          )}
          <BaselineCard baseline={planned.recommendation.baseline} trip={planned.trip} />
          {planned.recommendation.options.length === 0 ? (
            <p>
              No Parking Candidate can reach this Destination by that time{planned.trip.return ? ", and back," : ""}{" "}
              without driving through a ZBE that bars the car.
            </p>
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

      <section className="map-panel">
        <div className="tap-target" role="radiogroup" aria-label="Tap the map to set">
          <span className="hint">Tap the map to set</span>
          {(["origin", "destination"] as const).map((target) => (
            <button
              key={target}
              type="button"
              role="radio"
              aria-checked={tapTarget === target}
              className={tapTarget === target ? "active" : undefined}
              onClick={() => setTapTarget(target)}
            >
              {target === "origin" ? "Origin" : "Destination"}
            </button>
          ))}
        </div>
        <MapView
          origin={origin}
          destination={destination}
          candidates={candidates ?? NO_CANDIDATES}
          optionCandidates={optionCandidates}
          zbes={zbes ?? NO_ZBES}
          selectedId={selected}
          fitTo={planned?.fitTo ?? null}
          onTap={onMapTap}
          onOriginMoved={(p) => setOriginText(formatLatLng(p))}
          onDestinationMoved={(p) => setDestinationText(formatLatLng(p))}
        />
      </section>

      <footer className="attribution">
        <span className="legend-disputed" aria-hidden="true" /> Dashed areas: the DGT and OSM perimeters disagree, so
        they count as inside the ZBE. ZBE perimeters from the{" "}
        <a href="https://nap.dgt.es/en/dataset/zonas-de-bajas-emisiones">DGT NAP</a> (CC BY 4.0) and OpenStreetMap
        (ODbL). Transit and free-flow driving times by <a href="https://transitous.org/sources/">Transitous</a> and its data
        sources. Driving times with traffic: directions powered by{" "}
        <a href="https://www.mapbox.com/about/maps">© Mapbox</a>. Map
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
          <span className="option-total">
            {minutes(option.doorToDoorS)}
            {option.returnLeg && <span className="hint"> round trip</span>}
          </span>
        </div>
        {option.timeSavedS != null && <TimeSaved seconds={option.timeSavedS} />}
        <div className="option-split">
          drive {minutes(option.driveS)} · find a space {minutes(option.timeToFindSpaceS)} · transit{" "}
          {minutes(option.transitS)} ({transfers(option.transfers)})
        </div>
        <div className="option-times">
          Leave the Origin at {clock(option.leaveOriginAt)} · leave the parking at {clock(option.leaveParkingAt)}
        </div>
        {option.returnLeg && (
          <>
            <div className="option-split">
              back: transit {minutes(option.returnLeg.transitS)} ({transfers(option.returnLeg.transfers)}) · drive {minutes(option.returnLeg.driveS)}
            </div>
            <div className="option-times">
              Drive back from the parking at {clock(option.returnLeg.driveFromParkingAt)} · at the Origin at{" "}
              {clock(option.returnLeg.arriveOriginAt)}
            </div>
          </>
        )}
      </button>
    </li>
  );
}

function BaselineCard({ baseline, trip }: { baseline: Baseline | null; trip: TripRequest }) {
  const link = (
    <a href={googleMapsTransitUrl(trip.origin, trip.destination)} target="_blank" rel="noopener noreferrer">
      Open in Google Maps
    </a>
  );
  if (!baseline) {
    return (
      <p className="baseline">
        Transit only, no car: no connection reaches the Destination by that time
        {trip.return ? ", or brings you back" : ""}. {link}
      </p>
    );
  }
  const back = baseline.returnLeg;
  return (
    <p className="baseline">
      Transit only, no car: <strong>{minutes(baseline.transitS + (back?.transitS ?? 0))}</strong>
      {back && " round trip"}, leaving the Origin at {clock(baseline.leaveOriginAt)} ({transfers(baseline.transfers)})
      {back && (
        <>
          {" "}
          and back in {minutes(back.transitS)} ({transfers(back.transfers)}), at
          the Origin at {clock(back.arriveOriginAt)}
        </>
      )}
      . {link} <span className="hint">(set the arrival time there)</span>
    </p>
  );
}

function TimeSaved({ seconds }: { seconds: number }) {
  const m = Math.round(seconds / 60);
  if (m === 0) return <div className="time-saved">same as transit only</div>;
  return m > 0 ? (
    <div className="time-saved">{m} min faster than transit only</div>
  ) : (
    <div className="time-saved slower">{-m} min slower than transit only</div>
  );
}

function loadVehicleLabel(): EnvironmentalLabel {
  try {
    const stored = localStorage.getItem(LABEL_STORAGE_KEY);
    return ENVIRONMENTAL_LABELS.find((label) => label === stored) ?? "none";
  } catch {
    return "none";
  }
}

function parseLatLng(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Tells apart the returns that plan differently: none, unreadable, or leaving the Destination at a given moment. */
function returnKey(trip: { arriveBy: Date | null; return?: TripReturn | null | "invalid" }): string {
  if (trip.return === "invalid") return "invalid";
  const start = trip.arriveBy && trip.return ? returnStartsAt({ arriveBy: trip.arriveBy, return: trip.return }) : null;
  return start ? String(start.getTime()) : "none";
}

const samePoint = (a: LatLng, b: LatLng | null) => b != null && a.lat === b.lat && a.lng === b.lng;

/** About 1 m of precision; more digits would only be noise from a finger tap. */
const formatLatLng = (p: LatLng) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

const minutes = (s: number) => `${Math.round(s / 60)} min`;
const transfers = (n: number) => `${n} ${n === 1 ? "transfer" : "transfers"}`;
const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** A clock time, with the day when it isn't the same day as `reference`. */
function dayAndClock(d: Date, reference: Date): string {
  if (d.toDateString() === reference.toDateString()) return `at ${clock(d)}`;
  return `on ${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} at ${clock(d)}`;
}

function defaultArriveBy(): string {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
