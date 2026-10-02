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

## Programme application message (Awin's limit is 1,000 characters)

Replace `[BRAND]`. **Do not promise a `/[brand]-coupons` URL** — that page
can't exist before their deals sync, and a manager who clicks it gets a 404.
An earlier version of this message did exactly that, and the first Awin
rejection came back as "URL is irrelevant to advertiser brand". Point at a
page that already works instead.

> We're a US coupon site listing only offers from direct network partnerships — nothing scraped, no invented codes.
>
> This is the format every retailer gets: offermediscounts.com/marmot-coupons — a dedicated page carrying that brand's live offers, built to rank for "&lt;brand&gt; coupon code". [BRAND] would get the same once your offers sync.
>
> Codes are released only after a one-time SMS verification, so they never appear in page source, our API or our structured data — they can't be scraped and burnt out. Verified subscribers can separately opt in to future matching offers by SMS. TCPA compliant, STOP/HELP handled, opt-in flow documented at offermediscounts.com/opt-in-proof.html
>
> We're early — recently launched, growing through organic search — so I'd rather be upfront than oversell.
>
> partners@offermediscounts.com

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
