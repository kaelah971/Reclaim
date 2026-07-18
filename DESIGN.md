---
version: alpha
name: Reclaim
description: "The Proof Ledger — protected cUSD payments expressed as a calm, human-readable agreement from terms through settlement."
colors:
  primary: "#231C15"
  page: "#F5EFE4"
  hero: "#F2EBDD"
  surface: "#FFFFFF"
  utility: "#3A2E22"
  ink: "#1E1A15"
  muted: "#8A7F6E"
  gold: "#B4884A"
  gold-on-dark: "#C9A050"
  success: "#4C8A5E"
  border: "#E4D9C6"
  input: "#F7EFE2"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: 4rem
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  h1:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: 2.75rem
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "Georama, Satoshi, sans-serif"
    fontSize: 1.75rem
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body-md:
    fontFamily: "Georama, Satoshi, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.01em"
rounded:
  button: 6px
  input: 10px
  card: 16px
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#F5EFE4"
    typography: "{typography.body-md}"
    rounded: "{rounded.button}"
    padding: 12px
    height: 48px
  button-primary-hover:
    backgroundColor: "{colors.utility}"
    textColor: "#F5EFE4"
    rounded: "{rounded.button}"
    padding: 12px
    height: 48px
  button-secondary:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: 12px
    height: 48px
  card-payment-room:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 32px
  status-protected:
    backgroundColor: "#EAF3EC"
    textColor: "#235235"
    rounded: "{rounded.pill}"
    padding: 8px
---

## Overview

Reclaim is a protected-payment layer for cUSD commerce on Celo. It gives clients and digital workers one shared **Payment Room**: clear terms, funds held in escrow, delivery evidence, a fair dispute path, and an on-chain receipt.

The brand idea is **The Proof Ledger**. It makes an agreement visible from beginning to end:

> **Terms → Funds → Delivery → Evidence → Resolution → Receipt**

The supplied warm ivory, cream, espresso, sand and gold visual field remains intact. It is deliberately warmer than a conventional fintech interface. That warmth should communicate human commerce and calm care, not memorial hospitality. Reclaim must never look like a bank, DeFi trading terminal, legal case-management tool, or generic AI dashboard.

### Core visual principle

**A payment is a shared agreement, not a transfer row.** The product should help both parties see what was promised, what has happened, what evidence exists, and what action comes next.

## Colors

### Preserved visual base

| Token | HEX | Use |
|---|---:|---|
| Warm Ivory | `#F5EFE4` | Main page background; the calm, human ground of the brand |
| Soft Cream | `#F2EBDD` | Hero and quiet explanatory sections; carries the faint dot-grid texture |
| White | `#FFFFFF` | Payment Room cards, proof documents, evidence panels and important forms |
| Deep Espresso | `#3A2E22` | Utility bar, dark secondary surfaces and hover state |
| Near-Black Espresso | `#231C15` | Primary navigation, primary CTA, high-focus text and brand anchor |
| Near-Black Ink | `#1E1A15` | Primary text on light surfaces |
| Warm Taupe | `#8A7F6E` | Secondary text, metadata, helper text and quiet labels |
| Antique Gold | `#B4884A` | Limited emphasis: Accord Line, milestone markers, small iconography and selected heading detail |
| Gold on Dark | `#C9A050` | Supporting labels and links on espresso surfaces |
| Soft Green | `#4C8A5E` | Confirmed protection, successful settlement and verified status only |
| Warm Sand | `#E4D9C6` | Borders, rules, dividers and inactive structure |
| Pale Sand | `#F7EFE2` | Input fields, non-critical information groups and prefilled form areas |

### Colour rules

- Preserve the supplied warm visual field. Do not introduce cold blue, neon green, purple gradients, glassmorphism, chrome, or generic blockchain graphics.
- Antique Gold is an **accent**, never a large background fill and never the only signal for a successful settlement.
- Soft Green means **confirmed, protected or settled**. Pair it with a written status and icon; never rely on green alone.
- Amber-gold may indicate a milestone or missing detail, but a formal dispute or destructive action must rely on explicit language, iconography and strong contrast—not ornamental colour.
- Maintain WCAG AA contrast for all final text pairs. Body text is never set in low-opacity taupe.

## Typography

The former memorial-style Playfair/Lora approach is replaced. Reclaim needs a more grounded editorial voice paired with crisp financial utility.

| Role | Typeface | Use |
|---|---|---|
| Agreement / display | **Newsreader** | Landing-page statement, payment title, receipt title and major explanatory moments. It makes agreements feel human, not legalistic. |
| Interface / body | **Georama** | Navigation, forms, body copy, buttons, statuses, claims and all functional UI. |
| Data / verification | **IBM Plex Mono** | Dates, cUSD amounts, deadlines, state IDs, evidence identifiers, transaction hashes and receipt data. |

### Type hierarchy

| Token | Desktop | Mobile | Use |
|---|---:|---:|---|
| Display | 64px | 42px | Marketing statement only |
| H1 | 44px | 32px | Payment Room or case title |
| H2 | 28px | 24px | Major section |
| H3 | 20px | 18px | Module heading |
| Body | 16px | 16px | Default content |
| Data | 13px | 13px | Amounts, dates and identifiers; never below 12px |

Use `font-variant-numeric: tabular-nums` for all monetary values, dates and case IDs. Do not use all caps for primary actions; financial actions require immediate comprehension. All-caps, tracked labels are permitted only for quiet metadata such as `PAYMENT TERMS` or `EVIDENCE STATUS`.

## Layout

### Page structure

The supplied two-tier header, trust strip, cream hero, card elevation, and document-stack visual treatment remain. Their product purpose changes.

- **Utility bar:** concise Celo/network status, support and region/legal notice. No marketing clutter.
- **Main navigation:** Reclaim wordmark, How it works, For clients, For sellers, Developers, Sign in and `Protect a payment` CTA.
- **Trust strip:** terms clear, funds protected, evidence recorded, settlement visible, mobile-ready.
- **Hero:** left side explains the outcome; right side previews a real **Payment Room**—not generic illustration.
- **Floating cards:** preview payment terms, evidence status, and a plain-language settlement receipt. They show what using Reclaim produces.

### Payment Room hierarchy

1. Current money state: amount, cUSD, escrow state, relevant deadline.
2. What was agreed: deliverable, release rule and dispute window.
3. The one next action for the current participant.
4. Shared timeline: terms, deposit, acceptance, delivery, evidence, dispute and settlement.
5. Evidence and AI-prepared case summary.
6. On-chain receipt and verification detail.

### Responsive behaviour

On mobile, preserve a sticky money-state strip; stack the shared agreement before evidence; use clear bottom sheets for deposit, approval, dispute and settlement confirmation. Touch targets are at least 44 × 44px. No core action may rely on hover or a desktop-only table.

## Elevation & Depth

- Use flat warm backgrounds and white document surfaces. Shadows are soft, dark and structural: `0 8px 24px rgba(35,28,21,.14)` for standard cards and `0 16px 40px rgba(35,28,21,.18)` for a modal or confirmed receipt.
- Avoid glowing cards and coloured shadows.
- The faint hero dot-grid texture remains at very low opacity. It suggests a ledger or document field—not a decorative tech pattern.

## Shapes

- Primary buttons: 4–6px radius; deliberate, calm and stable.
- Inputs: 8–10px radius.
- Cards and document surfaces: 12–20px radius depending on scale.
- Pills: only for short statuses, role badges, small filters and protection state—not every container.
- The **Accord Line** is Reclaim’s proprietary visual asset: a restrained continuous line connecting agreement milestones from terms through receipt. It may appear in timeline, payment state, evidence map and share card. It is never a literal blockchain chain.

## Components

### Primary action

Primary CTA is espresso with cream text: `Protect a payment`, `Deposit cUSD`, `Approve release`, or `Open dispute`. Use one primary action per decision area. A destructive action must be visually and verbally distinct; never hide it in a generic ellipsis menu.

### Payment state strip

Shows amount, asset, current state, deadline and next owner. Example:

> `100.00 cUSD · Funds protected · Delivery due 18 Jul · Seller action required`

This remains visible in the Payment Room. Amounts and deadlines use IBM Plex Mono/tabular numerals.

### Terms block

A readable agreement summary, not a legal wall. Required fields: amount, seller, deliverable, deadline, release rule, dispute window, evidence expectation and platform fee. Terms are shown before funds are deposited.

### Evidence map

Evidence is connected to claims and the timeline. Show: submitted, missing, disputed and verified. Files remain off-chain; the interface exposes human-readable file information plus the stored hash/identifier for verification.

### AI case packet

Use a neutral, document-like format: buyer claim, seller claim, agreed terms, timeline, evidence inventory, missing/contradictory items, and proposed question for reviewers. The interface must state:

> **AI prepares the case. People vote. The contract settles.**

### Settlement receipt

The receipt is a product moment. It explains final outcome, allocated amount, participating wallets, relevant actions, transaction IDs and verification link in plain language. Do not charge a user merely to understand their own receipt.

### Motion

Use 160–240ms transitions for ordinary state change. The Accord Line may progress after deposit, acceptance, delivery or settlement. Support `prefers-reduced-motion`; no financial status may depend solely on animation.

## Do's and Don'ts

### Do

- Preserve the warm page, hero, card and floating-document visual language supplied in the reference.
- Use Newsreader for agreement and receipt titles; Inter for all working interface; IBM Plex Mono for proof and money data.
- Make terms, funds, evidence and current state more visually important than AI features.
- Show actual product outcomes in hero decoration: terms, escrow status, proof, receipt.
- Keep AI neutral and subordinate to human review.
- Give payment protection and settlement their own clear visual states.

### Don't

- Do not use funeral, memorial, concierge, travel-booking or hospitality language in Reclaim copy.
- Do not use generic dark DeFi dashboards, neon green, blue-purple gradients, glass panels, crypto coins, chains or shield icons as decoration.
- Do not turn every element into a rounded card or pill.
- Do not make a dispute feel like a gamified fight or a settlement feel like casino celebration.
- Do not use serif type for dense terms, forms, body copy, labels or transaction detail.
- Do not make users decode fees, deadlines, release rules or transaction status.
