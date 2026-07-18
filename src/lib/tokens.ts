export const colors = {
  primary: "#231C15",
  page: "#F5EFE4",
  hero: "#F2EBDD",
  surface: "#FFFFFF",
  utility: "#3A2E22",
  ink: "#1E1A15",
  muted: "#8A7F6E",
  gold: "#B4884A",
  goldOnDark: "#C9A050",
  success: "#4C8A5E",
  border: "#E4D9C6",
  input: "#F7EFE2",
} as const;

export const statusColors = {
  protected: { bg: "#EAF3EC", text: "#235235" },
  disputed: { bg: "#FDF3E7", text: "#7A5A30" },
  pending: { bg: "#F7EFE2", text: "#5C4F3B" },
  settled: { bg: "#EAF3EC", text: "#235235" },
} as const;

export const typography = {
  display: {
    fontFamily: "Newsreader, Georgia, serif",
    fontSize: { desktop: "4rem", mobile: "2.625rem" },
    fontWeight: 500,
    lineHeight: 1.05,
    letterSpacing: "-0.025em",
  },
  h1: {
    fontFamily: "Newsreader, Georgia, serif",
    fontSize: { desktop: "2.75rem", mobile: "2rem" },
    fontWeight: 500,
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
  },
  h2: {
    fontFamily: "Georama, sans-serif",
    fontSize: { desktop: "1.75rem", mobile: "1.5rem" },
    fontWeight: 650,
    lineHeight: 1.2,
    letterSpacing: "-0.02em",
  },
  body: {
    fontFamily: "Georama, sans-serif",
    fontSize: "1rem",
    fontWeight: 400,
    lineHeight: 1.6,
  },
  data: {
    fontFamily: "IBM Plex Mono, ui-monospace, monospace",
    fontSize: "0.8125rem",
    fontWeight: 500,
    lineHeight: 1.45,
    letterSpacing: "0.01em",
  },
} as const;

export const radii = {
  button: "6px",
  input: "10px",
  card: "16px",
  pill: "9999px",
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  "2xl": "48px",
} as const;

export const shadows = {
  card: "0 8px 24px rgba(35, 28, 21, 0.14)",
  modal: "0 16px 40px rgba(35, 28, 21, 0.18)",
} as const;

export const navigation = {
  marketing: [
    { label: "How it works", href: "/how-it-works" },
    { label: "For clients", href: "/for-clients" },
    { label: "For workers", href: "/for-workers" },
    { label: "Developers", href: "/developers" },
    { label: "Sign in", href: "/sign-in" },
  ],
  product: [
    { label: "Overview", href: "/dashboard" },
    { label: "Payments", href: "/payments" },
    { label: "Reviews", href: "/reviews" },
    { label: "Receipts", href: "/receipts" },
    { label: "Refund scan", href: "/refund-scan" },
  ],
} as const;

export const tagline = "Pay with proof.";
export const corePromise = "Move money without giving up your recourse.";
export const primaryCta = "Protect a payment";
export const productName = "Reclaim";
