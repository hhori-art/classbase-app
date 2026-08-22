import JSZip from 'jszip';

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function slideNumber(path: string) {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

export async function extractPptxText(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides: { slide_no: number; text: string }[] = [];

  for (const path of slideFiles) {
    const xml = await zip.files[path].async('string');
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
      .map(match => decodeXml(match[1]).trim())
      .filter(Boolean);
    const text = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text) slides.push({ slide_no: slideNumber(path), text });
  }

  return {
    slide_count: slideFiles.length,
    text: slides.map(slide => `【${slide.slide_no}枚目】\n${slide.text}`).join('\n\n').trim(),
    slides,
  };
}
