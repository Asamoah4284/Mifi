import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Check, ChevronLeft, ChevronRight, Copy, Gift, Loader2, Phone, Satellite, ShoppingCart, Ticket, Wifi, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MoolrePayment } from "@/components/payments/MoolrePayment.jsx"
import { HotspotConnectForm } from "@/components/portal/HotspotConnectForm.jsx"
import { getDefaultAppName } from "@/lib/env.js"
import {
  fetchPortalLocations,
  fetchPortalPackages,
  fetchPortalPaymentStatus,
  initializePortalPayment,
} from "@/lib/portalApi.js"
import { resolvePortalParams } from "@/lib/captivePortalParams.js"
import { formatGhanaPhoneDisplayLocal } from "@/lib/ghanaPhone.js"
import { cn, formatCedis } from "@/lib/utils"

function formatPackagePrice(priceGHS) {
  const formatted = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(priceGHS)
  return formatted
}

function isValidPhone(phone) {
  const trimmed = phone.replace(/\s+/g, " ")
  const digits = trimmed.replace(/\D/g, "")
  return trimmed.length >= 7 && trimmed.length <= 32 && digits.length >= 7
}

/** Round to pesewas (2 decimals), mirroring the backend. */
function roundMoney(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** @param {{ promo: { code: string, message: string, percentOff?: number } | null }} props */
function PromoBanner({ promo }) {
  const [copied, setCopied] = React.useState(false)
  if (!promo?.code) return null
  const percentOff = Number(promo.percentOff) || 0
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(promo.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — code is still shown */
    }
  }
  return (
    <div className="border-primary/30 bg-primary/5 flex items-start gap-3 rounded-lg border px-3 py-2.5">
      <div className="bg-primary/10 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Gift className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-primary text-[10px] font-semibold uppercase tracking-widest">Promo</p>
          {percentOff > 0 ? (
            <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[10px] font-bold leading-none">
              {percentOff}% OFF
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-bold tracking-tight hover:underline"
          title="Tap to copy"
        >
          {promo.code}
          {copied ? (
            <Check className="size-3.5 text-emerald-500" aria-hidden />
          ) : (
            <Copy className="size-3.5 opacity-60" aria-hidden />
          )}
        </button>
        {promo.message ? (
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">{promo.message}</p>
        ) : null}
      </div>
    </div>
  )
}

const PACKAGES_PER_PAGE = 4

export default function CaptiveBuy() {
  const appName = getDefaultAppName()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const portalParams = React.useMemo(() => resolvePortalParams(searchParams), [searchParams])
  const orgId = portalParams.org
  const [step, setStep] = React.useState(0)
  const [locations, setLocations] = React.useState(/** @type {{ locationId: string, name: string }[]} */ ([]))
  const [enquiryPhone, setEnquiryPhone] = React.useState("")
  const [packages, setPackages] = React.useState(
    /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]} */ ([]),
  )
  const [locationId, setLocationId] = React.useState("")
  const [locationName, setLocationName] = React.useState("")
  const [selectedPackage, setSelectedPackage] = React.useState(
    /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string } | null} */ (null),
  )
  const [phone, setPhone] = React.useState("")
  const [promo, setPromo] = React.useState(
    /** @type {{ code: string, message: string, percentOff: number } | null} */ (null),
  )
  const [promoInput, setPromoInput] = React.useState("")
  const [appliedPromo, setAppliedPromo] = React.useState(
    /** @type {{ code: string, percentOff: number } | null} */ (null),
  )
  const [promoError, setPromoError] = React.useState(/** @type {string | null} */ (null))
  const [loading, setLoading] = React.useState(true)
  const [loadingPackages, setLoadingPackages] = React.useState(false)
  const [paying, setPaying] = React.useState(false)
  const [error, setError] = React.useState(/** @type {string | null} */ (null))
  const [packagePage, setPackagePage] = React.useState(0)
  const [showMoolre, setShowMoolre] = React.useState(false)
  const [moolreAuthUrl, setMoolreAuthUrl] = React.useState(/** @type {string | null} */ (null))
  const [moolreReference, setMoolreReference] = React.useState(/** @type {string | null} */ (null))
  const [moolreCallbackUrl, setMoolreCallbackUrl] = React.useState(/** @type {string | null} */ (null))
  const [paymentsEnabled, setPaymentsEnabled] = React.useState(true)
  const [paymentNote, setPaymentNote] = React.useState("")

  const packagePageCount = Math.max(1, Math.ceil(packages.length / PACKAGES_PER_PAGE))
  const visiblePackages = packages.slice(
    packagePage * PACKAGES_PER_PAGE,
    packagePage * PACKAGES_PER_PAGE + PACKAGES_PER_PAGE,
  )

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      const result = await fetchPortalLocations(orgId)
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
        setLocations([])
        setEnquiryPhone("")
      } else {
        setLocations(result.locations)
        setEnquiryPhone(result.enquiryPhone || "")
        setPaymentsEnabled(typeof result.paymentsEnabled === "boolean" ? result.paymentsEnabled : true)
        setPaymentNote(typeof result.paymentNote === "string" ? result.paymentNote : "")
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  // While the Moolre POS iframe is open, poll our backend so the customer gets their code the
  // moment the payment is confirmed (via webhook or our own status check) — even if Moolre's POS
  // page is stuck on "processing" or shows a transaction-timeout dialog.
  React.useEffect(() => {
    if (!showMoolre || !moolreReference) return
    let cancelled = false
    /** @type {ReturnType<typeof setInterval> | null} */
    let intervalId = null

    const checkStatus = async () => {
      console.log("[buy] iframe poll status", { paymentReference: moolreReference })
      const status = await fetchPortalPaymentStatus(moolreReference)
      if (cancelled) return
      console.log("[buy] iframe poll result", status)
      if (status.ok && status.ready) {
        if (intervalId) clearInterval(intervalId)
        setShowMoolre(false)
        navigate(`/portal-payment-success?externalref=${encodeURIComponent(moolreReference)}`)
      }
    }

    void checkStatus()
    intervalId = setInterval(() => void checkStatus(), 4000)
    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [showMoolre, moolreReference, navigate])

  const handleLocationContinue = async () => {
    if (!locationId) {
      setError("Please select a WiFi location.")
      return
    }
    setError(null)
    setLoadingPackages(true)
    const result = await fetchPortalPackages(locationId, orgId)
    setLoadingPackages(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setLocationName(result.locationName)
    setPackages(result.packages)
    setPromo(result.promo ?? null)
    setAppliedPromo(null)
    setPromoInput("")
    setPromoError(null)
    setSelectedPackage(null)
    setPackagePage(0)
    if (result.packages.length === 0) {
      setError("No WiFi codes in stock at this location. Upload vouchers for this site, or try another location.")
      return
    }
    setStep(2)
  }

  const handlePackageSelect = (
    pkg /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string }} */,
  ) => {
    setSelectedPackage(pkg)
    setError(null)
    setStep(3)
  }

  const appliedPercent = appliedPromo ? Number(appliedPromo.percentOff) || 0 : 0
  const originalPrice = selectedPackage ? Number(selectedPackage.priceGHS) : 0
  const payableAmount =
    appliedPercent > 0 ? roundMoney(originalPrice * (1 - appliedPercent / 100)) : originalPrice

  const applyPromoCode = () => {
    setPromoError(null)
    const entered = promoInput.trim()
    if (!entered) {
      setPromoError("Enter a promo code.")
      return
    }
    const matches = promo && entered.toLowerCase() === promo.code.toLowerCase()
    if (!matches) {
      setAppliedPromo(null)
      setPromoError("That promo code isn't valid for this location.")
      return
    }
    const pct = Number(promo.percentOff) || 0
    if (pct <= 0) {
      setAppliedPromo(null)
      setPromoError("This code doesn't include a discount.")
      return
    }
    setAppliedPromo({ code: promo.code, percentOff: pct })
    setPromoError(null)
  }

  const removePromoCode = () => {
    setAppliedPromo(null)
    setPromoInput("")
    setPromoError(null)
  }

  const handlePay = async (e /** @type {React.FormEvent} */) => {
    e.preventDefault()
    if (!selectedPackage || !locationId) return
    if (!isValidPhone(phone)) {
      setError("Enter a valid phone number (at least 7 digits).")
      return
    }
    setError(null)
    setPaying(true)
    console.log("[buy] pay start", {
      locationId,
      packageId: selectedPackage.packageId,
      packageName: selectedPackage.name,
      promoCode: appliedPromo?.code || "",
      portalParams,
    })
    const result = await initializePortalPayment({
      locationId,
      packageId: selectedPackage.packageId,
      customerPhone: phone.trim(),
      promoCode: appliedPromo?.code || "",
      ...portalParams,
    })
    console.log("[buy] pay initialize result", result)
    if (!result.ok) {
      setPaying(false)
      setError(result.error)
      return
    }
    setMoolreAuthUrl(result.authorizationUrl)
    setMoolreReference(result.paymentReference)
    setMoolreCallbackUrl(result.redirectUrl || null)
    setShowMoolre(true)
    setPaying(false)
  }

  const handleMoolreSuccess = (
    response /** @type {{ reference?: string, externalref?: string }} */,
  ) => {
    const ref = response?.reference || response?.externalref || moolreReference
    console.log("[buy] moolre success callback", { response, ref })
    setShowMoolre(false)
    if (!ref) {
      setError(
        enquiryPhone
          ? `Payment could not be confirmed. Please try again or call ${formatGhanaPhoneDisplayLocal(enquiryPhone)} for enquiries.`
          : "Payment could not be confirmed. Please try again or contact support.",
      )
      return
    }
    navigate(`/portal-payment-success?externalref=${encodeURIComponent(ref)}`)
  }

  const handleMoolreCancel = () => {
    console.log("[buy] moolre cancelled", { paymentReference: moolreReference })
    setShowMoolre(false)
    setMoolreAuthUrl(null)
    setMoolreReference(null)
    setMoolreCallbackUrl(null)
    setPaying(false)
  }

  return (
    <div className="text-foreground relative flex min-h-svh flex-col bg-canvas px-4 py-8 sm:py-12 dark:bg-background antialiased selection:bg-emerald-500/20 selection:text-emerald-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="bg-emerald-500/[0.08] absolute -left-[10%] top-[-5%] h-[min(65vh,520px)] w-[min(75vw,520px)] rounded-full blur-[110px] dark:bg-emerald-500/[0.12]" />
        <div className="bg-[#02a145]/[0.06] absolute -right-[10%] top-[30%] h-[min(55vh,440px)] w-[min(65vw,440px)] rounded-full blur-[100px] dark:bg-emerald-500/[0.08]" />
        <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-35" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-md">
        <div className="mb-7 text-center">
          <div className="mb-3.5 flex justify-center">
            <img src="/logo.png" alt="Mifi" className="h-12 max-w-[170px] object-contain drop-shadow-xs" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/70 text-emerald-700 text-xs font-semibold tracking-wide shadow-xs dark:bg-emerald-950/50 dark:border-emerald-800/40 dark:text-emerald-300">
            <span className="size-2 rounded-full bg-[#02a145] animate-pulse" />
            WiFi Hotspot Portal
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {step === 0 ? "Connect to High-Speed WiFi" : "Buy WiFi Access"}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm max-w-sm mx-auto leading-relaxed">
            {step === 0
              ? "If you have a voucher code, enter it below to connect. Need one? Tap Buy WiFi to get started."
              : "Pay with MoMo, then we instantly activate your WiFi code."}
          </p>
        </div>

        {step >= 1 ? (
          <div className="mb-5 flex justify-center gap-2">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`h-1.5 w-12 rounded-full transition-all duration-300 ${
                  step >= n
                    ? "bg-primary shadow-xs"
                    : "bg-slate-200 dark:bg-slate-800"
                }`}
                aria-hidden
              />
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-xl border px-4 py-3 text-sm font-medium">
            {error}
          </div>
        ) : null}

        {!paymentsEnabled && !loading ? (
          <div className="border-amber-400/40 bg-amber-50/80 dark:bg-amber-900/20 dark:border-amber-500/30 rounded-2xl border px-5 py-6 text-center shadow-sm">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-800/40">
              <AlertTriangle className="size-6 text-amber-600 dark:text-amber-400" aria-hidden />
            </div>
            <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">
              Payments temporarily unavailable
            </h2>
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
              {paymentNote ||
                "Online payments are currently disabled. Please check back shortly or contact the WiFi provider for assistance."}
            </p>
            {enquiryPhone ? (
              <a
                href={`tel:${enquiryPhone}`}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors shadow-sm"
              >
                <Phone className="size-4" aria-hidden />
                Call {formatGhanaPhoneDisplayLocal(enquiryPhone)}
              </a>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="text-primary size-9 animate-spin" aria-label="Loading" />
          </div>
        ) : null}

        {/* Instant Mode Switcher: Enter Code vs Buy WiFi */}
        {!loading && paymentsEnabled ? (
          <div className="mb-4 grid grid-cols-2 gap-1.5 p-1.5 rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 border border-slate-300/40 dark:border-slate-700/50 shadow-inner">
            <button
              type="button"
              onClick={() => { setStep(0); setError(null); }}
              className={cn(
                "flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer",
                step === 0
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              )}
            >
              <Ticket className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Have a Code</span>
            </button>
            <button
              type="button"
              onClick={() => { setStep(1); setError(null); }}
              className={cn(
                "flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer",
                step >= 1
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              )}
            >
              <ShoppingCart className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Buy WiFi Access</span>
            </button>
          </div>
        ) : null}

        {!loading && step === 0 ? (
          <Card className="border-slate-200/90 bg-white/95 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.02)] backdrop-blur-sm dark:bg-slate-900/95 dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-bold text-slate-900 dark:text-white">Connect with Voucher</CardTitle>
              <CardDescription className="text-slate-500 dark:text-slate-400">
                Enter your WiFi voucher code to connect immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              <HotspotConnectForm
                loginUrl={portalParams.login_url}
                origUrl={portalParams.orig_url}
                onBuyWifi={paymentsEnabled ? () => setStep(1) : null}
              />
            </CardContent>
          </Card>
        ) : null}

        {!loading && paymentsEnabled && step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Step 1 — WiFi location</CardTitle>
              <CardDescription>Where are you connecting from?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {locations.length === 0 ? (
                <p className="text-muted-foreground text-sm">No WiFi locations available right now.</p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Select value={locationId} onValueChange={setLocationId}>
                    <SelectTrigger id="location" className="w-full">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.locationId} value={loc.locationId}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                className="w-full"
                disabled={!locationId || loadingPackages}
                onClick={() => void handleLocationContinue()}
              >
                {loadingPackages ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                    Loading packages…
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setStep(0)}>
                I already have a code
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!loading && paymentsEnabled && step === 2 ? (
          <Card className="overflow-hidden">
            <CardHeader className="border-border/60 border-b pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-lg">Step 2 — Choose a package</CardTitle>
                  <CardDescription className="mt-1 truncate">{locationName}</CardDescription>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStep(1)
                      setPackagePage(0)
                      setError(null)
                    }}
                  >
                    Change location
                  </Button>
                  <button
                    type="button"
                    className="text-primary text-xs font-medium underline-offset-4 hover:underline"
                    onClick={() => setStep(0)}
                  >
                    I have a code
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {promo ? (
                <div className="border-border/60 border-b p-4">
                  <PromoBanner promo={promo} />
                </div>
              ) : null}
              <ul className="divide-y divide-slate-100 p-1.5 dark:divide-slate-800">
                {visiblePackages.map((pkg) => (
                  <li key={pkg.packageId}>
                    <button
                      type="button"
                      onClick={() => handlePackageSelect(pkg)}
                      className={cn(
                        "group flex w-full items-center gap-3.5 rounded-xl p-3 text-left transition-all",
                        "hover:bg-emerald-50/70 hover:shadow-xs active:scale-[0.99] dark:hover:bg-emerald-950/30",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                      )}
                    >
                      <div
                        className="flex min-w-[5rem] shrink-0 flex-col items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-50 px-3 py-2 text-emerald-800 shadow-2xs dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                        aria-hidden
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">GH₵</span>
                        <span className="text-xl font-extrabold leading-none tabular-nums">
                          {formatPackagePrice(pkg.priceGHS)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-slate-100 dark:group-hover:text-emerald-400">
                          {pkg.name}
                        </p>
                        {pkg.dataLimit ? (
                          <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{pkg.dataLimit}</p>
                        ) : null}
                      </div>
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-all group-hover:bg-[#02a145] group-hover:text-white dark:bg-slate-800 dark:text-slate-400">
                        <ChevronRight className="size-4" aria-hidden />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-border/60 flex items-center justify-between gap-2 border-t px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={packagePage === 0}
                  onClick={() => setPackagePage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  Previous
                </Button>
                <span className="text-muted-foreground text-xs tabular-nums">
                  Page {packagePage + 1} of {packagePageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={packagePage >= packagePageCount - 1}
                  onClick={() => setPackagePage((p) => Math.min(packagePageCount - 1, p + 1))}
                >
                  Next
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!loading && paymentsEnabled && step === 3 && selectedPackage ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Step 3 — Pay with MoMo</CardTitle>
              <CardDescription className="truncate">
                {selectedPackage.name} at {locationName}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {promo ? (
                <div className="mb-4">
                  <PromoBanner promo={promo} />
                </div>
              ) : null}

              <div className="mb-4">
                {appliedPromo ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        Code {appliedPromo.code} applied — {appliedPercent}% off
                      </p>
                      <p className="text-muted-foreground text-xs">Your discount is in the total below.</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={removePromoCode}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="promo-input">Have a promo code?</Label>
                    <div className="flex gap-2">
                      <Input
                        id="promo-input"
                        value={promoInput}
                        onChange={(e) => {
                          setPromoInput(e.target.value)
                          setPromoError(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            applyPromoCode()
                          }
                        }}
                        placeholder={promo?.code ? `e.g. ${promo.code}` : "Enter promo code"}
                        autoComplete="off"
                        autoCapitalize="characters"
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" onClick={applyPromoCode}>
                        Apply
                      </Button>
                    </div>
                    {promoError ? (
                      <p className="text-destructive text-xs" role="alert">
                        {promoError}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="border-border/60 mb-4 flex items-center justify-between rounded-lg border px-3 py-2.5">
                <span className="text-muted-foreground text-sm">You pay</span>
                <span className="text-right">
                  {appliedPercent > 0 ? (
                    <span className="text-muted-foreground mr-2 text-sm line-through">
                      {formatCedis(originalPrice)}
                    </span>
                  ) : null}
                  <span className="text-lg font-bold tabular-nums">{formatCedis(payableAmount)}</span>
                </span>
              </div>

              <form className="space-y-4" onSubmit={(e) => void handlePay(e)}>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="e.g. 024 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                  <p className="text-muted-foreground text-xs">
                    We'll text the WiFi login code here. You can share it so someone else can connect.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(2)}>
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={paying}>
                    {paying ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                        Starting payment…
                      </>
                    ) : (
                      <>
                        <Wifi className="mr-2 size-4" aria-hidden />
                        Pay {formatCedis(payableAmount)}
                      </>
                    )}
                  </Button>
                </div>
              </form>

              {enquiryPhone ? (
                <div className="border-border/60 bg-muted/40 mt-4 flex items-start gap-3 rounded-lg border px-3 py-2.5">
                  <div className="bg-primary/10 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <Phone className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Payment not going through?</p>
                    <p className="text-muted-foreground text-xs leading-snug">
                      Call enquiries{" "}
                      <a
                        href={`tel:${enquiryPhone.replace(/\s+/g, "")}`}
                        className="text-foreground font-semibold underline-offset-2 hover:underline"
                      >
                        {formatGhanaPhoneDisplayLocal(enquiryPhone)}
                      </a>
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <MoolrePayment
        mode="captive"
        open={showMoolre}
        authorizationUrl={moolreAuthUrl}
        callbackUrl={moolreCallbackUrl}
        paymentReference={moolreReference}
        onCancel={handleMoolreCancel}
        onSuccess={handleMoolreSuccess}
      />
    </div>
  )
}
