// Study settings. Edit these, commit, and GitHub Pages serves the new version.
window.STUDY_CONFIG = {
  // URL of the deployed Google Apps Script web app (see apps_script/Code.gs and README.md).
  // Leave empty to test locally: answers are then only offered as a JSON download at the end.
  endpoint: "https://script.google.com/macros/s/AKfycbwWRlAkhOeMev13Yneo0UWKWqwlFJlRC4QIuvju5nDXjx59z9OJtPyowqV7GALSnjM/exec",

  // Pairs per participant, split evenly over the comparison groups (one prompt is never shown twice).
  trialsPerParticipant: 30,
  // Earlier trials shown again later with the sides swapped, to measure consistency.
  repeatTrials: 3,
  // Share of each participant's pairs drawn from "clean" pairs (neither clip collapsed into flat frames);
  // the rest come from the other pairs. The analysis reweights both strata to the full pair set.
  cleanShare: 0.8,
  // The choice buttons unlock after both clips have been on screen this long (clips are ~3 s).
  minViewMs: 3500,

  title: "Which video do you prefer?",
  lead: "Help us evaluate AI video generation. You will compare short clips generated from the same text description and tell us which one you prefer.",
  question: "Which video do you prefer for this description?",
  instructions: [
    "Read the description, then watch the two videos (A and B). They loop automatically.",
    "Pick the one you prefer, considering both how well it matches the description (objects, where they are, how they move) and how good it looks.",
    "There are no right or wrong answers. Use the buttons or the \u2190 / \u2192 arrow keys.",
  ],
  // Shown on the final screen, e.g. a completion code for a crowdsourcing platform. Empty = none.
  completionCode: "",
};
