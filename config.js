// Study settings. Edit these, commit, and GitHub Pages serves the new version.
window.STUDY_CONFIG = {
  // URL of the deployed Google Apps Script web app (see apps_script/Code.gs and README.md).
  // Leave empty to test locally: answers are then only offered as a JSON download at the end.
  endpoint: "https://script.google.com/macros/s/AKfycbwWRlAkhOeMev13Yneo0UWKWqwlFJlRC4QIuvju5nDXjx59z9OJtPyowqV7GALSnjM/exec",

  // Pairs per participant, split evenly over the comparison groups (one prompt is never shown twice).
  trialsPerParticipant: 30,
  // Earlier trials shown again later with the sides swapped, to measure consistency.
  repeatTrials: 3,
  // The choice buttons unlock after both clips have been on screen this long (clips are ~3 s).
  minViewMs: 3500,

  title: "Which video do you prefer?",
  question: "Which video do you prefer for this description?",
  instructions: [
    "You will see pairs of short AI-generated videos, each made from the text description shown above them.",
    "For each pair, pick the video you prefer. Consider both how well it matches the description (objects, their positions and motion) and how good it looks.",
    "There are no right or wrong answers. The clips loop; watch them as long as you like.",
    "Use the buttons, or the ← / → arrow keys.",
  ],
  // Shown on the final screen, e.g. a completion code for a crowdsourcing platform. Empty = none.
  completionCode: "",
};
