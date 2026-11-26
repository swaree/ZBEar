import type { RestrictionWindow } from "../domain/zbe";
import type { RestrictionTable } from "./buildZbes";

/*
 * Hand-maintained Restriction Windows and barred Environmental Labels, keyed by the DGT
 * controlledZone id. Holidays and suspensions are deliberately ignored (ADR-0003).
 *
 * Add a ZBE here only once its ordinance has been checked. Until then the build publishes it
 * with the worst case (all day, every day, every label but 0 barred) and warns, so an
 * unchecked guess never gives a less safe answer than no entry at all.
 *
 * Not yet checked, so left to the worst case: Granollers, Mataró, Rubí (two DGT records,
 * "8184_ZBE Rubí" and "25120_ZBE Terrassa" in Lleida's file), Sabadell, Terrassa, Girona,
 * Lleida, Reus, Tarragona, Manlleu. DGT suggests Mon–Fri 07:00–20:00 with no label barred
 * for most (07:00–19:00 for Reus and Tarragona; C, B and no label all day for Manlleu).
 */

const MON_FRI_7_20: RestrictionWindow = { weekdays: [1, 2, 3, 4, 5], start: "07:00", end: "20:00" };

export const restrictionTable: RestrictionTable = {
  // Barcelona Rondes and the neighbouring AMB ZBEs, under the AMB's common rules:
  // Mon–Fri 07:00–20:00, vehicles with no Environmental Label barred.
  "8019_ZBE Rondes Barcelona": { name: "ZBE Rondes de Barcelona", restrictionWindow: MON_FRI_7_20, barredLabels: ["none"] },
  "8217_Sant Joan Despi": { name: "ZBE Sant Joan Despí", restrictionWindow: MON_FRI_7_20, barredLabels: ["none"] },
  "8205_ZBE Sant Cugat del Valles": { name: "ZBE Sant Cugat del Vallès", restrictionWindow: MON_FRI_7_20, barredLabels: ["none"] },
  "8169_ZBE El Prat del Llobregat": { name: "ZBE El Prat de Llobregat", restrictionWindow: MON_FRI_7_20, barredLabels: ["none"] },
  "8200_ZBE Sant Boi de Llobregat": { name: "ZBE Sant Boi de Llobregat", restrictionWindow: MON_FRI_7_20, barredLabels: ["none"] },
  "8089_ZBE Gavà": { name: "ZBE Gavà", restrictionWindow: MON_FRI_7_20, barredLabels: ["none"] },
  "8301_ZBE Viladecans": { name: "ZBE Viladecans", restrictionWindow: MON_FRI_7_20, barredLabels: ["none"] },
  "8266_Cerdanyola del Valles": { name: "ZBE Cerdanyola del Vallès", restrictionWindow: MON_FRI_7_20, barredLabels: ["none"] },
};
