/**
 * Asking someone to verify their email (2026-11-03, owner: a popup when the account is made
 * and on each visit, never required). Both marks are per tab in session storage, so a new
 * visit asks again and moving between pages doesn't.
 */

/** Set at sign-up: the first ask sends the code straight away. */
const NEW_ACCOUNT = 'komogon.verifyEmail.new';
/** Set once the ask has been shown in this visit. */
const ASKED = 'komogon.verifyEmail.asked';

export function markNewAccount(): void {
  try {
    sessionStorage.setItem(NEW_ACCOUNT, '1');
  } catch {
    /* Blocked storage: the ask just waits for a tap to send. */
  }
}

/** Whether the account was just made in this tab. */
export function isNewAccount(): boolean {
  try {
    return sessionStorage.getItem(NEW_ACCOUNT) === '1';
  } catch {
    return false;
  }
}

export function clearNewAccount(): void {
  try {
    sessionStorage.removeItem(NEW_ACCOUNT);
  } catch {
    /* ignore */
  }
}

export function askedThisVisit(): boolean {
  try {
    return sessionStorage.getItem(ASKED) === '1';
  } catch {
    // Without storage, asking on every page would be too much: ask never.
    return true;
  }
}

export function markAsked(): void {
  try {
    sessionStorage.setItem(ASKED, '1');
  } catch {
    /* ignore */
  }
}
