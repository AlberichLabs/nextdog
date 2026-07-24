// Planted-bug scenario C — a bad response shape.
//
// GET /api/scenarios/profile returns a user profile. The API contract says the
// body must include `email`, but the BUGGY path builds the response from the
// wrong field name (`emailAddress`), so `email` comes out `undefined` and is
// dropped from the JSON — a 200 with a subtly wrong shape that a status-code
// check would miss. NextDog captures the response body, so the missing field is
// visible in the trace. The FIXED path emits the correct `email` field. Flip
// between them with `POST /api/scenarios { "scenario": "profile", "fixed": true }`
// or by editing the code below (Next hot-reloads).
import { isFixed } from '../../../../lib/planted-bugs';

// The stored user record. Note the column is `emailAddress`, not `email`.
const USER_RECORD = {
  id: 42,
  name: 'Ada Lovelace',
  emailAddress: 'ada@example.com',
  role: 'admin',
};

interface ProfileResponse {
  id: number;
  name: string;
  email: string;
  role: string;
}

export function GET(): Response {
  let profile: ProfileResponse;
  if (isFixed('profile')) {
    // FIX: map the stored `emailAddress` column onto the contract's `email` field.
    profile = {
      id: USER_RECORD.id,
      name: USER_RECORD.name,
      email: USER_RECORD.emailAddress,
      role: USER_RECORD.role,
    };
  } else {
    // BUG: reads `record.email` (no such field) instead of `emailAddress`, so
    // `email` is undefined and Response.json drops it — the response shape breaks.
    const record = USER_RECORD as unknown as { email?: string };
    profile = {
      id: USER_RECORD.id,
      name: USER_RECORD.name,
      email: record.email as string,
      role: USER_RECORD.role,
    };
  }

  console.log(`[profile] returning profile for #${profile.id} (email=${profile.email})`);
  return Response.json(profile);
}
