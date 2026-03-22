import { uniqueStrings } from "@/lib/utils";

const rules: Array<{ topic: string; patterns: RegExp[] }> = [
  { topic: "travel", patterns: [/philadelphia/i, /airbnb/i, /hotel/i, /flight/i, /trip/i] },
  { topic: "software", patterns: [/react/i, /vue/i, /node/i, /typescript/i, /cursor/i, /api/i] },
  { topic: "finance", patterns: [/budget/i, /insurance/i, /payment/i, /loan/i, /price/i] },
  { topic: "health", patterns: [/mri/i, /doctor/i, /pain/i, /vitamin/i, /bloodwork/i] },
  { topic: "vehicles", patterns: [/4runner/i, /sprinter/i, /toyota/i, /mercedes/i, /trailer/i] },
  { topic: "housing", patterns: [/apartment/i, /lease/i, /rent/i, /building/i, /unit/i] }
];

export function inferTopics(input: string) {
  return uniqueStrings(
    rules
      .filter((rule) => rule.patterns.some((pattern) => pattern.test(input)))
      .map((rule) => rule.topic)
  );
}
