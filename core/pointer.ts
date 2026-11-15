// Text a model may not leave behind in a note: anything that could carry a recipient, a number to
// call or a link. Pure, shared by working memory (core/memory.ts) and a head's focus notes
// (core/plan-rules.ts).
export const OUTSIDE_POINTER = /@|https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|coffee|shop|us|biz|info|app|dev)\b|\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b|\+\d[\d\s-]{7,}\d/i;
