# Affiliate network copy

The text used to apply to programmes and to fill in network profiles. Kept
here because it gets reused for weeks and was otherwise only in chat history.

Every claim below is verifiable by loading the site. That is deliberate — an
affiliate manager checks, and the compliance paragraph only carries weight
because the rest of it holds up.

## Before clicking Join — the checklist

1. **Tick the website in the "Promotion" dropdown.** "Content" is only the
   group heading; `https://www.offermediscounts.com/` is the item that has to
   be selected. Submitting without it sends the advertiser an application
   with no promotional space attached, and the closest rejection reason on
   their list is then "URL is irrelevant to advertiser brand" — which is
   exactly what came back from the first one.
2. Paste the message below, replacing `[BRAND]`.
3. Read the programme's own terms before ticking the box, at least for
   trademark-bidding and coupon-publisher clauses. They differ per advertiser
   and agreeing to one you haven't read is how a programme gets terminated
   later.

## Three lengths

Pick by the field's limit. **In all of them the `marmot-coupons` URL is a
page that actually resolves** — never promise `/[brand]-coupons`, which
can't exist before their deals sync. An early version did, a manager
presumably clicked it and got a 404, and the first Awin rejection came back
as "URL is irrelevant to advertiser brand".

### 500 characters (498)

Drops the `[BRAND]` personalisation to keep the brand-safety line, which is
the claim most coupon sites can't make and the objection managers actually
have.

> We're a US coupon site listing only offers from direct CJ, Impact and Awin partnerships — nothing scraped, no invented codes. Every retailer gets a page like offermediscounts.com/marmot-coupons, built to rank for their coupon terms. Codes unlock only after a one-time SMS verification, so they never reach page source or our API and can't be scraped and burnt out. Tobacco, adult and cannabis advertisers are excluded by policy. TCPA compliant, opt-in flow at offermediscounts.com/opt-in-proof.html

### 1,000 characters (972 — Awin's Join Program limit)

Replace `[BRAND]` and nothing else — it is the only placeholder. An earlier
draft also had a literal `<brand>` inside the quoted search term, which in a
sent message reads as a mail merge that failed. The quote now names Marmot,
matching the URL beside it, so the sentence demonstrates the claim instead of
describing it. 964 characters; 984 with a long brand name substituted.

> We're a US coupon site listing only offers from direct network partnerships — nothing scraped, no invented codes.
>
> This is the format every retailer gets: offermediscounts.com/marmot-coupons — a dedicated page carrying their live offers, built to rank for "Marmot coupon code". [BRAND] would get the same once your offers sync.
>
> The listing is the hook; the asset is a verified, opted-in SMS audience. Codes unlock only after a one-time phone verification, so they never appear in page source or our API and can't be scraped and burnt out. Subscribers then separately opt in to future offers and tell us which categories they want, so a new promotion reaches the subscribers who named your category rather than the whole list. TCPA compliant, STOP/HELP handled, opt-in flow documented at offermediscounts.com/opt-in-proof.html
>
> We're early — recently launched, growing through organic search — so I'd rather be upfront than oversell.
>
> partners@offermediscounts.com

### Long form (468 words)

For a long application field or a direct email to an affiliate manager. Drop
the bold headers if the field is plain text.

> OfferMeDiscounts.com is a US coupon and deals site built on a simple premise: people shouldn't have to hunt for a discount. Visitors tell us what they're into, and we surface — and text — the offers that match.
>
> **Where the offers come from.** Every offer comes from a direct affiliate partnership through CJ, Impact or Awin. Nothing is scraped from other coupon sites, and no code is invented, guessed at or crowdsourced. That keeps the catalog smaller than an aggregator's — we only list brands we actually have a relationship with — and it means every code on the page came from the advertiser who issued it.
>
> **What a partnership looks like.** Each retailer gets a dedicated page carrying their live offers, built to rank for "&lt;brand&gt; coupon code". offermediscounts.com/marmot-coupons is the current format. Offers also appear in the main deal feed and in category browsing. The catalog re-syncs daily, so expired promotions come down on their own rather than accumulating.
>
> **The asset is an opted-in SMS audience.** The listing is the acquisition hook; what we're building is a verified, permission-based messaging audience. Codes are released only after a one-time phone verification. They never appear in page source, in our public API, or in structured data — which is how they keep working instead of being scraped and burnt out within days of going live. Verified subscribers then separately opt in to future offers and tell us which categories they care about, so a new promotion reaches the subscribers who named that category rather than the whole list.
>
> **Compliance.** Express written consent, collected as a distinct, unchecked step that is never bundled into the verification. STOP and HELP are handled, and the number is a carrier-vetted toll-free line. The full opt-in flow is documented publicly at offermediscounts.com/opt-in-proof.html if you want to review it before approving.
>
> **Brand adjacency.** Advertisers are filtered before anything reaches the site. Tobacco and vape, adult products, cannabis and sexual-health categories are excluded by policy — partly because carriers restrict that content on messaging channels, and partly because your offer shouldn't sit next to it. Per-advertiser caps and duplicate collapsing stop any single merchant dominating a page.
>
> **Link integrity.** Every outbound link is followed to the retailer's own site daily, and anything that fails twice running is removed. Dead codes are the usual complaint about coupon sites; this is how we keep them off ours.
>
> **Where we are.** We're early. The site launched recently and grows through organic search on per-retailer pages. I'd rather be upfront about scale than oversell it: the mechanism is built and live, the audience is still small, and partners who join now get a dedicated page from day one rather than waiting in a queue behind a thousand merchants.
>
> Happy to answer questions or walk through the opt-in flow.
>
> partners@offermediscounts.com

### The one line to hold

If a manager asks how many SMS subscribers there are, answer honestly. Every
version above describes the **mechanism**, which is built and verifiable, not
an **audience**, which is currently zero verified numbers. The "we're early"
line exists so that answer isn't a surprise.

817 characters, 837 with a long brand name substituted.

## Network profile description

No deal or retailer counts: a profile is static text describing a live
number, so it only ever drifts, and overstating is worse than saying
nothing. `/stores` reports the real figure on every request.

> OfferMeDiscounts.com is a US coupon and deals site built around one idea: you shouldn't have to hunt for a discount. Visitors tell us what they're into, and we surface — and text — the offers that match.
>
> Every offer comes from a direct affiliate partnership with the retailer, through CJ, Impact and Awin. Nothing is scraped from other coupon sites, and no code is invented or guessed at. That limits the catalog to brands we actually have a relationship with — smaller than sites that aggregate, and verified end to end.
>
> Codes are released only after a one-time SMS verification. They are never published in page source, in our API, or in structured data — which is how they keep working instead of being scraped and burnt out. Verified subscribers may separately opt in to receive future matching offers by SMS; that consent is a distinct, unchecked step, never bundled into verification. We are TCPA compliant, handle STOP and HELP, and use a carrier-vetted toll-free number. Our opt-in flow is documented publicly at offermediscounts.com/opt-in-proof.html
>
> The catalog re-syncs daily. Every outbound link is followed to the retailer's own site, and anything that fails twice is removed — so expired codes don't accumulate.
>
> Contact: partners@offermediscounts.com

### 250-character version, where that's the limit

> Verified coupon codes from direct CJ, Impact and Awin partnerships. Nothing scraped. Codes are gated behind one-time SMS verification, never published on-page. Subscribers separately opt in to offers by SMS. TCPA compliant, STOP honored.

## Awin promotional type

One tick: **Discount Code**, under Content. Nothing under Display, Email or
Search — every option in those groups describes buying placement, which this
site doesn't do. There is no SMS type in Awin's taxonomy, which is why the
messaging channel has to be declared in the free-text description instead;
an undeclared channel is a termination risk once traffic shows up from it.

Two traps in that form: "Direct Traffic" means banners and pop-ups, not
people arriving directly, and "Linking via Landing Pages" is a paid-search
model, not SEO.

## What gets rejected, and why it isn't about the site

Premium, full-price brands decline coupon publishers as policy. Arc'teryx
put it in writing: "we are currently not accepting websites that are coupon
oriented". No amount of site work changes that, and appealing spends
credibility with an agency that manages many other programmes.

Apply to brands that discount routinely — they're the ones carrying 15+ live
vouchers, and they're looking for exactly this placement.
