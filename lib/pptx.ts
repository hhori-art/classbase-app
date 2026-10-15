import JSZip from 'jszip';

const MAX_SLIDES = 300;
const MAX_SLIDE_XML_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SLIDE_XML_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 250_000;

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

  if (slideFiles.length === 0) throw new Error('pptx-has-no-slides');
  if (slideFiles.length > MAX_SLIDES) throw new Error('pptx-too-many-slides');

  let totalSlideXmlBytes = 0;
  for (const path of slideFiles) {
    const entry = zip.files[path] as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
    const uncompressedSize = Number(entry?._data?.uncompressedSize || 0);
    if (uncompressedSize > MAX_SLIDE_XML_BYTES) throw new Error('pptx-slide-too-large');
    totalSlideXmlBytes += uncompressedSize;
    if (totalSlideXmlBytes > MAX_TOTAL_SLIDE_XML_BYTES) throw new Error('pptx-content-too-large');
  }

  const slides: { slide_no: number; text: string }[] = [];

  for (const path of slideFiles) {
    const xml = await zip.files[path].async('string');
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
      .map(match => decodeXml(match[1]).trim())
      .filter(Boolean);
    const text = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text) slides.push({ slide_no: slideNumber(path), text });
  }

  const text = slides.map(slide => `【${slide.slide_no}枚目】\n${slide.text}`).join('\n\n').trim();
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) throw new Error('pptx-text-too-large');

  return {
    slide_count: slideFiles.length,
    text,
    slides,
  };
}
