import { PDFDocument } from 'pdf-lib';

export async function countPdfPages(buffer: Buffer): Promise<number> {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}
