# Aztec Scanning

This project evaluates how quickly a mobile camera can read Aztec codes during brief passes over labelled boxes.

## Language

**Swipe**:
A brief pass of the camera over a box's Aztec code during a scanning trial.

**Payload**:
The data encoded in an Aztec code.

**Scan result**:
A successfully decoded payload from a code observed by the camera.
_Avoid_: Detection, validation

**Unique result**:
The first scan result with a particular payload in a scanning session. Two boxes carrying the same payload produce one unique result.

**Duplicate result**:
A scan result whose payload has already appeared in the current scanning session.

**Scanning session**:
The period over which unique results are retained, ending when the page is refreshed or a fresh scanning run is started.

**Captured swipe**:
A swipe during which at least one valid scan result is obtained. Multiple reads during one swipe still count as one captured swipe, and a previously seen payload can be captured again.

**Capture success**:
The fraction of attempted swipes that are captured. It is distinct from the number of unique results.
