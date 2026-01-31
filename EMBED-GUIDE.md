# No Mow Worries Quote Widget - Embed Guide

## Quick Embed (Recommended)

Add this to your website where you want the quote widget:

```html
<div id="nmw-quote-widget" style="min-height: 800px; max-width: 100%; overflow-x: hidden;"></div>
<iframe 
    src="https://estimate-widget.vercel.app/?embed=true" 
    style="width: 100%; max-width: 100%; height: 900px; border: none; display: block; overflow: hidden;"
    scrolling="no"
    frameborder="0"
    allowtransparency="true"
    title="Get a Quote">
</iframe>
```

**Mobile Note:** The widget is designed to feel native when embedded. Content scrolls with the page, no horizontal scroll.

## Alternative: Using the Embed Script

Add this where you want the widget:

```html
<div id="nmw-widget"></div>
<script src="https://estimate-widget.vercel.app/embed.js"></script>
```

The script automatically resizes the iframe based on content.

## WordPress

For WordPress sites, add the iframe embed code to a Custom HTML block or use a plugin like "Insert Headers and Footers" to add it to a specific page.

## Full-Page Link

Or just link directly:
```
https://estimate-widget.vercel.app/
```

---

## Technical Details

- Widget is hosted on Vercel (auto-deploys from GitHub)
- Backend is on VPS (handles Copilot CRM integration)
- Mobile responsive
- Auto-detects embed mode (adds scrolling, adjusts layout)

## Fixes Applied (Jan 31, 2026)

1. **Photo Duplication Fix** - Prevents duplicate photos from being uploaded
2. **Customer Notes Enhancement** - Captures all property details (gate, dog, stairs, overgrown)
3. **Server-side Deduplication** - Belt-and-suspenders duplicate prevention

## Contact

Questions? Email nomowworriesco@gmail.com
