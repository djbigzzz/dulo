"use client";

import type { ReactNode } from "react";
import { useOptionalSession } from "@/hooks/useSession";

/**
 * Renders `signedIn` once the server session is known to exist, `signedOut` otherwise (and on the
 * server and the first client frame, so both renders agree). The landing uses it so a signed-in
 * player's hero button says what to do next instead of repeating the header's wallet chip.
 */
export function SessionSwitch({ signedIn, signedOut }: { signedIn: ReactNode; signedOut: ReactNode }) {
  const session = useOptionalSession()?.session ?? null;
  return <>{session ? signedIn : signedOut}</>;
}

export default SessionSwitch;
