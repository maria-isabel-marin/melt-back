/**
 * Temporary development switch for testing personal AI credentials
 * from guest sessions before Google authentication is configured.
 *
 * Production/default behavior remains restrictive unless the backend
 * environment explicitly contains:
 *
 * ALLOW_GUEST_PERSONAL_AI=true
 */
export function shouldRestrictGuestPersonalAi(
  isGuest: boolean,
): boolean {
  if (!isGuest) {
    return false;
  }

  const allowGuestPersonalAi =
    String(
      process.env.ALLOW_GUEST_PERSONAL_AI ?? '',
    )
      .trim()
      .toLowerCase() === 'true';

  return !allowGuestPersonalAi;
}
