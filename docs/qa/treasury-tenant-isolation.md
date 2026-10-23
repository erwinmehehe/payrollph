# Treasury tenant isolation batch

The standalone treasury-isolation workflow builds the real application and runs
authenticated localhost HTTP against disposable PostgreSQL 16. Its target guard
runs before database imports and refuses hosted targets, provider enablement and
provider/mail secrets. No production flags, schema or application behavior change.

Two independent attacker employers each exercise their own resources against a
populated victim whose destination request ID exceeds both attacker IDs and six.
Each denial compares PostgreSQL money, employee, destination-change, treasury,
legal-employer and audit state. Whole-journey victim snapshots must also match.

Eight methods are targeted: treasury-controls GET/POST; payout-profiles GET/PATCH;
payout-destination-changes GET; destination decision PATCH; Xendit payout GET/POST.
The tests execute actual policy assignment, inactive company payout-profile
updates, nonempty history reads and independent encrypted destination approval.
Destination request creation is fixture setup through the real domain helper,
not acceptance of the employee mutation endpoint that normally initiates it.

Negative controls include foreign tenant, employee, entity, request and operator
IDs; unassigned operator; assigned maker attempting self-approval; missing recent
MFA; employee attempts to change financial controls; replay of decided requests;
and revoked treasury assignment with the original session retained.

Xendit POST checks all four operations against foreign runs and owned runs with
providers disabled. The latter must remain HTTP 409 with no writes. This is
containment evidence, not an enabled payout or recovery success. Neither the
PayMongo reconciliation methods nor external settlement are certified here.
No coverage credits or closure-queue changes are claimed before exact-head HTTP
CI passes and the evidence is reviewed. No exploit was reproduced locally.

Additional fixtures in two separate employers execute overlapping approval
requests: exactly one HTTP 200, one HTTP 409 and one committed approval audit.
Changing the stored destination after request creation must cancel the stale
request without overwriting the current worker destination. A scoped admin first
reads nonempty own-unit history, then is denied the same worker after unit
reassignment, company-wide history, treasury configuration reads and profile
writes. Every response is checked for the full fictional account numbers.

Local direct-handler diagnosis passed 635 assertions and 62 denied requests with
real PostgreSQL. Its fixture identity adapter is forbidden in CI and is not HTTP
session acceptance. CI must emit real-http in its JSON receipt before acceptance.
