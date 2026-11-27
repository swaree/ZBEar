import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { detailOption, type OptionDetails } from "../domain/optionDetails";
import { recommend, returnStartsAt } from "../domain/recommend";
import type {
  Baseline,
  DirectDrive,
  LatLng,
  LeaveOutsideRestrictionRemark,
  Option,
  ParkingCandidate,
  ParkingConditionName,
  ParkingConflict,
  Recommendation,
  Remark,
  TripRequest,
  TripReturn,
} from "../domain/types";
import { ENVIRONMENTAL_LABELS, type EnvironmentalLabel, type Zbe } from "../domain/zbe";
import { loadDiscoveredParkingCandidates } from "../data/parkingCandidates";
import { loadZbeDataset } from "../data/zbeDataset";
import { mapboxEngine } from "../routing/mapbox";
import type { RideMode, RoutingEngine, TransitItinerary } from "../routing/RoutingEngine";
import { transitousEngine } from "../routing/transitous";
import { formatDuration } from "./duration";
import { MapView, type DrawnPart } from "./MapView";
import { googleMapsDrivingUrl, googleMapsTransitUrl, wazeNavigationUrl } from "./mapLinks";
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
const NO_PARTS: DrawnPart[] = [];

/** Which of a round trip's legs the map draws. */
type DrawnLegs = "both" | "outbound" | "return";

const DRAWN_LEGS: { legs: DrawnLegs; label: string }[] = [
  { legs: "both", label: "Both" },
  { legs: "outbound", label: "Outbound" },
  { legs: "return", label: "Return" },
];

/** An Option's details: undefined while they load, then what they are, or why they couldn't be had. */
type DetailsState = OptionDetails | { error: string } | undefined;

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
  const [drawnLegs, setDrawnLegs] = useState<DrawnLegs>("both");
  // Keyed by Parking Candidate id, for the Options of the planned Trip only.
  const [details, setDetails] = useState<ReadonlyMap<string, DetailsState>>(new Map());
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

  // Itineraries are heavy, so they are fetched only for the Options shown, once those are known: one
  // Option at a time, best first, so the selected one arrives first and Transitous isn't sent a burst.
  useEffect(() => {
    if (!planned) return;
    let cancelled = false;
    void (async () => {
      for (const option of planned.recommendation.options) {
        if (cancelled) return;
        let result: DetailsState;
        try {
          result = await detailOption(planned.trip, option, engine);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        if (!cancelled) setDetails((prev) => new Map(prev).set(option.candidate.id, result));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planned, engine]);

  const selectedOption = planned?.recommendation.options.find((o) => o.candidate.id === selected);
  const selectedDetails = selected ? details.get(selected) : undefined;
  // The drives are drawn as soon as the Option is selected; its walks and rides join once its details load.
  const drawnParts = useMemo(
    () =>
      selectedOption
        ? drawnPartsOf(
            selectedOption,
            selectedDetails && !("error" in selectedDetails) ? selectedDetails : null,
            selectedOption.returnLeg ? drawnLegs : "outbound",
          )
        : NO_PARTS,
    [selectedOption, selectedDetails, drawnLegs],
  );

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
      setDetails(new Map());
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
        <div className="map-wrap">
          <MapView
            origin={origin}
            destination={destination}
            candidates={candidates ?? NO_CANDIDATES}
            optionCandidates={optionCandidates}
            zbes={zbes ?? NO_ZBES}
            selectedId={selected}
            fitTo={planned?.fitTo ?? null}
            drawn={drawnParts}
            onTap={onMapTap}
            onOriginMoved={(p) => setOriginText(formatLatLng(p))}
            onDestinationMoved={(p) => setDestinationText(formatLatLng(p))}
          />
          {selectedOption && (
            <div className="map-overlay">
              {selectedOption.returnLeg && (
                <div className="map-toggle" role="radiogroup" aria-label="Draw">
                  {DRAWN_LEGS.map(({ legs, label }) => (
                    <button
                      key={legs}
                      type="button"
                      role="radio"
                      aria-checked={drawnLegs === legs}
                      className={drawnLegs === legs ? "active" : undefined}
                      onClick={() => setDrawnLegs(legs)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <p className="drawn-legend">
                <span className="legend-drive" aria-hidden="true" /> drive <span className="legend-ride" aria-hidden="true" />{" "}
                rail, metro, tram <span className="legend-bus" aria-hidden="true" /> bus{" "}
                <span className="legend-walk" aria-hidden="true" /> walk
              </p>
            </div>
          )}
        </div>
      </section>

      {planned && (
        <section className={outdated ? "results outdated" : "results"}>
          {outdated && (
            <p className="notice">
              The Origin, Destination, return or Environmental Label changed since planning: press Find parking again.
            </p>
          )}
          <BaselineCard baseline={planned.recommendation.baseline} trip={planned.trip} />
          {planned.recommendation.directDrive && (
            <DirectDriveCard directDrive={planned.recommendation.directDrive} trip={planned.trip} />
          )}
          {planned.recommendation.options.length === 0 ? (
            <p>
              No Parking Candidate can reach this Destination by that time{planned.trip.return ? ", and back," : ""}{" "}
              without driving through a ZBE that bars the car.
            </p>
          ) : (
            <ol className="options">
              {planned.recommendation.options.map((o, i, all) => (
                <Fragment key={o.candidate.id}>
                  {o.parkingConflicts.length > 0 && !all[i - 1]?.parkingConflicts.length && (
                    <li className="tier-divider">
                      {i === 0 ? "Every Option's" : "Below, the"} Parking Conditions conflict with your stay
                    </li>
                  )}
                  <OptionCard
                    option={o}
                    details={details.get(o.candidate.id)}
                    arrival={planned.trip.arriveBy}
                    selected={o.candidate.id === selected}
                    onSelect={() => setSelected(o.candidate.id)}
                  />
                </Fragment>
              ))}
            </ol>
          )}
        </section>
      )}


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

function OptionCard({
  option,
  details,
  arrival,
  selected,
  onSelect,
}: {
  option: Option;
  details: DetailsState;
  arrival: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  const conflicting = option.parkingConflicts.length > 0;
  const parking = option.candidate.location;
  return (
    <li className={["option", selected && "selected", conflicting && "conflicting"].filter(Boolean).join(" ")}>
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-expanded={selected}>
        <div className="option-head">
          <span className="option-name">{option.candidate.name}</span>
          <span className="option-total">
            {formatDuration(option.doorToDoorS)}
            {option.returnLeg && <span className="hint"> round trip</span>}
          </span>
        </div>
        {option.timeSavedS != null && <TimeSaved seconds={option.timeSavedS} />}
        <div className="option-split">
          drive {formatDuration(option.driveS)} · find a space {formatDuration(option.timeToFindSpaceS)} · transit{" "}
          {formatDuration(option.transitS)} ({transfers(option.transfers)})
        </div>
        <div className="option-times">
          Leave the Origin at {clock(option.leaveOriginAt)} · leave the parking at {clock(option.leaveParkingAt)}
        </div>
        {option.returnLeg && (
          <>
            <div className="option-split">
              back: transit {formatDuration(option.returnLeg.transitS)} ({transfers(option.returnLeg.transfers)}) · drive {formatDuration(option.returnLeg.driveS)}
            </div>
            <div className="option-times">
              Drive back from the parking at {clock(option.returnLeg.driveFromParkingAt)} · at the Origin at{" "}
              {clock(option.returnLeg.arriveOriginAt)}
            </div>
          </>
        )}
        {conflicting && (
          <p className="notice conflict">
            Conflicts with your stay: {option.parkingConflicts.map((c) => conflictText(c, arrival)).join("; ")}.
          </p>
        )}
        {option.remarks.map((remark) => (
          <p key={remark.kind} className="notice">
            {remarkText(remark, arrival)}
          </p>
        ))}
      </button>
      {selected && (
        <div className="option-details">
          <p className="navigate">
            Navigate to the parking:{" "}
            <a href={googleMapsDrivingUrl(parking)} target="_blank" rel="noopener noreferrer">
              Google Maps
            </a>{" "}
            ·{" "}
            <a href={wazeNavigationUrl(parking)} target="_blank" rel="noopener noreferrer">
              Waze
            </a>
          </p>
          {details === undefined ? (
            <p className="hint">Loading the transit steps…</p>
          ) : "error" in details ? (
            <p className="hint">Could not load the transit steps ({details.error}).</p>
          ) : (
            <>
              <TransitSteps
                title="To the Destination"
                itinerary={details.transitThere}
                start="the parking"
                end="the Destination"
              />
              {option.returnLeg && (
                <TransitSteps title="Back" itinerary={details.transitBack} start="the Destination" end="the parking" />
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

const RIDE_NAMES: Record<RideMode, string> = {
  bus: "Bus",
  coach: "Coach",
  tram: "Tram",
  subway: "Metro",
  rail: "Train",
  ferry: "Ferry",
  funicular: "Funicular",
  "aerial-lift": "Cable car",
  other: "Transit",
};

/** Walks shorter than this are a change at the same stop, so their distance isn't worth showing. */
const MIN_SHOWN_WALK_M = 50;

/** An itinerary's walks and rides, one line each; `start` and `end` name its two ends. */
function TransitSteps({
  title,
  itinerary,
  start,
  end,
}: {
  title: string;
  itinerary: TransitItinerary | null;
  start: string;
  end: string;
}) {
  if (!itinerary) return <p className="hint">{title}: no itinerary found.</p>;
  return (
    <div className="steps">
      <div className="steps-title">
        {title}: {clock(itinerary.departAt)} → {clock(itinerary.arriveAt)}{" "}
        <span className="hint">({transfers(itinerary.transfers)})</span>
      </div>
      <ol>
        {itinerary.legs.map((leg, i) => {
          const duration = formatDuration((leg.arriveAt.getTime() - leg.departAt.getTime()) / 1000);
          if (leg.mode === "walk") {
            return (
              <li key={i} className="step step-walk">
                Walk {duration}
                {leg.distanceM >= MIN_SHOWN_WALK_M && <> ({Math.round(leg.distanceM / 10) * 10} m)</>} to {leg.toName ?? end}
              </li>
            );
          }
          const stops = leg.stopsBetween + 1;
          return (
            <li key={i} className="step step-ride">
              <span className="line-badge" style={lineBadgeStyle(leg.color)}>
                {leg.line || RIDE_NAMES[leg.mode]}
              </span>{" "}
              {RIDE_NAMES[leg.mode]}
              {leg.headsign && <> towards {leg.headsign}</>}: {clock(leg.departAt)} {leg.fromName ?? start} →{" "}
              {clock(leg.arriveAt)} {leg.toName ?? end}{" "}
              <span className="hint">
                ({stops} {stops === 1 ? "stop" : "stops"}, {duration}
                {leg.agency && <>, {leg.agency}</>})
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A line's badge in its own colour, with whichever of white or near-black text reads better on it. */
function lineBadgeStyle(color: string | null): { background: string; color: string } | undefined {
  if (!color) return undefined;
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { background: color, color: luminance > 0.5 ? "#1c1f1e" : "#ffffff" };
}

/**
 * What the map draws of an Option: each drive (the ones checked against the ZBEs) and, once its details
 * are in, each walk and ride; of the Outbound Leg, the Return Leg, or both.
 */
function drawnPartsOf(option: Option, details: OptionDetails | null, legs: DrawnLegs): DrawnPart[] {
  const ridden = (leg: DrawnPart["leg"], itinerary: TransitItinerary | null | undefined) =>
    (itinerary?.legs ?? []).map(
      (step): DrawnPart => ({ leg, mode: step.mode, path: step.path, color: step.mode === "walk" ? null : step.color }),
    );
  const outbound: DrawnPart[] = [
    { leg: "outbound", mode: "drive", path: option.drivePath, color: null },
    ...ridden("outbound", details?.transitThere),
  ];
  const back: DrawnPart[] = option.returnLeg
    ? [
        ...ridden("return", details?.transitBack),
        { leg: "return", mode: "drive", path: option.returnLeg.drivePath, color: null },
      ]
    : [];
  if (legs === "outbound") return outbound;
  if (legs === "return") return back;
  return [...outbound, ...back];
}

function conflictText(conflict: ParkingConflict, arrival: Date): string {
  switch (conflict.kind) {
    case "max-stay-exceeded":
      return `stays longer than the maximum ${formatDuration(conflict.maxStayS)}`;
    case "resident-only":
      return "residents only";
    case "closed-during-stay":
      return `closed from ${dayClock(conflict.closedFrom, arrival)}`;
  }
}

const CONDITION_NAMES: Record<ParkingConditionName, string> = {
  "max-stay": "maximum stay",
  access: "who may park",
  "opening-hours": "opening hours",
};

function DirectDriveCard({ directDrive, trip }: { directDrive: DirectDrive; trip: TripRequest }) {
  const back = directDrive.returnLeg;
  return (
    <div className="direct-drive">
      <div className="option-head">
        <span className="option-name">Direct Drive</span>
        <span className="option-total">
          {formatDuration(directDrive.doorToDoorS)}
          {back && <span className="hint"> round trip</span>}
        </span>
      </div>
      {directDrive.timeSavedS != null && <TimeSaved seconds={directDrive.timeSavedS} />}
      <div className="option-split">
        Never inside a ZBE while it bars the car{back ? ", there or back" : ""}: drive {formatDuration(directDrive.driveS)} · find a space{" "}
        {formatDuration(directDrive.timeToFindSpaceS)}
        {back && <> · drive back {formatDuration(back.driveS)}</>}
      </div>
      <div className="option-times">
        Leave the Origin at {clock(directDrive.leaveOriginAt)}
        {back && <> · at the Origin again at {clock(back.arriveOriginAt)}</>}
      </div>
      {directDrive.remarks.map((remark) => (
        <p key={remark.kind} className="notice">
          {remarkText(remark, trip.arriveBy)}
        </p>
      ))}
    </div>
  );
}

function remarkText(remark: Remark, arrival: Date): string {
  switch (remark.kind) {
    case "leave-outside-restriction":
      return leaveOutsideRestrictionText(remark, arrival);
    case "parking-conditions-unverified":
      return `Parking Conditions unverified: ${listed(remark.unknown.map((name) => CONDITION_NAMES[name]))} unknown.`;
    case "leave-parking-by":
      return `Leave the parking by ${dayClock(remark.leaveBy, arrival)}, ${
        remark.because === "max-stay" ? "when the maximum stay runs out" : "when it closes"
      }.`;
  }
}

/** "a", "a and b", "a, b and c". */
function listed(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function leaveOutsideRestrictionText(remark: LeaveOutsideRestrictionRemark, arrival: Date): string {
  const zbes = remark.zbeNames.join(", ");
  const outBy = remark.restrictedFrom > arrival ? `are out of ${zbes} by ${dayClock(remark.restrictedFrom, arrival)}` : null;
  const leaveAfter = remark.restrictedUntil && `leave after ${dayClock(remark.restrictedUntil, arrival)}`;
  return `Only valid if you ${[leaveAfter, outBy].filter(Boolean).join(", or ") || `never drive out of ${zbes}`}.`;
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
      Transit only, no car: <strong>{formatDuration(baseline.transitS + (back?.transitS ?? 0))}</strong>
      {back && " round trip"}, leaving the Origin at {clock(baseline.leaveOriginAt)} ({transfers(baseline.transfers)})
      {back && (
        <>
          {" "}
          and back in {formatDuration(back.transitS)} ({transfers(back.transfers)}), at
          the Origin at {clock(back.arriveOriginAt)}
        </>
      )}
      . {link} <span className="hint">(set the arrival time there)</span>
    </p>
  );
}

function TimeSaved({ seconds }: { seconds: number }) {
  if (Math.round(seconds / 60) === 0) return <div className="time-saved">same as transit only</div>;
  return seconds > 0 ? (
    <div className="time-saved">{formatDuration(seconds)} faster than transit only</div>
  ) : (
    <div className="time-saved slower">{formatDuration(-seconds)} slower than transit only</div>
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

const transfers = (n: number) => `${n} ${n === 1 ? "transfer" : "transfers"}`;
const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** A clock time, after the weekday when it isn't the same day as `reference`: "20:00" or "Mon 20:00". */
function dayClock(d: Date, reference: Date): string {
  if (d.toDateString() === reference.toDateString()) return clock(d);
  return `${d.toLocaleDateString([], { weekday: "short" })} ${clock(d)}`;
}

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
