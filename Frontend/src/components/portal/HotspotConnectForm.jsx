/**
 * @fileoverview HotspotConnectForm — Grandstream GWN captive-portal connect form.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * AUTH FLOW (WORKING STATE — do not change without updating CAPTIVE_PORTAL_LOG.md)
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. The Grandstream AP redirects the user's browser to:
 *      /buy?login_url=https://cwp.gwnportal.cloud:8443/gwn_login
 *          &client_mac=<mac>&orig_url=<destination>&…
 *
 * 2. CaptiveBuy.jsx calls resolvePortalParams() which reads those query params
 *    and persists them in sessionStorage (survives the payment redirect flow).
 *
 * 3. The user enters their voucher code and taps "Connect to WiFi".
 *    onSubmit() calls buildHotspotAuthorizeUrl(loginUrl, pin, { orig_url })
 *    which produces:
 *      https://cwp.gwnportal.cloud:8443/gwn_login
 *        ?username=<voucher>&password=<voucher>&redirect=<orig_url>
 *
 * 4. submitToGateway() navigates the browser to that full URL via
 *    window.location.assign(). The AP receives the full query string, sends a
 *    RADIUS Access-Request, and if the voucher is valid it redirects the user to
 *    orig_url (online).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CRITICAL FIX (2026-10-16) — "Connect to WiFi reloads page / PARAMETERS_FAILED"
 * ──────────────────────────────────────────────────────────────────────────────
 * BUG:  submitToGateway previously created a <form method="GET"> and set
 *       form.action = target (full URL with query string), then called
 *       form.submit(). The HTML spec requires browsers to STRIP the query
 *       string from action on GET forms and replace it with the serialised
 *       form fields. The form had no inputs, so the AP received an empty query
 *       string → 302 back to /buy with auth_status=PARAMETERS_FAILED.
 *
 * FIX:  Use window.location.assign(target) — a plain navigation that preserves
 *       the entire URL unchanged.
 *
 * ORDER CONSTRAINT: clearPersistedPortalParams() is called AFTER
 *       submitToGateway(). If it were called first and the AP bounces the user
 *       back to /buy (e.g. wrong code), the portal params would already be gone
 *       and the form could not rebuild the URL for a retry.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import * as React from "react"
import { Check, Copy, Phone, ShoppingCart, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  buildHotspotAuthorizeUrl,
  clearPersistedPortalParams,
} from "@/lib/captivePortalParams.js"

/** Support phone numbers shown at the bottom of the form. */
const SUPPORT_PHONES = [
  { label: "0202343065", tel: "+233202343065" },
  { label: "0542343069", tel: "+233542343069" },
]

/**
 * Navigate the browser to the AP login URL, preserving the full query string.
 *
 * ⚠️ MUST use window.location.assign — NOT a <form method="GET">.
 *    GET forms strip the query string from `action` before submission (HTML spec
 *    §4.10.21.3 step 2). The AP never sees the credentials and returns
 *    auth_status=PARAMETERS_FAILED. assign() sends the URL exactly as-is.
 *
 * @param {string} target  Fully-built URL including username/password params.
 */
function submitToGateway(target) {
  window.location.assign(target)
}

/**
 * WiFi-code entry form that authenticates against a Grandstream GWN captive portal.
 *
 * Props injected by CaptiveBuy.jsx from resolvePortalParams():
 * @param {{
 *   defaultCode?:   string  - Voucher code pre-filled from the URL / API response.
 *   loginUrl?:      string  - AP login endpoint (e.g. https://cwp.gwnportal.cloud:8443/gwn_login).
 *   origUrl?:       string  - Destination URL the user was heading to before the portal.
 *   authorizeUrl?:  string  - Pre-built full URL fallback (used when code === defaultCode).
 *   onBuyWifi?:     () => void - Handler to switch to the buy flow directly.
 * }} props
 */
export function HotspotConnectForm({
  defaultCode = "",
  loginUrl = "",
  origUrl = "",
  authorizeUrl = "",
  onBuyWifi = null,
}) {
  // useId gives a stable, unique ID for aria/label pairing across React renders.
  const fieldId = React.useId()

  /** Current value of the code input (may differ from defaultCode if user edits it). */
  const [code, setCode] = React.useState(defaultCode)

  /** True for 1.5 s after the copy button is tapped — drives the ✓ icon. */
  const [copied, setCopied] = React.useState(false)

  /** Validation / connection error to show inline below the input. */
  const [error, setError] = React.useState(/** @type {string | null} */ (null))

  /** True while the page is navigating to the AP (disables the button). */
  const [connecting, setConnecting] = React.useState(false)

  const inputId = `wifi-code-${fieldId}`

  // Sync the input if the parent re-renders with a new defaultCode
  // (e.g. the API response arrives after mount).
  React.useEffect(() => {
    setCode(defaultCode)
  }, [defaultCode])

  /** Copy the current code to the clipboard. Shows a ✓ icon for 1.5 s. */
  const copy = async () => {
    const pin = code.trim()
    if (!pin) return
    try {
      await navigator.clipboard.writeText(pin)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — silent fail */
    }
  }

  /**
   * Start the gateway navigation.
   *
   * Execution order matters:
   *  1. Log the target URL (password masked) for debugging in DevTools.
   *  2. Call submitToGateway — triggers navigation; the current JS context
   *     continues for a few more microtasks before the page unloads.
   *  3. clearPersistedPortalParams() AFTER navigate — so if the AP bounces the
   *     user back (wrong code / PARAMETERS_FAILED) the params are still in
   *     sessionStorage and the form can rebuild the URL for a retry.
   *
   * @param {string} targetUrl  Full URL with username/password query params.
   */
  const doConnect = (targetUrl) => {
    setConnecting(true)
    setError(null)

    // Mask the password param so voucher codes don't appear in plain text logs.
    const logUrl = targetUrl.replace(
      /(password=)[^&]*/,
      (_, prefix) => `${prefix}****`,
    )
    console.log("[buy] gateway target", logUrl)

    submitToGateway(targetUrl)

    // Clear persisted params AFTER navigation has started (see order note above).
    clearPersistedPortalParams()
  }

  /**
   * Form submit handler.
   * Validates the code, builds the full AP URL, and calls doConnect().
   *
   * URL precedence:
   *   1. buildHotspotAuthorizeUrl(loginUrl, pin) — preferred; works even if the
   *      user edited the code away from defaultCode.
   *   2. authorizeUrl prop — fallback for when loginUrl is empty but the parent
   *      passed a pre-built URL (only valid when pin === defaultCode).
   */
  const onSubmit = (e) => {
    e.preventDefault()
    const pin = code.trim()
    if (!pin) {
      setError("Enter your WiFi code before connecting.")
      return
    }

    // Build URL: loginUrl + ?username=<pin>&password=<pin>[&redirect=<origUrl>]
    const built = buildHotspotAuthorizeUrl(loginUrl, pin, { orig_url: origUrl })

    // Fallback: only safe when the user hasn't changed the code, because
    // authorizeUrl was pre-built with defaultCode as the credential.
    const fallback =
      authorizeUrl && pin === String(defaultCode || "").trim() ? String(authorizeUrl).trim() : ""

    const target = built || fallback
    if (!target) {
      setError(
        "Hotspot gateway address was not detected. Make sure you are connected to the venue WiFi. You can also try connecting via the default gateway below.",
      )
      console.warn("[buy] connect wifi missing login_url", { pinLength: pin.length })
      return
    }

    doConnect(target)
  }

  /**
   * Escape hatch: try a hard-coded Grandstream default gateway IP when the AP
   * did not inject redirect params (e.g. user navigated directly to /buy).
   *
   * Known defaults:
   *   192.168.1.1  — GWN7664 / GWN7760 factory default
   *   192.168.88.1 — some ISP-configured GWN units
   *
   * @param {string} [gatewayIp]
   */
  const onTryDefaultGateway = (gatewayIp = "192.168.1.1") => {
    const pin = code.trim()
    if (!pin) {
      setError("Enter your WiFi code first.")
      return
    }
    const url = buildHotspotAuthorizeUrl(`http://${gatewayIp}:8880/gwn/login`, pin, { orig_url: origUrl })
    doConnect(url)
  }

  /**
   * True when the AP provided a login_url or a pre-built authorizeUrl.
   * Controls whether the "no gateway detected" warning banner is shown.
   */
  const hasDetectedGateway = Boolean(String(loginUrl || "").trim() || String(authorizeUrl || "").trim())

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor={inputId} className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
          WiFi Voucher Code
        </Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            name="username"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              if (error) setError(null) // clear stale error on each keystroke
            }}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-13 rounded-xl border-slate-200/90 bg-slate-50/70 font-mono text-xl font-bold tracking-[0.22em] text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus-visible:bg-white focus-visible:border-[#02a145] focus-visible:ring-3 focus-visible:ring-[#02a145]/20 shadow-inner transition-all dark:bg-slate-800/50 dark:border-slate-700 dark:text-white"
            placeholder="Enter code"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="size-13 shrink-0 rounded-xl border-slate-200/90 bg-slate-50/70 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/50 transition-all"
            onClick={() => void copy()}
            title="Copy code"
          >
            {copied ? (
              <Check className="size-5 text-emerald-500" aria-hidden />
            ) : (
              <Copy className="size-5" aria-hidden />
            )}
            <span className="sr-only">Copy code</span>
          </Button>
        </div>
      </div>

      {/* Inline error — shown for validation failures and missing gateway. */}
      {error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border px-3.5 py-2.5 text-sm font-medium">
          {error}
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={connecting}
        className="h-13 w-full rounded-xl bg-primary text-white font-bold text-base shadow-sm hover:bg-[#01883a] active:scale-[0.99] transition-all duration-150 border-0 cursor-pointer disabled:opacity-60"
      >
        <Wifi className="size-5 mr-1.5" aria-hidden />
        {connecting ? "Connecting to WiFi…" : "Connect to WiFi"}
      </Button>

      {typeof onBuyWifi === "function" ? (
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={onBuyWifi}
            className="h-12 w-full rounded-xl border-2 border-emerald-500/30 bg-emerald-50/70 hover:bg-emerald-100/70 hover:border-emerald-500/50 text-emerald-800 font-bold text-sm shadow-xs transition-all dark:bg-emerald-950/30 dark:border-emerald-800/50 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
          >
            <ShoppingCart className="size-4 mr-2 text-emerald-600 dark:text-emerald-400" />
            I don't have a code — Buy WiFi Access
          </Button>
        </div>
      ) : null}

      {!hasDetectedGateway ? (
        /* Shown when /buy was opened without AP redirect params. */
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-900/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-2.5">
          <div className="flex items-start gap-2">
            <span className="inline-block mt-0.5 size-1.5 rounded-full bg-amber-500 shrink-0" />
            <p className="leading-relaxed">
              <strong className="font-semibold text-amber-950 dark:text-amber-100">Direct Gateway Access:</strong> If connected to venue WiFi without automatic pop-up, you can connect via the gateway:
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onTryDefaultGateway("192.168.1.1")}
              className="text-xs h-8 rounded-lg border-amber-300/80 bg-white/90 hover:bg-white text-amber-900 font-medium shadow-2xs"
            >
              Connect via 192.168.1.1
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onTryDefaultGateway("192.168.88.1")}
              className="text-xs h-8 rounded-lg border-amber-300/80 bg-white/90 hover:bg-white text-amber-900 font-medium shadow-2xs"
            >
              Connect via 192.168.88.1
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-slate-500 dark:text-slate-400 text-xs text-center">
          Tap Connect to go online. You can also copy this code and share it.
        </p>
      )}

      <div className="pt-2 space-y-2">
        <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
          Having issues? Call support:
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SUPPORT_PHONES.map((phone) => (
            <Button
              key={phone.tel}
              type="button"
              variant="outline"
              className="h-11 w-full rounded-xl border-slate-200/90 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-medium text-xs shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
              asChild
            >
              <a href={`tel:${phone.tel}`}>
                <Phone className="size-3.5 text-emerald-600 dark:text-emerald-400 mr-1.5" aria-hidden />
                Call {phone.label}
              </a>
            </Button>
          ))}
        </div>
      </div>
    </form>
  )
}
