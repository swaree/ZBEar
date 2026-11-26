import type { CorridorCorrection, ExemptRoadTable } from "./buildExemptCorridors";

/*
 * Hand-maintained exempt roads, keyed by the id of the ZBE they run through: roads within its
 * perimeter that are legally outside it, so barred vehicles may drive on them. The build makes
 * their main carriageways (by OSM `ref` and `highway` class) Exempt Corridors, plus the ramps
 * that connect them to each other or lead out of the ZBE; exits that lead only into the ZBE are
 * not exempt.
 *
 * Rondes de Barcelona: the only roads its ordinance leaves out of it are the Ronda de Dalt (B-20)
 * and the Ronda Litoral (B-10). The roads they lead out on (A-2, B-23, C-31, C-32, C-58) still run inside the
 * perimeter for a while in L'Hospitalet, Cornellà, Esplugues and Sant Adrià; they count as the
 * ways out. OSM tags city avenues with some of those refs too (Gran Via and Túnel de les Glòries
 * as C-31, part of Avinguda Diagonal as B-23), which the classes listed here leave out.
 */
export const exemptRoads: ExemptRoadTable = {
  "8019_ZBE Rondes Barcelona": [
    { ref: "B-10", highways: ["motorway", "trunk"] },
    { ref: "B-20", highways: ["motorway", "trunk"] },
    { ref: "A-2", highways: ["motorway", "trunk"] },
    { ref: "B-23", highways: ["motorway", "trunk"] },
    // Gran Via de les Corts Catalanes is C-31 `trunk` and `primary` in OSM.
    { ref: "C-31", highways: ["motorway"] },
    { ref: "C-32", highways: ["motorway", "trunk"] },
    { ref: "C-58", highways: ["motorway", "trunk"] },
  ],
};

/*
 * Hand-maintained corrections to the Exempt Corridors, one OSM way each, applied over the table
 * and the ramp rule:
 *   - "exempt": the whole way is exempt, and ramps that connect to it count as connecting to an
 *     exempt road;
 *   - "not-exempt": no part of it is, and no ramp is exempt by way of it.
 *
 * Correct only after checking the ordinance. The build warns about a correction whose way is no
 * longer in OSM (deleted, or split under a new id), so it can be checked again.
 */
export const corridorCorrections: CorridorCorrection[] = [];
