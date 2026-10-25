import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Loader2, Satellite } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { HotspotConnectForm } from "@/components/portal/HotspotConnectForm.jsx"
import { getDefaultAppName } from "@/lib/env.js"
import { resolvePortalParams } from "@/lib/captivePortalParams.js"
import { retrievePortalVouchers } from "@/lib/portalApi.js"

function isValidPhone(phone) {
  const trimmed = phone.replace(/\s+/g, " ")
  const digits = trimmed.replace(/\D/g, "")
  return trimmed.length >= 7 && trimmed.length <= 32 && digits.length >= 7
}

export default function CaptiveRetrieveVoucher() {
  const appName = getDefaultAppName()
  const [searchParams] = useSearchParams()
  const portal = React.useMemo(() => resolvePortalParams(searchParams), [searchParams])
  const [phone, setPhone] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(/** @type {string | null} */ (null))
  const [vouchers, setVouchers] = React.useState(
    /** @type {{ voucherCode: string, packageName: string, date: string }[]} */ ([]),
  )
  const [emptyMessage, setEmptyMessage] = React.useState("")

  React.useEffect(() => {
    document.title = "Find your WiFi code"
  }, [])

  const handleSubmit = async (e /** @type {React.FormEvent} */) => {
    e.preventDefault()
    if (!isValidPhone(phone)) {
      setError("Enter a valid phone number (at least 7 digits).")
      return
    }
    setError(null)
    setEmptyMessage("")
    setVouchers([])
    setLoading(true)
    console.log("[buy] retrieve lookup", { phone: phone.trim() })
    const result = await retrievePortalVouchers(phone.trim())
    setLoading(false)
    console.log("[buy] retrieve result", result)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setVouchers(result.vouchers)
    if (result.vouchers.length === 0) {
      setEmptyMessage(
        result.message ||
          "No WiFi codes found for this number. If you just paid, wait a moment and try again.",
      )
    }
  }

  return (
    <div className="text-foreground relative flex min-h-svh flex-col bg-canvas px-4 py-8 sm:py-12 dark:bg-background antialiased">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="bg-emerald-500/[0.08] absolute -left-[10%] top-[-5%] h-[min(65vh,520px)] w-[min(75vw,520px)] rounded-full blur-[110px] dark:bg-emerald-500/[0.12]" />
        <div className="bg-[#02a145]/[0.06] absolute -right-[10%] bottom-[-10%] h-[min(55vh,440px)] w-[min(65vw,440px)] rounded-full blur-[100px] dark:bg-emerald-500/[0.08]" />
        <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-35" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-md">
        <div className="mb-7 text-center">
          <div className="mb-3.5 flex justify-center">
            <img src="/logo.png" alt="Mifi" className="h-11 max-w-[160px] object-contain drop-shadow-xs" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/70 text-emerald-700 text-xs font-semibold tracking-wide shadow-xs dark:bg-emerald-950/50 dark:border-emerald-800/40 dark:text-emerald-300">
            <span className="size-2 rounded-full bg-[#02a145] animate-pulse" />
            Voucher Recovery
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Find your WiFi code</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1.5 text-sm">
            Enter the phone number you used when paying to look up your recent WiFi codes.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your phone number</CardTitle>
            <CardDescription>We show up to your 3 most recent WiFi codes.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
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
              </div>
              {error ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
                  {error}
                </div>
              ) : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                    Looking up…
                  </>
                ) : (
                  "Find my codes"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {emptyMessage ? (
          <p className="text-muted-foreground mt-4 text-center text-sm">{emptyMessage}</p>
        ) : null}

        {vouchers.length > 0 ? (
          <div className="mt-4 space-y-3">
            {vouchers.map((v, i) => (
              <Card key={`${v.voucherCode}-${i}`}>
                <CardHeader>
                  <CardTitle className="text-lg">{v.packageName || "WiFi"}</CardTitle>
                  <CardDescription>
                    {v.date ? `${v.date} · ` : ""}
                    Enter the code and tap Connect to WiFi.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <HotspotConnectForm
                    defaultCode={v.voucherCode}
                    loginUrl={portal.login_url}
                    origUrl={portal.orig_url}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        <p className="text-muted-foreground mt-8 text-center text-sm">
          Need a new package?{" "}
          <Link to="/buy" className="text-primary font-medium underline-offset-4 hover:underline">
            Buy WiFi access
          </Link>
        </p>
      </div>
    </div>
  )
}
