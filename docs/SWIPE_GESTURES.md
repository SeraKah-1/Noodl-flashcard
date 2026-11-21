# Whole-card swipe interaction (v0.2)

## Behavior

The entire visible card is the gesture region, including scrollable center content,
questions, explanations, and **approved** images. The area behind an embedded
video iframe itself remains a true interactive surface owned by that provider.
Embedded button/link controls are never treated as tap-to-flip.

- Tap blank card or text: flip/unflip. Tap verified image: open image preview.
- Drag left (>=92px, or fast >=40px): rate 0 (Lupa) and advance.
- Drag right (same rule): rate 3 (Mudah) and advance.
- Short horizontal drag: spring back; do not flip or rate.
- Vertical drag: native text/image content scroll; do not flip or rate.
- Drag right then left (or vice versa): last effective displacement wins.
- Undo: undo last saved rating and return to the preceding card.
- Before flip: both drag directions work and save `answerRevealed: false`.

## Mechanism

`public/app.js#bindGestures()` tracks a single primary Pointer Event stream on
`#flashStage`. Horizontal intent is locked after moving >=8px and exceeding
vertical displacement. Only then does the handler prevent native selection.
`setPointerCapture()` keeps a horizontal drag alive outside the card. For
images, capture is delayed until horizontal intent so a tap still opens the
zoom preview; `lostpointercapture` from the original image (bubbled to stage)
is not interpreted as cancellation. Native dragstart is disabled for images.

`requestAnimationFrame` sets a hardware-accelerated `translate3d` and rotation
while active. The card animates offscreen, waits for local persistence and the
exit transition to complete, then shows the next card sliding in. Short drags
return with a spring easing. `reducedMotion` disables the extra animations.
The `pointercancel` path restores the card instead of recording a rating.

The gesture surface uses `touch-action: pan-y` so vertical scrolling still
works. A local capture-phase click guard prevents a swipe over an image from
opening its preview due to a delayed synthetic click. The guard is scoped
to the original card instance, never the next card.

## Regression checks

```sh
npm run check
npm test
python scripts/smoke_browser.py
python scripts/smoke_gestures.py
```

The browser scripts use in-memory DOM and the exact production JS/CSS.
`scripts/smoke_gestures.py` sends real mouse input and Chrome DevTools
Protocol touch events to an emulated mobile context. It checks both directions
from text center; reversal; short drag rebound; swipe from the back; Undo;
image tap-to-zoom; swipe from image center; and native vertical scrolling.
This does **not** verify physical mobile hardware, Cloudflare Workers,
or a live ChatGPT MCP connection.
