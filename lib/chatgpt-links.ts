export function resolveChatGptConversationUrl(conversationId: string) {
  const trimmed = conversationId.trim();
  if (!trimmed) return null;

  if (/^https?:\/\/(chatgpt\.com|chat\.openai\.com)\/c\/[a-z0-9-]+$/i.test(trimmed)) {
    return trimmed.replace("chat.openai.com", "chatgpt.com");
  }

  const prefixed = trimmed.match(/^chatgpt-([a-z0-9-]+)$/i);
  if (prefixed?.[1]) {
    return `https://chatgpt.com/c/${prefixed[1]}`;
  }

  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(trimmed)) {
    return `https://chatgpt.com/c/${trimmed}`;
  }

  return null;
}
