// Local wall clock only; never reads or sets mixer time.
export function startLocalClock(element) {
  const segments = [
    "abcdef",
    "bc",
    "abdeg",
    "abcdg",
    "bcfg",
    "acdfg",
    "acdefg",
    "abc",
    "abcdefg",
    "abcdfg",
  ];
  function paint() {
    const time = new Date().toLocaleTimeString("en-IE", { hour12: false });
    element.setAttribute("aria-label", "Current local time " + time);
    element.innerHTML = [...time]
      .map((c) =>
        c === ":"
          ? '<span class="mm-colon" aria-hidden="true"></span>'
          : `<span class="mm-digit" aria-hidden="true">${[..."abcdefg"].map((s) => `<i class="${s} ${segments[+c].includes(s) ? "on" : ""}"></i>`).join("")}</span>`,
      )
      .join("");
  }
  paint();
  const timer = setInterval(paint, 1000);
  return () => clearInterval(timer);
}
