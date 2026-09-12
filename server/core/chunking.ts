export type PageInput = { pageId: number; pageNumber: number; text: string };
export type ChunkDraft = { pageId: number; pageNumber: number; text: string; startPosition: number; endPosition: number; chunkIndex: number };

function splitSentences(paragraph: string): string[] {
  return paragraph.match(/[^.!?؟。]+[.!?؟。]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [paragraph.trim()];
}

export function smartChunk(pages: PageInput[], maxCharacters = 900, overlapSentences = 1): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let index = 0;
  for (const page of pages) {
    const paragraphs = page.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let cursor = 0;
    let buffer = "";
    let bufferStart = 0;
    const flush = () => {
      const text = buffer.trim();
      if (!text) return;
      const leading = buffer.indexOf(text);
      const start = bufferStart + Math.max(0, leading);
      chunks.push({ pageId: page.pageId, pageNumber: page.pageNumber, text, startPosition: start, endPosition: start + text.length, chunkIndex: index++ });
      const tail = splitSentences(text).slice(-overlapSentences).join(" ");
      buffer = tail;
      bufferStart = start + Math.max(0, text.length - tail.length);
    };
    for (const paragraph of paragraphs) {
      const sentences = splitSentences(paragraph);
      for (const sentence of sentences) {
        const candidate = buffer ? `${buffer} ${sentence}` : sentence;
        if (candidate.length > maxCharacters && buffer) flush();
        if (!buffer) bufferStart = cursor;
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
        cursor += sentence.length + 1;
      }
      cursor += 1;
      if (buffer.length >= maxCharacters * 0.75) flush();
    }
    flush();
  }
  return chunks;
}
