# ZBEar

ZBEar recommends where to leave a car outside every low emission zone, and how to continue by public transport, so that a trip to a destination inside a zone takes the least time.

## Zones and vehicles

**ZBE**:
A low emission zone: an area, defined by a municipality, where vehicles with certain Environmental Labels may not circulate during its Restriction Window. ZBEar considers every active ZBE in Catalonia, not only Barcelona's.
_Avoid_: LEZ, zone, perimeter (the perimeter is the ZBE's boundary, not the ZBE)

**Disputed Area**:
A place where the DGT and OSM perimeters of the same ZBE disagree by more than a small threshold (in area and in width). It counts as inside the ZBE and is marked on the map until a Settlement decides it.
_Avoid_: uncertain area, conflict

**Settlement**:
A hand-made, repo-maintained decision that a Disputed Area is inside or outside its ZBE. It is applied last and wins over both DGT and OSM.
_Avoid_: override, fix, correction

**Restriction Window**:
The recurring time span during which a ZBE bars a vehicle (e.g. Mon–Fri 07:00–20:00), assumed to apply even on holidays and during suspensions. It applies to the time the vehicle is actually *driving* inside the ZBE.
_Avoid_: schedule, opening hours

**Exempt Corridor**:
A road that runs within a ZBE's perimeter but is legally outside the ZBE, so barred vehicles may drive on it (e.g. the Rondes, B-10/B-20). It includes ramps that connect to other exempt roads or lead out of the ZBE, but not exits that lead only into the ZBE.
_Avoid_: exception, excluded road

**Environmental Label**:
The DGT classification of a vehicle (none, B, C, ECO, 0) that a ZBE uses to decide who is barred.
_Avoid_: sticker, distintivo, distintiu, badge

## Trips

**Origin**:
Where the trip starts, home by default.

**Destination**:
Where the traveller needs to be, typically inside a ZBE.

**Trip**:
A round journey from the Origin to the Destination and back, made of an Outbound Leg and a Return Leg.
_Avoid_: journey, route

**Outbound Leg**:
Origin → Parking Candidate by car, then Parking Candidate → Destination by transit.

**Return Leg**:
Destination → Parking Candidate by transit, then Parking Candidate → Origin by car. Its transit part need not mirror the Outbound Leg's.

## Recommendations

**Parking Candidate**:
A place outside every ZBE where the car can be left for the length of a Trip. It is either **Curated** (added or annotated by the user) or **Discovered** (found automatically from map data).
_Avoid_: spot, parking area, P+R (a P+R is one kind of Parking Candidate)

**Parking Conditions**:
The rules for leaving a car at a Parking Candidate: fee, maximum stay, resident-only status and the hours each applies. They may be unknown.
_Avoid_: parking rules, restrictions (reserved for ZBEs)

**Search Area**:
A stretch of streets around a transit stop outside every ZBE where street parking probably exists but no Parking Candidate is known. It is suggested for scouting and is never ranked; it leads to Curated Parking Candidates once the user adds some.
_Avoid_: parking area, zone, suggestion

**Option**:
One Parking Candidate evaluated for a specific Trip, with its door-to-door time and Remarks. Options are ranked by door-to-door time.
_Avoid_: result, route, plan

**Direct Drive**:
The Option of driving straight to the Destination, valid only when no part of the Trip drives inside a ZBE during its Restriction Window.
_Avoid_: drive-in

**Baseline**:
The door-to-door time of making the whole Trip by transit from the Origin, against which each Option's time saved is shown.
_Avoid_: comparison, reference trip

**Remark**:
A notable fact about an Option that the score leaves out, such as heavy traffic at that hour, a Rodalies leg or fuel use.
_Avoid_: warning, note, tip
