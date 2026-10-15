import React from "react";
import { useLiveTelemetryFrame } from "../Telemetry/useLiveTelemetry";

// Raw telemetry-values debug dump — ported verbatim from the old #/telemetry
// app's Show/index.tsx (undocumented, not linked from any nav, reachable
// only by direct URL — kept because it was explicitly asked for, not because
// it's discoverable).
const Show: React.FC = () => {
  // On the shared hub at the ~30Hz the standalone subscription ran at. A
  // dropped connection is the hub's to recover (it reconnects on its own),
  // so there's no error state of this page's own any more.
  const { frame: t, received } = useLiveTelemetryFrame({ rateHz: 30 });

  if (!received) return <p>Waiting for sim...</p>;
  if (!t) return <p>No data</p>;
  return (
    <div style={{ fontFamily: "monospace", padding: "1rem" }}>
      <h2>{t.car} — {t.track}</h2>
      <p>Driver: {t.driver}</p>
      <p>Status: {t.simStatus}</p>

      <h3>Motion</h3>
      <p>G Lat: {t.gLat?.toFixed(2)} | G Lon: {t.gLon?.toFixed(2)} | G Vert: {t.gVert?.toFixed(2)}</p>
      <p>Pitch: {t.pitch?.toFixed(2)} | Roll: {t.roll?.toFixed(2)}</p>

      <h3>Drivetrain</h3>
      <p>Speed: {t.speed} | RPM: {t.rpm} / {t.maxRpm}</p>
      <p>Gear: {t.gear} | Throttle: {(t.throttle * 100)?.toFixed(0)}% | Brake: {(t.brake * 100)?.toFixed(0)}%</p>
      <p>Fuel: {t.fuel?.toFixed(1)} / {t.fuelCapacity?.toFixed(1)}</p>

      <h3>Tyres</h3>
      {t.tyres?.map((tyre: any, i: number) => (
        <p key={i}>{["FL","FR","RL","RR"][i]}: {tyre.temp?.toFixed(1)}°C | {tyre.pressure?.toFixed(1)} kPa | Slip: {tyre.slipRatio?.toFixed(3)}</p>
      ))}

      <h3>Session</h3>
      <p>Lap: {t.lap} | Pos: {t.position}/{t.numCars} | Flag: {t.courseFlag}</p>
      <p>In Pit: {t.inPit ? "Yes" : "No"} | Valid: {t.lapIsValid ? "Yes" : "No"}</p>
    </div>
  );
};

export default Show;
