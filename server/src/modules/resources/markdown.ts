const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;

export function stripHtml(value: string): string {
  return value.replace(SCRIPT_OR_STYLE, "").replace(HTML_TAG, "").replace(/javascript:/gi, "");
}
