import type { Settlement } from "./buildZbes";

/*
 * Hand-maintained decisions on disputed areas: the places where the DGT and OSM perimeters of
 * a ZBE disagree by more than the build's threshold. Until settled, a disputed area counts as
 * inside its ZBE and is marked on the map.
 *
 * A settlement names the ZBE and any point inside the disputed area (copy it from the map), so
 * it keeps matching when the area's exact shape shifts between rebuilds. Settlements are
 * applied last and win over both sources:
 *   - "inside": the area becomes part of the ZBE's perimeter;
 *   - "outside": the area is left out, even where DGT's perimeter has it.
 *
 * Settle only after checking the ordinance's own map. The build warns about a settlement that
 * matches no disputed area (OSM or DGT was corrected since), so it can be removed.
 */
export const settlements: Settlement[] = [];
