// charter section 3549: the two transition longhands take the vocabularies the
// matching builders take. The longhand read a closed set while the builder read
// nothing, so 'backgroundColor' -- the camelCase spelling every other Look
// property is written with -- compiled clean and reached the browser as a
// declaration it discards. The set is the analyzer's, derived from the Look
// property table rather than restated here.
const transitionProperties = ["inherit","initial","revert","revert-layer","unset","none","all","box-sizing","z-index","clip","clip-path","object-fit","object-position","aspect-ratio","grid-template-columns","grid-template-rows","grid-template-areas","grid-auto-columns","grid-auto-rows","grid-auto-flow","grid-column","grid-column-start","grid-column-end","grid-row","grid-row-start","grid-row-end","grid-area","flex","flex-direction","flex-grow","flex-shrink","flex-basis","flex-wrap","order","gap","row-gap","column-gap","align-items","justify-items","justify-content","align-content","align-self","justify-self","place-items","place-content","place-self","width","height","min-width","max-width","min-height","max-height","inline-size","block-size","min-inline-size","max-inline-size","min-block-size","max-block-size","inset","top","right","bottom","left","inset-inline","inset-block","inset-inline-start","inset-inline-end","inset-block-start","inset-block-end","padding","padding-top","padding-right","padding-bottom","padding-left","padding-inline","padding-block","padding-inline-start","padding-inline-end","padding-block-start","padding-block-end","margin","margin-top","margin-right","margin-bottom","margin-left","margin-inline","margin-block","margin-inline-start","margin-inline-end","margin-block-start","margin-block-end","background","background-color","background-image","background-position","background-size","background-repeat","background-attachment","background-clip","background-origin","background-blend-mode","border","border-width","border-style","border-color","border-top","border-right","border-bottom","border-left","border-top-width","border-right-width","border-bottom-width","border-left-width","border-top-style","border-right-style","border-bottom-style","border-left-style","border-top-color","border-right-color","border-bottom-color","border-left-color","border-radius","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","outline","outline-width","outline-style","outline-color","outline-offset","box-shadow","text-shadow","opacity","filter","backdrop-filter","color","font-family","font-size","font-weight","font-style","font-stretch","font-variant","font-kerning","font-optical-sizing","font-feature-settings","font-variation-settings","line-height","vertical-align","letter-spacing","word-spacing","text-align","text-indent","text-decoration","text-decoration-color","text-decoration-line","text-decoration-style","text-decoration-thickness","text-underline-offset","text-underline-position","text-transform","text-rendering","white-space","text-overflow","text-wrap","overflow-wrap","word-break","hyphens","tab-size","writing-mode","text-orientation","direction","unicode-bidi","list-style","list-style-type","list-style-position","list-style-image","fill","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","translate","scale","rotate","transform","transform-origin","accent-color","caret-color","color-scheme","scroll-margin","scroll-margin-top","scroll-margin-right","scroll-margin-bottom","scroll-margin-left","scroll-padding","scroll-padding-top","scroll-padding-right","scroll-padding-bottom","scroll-padding-left","scroll-snap-align","scroll-snap-stop","scroll-snap-type","overscroll-behavior","overscroll-behavior-x","overscroll-behavior-y","scrollbar-color","scrollbar-width"];
function lookTransitionProperty(value) {
  value = lookText(value, "Transition property");
  if (transitionProperties.includes(value)) return value;
  // The longhand's diagnostic teaches the CSS spelling, so the rejection here
  // teaches the same one rather than only naming the value.
  let dashed = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    dashed += code >= 65 && code <= 90 ? "-" + value[index].toLowerCase() : value[index];
  }
  if (dashed !== value && transitionProperties.includes(dashed)) {
    throw new TypeError("Transition property '" + value + "' is not a CSS property name; did you mean '" + dashed + "'?");
  }
  throw new TypeError("Transition property '" + value + "' is not an animatable CSS property name");
}
function lookType(name, predicate) {
  return __velarRegisterRuntimeType(Object.freeze({
    is(value) { return predicate(value); },
    parse(value) {
      if (!predicate(value)) throw new TypeError(name + " received an invalid visual value");
      return value;
    },
  }));
}
const lengthPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax)$/;
const percentagePattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%$/;
const trackFractionPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)fr$/;
const durationPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/;
const anglePattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|turn)$/;
const calculatedLengthPattern = /^(?:calc|min|max|clamp)\(/;
const textVisual = (value) => typeof value === "string" && value.length > 0 && value.length <= 1024 * 1024;

export const Look = lookType("Look", (value) => value !== null && typeof value === "object" && lookOwnData(value, "__velarLook") === true);
export const Length = lookType("Length", (value) => typeof value === "string" && (lookMatches(lengthPattern, value) || lookMatches(calculatedLengthPattern, value)));
export const Percentage = lookType("Percentage", (value) => typeof value === "string" && lookMatches(percentagePattern, value));
export const LengthPercentage = lookType("LengthPercentage", (value) => typeof value === "string" && (lookMatches(lengthPattern, value) || lookMatches(percentagePattern, value) || lookMatches(calculatedLengthPattern, value)));
export const TrackFraction = lookType("TrackFraction", (value) => typeof value === "string" && lookMatches(trackFractionPattern, value));
export const Duration = lookType("Duration", (value) => typeof value === "string" && lookMatches(durationPattern, value));
export const Angle = lookType("Angle", (value) => typeof value === "string" && lookMatches(anglePattern, value));
export const Color = lookType("Color", textVisual);
export const Border = lookType("Border", textVisual);
export const Shadow = lookType("Shadow", textVisual);
export const Filter = lookType("Filter", textVisual);
export const Image = lookType("Image", textVisual);
export const Track = lookType("Track", textVisual);
export const TrackList = lookType("TrackList", textVisual);
export const Transition = lookType("Transition", textVisual);
export const Spacing = lookType("Spacing", textVisual);
export const Keyframes = lookType("Keyframes", (value) => lookOwnData(value, "__velarKeyframes") === true
  && typeof lookOwnData(value, "name") === "string");
export const Animation = lookType("Animation", (value) => lookOwnData(value, "__velarAnimation") === true
  && typeof lookOwnData(value, "css") === "string");

// D103: every written token() call is folded to its CSS text while the module
// compiles, because the analyzer has already proved the name is a literal
// custom property identifier. This implementation is what the published module
// interface promises anyway — the builder is an ordinary value that may be
// aliased, passed on, and called outside a look: block — so the same name check
// answers here rather than trusting a caller the compiler never saw.
const lookTokenNamePattern = /^--[A-Za-z0-9_-]+$/u;
export function token(name) {
  name = lookText(name, "Design token name");
  if (!lookMatches(lookTokenNamePattern, name)) {
    throw new TypeError("Design token name '" + name + "' is not a CSS custom property identifier: write '--' followed by one or more letters, digits, hyphens, or underscores");
  }
  return "var(" + name + ")";
}
export function color(value) { return lookText(value, "Color"); }
export function rgb(red, green, blue) {
  const channels = [red, green, blue].map((value, index) => lookRange(value, "RGB channel " + (index + 1), 0, 255));
  return lookResult("rgb(" + channels.join(" ") + ")");
}
export function rgba(red, green, blue, alpha) {
  const channels = [red, green, blue].map((value, index) => lookRange(value, "RGB channel " + (index + 1), 0, 255));
  return lookResult("rgb(" + channels.join(" ") + " / " + lookRange(alpha, "RGB alpha", 0, 1) + ")");
}
export function hsl(hue, saturation, lightness) {
  return lookResult("hsl(" + lookFinite(hue, "HSL hue") + " " + lookRange(saturation, "HSL saturation", 0, 100)
    + "% " + lookRange(lightness, "HSL lightness", 0, 100) + "%)");
}
export function alpha(value, opacity) {
  return lookResult("color-mix(in srgb, " + lookText(value, "Color") + " " + (lookRange(opacity, "Color opacity", 0, 1) * 100) + "%, transparent)");
}
export function lighten(value, amount) {
  return lookResult("color-mix(in srgb, " + lookText(value, "Color") + ", white " + (lookRange(amount, "Color amount", 0, 1) * 100) + "%)");
}
export function darken(value, amount) {
  return lookResult("color-mix(in srgb, " + lookText(value, "Color") + ", black " + (lookRange(amount, "Color amount", 0, 1) * 100) + "%)");
}
export function border(width, value, style = "solid") {
  if (typeof style !== "string" || !["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"].includes(style)) {
    throw new TypeError("Border style is invalid");
  }
  return lookResult(lookVisual(width, "Border width") + " " + style + " " + lookText(value, "Border color"));
}
export function shadow(x, y, blur, value, spread = "0px", inset = false) {
  if (typeof inset !== "boolean") throw new TypeError("Shadow inset must be bool");
  return lookResult((inset ? "inset " : "") + lookVisual(x, "Shadow x") + " " + lookVisual(y, "Shadow y") + " "
    + lookVisual(blur, "Shadow blur") + " " + lookVisual(spread, "Shadow spread") + " " + lookText(value, "Shadow color"));
}
export function blur(radius) { return lookResult("blur(" + lookNonNegativeVisual(radius, "Filter blur radius") + ")"); }
export function brightness(amount) { return lookResult("brightness(" + lookRange(amount, "Filter brightness", 0, 1000000) + ")"); }
export function contrast(amount) { return lookResult("contrast(" + lookRange(amount, "Filter contrast", 0, 1000000) + ")"); }
export function dropShadow(x, y, blur, value) {
  return lookResult("drop-shadow(" + lookVisual(x, "Drop shadow x") + " " + lookVisual(y, "Drop shadow y") + " "
    + lookNonNegativeVisual(blur, "Drop shadow blur") + " " + lookText(value, "Drop shadow color") + ")");
}
export function grayscale(amount) { return lookResult("grayscale(" + lookRange(amount, "Filter grayscale", 0, 1) + ")"); }
export function hueRotate(angle) { return lookResult("hue-rotate(" + lookVisual(angle, "Filter hue rotation") + ")"); }
export function invert(amount) { return lookResult("invert(" + lookRange(amount, "Filter inversion", 0, 1) + ")"); }
export function filterOpacity(amount) { return lookResult("opacity(" + lookRange(amount, "Filter opacity", 0, 1) + ")"); }
export function saturate(amount) { return lookResult("saturate(" + lookRange(amount, "Filter saturation", 0, 1000000) + ")"); }
export function sepia(amount) { return lookResult("sepia(" + lookRange(amount, "Filter sepia", 0, 1) + ")"); }
export function filters(first, ...rest) {
  const values = [first, ...rest];
  if (values.length > 64) throw new RangeError("filters cannot compose more than 64 values");
  return lookResult(values.map((value, index) => lookText(value, "Filter " + (index + 1))).join(" "));
}
export function linearGradient(angle, start, end) {
  return lookResult("linear-gradient(" + lookVisual(angle, "Gradient angle") + ", " + lookText(start, "Gradient start") + ", " + lookText(end, "Gradient end") + ")");
}
export function asset(path) { return lookResult("url(" + __velarCssString(lookText(path, "Asset path")) + ")"); }
export function minmax(minimum, maximum) { return lookResult("minmax(" + lookVisual(minimum, "Minimum track") + ", " + lookVisual(maximum, "Maximum track") + ")"); }
export function repeat(count, size) { return lookResult("repeat(" + lookVisual(count, "Repeat count") + ", " + lookVisual(size, "Repeat size") + ")"); }
export function tracks(first, ...rest) {
  const values = [first, ...rest];
  if (values.length > 1024) throw new RangeError("tracks cannot contain more than 1024 values");
  return lookResult(values.map((value, index) => lookVisual(value, "Track " + (index + 1))).join(" "));
}
export function transition(property, duration, easing = "ease", delay) {
  const suffix = delay === undefined ? "" : " " + lookVisual(delay, "Transition delay");
  return lookResult(lookTransitionProperty(property) + " " + lookVisual(duration, "Transition duration") + " " + lookText(easing, "Transition easing") + suffix);
}
export function spacing(first, second, third, fourth) {
  return lookResult([first, second, third, fourth].filter((value) => value !== undefined)
    .map((value, index) => lookVisual(value, "Spacing value " + (index + 1))).join(" "));
}
export function min(first, second) { return lookResult("min(" + lookVisual(first, "min value") + ", " + lookVisual(second, "min value") + ")"); }
export function max(first, second) { return lookResult("max(" + lookVisual(first, "max value") + ", " + lookVisual(second, "max value") + ")"); }
export function clamp(minimum, preferred, maximum) {
  return lookResult("clamp(" + lookVisual(minimum, "clamp minimum") + ", " + lookVisual(preferred, "clamp preferred") + ", " + lookVisual(maximum, "clamp maximum") + ")");
}
export function animate(frames, duration, easing = "ease", delay = "0ms", count = 1, loop = false, direction = "normal", fill = "none") {
  if (lookOwnData(frames, "__velarKeyframes") !== true) throw new TypeError("animate frames must be a Keyframes value");
  const name = lookText(lookOwnData(frames, "name"), "Keyframes name");
  if (!lookMatches(durationPattern, duration)) throw new TypeError("Animation duration must be a Duration value");
  if (!lookMatches(durationPattern, delay)) throw new TypeError("Animation delay must be a Duration value");
  if (!["linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"].includes(easing)) throw new TypeError("Animation easing is invalid");
  if (!["normal", "reverse", "alternate", "alternate-reverse"].includes(direction)) throw new TypeError("Animation direction is invalid");
  if (!["none", "forwards", "backwards", "both"].includes(fill)) throw new TypeError("Animation fill is invalid");
  if (typeof loop !== "boolean") throw new TypeError("Animation loop must be bool");
  count = lookFinite(count, "Animation count");
  if (!Number.isInteger(count) || count <= 0 || count > 1000000) throw new RangeError("Animation count must be a positive integer no greater than 1000000");
  const css = [name, duration, easing, delay, loop ? "infinite" : String(count), direction, fill].join(" ");
  return Object.freeze({ __velarAnimation: true, css: lookResult(css) });
}
