# Aztec Scanning

This project evaluates reading Aztec labels on boxes, including small labels in a distant scene and brief camera passes.

## Language

**Scene**:
One captured view of the boxes, held unchanged while it is searched.

**Sweep**:
A complete search of one scene for readable Aztec codes.
_Avoid_: Frame scan

**Search pass**:
One attempt to read codes in a particular view of the scene.

**Payload**:
The data encoded in an Aztec code.

**Scan result**:
A successfully decoded payload from a code observed by the camera.
_Avoid_: Detection, validation

**Unique result**:
The first scan result with a particular payload in a scanning session. Two boxes carrying the same payload produce one unique result.

**Duplicate result**:
A payload seen in an earlier scene of the current session and read again in a later scene. Repeated reads within the same scene count only once.

**Scanning session**:
The period over which unique results are retained, ending when the page is refreshed or a fresh scanning run is started.

**Swipe**:
A brief pass of the camera over a box's Aztec code during a scanning trial.

**Captured swipe**:
A swipe during which at least one valid scan result is obtained. Multiple reads during one swipe still count as one captured swipe, and a previously seen payload can be captured again.

**Capture success**:
The fraction of attempted swipes that are captured. It is distinct from the number of unique results.
