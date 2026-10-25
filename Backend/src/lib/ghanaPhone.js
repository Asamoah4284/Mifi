/**
 * Local display format starting with 0 (e.g. 0241234567).
 * @param {unknown} input
 */
export function formatGhanaPhoneLocal(input) {
  const digits = String(input || "").replace(/\D/g, "")
  if (!digits) return ""
  if (digits.startsWith("233") && digits.length >= 12) {
    return `0${digits.slice(3, 12)}`
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    return digits.slice(0, 10)
  }
  if (digits.length === 9) {
    return `0${digits}`
  }
  if (digits.startsWith("0")) return digits
  return `0${digits}`
}

/**
 * Pretty local format: 024 123 4567
 * @param {unknown} input
 */
export function formatGhanaPhoneDisplayLocal(input) {
  const local = formatGhanaPhoneLocal(input)
  const digits = local.replace(/\D/g, "")
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  }
  return local
}

/**
 * Dedupe key using trailing 9 national digits (handles 0… vs 233…).
 * @param {unknown} input
 */
export function ghanaPhoneDedupeKey(input) {
  const local = formatGhanaPhoneLocal(input)
  const digits = local.replace(/\D/g, "")
  if (digits.length >= 9) return digits.slice(-9)
  return digits
}

/**
 * Normalize Ghana mobile numbers to E.164 (+233…).
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeGhanaPhone(input) {
  const s = String(input || "")
    .trim()
    .replace(/\s/g, "")
  if (!s) return ""
  if (s.startsWith("+")) return s
  if (s.startsWith("0")) return `+233${s.slice(1)}`
  if (s.startsWith("233")) return `+${s}`
  return `+233${s}`
}

/**
 * Digits-only key for indexes (233XXXXXXXXX).
 * @param {string} e164
 */
export function phoneNormalizedKey(e164) {
  return normalizeGhanaPhone(e164).replace(/\D/g, "")
}
