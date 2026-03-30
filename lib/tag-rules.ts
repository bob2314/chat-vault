import { uniqueStrings } from "@/lib/utils";

const rules: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: "pets", patterns: [/\bdog\b/i, /\bcat\b/i, /\bpuppy\b/i, /\bpet\b/i, /\bvet\b/i] },
  { tag: "medical", patterns: [/\bdoctor\b/i, /\bmedical\b/i, /\bmri\b/i, /\bblood\b/i, /\bpain\b/i, /\bhealth\b/i] },
  { tag: "vehicles", patterns: [/\b4runner\b/i, /\bsprinter\b/i, /\btoyota\b/i, /\bmercedes\b/i, /\btrailer\b/i, /\bcar\b/i] },
  { tag: "housing", patterns: [/\bapartment\b/i, /\blease\b/i, /\brent\b/i, /\bbuilding\b/i, /\bunit\b/i, /\bmortgage\b/i] },
  { tag: "finance", patterns: [/\binsurance\b/i, /\bbudget\b/i, /\bloan\b/i, /\bpayment\b/i, /\bcost\b/i, /\bprice\b/i] },
  { tag: "software", patterns: [/\breact\b/i, /\bvue\b/i, /\bnode\b/i, /\btypescript\b/i, /\bcursor\b/i, /\bapi\b/i] },
  { tag: "travel", patterns: [/\bflight\b/i, /\bhotel\b/i, /\btrip\b/i, /\btravel\b/i, /\bairbnb\b/i, /\bphiladelphia\b/i] }
];

const aliases: Record<string, string> = {
  philly: "philadelphia",
  phil: "philadelphia",
  "toyota-4runner": "4runner",
  "4-runner": "4runner",
  auto: "vehicles",
  cars: "vehicles",
  vehicle: "vehicles",
  healthcare: "medical",
  health: "medical"
};

export function normalizeTag(input: string) {
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, "-");
  return aliases[cleaned] ?? cleaned;
}

export function inferTags(input: string, seedTags: string[] = []) {
  const ruleTags = rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(input)))
    .map((rule) => rule.tag);
  return uniqueStrings([...seedTags, ...ruleTags]).map(normalizeTag);
}
