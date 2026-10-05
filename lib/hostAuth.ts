import "server-only";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// The host unlocks /host with HOST_PIN (a server-only env var). The unlock is
// remembered in a signed, httpOnly cookie for 30 days. Changing HOST_PIN
// logs out every device.

export const HOST_COOKIE = "picme_host";
const MAX_AGE = 60 * 60 * 24 * 30;

export function hostPin() {
  return process.env.HOST_PIN?.trim() || null;
}

function signingKey() {
  const pin = hostPin();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pin || !service) return null;
  return createHash("sha256").update(`${pin}\0${service}`).digest();
}

function sign(issued: string) {
  const key = signingKey();
  if (!key) return null;
  return createHmac("sha256", key).update(`picme-host:${issued}`).digest("base64url");
}

function sameText(a: string, b: string) {
  // Compare hashes so length differences don't leak through timing
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function pinMatches(input: string) {
  const pin = hostPin();
  return !!pin && sameText(input.trim(), pin);
}

export async function setHostCookie() {
  const issued = Date.now().toString();
  const sig = sign(issued);
  if (!sig) return;
  (await cookies()).set(HOST_COOKIE, `${issued}.${sig}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearHostCookie() {
  (await cookies()).delete(HOST_COOKIE);
}

export async function isHost() {
  const value = (await cookies()).get(HOST_COOKIE)?.value;
  if (!value) return false;
  const [issued, sig] = value.split(".");
  const expected = issued && sign(issued);
  if (!expected || !sig || !sameText(sig, expected)) return false;
  return Date.now() - Number(issued) < MAX_AGE * 1000;
}
