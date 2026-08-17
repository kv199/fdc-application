# Coach reference through the finish tail

The HUD treats an available `coach_reference` with an empty `corner` and
`phase: "between"` as the straight after the final detected corner. It renders
`TO FINISH` in the Coach card while continuing to move the lap-delta marker
from the payload's `lapDeltaMs`.

This state is different from `available: false`, which means that no historical
reference is loaded and the Coach remains hidden. The official result is still
received as `lap_complete` at the game's lap boundary.
